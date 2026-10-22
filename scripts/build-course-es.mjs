// Baut den Datenkurs „Spanisch – Wortschatz“ (data/courses/de-es-wortschatz.json) aus offenen Quellen.
// Eingaben: .cache/sources/es/ (Downloads, nicht im Repo, Quellen siehe data/courses/PROVENIENZ.md) und die
// kuratierten Listen in data/build/es/. Ausgabe ist deterministisch (gleiche Eingaben → gleiche Datei).
// Aufruf: node scripts/build-course-es.mjs [--liste datei.tsv]   (--liste: Kandidaten zum Durchsehen)
// Quelldateien sind fremde Daten: sie werden nur gelesen und geparst, nie ausgeführt.
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { normalize, looseNormalize } from '../src/grading.js';
import { validateCourse } from '../src/content.js';

const SRC = fileURLToPath(new URL('../.cache/sources/es/', import.meta.url));
const CUR = fileURLToPath(new URL('../data/build/es/', import.meta.url));
const OUT = fileURLToPath(new URL('../data/courses/de-es-wortschatz.json', import.meta.url));

// Stellschrauben (Einheiten und Abschnitte: data/build/es/lehrplan.json)
const MIN_WORDS = 2; // Satzlänge in Wörtern
const MAX_WORDS = 12;
const NOTE_MAX = 250;

const started = performance.now();
const log = (msg) => console.log(`[${((performance.now() - started) / 1000).toFixed(1)} s] ${msg}`);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- Hilfen zum Lesen --------------------------------------------------------------------------------

async function* lines(path) {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

/** Liest eine Datei über ein Entpackprogramm (bzip2/tar) zeilenweise; Argumente fest, keine Shell. */
async function* commandLines(cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const done = new Promise((res, rej) => child.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')}: Exit ${code}`)))));
  child.stdout.setEncoding('utf8');
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) yield line;
  await done;
}

/** Kuratierte Textdatei: Zeilen ohne Kommentare (# …) und Leerzeilen; TSV-Spalten getrennt. */
async function curated(name, path = CUR + name) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').map((l) => l.replace(/\s+#.*$|^#.*$/, '').replace(/\s+$/, '')).filter(Boolean).map((l) => l.split('\t').map((c) => c.trim()));
}

// --- Spanische Wörter: Häufigkeit, Formen → Lemma ----------------------------------------------------

const FUNCTION_POS = new Set(['prep', 'conj', 'pron', 'det', 'article', 'adv', 'num', 'particle', 'contraction', 'postp']);
const LEMMA_POS = new Set([...FUNCTION_POS, 'noun', 'verb', 'adj', 'intj']);
const BAD_TAGS = new Set(['vulgar', 'offensive', 'derogatory', 'slur', 'ethnic', 'pejorative', 'obscene']);
// Nur bei Formverweisen ausgewertet (Bedeutungs-Tags enthalten oft Angaben aus dem Kopf des Eintrags).
const WEAK_TAGS = new Set(['obsolete', 'archaic', 'misspelling', 'voseo']);
const CLITICS = { me: 'me', te: 'te', se: 'se', nos: 'nos', os: 'os', lo: 'lo', la: 'lo', los: 'lo', las: 'lo', le: 'le', les: 'le' };

async function readFrequency() {
  const freq = new Map();
  for await (const line of lines(SRC + 'frequencywords/es_50k.txt')) {
    const [form, n] = line.split(' ');
    if (form && /^[a-záéíóúüñ]+$/.test(form) && !freq.has(form)) freq.set(form, Number(n) || 0);
  }
  return freq;
}

/**
 * en.wiktionary (kaikki): nur Einträge, deren Stichwort eine häufige Form ist, werden geparst.
 * Ergebnis je Wort: Lesarten { pos, self (eigenes Lemma), lemmas [{lemma, clitics}], gender, en, bad }.
 */
async function readKaikkiEn(wanted) {
  const byWord = new Map();
  const marker = '", "lang": "Spanish"';
  for await (const line of lines(SRC + 'kaikki-en/kaikki.org-dictionary-Spanish.jsonl')) {
    // Das Stichwort steht vor "lang": "Spanish" (verschachtelte Einträge können ebenfalls so aussehen).
    let hit = false;
    for (let end = line.indexOf(marker); end >= 0 && !hit; end = line.indexOf(marker, end + 1)) {
      const start = line.lastIndexOf('"word": "', end);
      hit = start >= 0 && wanted.has(line.slice(start + 9, end));
    }
    if (!hit) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.word !== 'string' || !wanted.has(e.word) || !LEMMA_POS.has(e.pos)) continue;
    const reading = { pos: e.pos, self: false, lemmas: [], gender: null, en: [], bad: false };
    let good = 0;
    let bad = 0;
    for (const s of e.senses ?? []) {
      const tags = s.tags ?? [];
      const target = s.form_of ?? s.alt_of;
      if (Array.isArray(target) && target.length) {
        if (tags.some((t) => WEAK_TAGS.has(t))) continue;
        const gloss = (s.glosses ?? []).join(' ');
        const m = gloss.match(/combined with (.*)$/);
        const clitics = m ? [...new Set((m[1].match(/\b(me|te|se|nos|os|lo|la|los|las|le|les)\b/g) ?? []).map((c) => CLITICS[c]))] : [];
        for (const t of target) {
          if (typeof t?.word === 'string' && /^[a-záéíóúüñ]+$/.test(t.word) && t.word !== e.word) reading.lemmas.push({ lemma: t.word, clitics, tags });
        }
        continue;
      }
      if (!Array.isArray(s.glosses) || !s.glosses.length) continue;
      if (tags.some((t) => BAD_TAGS.has(t))) { bad++; continue; }
      good++;
      if (reading.en.length < 3) reading.en.push(s.glosses.at(-1).slice(0, 60));
    }
    reading.self = good > 0;
    reading.bad = bad > 0 && good === 0;
    if (e.pos === 'noun') {
      const args = (e.head_templates ?? []).find((h) => h.name === 'es-noun')?.args;
      const g = String(args?.['1'] ?? '');
      reading.gender = /^mf|^fm/.test(g) ? 'mf' : g.startsWith('m') ? 'm' : g.startsWith('f') ? 'f' : null;
      if (/-p$/.test(g)) reading.gender += '-p';
    }
    if (!reading.self && !reading.lemmas.length && !reading.bad) continue;
    if (!byWord.has(e.word)) byWord.set(e.word, []);
    byWord.get(e.word).push(reading);
  }
  return byWord;
}

/** de.wiktionary (kaikki): spanische Einträge mit deutschen Bedeutungen und Übersetzungen (inkl. Genus). */
async function readKaikkiDe() {
  const byWord = new Map();
  for await (const line of lines(SRC + 'kaikki-de/kaikki.org-dictionary-Spanisch.jsonl')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.word !== 'string' || !LEMMA_POS.has(e.pos)) continue;
    const senses = (e.senses ?? []).map((s) => (s.glosses ?? []).join(', ')).filter((g) => typeof g === 'string' && g);
    const tr = (e.translations ?? []).filter((t) => t.lang_code === 'de' && typeof t.word === 'string')
      .map((t) => ({ word: t.word, idx: Number(t.sense_index) || 1, gender: genderTag(t.tags) }));
    if (!byWord.has(e.word)) byWord.set(e.word, []);
    byWord.get(e.word).push({ pos: e.pos, senses, tr, gender: genderTag(e.tags) });
  }
  return byWord;
}

function genderTag(tags) {
  if (!Array.isArray(tags)) return null;
  if (tags.includes('masculine') && tags.includes('feminine')) return 'mf';
  return tags.includes('masculine') ? 'm' : tags.includes('feminine') ? 'f' : tags.includes('neuter') ? 'n' : null;
}

const WIKDICT_POS = { sustantivo: 'noun', verbo: 'verb', adjetivo: 'adj', adverbio: 'adv', Substantiv: 'noun', Verb: 'verb', Adjektiv: 'adj', Adverb: 'adv' };
const wikdictPos = (lexentry) => {
  const m = String(lexentry ?? '').match(/__([A-Za-zä]+)/);
  return m ? WIKDICT_POS[m[1]] ?? 'other' : null;
};

/** WikDict: es→de-Übersetzungen und umgekehrt de→es (für Kandidaten je spanischem Lemma). */
function readWikdict() {
  const fwd = new Map();
  const rev = new Map();
  const add = (map, key, val) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  };
  const es = new DatabaseSync(SRC + 'wikdict/es-de.sqlite3', { readOnly: true });
  for (const r of es.prepare('SELECT lexentry, written_rep, trans_list, score, is_good FROM translation ORDER BY written_rep, rowid').iterate()) {
    for (const de of String(r.trans_list ?? '').split(' | ')) {
      if (de) add(fwd, r.written_rep, { de, pos: wikdictPos(r.lexentry), score: Number(r.score) || 0, good: !!r.is_good });
    }
  }
  es.close();
  const de = new DatabaseSync(SRC + 'wikdict/de-es.sqlite3', { readOnly: true });
  for (const r of de.prepare('SELECT lexentry, written_rep, trans_list, score FROM translation ORDER BY written_rep, rowid').iterate()) {
    for (const w of String(r.trans_list ?? '').split(' | ')) {
      if (w) add(rev, w, { de: r.written_rep, pos: wikdictPos(r.lexentry), score: Number(r.score) || 0 });
    }
  }
  de.close();
  return { fwd, rev };
}

// --- Tatoeba ---------------------------------------------------------------------------------------

const BAD_TAG_RE = /^@|vulg|sex|slang|rude|insult|offens|pejor|derog|obsc|profan|drug|crime|violen|\bwar\b|death|suicid|porn|bibl|bib-|religi|politic|voseo|orthograph|archai|old-fashioned|dialect|scolding|copyright/i;

async function readTatoeba() {
  const dir = SRC + 'tatoeba/';
  const bz = (f) => commandLines('bzip2', ['-dc', dir + f]);
  const native = { spa: new Set(), deu: new Set() };
  for await (const line of commandLines('tar', ['-xOjf', dir + 'user_languages.tar.bz2'])) {
    const [lang, level, user] = line.split('\t');
    if (level === '5' && native[lang] && user) native[lang].add(user);
  }
  const badIds = new Set();
  for (const f of ['spa_tags.tsv.bz2', 'deu_tags.tsv.bz2']) {
    for await (const line of bz(f)) {
      const [id, tag] = line.split('\t');
      if (tag && BAD_TAG_RE.test(tag)) badIds.add(Number(id));
    }
  }
  const s2d = new Map();
  const d2s = new Map();
  for await (const line of bz('spa-deu_links.tsv.bz2')) {
    const [a, b] = line.split('\t').map(Number);
    if (!a || !b) continue;
    if (!s2d.has(a)) s2d.set(a, []);
    s2d.get(a).push(b);
    if (!d2s.has(b)) d2s.set(b, []);
    d2s.get(b).push(a);
  }
  const readSentences = async (f, keep) => {
    const map = new Map();
    for await (const line of bz(f)) {
      const [id, , text, user] = line.split('\t');
      const n = Number(id);
      if (keep && !keep.has(n)) continue;
      map.set(n, { id: n, text: text ?? '', user: user && user !== '\\N' ? user : '' });
    }
    return map;
  };
  const spa = await readSentences('spa_sentences_detailed.tsv.bz2', null);
  const deu = await readSentences('deu_sentences_detailed.tsv.bz2', d2s);
  return { spa, deu, s2d, d2s, badIds, native };
}

/** Spanische Wörter eines Satzes (Satzzeichen am Rand entfernt), wie tokenize() in src/grading.js. */
function esTokens(text) {
  return text.split(/\s+/).map((t) => t.replace(/^[¿¡"„“(]+|[.,!?;:"“”)]+$/g, '')).filter(Boolean);
}

const ES_CHARS = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ,.¿?¡!]+$/;
/** Spanischer Satz sauber genug für Übungen (Satzbau, Lücke, Hören)? */
function goodSpanish(text) {
  if (!ES_CHARS.test(text) || /\.\.|\s{2}|\s[,.?!]|,[^\s]/.test(text)) return false;
  if (!/^[¿¡]?[A-ZÁÉÍÓÚÑ]/.test(text) || !/[.?!]$/.test(text)) return false;
  const count = (re) => (text.match(re) ?? []).length;
  if (count(/\?/g) !== count(/¿/g) || count(/!/g) !== count(/¡/g)) return false;
  const raw = text.split(/\s+/);
  return raw.every((t) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(t));
}

const DE_CHARS = /^[A-Za-zÄÖÜäöüß ,.?!;:'"„“‚‘’-]+$/;
const goodGerman = (text) => text.length <= 140 && DE_CHARS.test(text) && /^["„]?[A-ZÄÖÜ]/.test(text) && /[.?!"“]$/.test(text) && !/\s{2}/.test(text);

/** Kontext für mehrdeutige Formen: davor Begleiter → Nomen/Adjektiv, davor Pronomen/„no“/Hilfsverb → Verb. */
const NOUN_CTX = new Set('el la los las un una unos unas mi mis tu tus su sus este esta estos estas ese esa esos esas nuestro nuestra nuestros nuestras del al otro otra otros otras cada mucho mucha muchos muchas poco poca pocos pocas es está son están era estaba fue muy más tan menos bastante demasiado'.split(' '));
const VERB_CTX = new Set('me te se nos os lo le les yo tú él ella usted nosotros vosotros ellos ellas ustedes no ya he has ha hemos habéis han había habías habíamos habían haya que si también nunca siempre quien'.split(' '));

function contextStats(spa, kaikki) {
  const ambiguous = new Set();
  for (const [w, rs] of kaikki) {
    const cls = new Set(rs.map((r) => classOf(r.pos)));
    if (cls.has('N') && cls.has('V') && !cls.has('F')) ambiguous.add(w);
  }
  const stats = new Map();
  for (const s of spa.values()) {
    const t = esTokens(s.text).map((x) => x.toLowerCase());
    for (let i = 1; i < t.length; i++) {
      if (!ambiguous.has(t[i])) continue;
      const st = stats.get(t[i]) ?? [0, 0];
      if (NOUN_CTX.has(t[i - 1])) st[0]++;
      else if (VERB_CTX.has(t[i - 1])) st[1]++;
      stats.set(t[i], st);
    }
  }
  return (form) => {
    const [n, v] = stats.get(form) ?? [0, 0];
    return (n + 1) / (n + v + 2);
  };
}

const classOf = (pos) => (FUNCTION_POS.has(pos) ? 'F' : pos === 'verb' ? 'V' : 'N');

function parseOverrides(rows) {
  const map = new Map();
  for (const [form, spec] of rows) {
    if (!spec) continue;
    const opts = spec.split(' | ').map((o) => {
      const m = o.trim().match(/^([^/:]+)\/([a-z]+)(?::([\d.]+))?$/);
      if (!m) throw new Error(`formen.tsv: Lesart „${o}“ unverständlich`);
      return { lemmas: m[1].split('+'), pos: m[2], cls: classOf(m[2]), w: Number(m[3] ?? 1) };
    });
    const sum = opts.reduce((a, o) => a + o.w, 0);
    map.set(form, opts.map((o) => ({ ...o, w: o.w / sum })));
  }
  return map;
}

/**
 * Lesarten einer Form: [{ lemmas: [Lemma, …weitere nötige], pos, cls: F|N|V, w }], Gewichte summieren zu 1.
 * Funktionswort-Lesarten haben Vorrang; Nomen/Adjektiv gegen Verb nach Kontextstatistik; innerhalb einer
 * Klasse nach der Häufigkeit eindeutiger Formen des Lemmas (mass), z. B. „creo“ eher creer als crear.
 */
function makeAnalyzer(kaikki, overrides, pNoun, mass = () => 0) {
  const cache = new Map();
  return (form) => {
    if (cache.has(form)) return cache.get(form);
    let opts = overrides.get(form);
    if (!opts) {
      const raw = [];
      const seen = new Set();
      const push = (lemmas, pos) => {
        const key = lemmas.join('+') + '/' + classOf(pos);
        if (seen.has(key)) return;
        seen.add(key);
        raw.push({ lemmas, pos, cls: classOf(pos) });
      };
      for (const r of kaikki.get(form) ?? []) {
        if (r.self) push([form], r.pos);
        for (const l of r.lemmas) push([l.lemma, ...l.clitics], r.pos);
      }
      const by = (c) => raw.filter((o) => o.cls === c);
      const split = (list, total) => {
        const m = list.map((o) => mass(o.lemmas[0]) + 1);
        const sum = m.reduce((a, b) => a + b, 0);
        return list.map((o, i) => ({ ...o, w: (total * m[i]) / sum }));
      };
      const [F, N, V] = [by('F'), by('N'), by('V')];
      // Andere Lesarten bleiben mit Gewicht 0 erhalten (für die Entscheidung im Satz, z. B. „Yo como …“).
      if (F.length) opts = [...split(F, 1), ...[...N, ...V].map((o) => ({ ...o, w: 0 }))];
      else if (N.length && V.length) {
        const p = pNoun(form);
        opts = [...split(N, p), ...split(V, 1 - p)];
      } else opts = split(raw, 1);
    }
    cache.set(form, opts);
    return opts;
  };
}

/** Lemmata nach Häufigkeit: Formen-Häufigkeit anteilig auf die Lemmata ihrer Lesarten verteilt. */
function countLemmas(freq, analyze) {
  const lemmas = new Map();
  for (const [form, n] of freq) {
    for (const o of analyze(form)) {
      o.lemmas.forEach((lemma, i) => {
        let L = lemmas.get(lemma);
        if (!L) lemmas.set(lemma, (L = { lemma, count: 0, pos: new Map(), forms: new Map() }));
        const share = i === 0 ? n * o.w : 0; // Klitika/zweiter Teil zählen nicht doppelt
        L.count += share;
        if (i === 0) {
          L.pos.set(o.pos, (L.pos.get(o.pos) ?? 0) + share);
          L.forms.set(form, (L.forms.get(form) ?? 0) + share);
        }
      });
    }
  }
  for (const L of lemmas.values()) L.mainPos = [...L.pos].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0] ?? 'other';
  return [...lemmas.values()].sort((a, b) => b.count - a.count || cmp(a.lemma, b.lemma));
}

// --- Sätze analysieren -------------------------------------------------------------------------------

const MOTION_NEXT = new Set(['a', 'al', 'allí', 'ahí', 'allá', 'aquí', 'hacia', 'hasta']);

/** Wählt je Wort die Lesung nach Kontext (Begleiter/Pronomen davor, Verb danach, „fue a“ → ir). */
function makeResolver(analyze, lemmaCount) {
  const best = (list) => list.reduce((a, o) => (o.w > a.w + 1e-9 || (Math.abs(o.w - a.w) <= 1e-9 && lemmaCount(o.lemmas[0]) > lemmaCount(a.lemmas[0])) ? o : a));
  return (opts, prev, next) => {
    if (opts.length === 1) return opts[0];
    const art = opts.find((o) => o.pos === 'article');
    const pro = opts.find((o) => o.pos === 'pron');
    if (art && pro) {
      const nx = next ? analyze(next) : [];
      return nx.length && nx.every((o) => o.cls === 'V') ? pro : art;
    }
    const heads = opts.map((o) => o.lemmas[0]);
    if (heads.includes('ir') && heads.includes('ser')) return opts.find((o) => o.lemmas[0] === (MOTION_NEXT.has(next) ? 'ir' : 'ser'));
    const N = opts.filter((o) => o.cls === 'N' && o.w > 0);
    const V = opts.filter((o) => o.cls === 'V' && o.w > 0);
    if (N.length && V.length && NOUN_CTX.has(prev)) return best(N);
    if (N.length && V.length && VERB_CTX.has(prev)) return best(V);
    return best(opts);
  };
}

/** Zerlegt einen Satz in Wörter mit Lemma(ta); null, wenn ein Wort unbekannt ist. */
function sentenceTokens(text, analyze, resolve, names) {
  const raw = esTokens(text);
  const lower = raw.map((t) => t.toLowerCase());
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (names.has(raw[i])) {
      out.push({ form: raw[i], name: true, lemmas: [] });
      continue;
    }
    const opts = analyze(lower[i]);
    if (!opts.length) return null;
    const o = resolve(opts, lower[i - 1], lower[i + 1]);
    out.push({ form: lower[i], lemmas: o.lemmas, pos: o.pos, opts });
  }
  return out;
}

function analyzeSentences(tat, analyze, resolve, names, heikel) {
  const deOrder = (a, b) => Number(tat.native.deu.has(b.user)) - Number(tat.native.deu.has(a.user)) || a.id - b.id;
  const okSpanish = (s) => s && !tat.badIds.has(s.id) && goodSpanish(s.text) && !heikel.de.test(s.text);
  const out = [];
  let stats = { linked: 0, form: 0, german: 0, heikel: 0, unknown: 0 };
  for (const [id, deIds] of tat.s2d) {
    stats.linked++;
    const s = tat.spa.get(id);
    if (!okSpanish(s)) { stats.form++; continue; }
    const n = esTokens(s.text).length;
    if (n < MIN_WORDS || n > MAX_WORDS) { stats.form++; continue; }
    const deAll = deIds.map((d) => tat.deu.get(d)).filter(Boolean);
    if (deAll.some((d) => heikel.de.test(d.text))) { stats.heikel++; continue; }
    const de = deAll.filter((d) => !tat.badIds.has(d.id) && goodGerman(d.text)).sort(deOrder);
    if (!de.length) { stats.german++; continue; }
    const toks = sentenceTokens(s.text, analyze, resolve, names);
    if (!toks) { stats.unknown++; continue; }
    const lemmas = [...new Set(toks.flatMap((t) => t.lemmas))];
    if (lemmas.some((l) => heikel.es.has(l))) { stats.heikel++; continue; }
    // Deutsche Übersetzungen (ohne Doppelte), weitere spanische Übersetzungen des ersten deutschen Satzes.
    const native = [];
    for (const d of de) if (!native.some((x) => normalize(x.text, 'de') === normalize(d.text, 'de'))) native.push(d);
    const alts = (tat.d2s.get(native[0].id) ?? []).filter((x) => x !== id).map((x) => tat.spa.get(x)).filter(okSpanish)
      .sort((a, b) => Number(tat.native.spa.has(b.user)) - Number(tat.native.spa.has(a.user)) || a.id - b.id);
    const target = [s.text];
    for (const a of alts) if (target.length < 4 && !target.some((t) => looseNormalize(t, 'es') === looseNormalize(a.text, 'es'))) target.push(a.text);
    const nameCount = toks.filter((t) => t.name).length;
    const quality = (tat.native.spa.has(s.user) ? 2 : s.user ? 0.5 : 0) + (tat.native.deu.has(native[0].user) ? 1 : 0)
      + (n >= 3 && n <= 8 ? 1 : 0) + (native.length > 1 ? 0.3 : 0) - nameCount * 0.7;
    out.push({ id, user: s.user, text: s.text, target, native: native.slice(0, 4).map((d) => d.text), toks, lemmas, quality });
  }
  out.sort((a, b) => a.id - b.id);
  return { sentences: out, stats };
}

// --- Deutsche Bedeutungen ----------------------------------------------------------------------------

const ART = { m: 'der', f: 'die', n: 'das' };
const ART_GENDER = { der: 'm', die: 'f', das: 'n' };

/** Genus deutscher Nomen aus den Tatoeba-Sätzen (Artikel davor), als Rückfallebene. */
function germanArticleStats(deu) {
  const W = { der: { m: 0.5, f: 0.3 }, die: { f: 0.6 }, das: { n: 1 }, den: { m: 0.6 }, dem: { m: 0.5, n: 0.5 }, ein: { m: 0.5, n: 0.5 },
    eine: { f: 1 }, einen: { m: 1 }, einem: { m: 0.5, n: 0.5 }, einer: { f: 0.8 }, kein: { m: 0.5, n: 0.5 }, keine: { f: 0.6 }, keinen: { m: 1 } };
  const stats = new Map();
  for (const d of deu.values()) {
    const t = d.text.split(/\s+/).map((x) => x.replace(/^[„"‚']+|[.,!?;:"“'‘]+$/g, ''));
    for (let i = 1; i < t.length; i++) {
      const w = W[t[i - 1].toLowerCase()];
      if (!w || !/^[A-ZÄÖÜ][a-zäöüß]+$/.test(t[i])) continue;
      const st = stats.get(t[i]) ?? { m: 0, f: 0, n: 0 };
      for (const g in w) st[g] += w[g];
      stats.set(t[i], st);
    }
  }
  return (noun) => {
    const st = stats.get(noun);
    if (!st) return null;
    const [g, v] = Object.entries(st).sort((a, b) => b[1] - a[1])[0];
    const total = st.m + st.f + st.n;
    return total >= 1.5 && v / total >= 0.6 ? g : null;
  };
}

function cleanGloss(text) {
  let t = String(text).replace(/\[[^\]]*\]|\([^)]*\)|„|“|"/g, ' ').replace(/^\s*[A-ZÄÖÜa-zäöü. ,-]+:\s+/, '').trim();
  for (let i = 0; i < 2; i++) t = t.replace(/^(etwas|etw\.|jemanden|jemandem|jemandes|jemand|jmdn\.|jmdm\.|jmds\.)\s+/, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** Form der Kandidaten nach Wortart: Nomen groß (mit Artikel), Verben im Infinitiv, sonst klein. */
function shapeOk(word, pos) {
  if (!/^(sich )?[A-Za-zÄÖÜäöüß-]+( [A-Za-zÄÖÜäöüß-]+){0,2}$/.test(word) || word.length > 28) return false;
  if (pos === 'noun') return /^[A-ZÄÖÜ]/.test(word) && !word.includes(' ');
  if (pos === 'verb') return /^[a-zäöü]/.test(word) && /n$/.test(word);
  return /^[a-zäöü]/.test(word);
}

// Unregelmäßige deutsche Verbformen (Wortanfänge), damit „war“ zu „sein“ und „ging“ zu „gehen“ passt.
const DE_IRREGULAR = Object.fromEntries(Object.entries({
  sein: 'ist bin bist sind seid war wär gewesen sei', haben: 'hab hat hätt gehabt', gehen: 'geh ging gegangen',
  werden: 'wird wirst werd wurd würd geworden', können: 'kann konnt könn', wissen: 'weiß wusst wüsst wiss gewusst',
  wollen: 'will wollt woll', müssen: 'muss musst müss', sollen: 'soll', dürfen: 'darf durft dürf',
  mögen: 'mag mocht möcht mög', kommen: 'komm kam käm gekommen', sehen: 'seh sieh sah säh gesehen',
  geben: 'geb gib gab gäb gegeben', nehmen: 'nehm nimm nahm genommen', fahren: 'fahr fähr fuhr gefahren',
  tun: 'tu tat getan', finden: 'find fand gefunden', bringen: 'bring bracht', denken: 'denk dacht',
  essen: 'ess iss aß gegessen', trinken: 'trink trank getrunken', schlafen: 'schlaf schläf schlief',
  lesen: 'les lies las gelesen', sprechen: 'sprech sprich sprach gesprochen', helfen: 'helf hilf half geholfen',
  stehen: 'steh stand gestanden', sitzen: 'sitz saß gesessen', liegen: 'lieg lag gelegen', fallen: 'fall fäll fiel',
  laufen: 'lauf läuf lief', halten: 'halt hält hielt', lassen: 'lass läss ließ', heißen: 'heiß hieß',
  schreiben: 'schreib schrieb', bleiben: 'bleib blieb', treffen: 'treff triff traf getroffen',
  vergessen: 'vergess vergiss vergaß', verlieren: 'verlier verlor', beginnen: 'beginn begann begonnen',
  rufen: 'ruf rief gerufen', anrufen: 'anruf rief angerufen', ziehen: 'zieh zog gezogen', kennen: 'kenn kannt',
  fliegen: 'flieg flog geflogen', sterben: 'sterb stirb starb gestorben', tragen: 'trag träg trug getragen',
  waschen: 'wasch wäsch wusch', vergeben: 'vergeb vergib vergab', verstehen: 'versteh verstand',
}).map(([k, v]) => [k, v.split(' ')]));

/** Test, ob ein deutsches Wort (aus einer Übersetzung) zur Bedeutung passt; Nomen nur großgeschrieben. */
function germanStem(word, pos) {
  const last = word.split(' ').at(-1);
  const w = last.toLowerCase();
  const irregular = DE_IRREGULAR[w];
  if (irregular) return { stem: w, test: (t) => { const x = t.toLowerCase(); return x.includes(w.slice(0, -2)) || irregular.some((f) => x.startsWith(f) || x.startsWith('ge' + f)); } };
  if (pos === 'noun') {
    const stem = last.replace(/e$/, '');
    return { stem, test: stem.length >= 3 ? (t) => t.startsWith(stem) : (t) => t === last };
  }
  const stem = pos === 'verb' ? w.replace(/(en|ern|eln|n)$/, (m) => (m === 'ern' || m === 'eln' ? m.slice(0, 2) : '')) : w.replace(/e$/, '');
  if (stem.length < 3) return { stem: w, test: (t) => t.toLowerCase() === w };
  return { stem, test: pos === 'verb' ? (t) => t.toLowerCase().includes(stem) : (t) => t.toLowerCase().startsWith(stem) };
}

/**
 * Kandidaten für deutsche Bedeutungen eines Lemmas mit Punktzahl:
 * de.wiktionary (Bedeutung/Übersetzung, frühe Bedeutungen zählen mehr), WikDict (beide Richtungen) und
 * wie oft das Wort in den deutschen Übersetzungen von Tatoeba-Sätzen mit diesem Lemma vorkommt.
 */
function glossCandidates(L, sources) {
  const { kde, wik, deTokens, articleOf } = sources;
  const pos = L.mainPos === 'noun' ? 'noun' : L.mainPos === 'verb' ? 'verb' : 'other';
  const cands = new Map();
  const add = (raw, score, src, gender = null) => {
    let word = cleanGloss(raw);
    let g = gender;
    const m = word.match(/^(der|die|das) (.+)$/);
    if (m) {
      g = ART_GENDER[m[1]];
      word = m[2];
    }
    if (!shapeOk(word, pos)) return;
    const key = word;
    const c = cands.get(key) ?? { word, score: 0, srcs: new Set(), gender: null };
    c.score += score;
    c.srcs.add(src);
    if (g && !c.gender) c.gender = g;
    cands.set(key, c);
  };
  const entries = (kde.get(L.lemma) ?? []).filter((e) => classOf(e.pos) === classOf(L.mainPos) && (e.pos === L.mainPos || pos === 'other'));
  for (const e of entries) {
    e.senses.forEach((s, i) => s.split(/[,;]\s*/).forEach((piece, j) => add(piece, Math.max(1, 5 - i - j * 0.5), 'wikt')));
    for (const t of e.tr) add(t.word, Math.max(1, 4 - (t.idx - 1)), 'wikt', t.gender);
  }
  const wantPos = pos === 'other' ? null : pos;
  for (const r of wik.fwd.get(L.lemma) ?? []) if (!wantPos || r.pos === wantPos || r.pos == null) add(r.de, 1 + Math.min(3, r.score / 60) + (r.good ? 1 : 0), 'wikdict');
  for (const r of wik.rev.get(L.lemma) ?? []) if (!wantPos || r.pos === wantPos) add(r.de, Math.min(2, r.score / 120), 'wikdict');
  const sets = deTokens.get(L.lemma) ?? [];
  for (const c of cands.values()) {
    if (sets.length) {
      const { test } = germanStem(c.word, pos);
      const hits = sets.filter((set) => [...set].some(test)).length;
      c.ratio = hits / sets.length;
      c.score += 8 * c.ratio;
      if (hits) c.srcs.add('tatoeba');
    } else c.ratio = 0;
    if (pos === 'noun' && !c.gender) c.gender = articleOf(c.word);
  }
  return [...cands.values()].filter((c) => pos !== 'noun' || c.gender)
    .sort((a, b) => b.score - a.score || cmp(a.word, b.word));
}

// --- Wörter des Kurses -------------------------------------------------------------------------------

/** Spanische Zielformen: Nomen mit Artikel (und ohne als Alternative), Adjektive auf -o auch mit -a. */
function spanishTarget(L, gender, analyze, elFem) {
  const w = L.lemma;
  if (L.mainPos === 'noun' && gender) {
    const art = { m: ['el'], f: [elFem.has(w) ? 'el' : 'la'], mf: ['el', 'la'], 'm-p': ['los'], 'f-p': ['las'], 'mf-p': ['los'] }[gender];
    if (art) return [...art.map((a) => `${a} ${w}`), w];
  }
  if (L.mainPos === 'adj' && w.endsWith('o')) {
    const fem = w.slice(0, -1) + 'a';
    if (analyze(fem).some((o) => o.lemmas[0] === w)) return [w, fem];
  }
  return [w];
}

function spanishGender(L, kaikki, kde) {
  const r = (kaikki.get(L.lemma) ?? []).find((x) => x.pos === 'noun' && x.self && x.gender);
  if (r) return r.gender;
  const e = (kde.get(L.lemma) ?? []).find((x) => x.pos === 'noun' && x.gender);
  return e?.gender ?? null;
}

const stripArticle = (s) => s.replace(/^(der|die|das|el|la|los|las) /, '');

/** Gleichheit für die Eindeutigkeit in einer Einheit: deutsche und spanische Varianten (ohne Akzente). */
function wordKeys(w) {
  return {
    de: new Set(w.native.flatMap((n) => [normalize(n, 'de'), normalize(stripArticle(n), 'de')])),
    es: new Set(w.target.flatMap((t) => [looseNormalize(t, 'es'), looseNormalize(stripArticle(t), 'es')])),
  };
}

function conflicts(a, b) {
  for (const k of a.de) if (b.de.has(k)) return true;
  for (const k of a.es) if (b.es.has(k)) return true;
  return false;
}

// --- Notizen zu Sätzen -------------------------------------------------------------------------------

function sentenceNote(s, wordOf, unitStart, hints) {
  const parts = [];
  const seen = new Set();
  for (const t of s.toks) {
    if (t.name || seen.has(t.form)) continue;
    seen.add(t.form);
    const [head, ...extra] = t.lemmas;
    const w = wordOf.get(head);
    if (!w) continue;
    let text;
    if (hints.has(`${t.form}|${head}`)) text = hints.get(`${t.form}|${head}`);
    else if (extra.length && t.pos === 'prep') text = `${t.form} = ${t.lemmas.join(' + ')}`;
    else if (extra.length) text = `${t.form} → ${head} = ${w.gloss} (+ ${extra.join(' + ')})`;
    else if (t.form !== head) text = `${t.form} → ${head} = ${w.gloss}`;
    else text = `${head} = ${w.gloss}`;
    const prio = w.idx >= unitStart ? 0 : t.form !== head || extra.length ? 1 : w.idx >= unitStart - 200 ? 2 : 3;
    parts.push({ text, prio });
  }
  const join = (list) => list.map((p) => p.text).join(' · ');
  let list = parts;
  for (let prio = 3; prio >= 1 && join(list).length > NOTE_MAX; prio--) {
    while (join(list).length > NOTE_MAX && list.some((p) => p.prio === prio)) {
      const i = list.findLastIndex((p) => p.prio === prio);
      list = list.filter((_, j) => j !== i);
    }
  }
  while (join(list).length > NOTE_MAX && list.length > 1) list = list.slice(0, -1);
  return join(list.length ? list : parts.slice(0, 1)).slice(0, NOTE_MAX);
}

// --- Ablauf ------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const listPath = args.includes('--liste') ? args[args.indexOf('--liste') + 1] : null;
const unreviewedPath = args.includes('--ungeprueft') ? args[args.indexOf('--ungeprueft') + 1] : null;
const reportPath = args.includes('--bericht') ? args[args.indexOf('--bericht') + 1] : null;
const ownExamplePath = args.includes('--beispiele') ? args[args.indexOf('--beispiele') + 1] : CUR + 'eigene-beispiele.tsv';

const freq = await readFrequency();
const kaikki = await readKaikkiEn(new Set(freq.keys()));
const kde = await readKaikkiDe();
const wik = readWikdict();
log(`Wörterbücher gelesen: ${freq.size} Formen, ${kaikki.size} Wiktionary-Stichwörter (en), ${kde.size} (de)`);
const tat = await readTatoeba();
log(`Tatoeba gelesen: ${tat.spa.size} spanische Sätze, ${tat.s2d.size} mit deutscher Übersetzung`);

const overrides = parseOverrides(await curated('formen.tsv'));
const pNoun = contextStats(tat.spa, kaikki);
const analyze = (() => {
  // Erst eindeutige Formen zählen, dann mehrdeutige danach aufteilen.
  const first = makeAnalyzer(kaikki, overrides, pNoun);
  const mass = new Map();
  for (const [form, n] of freq) {
    const heads = new Set(first(form).map((o) => o.lemmas[0]));
    if (heads.size === 1) for (const h of heads) mass.set(h, (mass.get(h) ?? 0) + n);
  }
  return makeAnalyzer(kaikki, overrides, pNoun, (l) => mass.get(l) ?? 0);
})();
const lemmaList = countLemmas(freq, analyze);
const byLemma = new Map(lemmaList.map((L) => [L.lemma, L]));
const resolve = makeResolver(analyze, (l) => byLemma.get(l)?.count ?? 0);
const names = new Set((await curated('namen.txt')).map((r) => r[0]));
const heikelRows = await curated('heikel.tsv');
const heikel = {
  es: new Set(heikelRows.filter((r) => r[0] === 'es').map((r) => r[1])),
  de: new RegExp(heikelRows.filter((r) => r[0] === 'de').map((r) => r[1]).join('|') || '(?!)', 'iu'),
};
// Von Hand aussortierte Sätze (unsinnig, unnatürlich, falsch übersetzt): wie Sätze mit Prüf-Tags behandeln.
for (const [id] of await curated('satz-ausschluss.txt')) tat.badIds.add(Number(id));
const { sentences, stats: sentStats } = analyzeSentences(tat, analyze, resolve, names, heikel);
log(`Sätze: ${sentences.length} brauchbar (${JSON.stringify(sentStats)})`);

// Deutsche Wörter der Übersetzungen je Lemma (für die Auswahl der Bedeutung).
const deTokens = new Map();
for (const s of sentences) {
  const set = new Set(s.native.join(' ').split(/[\s,.?!;:"„“]+/).filter(Boolean));
  for (const l of s.lemmas) {
    const list = deTokens.get(l) ?? [];
    if (list.length < 300) list.push(set);
    deTokens.set(l, list);
  }
}
const sources = { kde, wik, deTokens, articleOf: germanArticleStats(tat.deu) };

// Kuratierte Bedeutungen und Ausschlüsse.
const manual = new Map();
for (const [lemma, deutsch, ziel, hinweis] of await curated('glossen.tsv')) {
  manual.set(lemma, { native: deutsch === '-' ? null : deutsch.split(' | '), target: ziel ? ziel.split(' | ') : null, note: hinweis || null });
}
const excluded = new Map((await curated('ausschluss.txt')).map((r) => [r[0], 'Liste']));
for (const [w, rs] of kaikki) if (rs.some((r) => r.bad) && !rs.some((r) => r.self && !r.bad)) excluded.set(w, 'vulgär/abwertend');
const elFem = new Set((await curated('artikel-el.txt')).map((r) => r[0]));
const formHints = new Map((await curated('formhinweise.tsv')).map(([form, lemma, text]) => [`${form}|${lemma}`, text]));

const MIN_AUTO_SCORE = 6;
const drop = { ausgeschlossen: 0, ohneBedeutung: 0, ohneGenus: 0, ohneSatz: 0, doppelt: 0 };
const candidates = [];
const usedMain = new Map();
lemmaList.forEach((L, i) => {
  L.rank = i + 1;
  if (excluded.has(L.lemma) || manual.get(L.lemma)?.native === null) { drop.ausgeschlossen++; L.status = 'ausgeschlossen'; return; }
  const m = manual.get(L.lemma);
  const gender = L.mainPos === 'noun' ? spanishGender(L, kaikki, kde) : null;
  let native;
  let source = 'manuell';
  if (m) native = m.native;
  else {
    if (L.mainPos === 'noun' && !gender) { drop.ohneGenus++; L.status = 'ohne Genus'; return; }
    // Sicher genug: hohe Punktzahl oder mehrere Quellen inkl. Tatoeba-Treffer. Schon vergebene Hauptbedeutung
    // nur, wenn keine fast gleich gute andere Bedeutung da ist (sonst gegenseitig akzeptiert, s. u.).
    const all = glossCandidates(L, sources).filter((x) => x.score >= MIN_AUTO_SCORE || (x.score >= 4 && x.srcs.size >= 2 && x.ratio > 0));
    if (!all.length) { drop.ohneBedeutung++; L.status = 'ohne Bedeutung'; return; }
    const fresh = all.filter((x) => !usedMain.has(normalize(x.word, 'de')));
    const c = fresh.length && fresh[0].score >= all[0].score * 0.6 ? [fresh[0], ...all.filter((x) => x !== fresh[0])] : all;
    const pick = [c[0], c.find((x, j) => j > 0 && x.score >= Math.max(MIN_AUTO_SCORE, c[0].score * 0.5))].filter(Boolean);
    native = L.mainPos === 'noun'
      ? [`${ART[pick[0].gender]} ${pick[0].word}`, pick[0].word, ...pick.slice(1).map((x) => `${ART[x.gender]} ${x.word}`)]
      : pick.map((x) => x.word);
    source = 'auto';
  }
  const target = m?.target ?? spanishTarget(L, gender, analyze, elFem);
  const key = normalize(stripArticle(native[0]), 'de');
  if (!usedMain.has(key)) usedMain.set(key, L.lemma);
  candidates.push({ L, native, target, baseTarget: target, note: m?.note ?? null, source, gender });
});
log(`Lemma-Kandidaten mit Bedeutung: ${candidates.length} von ${lemmaList.length} (${JSON.stringify(drop)})`);

// Mehrdeutige Inhaltswörter mit der deutschen Übersetzung entscheiden („fue“: war → ser, ging → ir;
// „como“: esse → comer). Nur wenn genau ein Lemma passt; Funktionswörter bleiben bei der Kontextregel.
{
  const glossOf = new Map(candidates.map((c) => [c.L.lemma, c]));
  const fits = (lemma, de) => {
    const c = glossOf.get(lemma);
    if (!c) return false;
    const pos = c.L.mainPos === 'noun' ? 'noun' : c.L.mainPos === 'verb' ? 'verb' : 'other';
    return c.native.some((n) => { const { test } = germanStem(stripArticle(n), pos); return de.some(test); });
  };
  const AUX = new Set(['ser', 'estar', 'haber', 'tener']);
  let changed = 0;
  for (const s of sentences) {
    const de = s.native.join(' ').split(/[\s,.?!;:"„“]+/).filter(Boolean);
    let touched = false;
    for (const t of s.toks) {
      if (!t.opts || t.opts.every((o) => o.cls === 'F') || new Set(t.opts.map((o) => o.lemmas[0])).size < 2) continue;
      let hits = t.opts.filter((o) => fits(o.lemmas[0], de));
      // Hilfsverben (sein/haben im Perfekt) sind schwache Hinweise: „no fui“ → „bin … gegangen“ = ir.
      if (new Set(hits.map((o) => o.lemmas[0])).size > 1) hits = hits.filter((o) => !AUX.has(o.lemmas[0]));
      if (new Set(hits.map((o) => o.lemmas[0])).size !== 1 || hits[0].lemmas[0] === t.lemmas[0]) continue;
      const o = hits.reduce((a, b) => (b.w > a.w ? b : a));
      t.lemmas = o.lemmas;
      t.pos = o.pos;
      touched = true;
      changed++;
    }
    if (touched) s.lemmas = [...new Set(s.toks.flatMap((t) => t.lemmas))];
  }
  const before = sentences.length;
  sentences.splice(0, sentences.length, ...sentences.filter((s) => !s.lemmas.some((l) => heikel.es.has(l))));
  log(`Lesarten nach Übersetzung korrigiert: ${changed} (${before - sentences.length} Sätze danach heikel)`);
}

// Nur Lemmata, die in mindestens einem Satz aus lauter Kurs-Lemmata vorkommen (Fixpunkt).
function supported(list) {
  for (;;) {
    const set = new Set(list.map((c) => c.L.lemma));
    const count = new Map();
    for (const s of sentences) if (s.lemmas.every((l) => set.has(l))) for (const l of s.lemmas) count.set(l, (count.get(l) ?? 0) + 1);
    const next = list.filter((c) => count.get(c.L.lemma) > 0);
    if (next.length === list.length) return next;
    list = next;
  }
}
const course = supported(candidates);
drop.ohneSatz = candidates.length - course.length;
log(`Lemmata mit Satzstütze: ${course.length}`);

// --- Zeitformen ---------------------------------------------------------------------------------------
// Sätze im Präsens kommen von Anfang an; Vergangenheit, Zukunft/Konditional und Subjuntivo erst ab der
// Regel-Einheit, die sie einführt („zeitform“ in lehrplan.json).

const TENSES = ['praesens', 'vergangenheit', 'zukunft', 'subjuntivo'];
function formTense(tags) {
  if (tags.includes('subjunctive')) return 'subjuntivo';
  if (tags.includes('future') || tags.includes('conditional')) return 'zukunft';
  if (['preterite', 'imperfect', 'pluperfect', 'participle', 'past'].some((t) => tags.includes(t))) return 'vergangenheit';
  return 'praesens';
}
/**
 * Einfachste mögliche Zeitform einer Verbform (mehrdeutig wie „hablamos“ → Präsens), als Index in TENSES.
 * Befehlsformen mit Sie (haga, quiera, vaya) sind Subjuntivo-Formen: nur am Satzanfang als Befehl werten.
 */
function tenseOf(form, lemma, first) {
  let best = -1;
  for (const r of kaikki.get(form) ?? []) {
    for (const l of r.lemmas) {
      if (l.lemma !== lemma || !l.tags) continue;
      const formal = l.tags.includes('imperative') && !l.tags.includes('second-person');
      const t = formal && !first ? TENSES.indexOf('subjuntivo') : TENSES.indexOf(formTense(l.tags));
      if (best < 0 || t < best) best = t;
    }
  }
  return Math.max(0, best);
}
for (const s of sentences) {
  s.tense = Math.max(0, ...s.toks.map((t, i) => (t.pos === 'verb' && t.form !== t.lemmas[0] ? tenseOf(t.form, t.lemmas[0], i === 0) : 0)));
  s.forms = new Set(s.toks.map((t) => t.form));
  s.seq = ` ${s.toks.map((t) => t.form).join(' ')} `;
}

// --- Lehrplan: Abschnitte und Einheiten von leicht nach schwer -----------------------------------------

const plan = JSON.parse(await readFile(CUR + 'lehrplan.json', 'utf8'));
const themeOf = new Map((await curated('themen.tsv')).map(([l, c]) => [l, c]));
const whitelist = new Set((await curated('saetze-geprueft.txt')).map((r) => Number(r[0])));
const theme = (c) => themeOf.get(c.L.lemma) ?? 'allg';
for (const c of course) c.keys = wordKeys(c);
const used = new Set();
/** Häufigste freie Lemmata der Themen, ohne gleiche Bedeutung oder Form in derselben Einheit. */
function take(themes, count, maxRank = Infinity, from = course) {
  const pick = [];
  for (const c of from) {
    if (pick.length >= count) break;
    if (used.has(c) || !themes.includes(theme(c)) || c.L.rank > maxRank) continue;
    if (pick.some((x) => conflicts(x.keys, c.keys))) continue;
    pick.push(c);
  }
  return pick;
}
const units = []; // { stage, title, intro?, words?: Kandidaten, items?: Regelwörter, gate? }
for (const st of plan.stufen) {
  if (st.rest) {
    // Übrige Lemmata nach Häufigkeit in Abschnitte, darin nach Thema gruppiert, Rest gemischt.
    const rest = course.filter((c) => !used.has(c));
    for (let b = 0; b * st.proStufe < rest.length; b++) {
      const band = rest.slice(b * st.proStufe, (b + 1) * st.proStufe);
      const stage = `${st.titel} ${b + 1}`;
      for (const th of Object.keys(plan.themenNamen)) {
        for (;;) {
          const pick = take([th], st.anzahl, Infinity, band);
          if (pick.length < 8) break;
          pick.forEach((c) => used.add(c));
          units.push({ stage, title: plan.themenNamen[th], words: pick });
        }
      }
      const left = band.filter((c) => !used.has(c));
      for (;;) {
        const pick = take(Object.keys(plan.themenNamen), st.anzahl, Infinity, left);
        if (pick.length < 4) { drop.doppelt += pick.length; break; }
        pick.forEach((c) => used.add(c));
        units.push({ stage, title: 'Gemischte Wörter', words: pick });
      }
    }
    continue;
  }
  for (const u of st.einheiten) {
    if (u.woerter) {
      units.push({ stage: st.titel, title: u.titel, intro: u.intro, items: u.woerter, gate: u.zeitform });
      continue;
    }
    const pick = take(u.themen, u.anzahl, u.maxRang);
    if (pick.length < 4) { log(`Einheit „${u.titel}“ übersprungen (nur ${pick.length} Wörter)`); continue; }
    pick.forEach((c) => used.add(c));
    units.push({ stage: st.titel, title: u.titel, intro: u.intro, words: pick, gate: u.zeitform });
  }
}

// Positionen im Lernpfad: Wörter und Regelwörter der Reihe nach; Zeitformen ab ihrer Regel-Einheit.
const wordOf = new Map();
const unitStart = [];
const gateAt = TENSES.map((_, i) => (i === 0 ? 0 : Infinity));
let position = 0;
units.forEach((u, ui) => {
  unitStart.push(position);
  if (u.gate) gateAt[TENSES.indexOf(u.gate)] = Math.min(gateAt[TENSES.indexOf(u.gate)], position);
  (u.words ?? []).forEach((c, j) => wordOf.set(c.L.lemma, { idx: position + j, gloss: c.native[0], unit: ui }));
  u.size = (u.words ?? u.items).length;
  position += u.size;
});
for (let i = 1; i < gateAt.length; i++) gateAt[i] = Math.max(gateAt[i], gateAt[i - 1]);
const unitOfIdx = (idx) => { let u = unitStart.length - 1; while (unitStart[u] > idx) u--; return u; };
const words = units.flatMap((u) => u.words ?? []);
log(`Einheiten: ${units.length}, Wörter: ${words.length}, Regelwörter: ${units.reduce((a, u) => a + (u.items?.length ?? 0), 0)}`);

// Sätze den Einheiten zuordnen (Einheit des spätesten Lemmas bzw. der Zeitform) und je Lektion auswählen.
const byUnit = units.map(() => []);
for (const s of sentences) {
  if (!s.lemmas.every((l) => wordOf.has(l))) continue;
  s.newest = Math.max(gateAt[s.tense], ...s.lemmas.map((l) => wordOf.get(l).idx));
  if (!Number.isFinite(s.newest)) continue;
  if (whitelist.has(s.id)) s.quality += 4;
  byUnit[unitOfIdx(s.newest)].push(s);
}
const usedEs = new Set();
const usedDe = new Set();
const isFree = (s) => !s.target.some((t) => usedEs.has(looseNormalize(t, 'es'))) && !usedDe.has(normalize(s.native[0], 'de'));
const markUsed = (s) => {
  s.target.forEach((t) => usedEs.add(looseNormalize(t, 'es')));
  s.native.forEach((t) => usedDe.add(normalize(t, 'de')));
};
/** Enthält der Satz die Form bzw. Wendung (Wörter direkt hintereinander)? */
const itemMatch = (s, item) => s.seq.includes(` ${item.formen.join(' ')} `);
const review = []; // nicht gewählte Sätze früherer Einheiten (alles bekannt) als Reserve
const unitSentences = [];
let reviewUsed = 0;
units.forEach((unit, u) => {
  const start = unitStart[u];
  const lessons = Math.ceil(unit.size / 4);
  const chosen = [];
  const take1 = (s, k, isReview = false) => {
    s.taken = true;
    markUsed(s);
    s.lessonSlot = k;
    if (isReview) { s.review = true; reviewUsed++; }
    chosen.push(s);
  };
  if (unit.items) {
    // Regel-Einheit: Sätze mit den Formen der Lektion, sonst der Einheit; nur bekannte Wörter.
    const end = start + unit.size;
    const pool = sentences.filter((s) => s.newest != null && s.newest < end && !s.taken);
    for (let k = 0; k < lessons; k++) {
      const mine = unit.items.slice(4 * k, 4 * k + 4);
      const quota = k === 0 ? 4 : 3;
      for (let got = 0; got < quota;) {
        let best = null;
        let bestScore = -Infinity;
        for (const s of pool) {
          if (s.taken || !isFree(s)) continue;
          const here = mine.filter((it) => itemMatch(s, it)).length;
          const any = unit.items.filter((it) => itemMatch(s, it)).length;
          if (!any) continue;
          const sc = s.quality + 6 * here + 2 * any;
          if (sc > bestScore) { best = s; bestScore = sc; }
        }
        if (!best) break;
        take1(best, k);
        got++;
      }
    }
  } else {
    const lessonOf = (s) => Math.floor((s.newest - start) / 4);
    const cands = byUnit[u].sort((a, b) => b.quality - a.quality || a.id - b.id);
    const covered = new Set();
    const pickFrom = (pool, k) => {
      let best = null;
      let bestScore = -Infinity;
      for (const s of pool) {
        if (s.taken || !isFree(s)) continue;
        const fresh = s.lemmas.filter((l) => wordOf.get(l).idx >= start && !covered.has(l)).length;
        const sc = s.quality + 2 * fresh;
        if (sc > bestScore) { best = s; bestScore = sc; }
      }
      if (!best) return false;
      best.lemmas.forEach((l) => covered.add(l));
      take1(best, k);
      return true;
    };
    for (let k = 0; k < lessons; k++) {
      const quota = k === 0 ? 4 : 3;
      const own = cands.filter((s) => lessonOf(s) === k);
      let got = 0;
      while (got < quota && pickFrom(own, k)) got++;
      const earlier = cands.filter((s) => lessonOf(s) < k);
      while (got < quota && pickFrom(earlier, k)) got++;
      // Reserve: neueste unbenutzte Sätze früherer Einheiten
      while (got < quota) {
        let best = -1;
        for (let i = review.length - 1; i >= 0 && best < 0; i--) if (!review[i].taken && isFree(review[i])) best = i;
        if (best < 0) break;
        take1(review.splice(best, 1)[0], k, true);
        got++;
      }
    }
  }
  chosen.sort((a, b) => a.lessonSlot - b.lessonSlot || Number(!!b.review) - Number(!!a.review) || a.newest - b.newest || a.id - b.id);
  unitSentences.push(chosen);
  for (const s of byUnit[u].filter((x) => !x.taken).sort((a, b) => a.newest - b.newest || a.quality - b.quality || b.id - a.id)) review.push(s);
});

// --- Beispielsätze je Wort ----------------------------------------------------------------------------
// Zu jedem neuen Wort ein Beispiel, das zeigt, wie man es benutzt: bevorzugt von Hand geprüft, kurz,
// mit bekannten Wörtern und in einer schon bekannten Zeitform; nicht derselbe Satz wie in den Übungen.

const sentencesOf = new Map();
for (const s of sentences) {
  if (s.newest == null) continue;
  for (const l of s.lemmas) {
    if (!sentencesOf.has(l)) sentencesOf.set(l, []);
    sentencesOf.get(l).push(s);
  }
}
const exampleUsed = new Set();
// Fehlt einem Wort ein geprüftes Beispiel, landet der beste ungeprüfte Kandidat im Prüfbericht.
const exampleCandidates = new Map();
function bestExample(list, ui) {
  const end = unitStart[ui] + units[ui].size;
  let best = null;
  let bestScore = -Infinity;
  let fallback = null;
  let fallbackScore = -Infinity;
  for (const s of list) {
    if (exampleUsed.has(s.id)) continue;
    const n = esTokens(s.text).length;
    const sc = (s.newest < end ? 4 : 0) + (gateAt[s.tense] <= end ? 2 : -4)
      + (s.taken ? -6 : 0) + (n >= 3 && n <= 8 ? 2 : 0) - n * 0.15 + s.quality * 0.5;
    // Beispiele nur aus handgeprüften Sätzen: sonst verschiebt jede Prüfrunde die Auswahl und bringt neue ungeprüfte.
    if (whitelist.has(s.id)) {
      if (sc > bestScore || (sc === bestScore && s.id < best.id)) { best = s; bestScore = sc; }
    } else if (sc > fallbackScore || (sc === fallbackScore && s.id < fallback.id)) { fallback = s; fallbackScore = sc; }
  }
  if (best) exampleUsed.add(best.id);
  else if (fallback && !exampleCandidates.has(fallback.id)) exampleCandidates.set(fallback.id, fallback);
  return best;
}
// Eigene Beispielsätze (eigene-beispiele.tsv: Lemma bzw. Regelwort, Spanisch, Deutsch): gehen Tatoeba vor.
// Geprüft wird streng: Satzzeichen, alle Wörter im Kurs, das Wort kommt vor, Wortschatz und Zeitform sind bis zum
// Ende der nächsten Einheit bekannt (am Anfang die ersten 120 Wörter). Fehler brechen den Bau ab.
const ownOf = new Map();
{
  const fatal = [];
  const keyOf = new Map();
  units.forEach((unit, ui) => {
    for (const c of unit.words ?? []) keyOf.set(c.L.lemma, { ref: c, ui });
    for (const it of unit.items ?? []) if (!keyOf.has(it.ziel[0])) keyOf.set(it.ziel[0], { ref: it, ui, item: true });
  });
  for (const [i, row] of (await curated('eigene-beispiele.tsv', ownExamplePath)).entries()) {
    const [key, es, de] = row;
    const where = `eigenes Beispiel ${i + 1} (${key ?? '?'})`;
    const hit = keyOf.get(key);
    if (!hit || !es || !de) { fatal.push(`${where}: unbekanntes Wort oder Spalte fehlt`); continue; }
    if (!goodSpanish(es) || !goodGerman(de)) { fatal.push(`${where}: Satzzeichen oder Zeichen – „${es}“ / „${de}“`); continue; }
    const toks = sentenceTokens(es, analyze, resolve, names);
    if (!toks) { fatal.push(`${where}: „${es}“ – unbekannte Form: ${esTokens(es).filter((t) => !names.has(t) && !analyze(t.toLowerCase()).length).join(' ')}`); continue; }
    const lemmas = [...new Set(toks.flatMap((t) => t.lemmas))];
    const outside = lemmas.filter((l) => !wordOf.has(l));
    if (outside.length) { fatal.push(`${where}: „${es}“ – nicht im Kurs: ${outside.join(' ')}`); continue; }
    const tense = Math.max(0, ...toks.map((t, j) => (t.pos === 'verb' && t.form !== t.lemmas[0] ? tenseOf(t.form, t.lemmas[0], j === 0) : 0)));
    const own = { id: 900000000 + i, own: true, text: es, native: [de], toks, lemmas, tense, seq: ` ${toks.map((t) => t.form).join(' ')} ` };
    if (hit.item ? !itemMatch(own, hit.ref) : !lemmas.includes(key)) { fatal.push(`${where}: „${es}“ enthält das Wort nicht (erkannt: ${lemmas.join(' ')})`); continue; }
    own.newest = Math.max(gateAt[tense], ...lemmas.map((l) => wordOf.get(l).idx));
    const limit = Math.max(unitStart[hit.ui] + units[hit.ui].size + 16, 120);
    if (!(own.newest < limit)) {
      const late = lemmas.filter((l) => wordOf.get(l).idx >= limit);
      fatal.push(`${where}: „${es}“ – erst später gelernt: ${late.join(' ') || `Zeitform ${TENSES[tense]}`}`);
      continue;
    }
    if (ownOf.has(hit.ref)) { fatal.push(`${where}: für dieses Wort gibt es schon ein eigenes Beispiel`); continue; }
    ownOf.set(hit.ref, own);
  }
  if (fatal.length) {
    console.error(`Abbruch (${fatal.length} Fehler):\n  ${fatal.slice(0, 200).join('\n  ')}`);
    process.exit(1);
  }
}
const exampleOf = new Map();
units.forEach((unit, ui) => {
  for (const c of unit.words ?? []) exampleOf.set(c, ownOf.get(c) ?? bestExample(sentencesOf.get(c.L.lemma) ?? [], ui));
  for (const it of unit.items ?? []) exampleOf.set(it, ownOf.get(it) ?? bestExample(sentences.filter((s) => s.newest != null && itemMatch(s, it)), ui));
});
const toExample = (s) => {
  if (s.own) return { target: s.text, native: s.native[0], source: { name: 'Wortweg' } };
  const source = { name: 'Tatoeba', id: String(s.id), url: `https://tatoeba.org/de/sentences/show/${s.id}` };
  if (s.user) source.author = s.user;
  return { target: s.text, native: s.native[0], source };
};

// Ungeprüfte Sätze melden (Übungen und Beispiele), damit sie von Hand durchgesehen werden können.
const unreviewed = new Map();
for (const list of unitSentences) for (const s of list) if (!whitelist.has(s.id)) unreviewed.set(s.id, s);
for (const s of exampleCandidates.values()) unreviewed.set(s.id, s);

// --- Kurs schreiben ----------------------------------------------------------------------------------

const attribution = [
  { name: 'Tatoeba', url: 'https://tatoeba.org/', license: 'CC BY 2.0 FR', usage: 'Beispielsätze Spanisch–Deutsch mit Übersetzungen; Autor je Satz unter source.author, Übersetzungen auf der verlinkten Satzseite.' },
  { name: 'Wiktionary (englisch), aufbereitet von kaikki.org/Wiktextract', url: 'https://kaikki.org/dictionary/Spanish/', license: 'CC BY-SA 4.0', usage: 'Grundformen (Wortform → Lemma), Wortart, Genus, Kennzeichnung vulgärer/abwertender Wörter.' },
  { name: 'Wiktionary (deutsch), aufbereitet von kaikki.org/Wiktextract', url: 'https://kaikki.org/dewiktionary/Spanisch/', license: 'CC BY-SA 4.0', usage: 'Deutsche Bedeutungen (Kandidaten) und Genus deutscher Nomen.' },
  { name: 'WikDict (aus Wiktionary/DBnary)', url: 'https://www.wikdict.com/', license: 'CC BY-SA 3.0', usage: 'Deutsche Bedeutungen (Kandidaten mit Gewichten, beide Richtungen).' },
  { name: 'FrequencyWords (Hermit Dave), aus OpenSubtitles', url: 'https://github.com/hermitdave/FrequencyWords', license: 'CC BY-SA 4.0', usage: 'Häufigkeit spanischer Wortformen (Reihenfolge der Wörter).' },
];

const levels = [];
let sentenceCount = 0;
const coveredWords = new Set();
let exampleCount = 0;
units.forEach((unit, u) => {
  if (!levels.length || levels.at(-1).title !== unit.stage) {
    levels.push({ id: `es-s${String(levels.length + 1).padStart(2, '0')}`, title: unit.stage, units: [] });
  }
  const level = levels.at(-1);
  const sents = unitSentences[u].map((s) => {
    s.lemmas.forEach((l) => coveredWords.add(l));
    const source = { name: 'Tatoeba', id: String(s.id), url: `https://tatoeba.org/de/sentences/show/${s.id}` };
    if (s.user) source.author = s.user;
    return { native: s.native, target: s.target, note: sentenceNote(s, wordOf, unitStart[u], formHints), source };
  });
  sentenceCount += sents.length;
  const same = level.units.filter((x) => x.baseTitle === unit.title).length;
  const out = {
    id: `es-w-${String(u + 1).padStart(3, '0')}`,
    title: same ? `${unit.title} ${same + 1}` : unit.title,
    baseTitle: unit.title,
    description: unit.words ? unit.words.map((c) => c.L.lemma).join(', ') : unit.items.map((it) => it.ziel[0]).join(', '),
  };
  if (unit.intro) out.intro = unit.intro;
  const withExample = (w, key) => {
    const ex = exampleOf.get(key);
    if (ex) { w.examples = [toExample(ex)]; exampleCount++; }
    return w;
  };
  out.words = unit.words
    ? unit.words.map((c) => {
      const w = { native: c.native, target: c.target };
      if (c.note) w.note = c.note;
      w.tags = [`rank-${c.L.rank}`, `thema-${theme(c)}`];
      return withExample(w, c);
    })
    : unit.items.map((it) => {
      const w = { native: it.deutsch, target: it.ziel };
      if (it.hinweis) w.note = it.hinweis;
      w.tags = ['regel'];
      return withExample(w, it);
    });
  out.sentences = sents;
  level.units.push(out);
});
for (const l of levels) for (const un of l.units) delete un.baseTitle;

const courseJson = {
  id: 'de-es-wortschatz',
  title: 'Spanisch – Wortschatz',
  subtitle: 'Die häufigsten Wörter mit Beispielsätzen',
  nativeLang: 'de',
  targetLang: 'es',
  ttsLang: 'es-ES',
  license: 'CC BY-SA 4.0',
  generated: true,
  attribution,
  levels,
};

/** JSON mit je einer Zeile pro Wort/Satz (kompakt, aber gut vergleichbar). */
function serialize(c) {
  const { levels: lv, ...head } = c;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  const units = (l) => l.units.map((un) => {
    const { words: ws, sentences: ss, ...uh } = un;
    return `${JSON.stringify(uh).slice(0, -1)},"words":[\n${ws.map((x) => JSON.stringify(x)).join(',\n')}],\n"sentences":[\n${ss.map((x) => JSON.stringify(x)).join(',\n')}]}`;
  }).join(',\n');
  const body = lv.map((l) => `${JSON.stringify({ id: l.id, title: l.title }).slice(0, -1)},"units":[\n${units(l)}]}`).join(',\n');
  return `${top},\n  "levels": [\n${body}]\n}\n`;
}

const check = validateCourse(courseJson);
if (!check.ok) {
  console.error(check.errors.slice(0, 20).join('\n'));
  process.exit(1);
}
const text = serialize(courseJson);
JSON.parse(text);
if (!args.includes('--nur-pruefen')) await writeFile(OUT, text);

// Bericht für eigene Sätze: Wörter ohne Beispiel bzw. mit unbekannten Wörtern im Beispiel, Wortschatz in Lernreihenfolge.
if (reportPath) {
  const rows = [];
  units.forEach((unit, ui) => {
    const end = unitStart[ui] + unit.size;
    const limit = Math.max(end + 16, 120);
    for (const ref of [...(unit.words ?? []), ...(unit.items ?? [])]) {
      const ex = exampleOf.get(ref);
      const word = unit.words ? { lemma: ref.L.lemma, ziel: ref.target, deutsch: ref.native } : { lemma: ref.ziel[0], ziel: ref.ziel, deutsch: ref.deutsch, regelwort: true };
      const late = ex && !ex.own ? ex.lemmas.filter((l) => wordOf.get(l)?.idx >= end) : [];
      rows.push({ ...word, einheit: `es-w-${String(ui + 1).padStart(3, '0')}`, einheitTitel: unit.title, position: unitStart[ui] + (unit.words ?? unit.items).indexOf(ref),
        erlaubtBisPosition: limit - 1, zeitformenBekannt: TENSES.filter((_, t) => gateAt[t] < limit),
        beispiel: ex ? { es: ex.text, de: ex.native[0], eigen: !!ex.own, unbekannteWoerter: late } : null });
    }
  });
  const vocab = [...wordOf.entries()].sort((a, b) => a[1].idx - b[1].idx).map(([lemma, v]) => ({ position: v.idx, lemma, deutsch: v.gloss }));
  await writeFile(reportPath, JSON.stringify({ woerter: rows, vocab }, null, 1));
}

// Liste zum Durchsehen: alle Lemmata bis Rang 8000 mit Status, Kandidaten und englischer Glosse.
if (listPath) {
  const inCourse = new Map(words.map((c, i) => [c.L.lemma, { c, i }]));
  const inCand = new Map(candidates.map((c) => [c.L.lemma, c]));
  const rows = ['rang\tkurs\tlemma\twortart\tgenus\tstatus\tdeutsch\tziel\tkandidaten\tenglisch'];
  for (const L of lemmaList.slice(0, 8000)) {
    const hit = inCourse.get(L.lemma);
    const c = hit?.c ?? inCand.get(L.lemma);
    const status = hit ? c.source : c ? 'ohne Satz' : L.status ?? '?';
    const cands = glossCandidates(L, sources).slice(0, 5).map((x) => `${x.gender ? ART[x.gender] + ' ' : ''}${x.word}:${x.score.toFixed(1)}`).join('; ');
    const en = (kaikki.get(L.lemma) ?? []).filter((r) => r.self).flatMap((r) => r.en).slice(0, 2).join(' / ');
    rows.push([L.rank, hit ? hit.i + 1 : '', L.lemma, L.mainPos, c?.gender ?? '', status, c?.native.join(' | ') ?? '', c?.target.join(' | ') ?? '', cands, en].join('\t'));
  }
  await writeFile(listPath, rows.join('\n') + '\n');
}

// Liste der ungeprüften Sätze (ID, Spanisch, Deutsch) zum Durchsehen.
if (unreviewedPath) {
  const rows = [...unreviewed.values()].sort((a, b) => a.newest - b.newest || a.id - b.id).map((s) => `${s.id} ${s.text} | ${s.native[0]}`);
  await writeFile(unreviewedPath, rows.join('\n') + (rows.length ? '\n' : ''));
}

const manualCount = words.filter((c) => c.source === 'manuell').length;
log(`Fertig: ${levels.length} Abschnitte, ${units.length} Einheiten, ${units.reduce((a, un) => a + Math.ceil(un.size / 4), 0)} Lektionen, `
  + `${words.length} Wörter (${manualCount} geprüft) + ${units.reduce((a, u) => a + (u.items?.length ?? 0), 0)} Regelwörter, ${sentenceCount} Sätze (${reviewUsed} Wiederholungssätze), `
  + `${exampleCount} Beispiele, ${unreviewed.size} ungeprüft, ${coveredWords.size} Wörter in Sätzen, ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB`);
log(`Ausgelassen: ${JSON.stringify(drop)}`);
