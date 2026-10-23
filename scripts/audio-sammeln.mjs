// Sammelt menschliche Aussprache-Aufnahmen für die Datenkurse – keine Computer- oder KI-Stimmen:
//   Wörter: Lingua Libre und ältere Aussprachedateien (u. a. Shtooka) auf Wikimedia Commons,
//   Sätze:  Tatoeba-Aufnahmen mit Lizenz (ohne Lizenz dürfen sie außerhalb Tatoebas nicht genutzt werden).
// Alles landet in .cache/audio/ (nicht im Repo, nicht vertrauenswürdig: nur parsen und dekodieren).
// Danach macht scripts/audio-aufbereiten.mjs daraus die Dateien für die App.
// Aufruf: node scripts/audio-sammeln.mjs [es|zh] [--nur-liste]   (--nur-liste: nur zählen, nichts laden)
import { createReadStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordingKey as audioKey } from '../src/recordings.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = join(ROOT, '.cache/audio/');
const UA = 'Wortweg/0.5 (https://github.com/aprael/wortweg; freie Lern-App, einmaliger Abgleich)';
const API = 'https://commons.wikimedia.org/w/api.php';
const TATOEBA_META = 'https://downloads.tatoeba.org/exports/sentences_with_audio.tar.bz2';

const LANGS = {
  es: {
    courses: ['de-es-wortschatz', 'de-es'],
    commons: ['Lingua_Libre_pronunciation-spa'],
    tatoeba: 'spa',
  },
  zh: {
    courses: ['de-zh'],
    commons: ['Lingua_Libre_pronunciation-cmn', 'Chinese_pronunciation', 'Mandarin_pronunciation'],
    tatoeba: 'cmn',
  },
};

// Commons erlaubt nur freie Lizenzen; trotzdem jede Datei prüfen. Tatoeba: auch NC/ND (Wortweg ist nicht
// kommerziell), aber nur mit eingetragener Lizenz – ND-Dateien gibt aufbereiten.mjs unverändert weiter.
const ccUrl = (license) => {
  const m = String(license).match(/^CC (BY(?:-[A-Z]{2})*) (\d\.\d)/i);
  return m ? `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/` : license.startsWith('CC0') ? 'https://creativecommons.org/publicdomain/zero/1.0/' : '';
};
const COMMONS_OK = /^(cc0|public domain|pd|cc[ -]by(-sa)?[ -]\d)/i;
const TATOEBA_OK = /^(cc0|cc by( |-sa |-nc |-nc-nd |-nc-sa )?\d)/i;

const args = process.argv.slice(2);
const onlyList = args.includes('--nur-liste');
const langs = args.filter((a) => LANGS[a]);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Pinyin mit Tonziffern („an1ji2“) → mit Tonzeichen („ānjí“), damit Dateinamen und Kurs-Lesungen vergleichbar sind.
const TONE_MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', 'ü': 'ǖǘǚǜ' };
function markSyllable(s, tone) {
  s = s.replace(/v|u:/g, 'ü');
  if (tone < 1 || tone > 4) return s;
  let pos = s.search(/[ae]/);
  if (pos < 0) pos = s.indexOf('ou');
  if (pos < 0) for (let i = 0; i < s.length; i++) if ('iouü'.includes(s[i])) pos = i;
  return pos < 0 ? s : s.slice(0, pos) + TONE_MARKS[s[pos]][tone - 1] + s.slice(pos + 1);
}
function readingKey(reading) {
  const r = reading.normalize('NFC').toLowerCase();
  const marked = /\d/.test(r) ? r.replace(/([a-zü:v]+)([0-5])/g, (_, s, t) => markSyllable(s, Number(t))) : r;
  return marked.replace(/[\s'’·.-]/g, '');
}

async function fetchRetry(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init.headers } }).catch((e) => e);
    if (res instanceof Response && res.ok) return res;
    const status = res instanceof Response ? res.status : 0;
    if (status === 404 || attempt >= 30) throw new Error(`${url}: ${status ? `HTTP ${status}` : res.message}`);
    // Wikimedia drosselt Abrufe nicht zwischengespeicherter Dateien (429 mit Retry-After): genau so lange warten.
    const retryAfter = Number(res instanceof Response ? res.headers.get('retry-after') : NaN);
    await res.body?.cancel?.().catch(() => {});
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? (retryAfter + 1) * 1000 : 10000 * Math.min(attempt + 1, 6));
  }
}

async function commonsApi(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const text = await (await fetchRetry(url)).text();
    if (text.startsWith('{')) {
      await sleep(1000);
      return JSON.parse(text);
    }
    if (attempt >= 8) throw new Error(`Commons-API: ${text.slice(0, 120)}`);
    await sleep(15000 * (attempt + 1));
  }
}

/** Alle Dateititel einer Commons-Kategorie (zwischengespeichert). */
async function categoryFiles(cat) {
  const file = join(CACHE, 'listen', `${cat}.txt`);
  if (existsSync(file)) return (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  const titles = [];
  let cont = '';
  do {
    const j = await commonsApi({ action: 'query', list: 'categorymembers', cmtitle: `Category:${cat}`,
      cmtype: 'file', cmlimit: '500', ...(cont ? { cmcontinue: cont } : {}) });
    for (const m of j.query.categorymembers) titles.push(m.title);
    cont = j.continue?.cmcontinue ?? '';
  } while (cont);
  mkdirSync(join(CACHE, 'listen'), { recursive: true });
  await writeFile(file, titles.join('\n') + '\n');
  return titles;
}

/** Was aus einem Commons-Dateinamen gesprochen wird: {text} (Lingua Libre) oder {reading} (Pinyin-Name). */
function parseTitle(title, lang) {
  const ll = title.match(/^File:LL-Q\d+ \(([a-z-]+)\)-[^-]+-(.+)\.(wav|ogg|oga|flac|mp3)$/i);
  if (ll) return { text: ll[2].replace(/^\([^)]*\)\s*/, '') };
  if (lang !== 'zh') return null;
  const py = title.match(/^File:(?:(?:Zh|Cmn|Zh-cn)-)?([a-zA-ZüÜ:āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ0-5' -]+)\.(ogg|oga|wav|flac|mp3)$/);
  return py ? { reading: py[1] } : null;
}

/** Texte, die die App vorliest: Wörter (mit Lesung), einzelne Satzbausteine, Tatoeba-Sätze. */
function courseTexts(course) {
  const words = [];
  const tokens = new Set();
  const sentences = [];
  for (const level of course.levels) {
    for (const unit of level.units) {
      for (const w of unit.words ?? []) {
        words.push(w);
        for (const e of w.examples ?? []) if (e.source?.name === 'Tatoeba') sentences.push({ text: e.target, id: e.source.id });
      }
      for (const s of unit.sentences ?? []) {
        for (const t of s.tokens ?? []) tokens.add(t);
        for (const t of s.target) for (const piece of t.split(/[\s,.;:!?¡¿«»"“”()]+/)) if (piece) tokens.add(piece);
        if (s.source?.name === 'Tatoeba') sentences.push({ text: s.target[0], id: s.source.id });
      }
    }
  }
  return { words, tokens, sentences };
}

function commandLines(cmd, cmdArgs) {
  const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  return createInterface({ input: child.stdout, crlfDelay: Infinity });
}

async function tatoebaAudio() {
  const file = join(CACHE, 'tatoeba', 'sentences_with_audio.tar.bz2');
  if (!existsSync(file)) {
    mkdirSync(join(CACHE, 'tatoeba'), { recursive: true });
    const res = await fetchRetry(TATOEBA_META);
    await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()));
    renameSync(`${file}.part`, file);
  }
  const bySentence = new Map();
  for await (const line of commandLines('tar', ['-xOjf', file])) {
    const [sid, audioId, user, license, attribution] = line.split('\t');
    if (!audioId || !TATOEBA_OK.test(license ?? '')) continue;
    if (!bySentence.has(sid)) bySentence.set(sid, []);
    bySentence.get(sid).push({ audioId, user, license, attribution: attribution ?? '' });
  }
  return bySentence;
}

async function commonsMeta(titles) {
  const file = join(CACHE, 'meta-commons.json');
  const meta = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
  const missing = titles.filter((t) => !(t in meta));
  for (let i = 0; i < missing.length; i += 50) {
    const j = await commonsApi({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist', titles: missing.slice(i, i + 50).join('|') });
    const renamed = new Map((j.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of j.query.pages) {
      const info = p.imageinfo?.[0];
      const em = info?.extmetadata ?? {};
      meta[renamed.get(p.title) ?? p.title] = info ? {
        url: info.url.split('?')[0], size: info.size, mime: info.mime, page: info.descriptionurl,
        license: em.LicenseShortName?.value ?? '', licenseUrl: em.LicenseUrl?.value ?? '',
        // Artist kommt als HTML; nur den Text behalten.
        artist: (em.Artist?.value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      } : null;
    }
    if (i % 1000 === 0) process.stdout.write(`  Metadaten ${i + 50}/${missing.length}\n`);
    await writeFile(file, JSON.stringify(meta));
  }
  return meta;
}

async function download(url, target) {
  if (existsSync(target)) return false;
  const res = await fetchRetry(url);
  await writeFile(`${target}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${target}.part`, target);
  return true;
}

const jobs = [];
for (const lang of langs.length ? langs : Object.keys(LANGS)) {
  const cfg = LANGS[lang];
  const texts = { words: [], tokens: new Set(), sentences: [] };
  for (const id of cfg.courses) {
    const t = courseTexts(JSON.parse(await readFile(join(ROOT, 'data/courses', `${id}.json`), 'utf8')));
    texts.words.push(...t.words);
    for (const x of t.tokens) texts.tokens.add(x);
    texts.sentences.push(...t.sentences);
  }

  // Wörter und Satzbausteine → Commons-Dateien
  const byText = new Map();
  const byReading = new Map();
  for (const cat of cfg.commons) {
    for (const title of await categoryFiles(cat)) {
      const p = parseTitle(title, lang);
      if (p?.text) (byText.get(audioKey(p.text)) ?? byText.set(audioKey(p.text), []).get(audioKey(p.text))).push(title);
      else if (p?.reading) {
        const k = readingKey(p.reading);
        (byReading.get(k) ?? byReading.set(k, []).get(k)).push(title);
      }
    }
  }
  const wanted = new Map(); // Schlüssel (wie die App ihn sucht) → Commons-Titel
  const want = (key, titles, how) => {
    if (!titles?.length) return;
    if (!wanted.has(key)) wanted.set(key, []);
    for (const title of titles) wanted.get(key).push({ title, how });
  };
  let wordsWith = 0;
  const wordKeys = new Set(texts.words.flatMap((w) => w.target.map(audioKey)));
  for (const w of texts.words) {
    const before = wanted.size;
    for (const t of w.target) {
      const k = audioKey(t);
      want(k, byText.get(k), 'genau');
      // „el cariño“: Aufnahme ohne Artikel, wenn es keine mit Artikel gibt
      if (lang === 'es' && !byText.has(k)) want(k, byText.get(audioKey(t.replace(/^(el|la|los|las|un|una) /i, ''))), 'ohne-artikel');
      if (lang === 'zh' && w.reading) want(k, byReading.get(readingKey(w.reading)), 'pinyin');
    }
    if (wanted.size > before || w.target.some((t) => wanted.has(audioKey(t)))) wordsWith++;
  }
  // Satzbausteine (Wortkacheln): nur echte Aufnahmen genau dieses Worts
  const readingOf = new Map(texts.words.filter((w) => w.reading).map((w) => [audioKey(w.target[0]), w.reading]));
  for (const tok of texts.tokens) {
    const k = audioKey(tok);
    if (wanted.has(k)) continue;
    want(k, byText.get(k), 'genau');
    if (lang === 'zh' && readingOf.has(k)) want(k, byReading.get(readingKey(readingOf.get(k))), 'pinyin');
  }
  const titles = [...new Set([...wanted.values()].flat().map((c) => c.title))];
  console.log(`${lang}: ${wordsWith}/${texts.words.length} Wörter mit Aufnahme, ${wanted.size} Schlüssel, ${titles.length} Commons-Dateien`);

  // Sätze → Tatoeba
  const tat = await tatoebaAudio();
  const seen = new Set();
  const sentenceAudio = [];
  for (const s of texts.sentences) {
    const rec = tat.get(String(s.id));
    if (!rec || seen.has(s.id)) continue;
    seen.add(s.id);
    sentenceAudio.push({ key: audioKey(s.text), text: s.text, sentenceId: s.id, ...rec[0] });
  }
  console.log(`${lang}: ${sentenceAudio.length}/${new Set(texts.sentences.map((s) => s.id)).size} Tatoeba-Sätze mit freigegebener Aufnahme`);
  if (onlyList) continue;

  const meta = await commonsMeta(titles);
  const candidates = [];
  let bytes = 0;
  const rawDir = join(CACHE, lang, 'roh');
  mkdirSync(rawDir, { recursive: true });
  for (const [key, list] of wanted) {
    let n = 0;
    for (const { title, how } of list) {
      const m = meta[title];
      if (!m || !COMMONS_OK.test(m.license)) continue;
      const ext = m.url.split('.').pop().toLowerCase();
      const file = `c-${createHash('sha1').update(title).digest('hex').slice(0, 16)}.${ext}`;
      // Reihenfolge beim Laden: erste Aufnahme jedes Lernworts, dann Satzbausteine, zuletzt Alternativen.
      const prio = n++ > 0 ? 3 : wordKeys.has(key) ? 0 : 2;
      candidates.push({ key, source: 'commons', how, title, file, prio, ...m });
      bytes += m.size;
    }
  }
  for (const s of sentenceAudio) {
    candidates.push({ key: s.key, source: 'tatoeba', how: 'satz', text: s.text, sentenceId: s.sentenceId,
      file: `t-${s.audioId}.mp3`, url: `https://tatoeba.org/en/audio/download/${s.audioId}`,
      page: `https://tatoeba.org/de/sentences/show/${s.sentenceId}`, license: s.license, licenseUrl: ccUrl(s.license),
      artist: s.user, attribution: s.attribution, prio: 1 });
  }
  await writeFile(join(CACHE, lang, 'kandidaten.json'), JSON.stringify(candidates, null, 1));
  const files = [...new Map(candidates.map((c) => [c.file, c])).values()].filter((c) => !existsSync(join(rawDir, c.file)));
  console.log(`${lang}: ${files.length} Dateien fehlen noch (Commons insgesamt etwa ${(bytes / 1e6).toFixed(0)} MB, dazu Tatoeba-MP3s)`);
  for (const c of files) jobs.push({ ...c, target: join(rawDir, c.file) });
}

// Laden: Commons und Tatoeba gleichzeitig (verschiedene Server), jeweils nacheinander und mit Pause.
async function loadQueue(name, queue, pause) {
  queue.sort((a, b) => a.prio - b.prio);
  const started = Date.now();
  let failed = 0;
  for (const [i, c] of queue.entries()) {
    try {
      await download(c.url, c.target);
    } catch (e) {
      failed++;
      process.stdout.write(`  ${name}: ${e.message}\n`);
    }
    await sleep(pause);
    if ((i + 1) % 100 === 0 || i + 1 === queue.length) {
      const perFile = (Date.now() - started) / (i + 1);
      process.stdout.write(`  ${name}: ${i + 1}/${queue.length}, noch etwa ${Math.round((queue.length - i - 1) * perFile / 60000)} min\n`);
    }
  }
  console.log(`${name}: fertig (${queue.length - failed} geladen, ${failed} fehlgeschlagen)`);
}
if (!onlyList) {
  await Promise.all([
    loadQueue('Commons', jobs.filter((j) => j.source === 'commons'), 1000),
    loadQueue('Tatoeba', jobs.filter((j) => j.source === 'tatoeba'), 500),
  ]);
}
