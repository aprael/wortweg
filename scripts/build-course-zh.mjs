// Baut den Datenkurs Deutsch → Chinesisch (HSK 1–3 nach HSK 3.0) aus offenen Quellen.
// Eingaben: .cache/sources/zh/ (heruntergeladene Quellen, nicht im Repo, nur als Daten gelesen)
//           data/build/zh/   (kuratierte Dateien: Glossen, Namen, Ausschlüsse, eigene Sätze)
// Ausgabe:  data/courses/de-zh.json – deterministisch (gleiche Eingaben → gleiche Datei).
// Aufruf:   node scripts/build-course-zh.mjs               → Kurs bauen
//           node scripts/build-course-zh.mjs --kandidaten  → Glossen-Kandidaten für Wörter ohne Eintrag in glossen.tsv
//           node scripts/build-course-zh.mjs --kandidaten --alle  → … für alle Wörter
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/grading.js';
import { validateCourse, WORDS_PER_LESSON } from '../src/content.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = `${ROOT}.cache/sources/zh/`;
const CUR = `${ROOT}data/build/zh/`;
const OUT = `${ROOT}data/courses/de-zh.json`;
const args = new Set(process.argv.slice(2));
const started = performance.now();

// --- Hilfsfunktionen -------------------------------------------------------------------------------

const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const gzLines = (p) => gunzipSync(readFileSync(p)).toString('utf8').split('\n');
/** bz2-Datei zeilenweise (Node hat kein bzip2, daher das Systemprogramm). */
function bz2Lines(p) {
  const r = spawnSync('bzip2', ['-dc', p], { maxBuffer: 1 << 30, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`bzip2 fehlgeschlagen für ${p}: ${r.stderr}`);
  return r.stdout.split('\n');
}
/** Kuratierte TSV-Datei: Kommentare (#) und Leerzeilen überspringen. */
function tsv(name, path = CUR + name) {
  if (!existsSync(path)) return [];
  return readText(path).split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t').map((x) => x.trim()));
}
/** Wert nach einem Schalter („--bericht datei“), sonst null. */
const argValue = (flag) => { const i = process.argv.indexOf(flag); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const HAN = /\p{Script=Han}/u;
const isHan = (s) => /^[\p{Script=Han}〇]+$/u.test(s);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --- Pinyin --------------------------------------------------------------------------------------------

const MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
const UNMARK = new Map(Object.entries(MARKS).flatMap(([v, m]) => [...m].map((c, i) => [c, [v, i + 1]])));

/** Silbe mit Tonziffer → Tonzeichen („hao3“ → „hǎo“, „lu:4“/„lv4“ → „lǜ“, Ton 5 = neutral). */
function markSyllable(syl) {
  const m = syl.toLowerCase().match(/^([a-zü:]+?)([0-5])?$/);
  if (!m) return syl.toLowerCase();
  const base = m[1].replace(/u:|v/g, 'ü');
  const tone = Number(m[2] ?? 5);
  if (tone === 0 || tone === 5) return base;
  // Regel: a oder e trägt den Ton; bei „ou“ das o; sonst der letzte Vokal.
  let i = base.search(/[ae]/);
  if (i < 0) i = base.indexOf('ou');
  if (i < 0) for (let k = base.length - 1; k >= 0; k--) if ('iouü'.includes(base[k])) { i = k; break; }
  if (i < 0) return base;
  return base.slice(0, i) + MARKS[base[i]][tone - 1] + base.slice(i + 1);
}
/** Silben eines Worts zusammenfügen; Apostroph vor a/e/o im Wortinneren (nǚ'ér). */
function joinSyllables(syls) {
  return syls.map((s, i) => (i > 0 && /^[aeoāáǎàēéěèōóǒò]/i.test(s) ? `'${s}` : s)).join('');
}
/** Pinyin ohne Töne/Leerzeichen/Apostrophe, für Vergleiche („Běijīng“ → „beijing“). */
function pinyinLetters(s) {
  let out = '';
  for (const ch of String(s).normalize('NFC').toLowerCase()) {
    const u = UNMARK.get(ch);
    if (u) out += u[0] === 'ü' ? 'v' : u[0];
    else if (ch === 'ü') out += 'v';
    else if (ch >= 'a' && ch <= 'z') out += ch;
  }
  return out;
}
/** Silben mit Tonzahl („wǒmen“ → „wo3men5“), für Vergleiche inkl. Ton. */
function pinyinTones(s) {
  let out = '';
  let tone = 0;
  for (const ch of String(s).normalize('NFC').toLowerCase()) {
    const u = UNMARK.get(ch);
    if (u) { out += u[0] === 'ü' ? 'v' : u[0]; tone = u[1]; } else if (ch === 'ü') out += 'v';
    else if (ch >= 'a' && ch <= 'z') out += ch;
    else if (ch === ' ' || ch === "'") { out += tone ? String(tone) : ''; tone = 0; }
  }
  return out + (tone ? String(tone) : '');
}

// --- HSK 3.0 Wortliste (Pleco, MIT) -------------------------------------------------------------------

/** Formen eines Listeneintrags: „爸爸｜爸“ → [爸爸, 爸]; „白（形）“ → [白]; „有（一）些“ → [有些, 有一些]; „…极了“ → [极了]. */
function entryForms(raw) {
  const s = raw.replace(/[¹²³]/g, '').replace(/^…/, '');
  const m = s.match(/^(.*?)（(.*?)）(.*)$/);
  if (m && isHan(m[1] + m[3]) && m[3]) return [m[1] + m[3], m[1] + m[2] + m[3]];
  return s.replace(/（.*?）/g, '').split('｜').filter(Boolean);
}
function loadHsk30() {
  const levels = [];
  let cur = null;
  for (const line of readText(`${SRC}hsk30/wordlist.txt`).split('\n')) {
    if (/级词汇表/.test(line)) { cur = []; levels.push(cur); continue; }
    const m = line.match(/^(\d+)\s+(.+?)\s*$/);
    if (m && cur) cur.push({ n: Number(m[1]), raw: m[2], forms: entryForms(m[2]) });
  }
  if (levels.length < 4 || levels[0].length < 400) throw new Error('HSK-3.0-Liste nicht erkannt.');
  return levels;
}

// --- complete-hsk-vocabulary (MIT): Häufigkeitsrang, alte HSK-2.0-Stufe, Lesungen ------------------------

function loadComplete() {
  const map = new Map();
  for (const e of JSON.parse(readText(`${SRC}hsk/complete.json`))) {
    const old = e.level.filter((l) => l.startsWith('old-')).map((l) => Number(l.slice(4)));
    const readings = [...new Set(e.forms.map((f) => joinSyllables(f.transcriptions.pinyin.split(/\s+/))))];
    map.set(e.simplified, { rank: e.frequency ?? 99999, old: old.length ? Math.min(...old) : null, readings });
  }
  return map;
}

// --- HanDeDict (CC BY-SA 3.0) und de.wiktionary (CC BY-SA 4.0): Glossen-Kandidaten ------------------------

/** Ein HanDeDict-Sinn → Glossen ohne Beispiele und Wortart-Kürzel. */
function cleanSense(sense) {
  const head = sense.split(/;\s*Bsp\.:/)[0];
  const pos = (head.match(/\(([^()]*)\)\s*$/) ?? [])[1] ?? '';
  const glosses = head.replace(/\s*\([^()]*\)\s*$/, '').split(/;\s*/).map((g) => g.trim()).filter((g) => g && !/Bsp\./.test(g));
  return { pos, glosses };
}
function loadHanDeDict(needed) {
  const map = new Map();
  for (const line of gzLines(`${SRC}handedict/handedict.u8.gz`)) {
    if (line.startsWith('#')) continue;
    const m = line.match(/^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/);
    if (!m || !needed.has(m[2])) continue;
    const reading = joinSyllables(m[3].split(/\s+/).map(markSyllable));
    const senses = m[4].split('/').map(cleanSense).filter((s) => s.glosses.length);
    if (!map.has(m[2])) map.set(m[2], []);
    map.get(m[2]).push({ reading, senses });
  }
  return map;
}
function loadWiktionary(needed) {
  const map = new Map();
  for (const line of readText(`${SRC}dewiktionary/kaikki.org-dictionary-Chinesisch.jsonl`).split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (!needed.has(e.word) || e.pos === 'character') continue;
    const gl = (e.senses ?? []).flatMap((s) => s.glosses ?? []).flatMap((g) => g.split(/[,;]\s*/)).map((g) => g.trim()).filter(Boolean);
    if (!map.has(e.word)) map.set(e.word, []);
    map.get(e.word).push(...gl);
  }
  return map;
}
/** Vergleichsform einer Glosse (für die Herkunftszählung): ohne Klammern, Artikel, „sich“, Satzzeichen. */
const glossKey = (g) => normalize(String(g).replace(/\([^)]*\)/g, ' ').replace(/^(der|die|das|ein|eine|sich|zu)\s+/i, ''), 'de');

// --- Einlesen ------------------------------------------------------------------------------------------------

const hsk = loadHsk30();
const complete = loadComplete();
const entries = [];
for (let li = 0; li < 3; li++) {
  for (const e of hsk[li]) {
    const info = complete.get(e.forms[0]);
    entries.push({ key: `${li + 1}-${e.n}`, level: li + 1, n: e.n, raw: e.raw, forms: e.forms, rank: info?.rank ?? 99999, old: info?.old ?? null });
  }
}
const vocabForms = new Set(entries.flatMap((e) => e.forms));
const handedict = loadHanDeDict(vocabForms);
const wiktionary = loadWiktionary(vocabForms);

const curated = new Map();
for (const [key, hanzi, reading, bed, hinweis] of tsv('glossen.tsv')) curated.set(key, { hanzi, reading, bed, hinweis });

if (args.has('--kandidaten')) {
  // Ausgabe zum Kuratieren: Schlüssel, Formen, Lesungen (complete.json), HanDeDict-Sinne (gekürzt), Wiktionary.
  const all = args.has('--alle');
  for (const e of entries) {
    if (!all && curated.has(e.key)) continue;
    const readings = e.forms.map((f) => (complete.get(f)?.readings ?? []).join('/')).join(' | ');
    const hd = (handedict.get(e.forms[0]) ?? []).map((h) => `[${h.reading}] ${h.senses.slice(0, 4).map((s) => s.glosses.slice(0, 3).join(', ') + (s.pos ? ` (${s.pos})` : '')).join(' / ')}`).join(' ‖ ');
    const wk = (wiktionary.get(e.forms[0]) ?? []).slice(0, 4).join(', ');
    console.log(`${e.key}\t${e.raw}\t${readings}\t${hd.slice(0, 220)}${wk ? `\tWikt: ${wk.slice(0, 60)}` : ''}`);
  }
  process.exit(0);
}

// --- Wörter aus Liste + Glossen ----------------------------------------------------------------------------

const fatal = [];
const warn = [];
for (const e of entries) if (!curated.has(e.key)) fatal.push(`${e.key} ${e.raw}: fehlt in glossen.tsv`);
const words = [];
const wordByKey = new Map();
for (const e of entries) {
  const c = curated.get(e.key);
  if (!c) continue;
  if (c.hanzi !== e.forms[0]) fatal.push(`${e.key}: Hanzi „${c.hanzi}“ ≠ Liste „${e.forms[0]}“`);
  if (c.bed.startsWith('=')) continue;
  const parts = c.reading.split('|');
  const readings = e.forms.map((f, i) => parts[i] || complete.get(f)?.readings.find((r) => r === r.toLowerCase()) || complete.get(f)?.readings[0] || '');
  const native = c.bed.split(/;\s*/).map((g) => g.trim()).filter(Boolean);
  if (!native.length || native.length > 3) fatal.push(`${e.key}: 1–3 Bedeutungen nötig`);
  for (const g of native) if (g.length > 45 || /[()]/.test(g.replace(/\([^()]*\)/g, ''))) fatal.push(`${e.key}: Glosse „${g}“ zu lang oder Klammern unvollständig`);
  // Lesung gegen complete.json prüfen (nur Buchstaben; Töne können bei neutralen Silben abweichen).
  e.forms.forEach((f, i) => {
    const known = complete.get(f)?.readings ?? [];
    if (known.length && !known.some((r) => pinyinLetters(r) === pinyinLetters(readings[i]))) warn.push(`${e.key} ${f}: Lesung „${readings[i]}“ nicht in complete.json (${known.join('/')})`);
    else if (known.length && !known.some((r) => pinyinTones(r) === pinyinTones(readings[i]))) warn.push(`${e.key} ${f}: Töne „${readings[i]}“ ≠ complete.json (${known.join('/')})`);
  });
  const w = { idx: words.length, keys: [e.key], level: e.level, n: e.n, forms: [...e.forms], readings, native, note: c.hinweis || '', rank: e.rank, old: e.old };
  words.push(w);
  wordByKey.set(e.key, w);
}
// Doppelte Listeneinträge zusammenführen („=Schlüssel“).
const merged = [];
for (const e of entries) {
  const c = curated.get(e.key);
  if (!c?.bed.startsWith('=')) continue;
  const w = wordByKey.get(c.bed.slice(1));
  if (!w) { fatal.push(`${e.key}: Ziel ${c.bed} unbekannt`); continue; }
  w.keys.push(e.key);
  if (e.old != null && (w.old == null || e.old < w.old)) w.old = e.old;
  merged.push(`${e.key} → ${w.keys[0]} (${e.raw})`);
}
for (const w of words) w.tags = [`hsk3-${w.level}`, ...(w.old != null ? [`hsk2-${w.old}`] : [])];
if (fatal.length) {
  console.error(`Abbruch (${fatal.length} Fehler):\n  ${fatal.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}

// Herkunft der Glossen: stimmt eine Glosse (normalisiert) mit HanDeDict bzw. Wiktionary überein?
const glossSource = { main: { HanDeDict: 0, Wiktionary: 0, eigen: 0 }, all: { HanDeDict: 0, Wiktionary: 0, eigen: 0 } };
for (const w of words) {
  const hd = new Set(w.forms.flatMap((f) => (handedict.get(f) ?? []).flatMap((h) => h.senses.flatMap((s) => s.glosses))).map(glossKey));
  const wk = new Set(w.forms.flatMap((f) => wiktionary.get(f) ?? []).map(glossKey));
  w.native.forEach((g, i) => {
    const k = glossKey(g);
    const src = hd.has(k) ? 'HanDeDict' : wk.has(k) ? 'Wiktionary' : 'eigen';
    glossSource.all[src]++;
    if (i === 0) glossSource.main[src]++;
  });
}

// --- Lexikon für die Segmentierung --------------------------------------------------------------------------

/** Form → { words: [idx], name?, unknown?, rank } */
const lex = new Map();
const lexAdd = (form, data) => {
  const cur = lex.get(form);
  if (!cur) lex.set(form, { words: [], rank: 99999, ...data, words: [...(data.words ?? [])] });
  else {
    cur.words.push(...(data.words ?? []));
    cur.rank = Math.min(cur.rank, data.rank ?? 99999);
    if (data.name) cur.name = data.name;
    if (!data.unknown) delete cur.unknown;
  }
};
for (const w of words) w.forms.forEach((f) => lexAdd(f, { words: [w.idx], rank: complete.get(f)?.rank ?? w.rank }));
const names = new Map();
for (const [zh, reading, de, art] of tsv('namen.tsv')) {
  names.set(zh, { reading, de, art });
  lexAdd(zh, { name: { reading, de, art }, rank: 3000 });
}
// Wörter höherer Stufen (HSK 4–9) als „unbekannt“: ein Satz damit wird verworfen statt falsch zerlegt.
for (const lv of hsk.slice(3)) {
  for (const e of lv) for (const f of e.forms) if (isHan(f) && !lex.has(f)) lexAdd(f, { unknown: true, rank: complete.get(f)?.rank ?? 30000 });
}
const MAX_FORM = Math.max(...[...lex.keys()].map((f) => [...f].length));

/** Zerlegt einen Hanzi-Abschnitt (DP: wenige, häufige Wörter). Ergebnis: Formen oder null. */
function segmentRun(chars) {
  const n = chars.length;
  const best = new Array(n + 1).fill(Infinity);
  const prev = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    for (let len = 1; len <= MAX_FORM && i + len <= n; len++) {
      const piece = chars.slice(i, i + len).join('');
      const entry = lex.get(piece);
      if (!entry) continue;
      const cost = best[i] + 10 + Math.log(entry.rank + 10);
      if (cost < best[i + len]) { best[i + len] = cost; prev[i + len] = i; }
    }
  }
  if (best[n] === Infinity) return null;
  const out = [];
  for (let i = n; i > 0; i = prev[i]) out.unshift(chars.slice(prev[i], i).join(''));
  return out;
}

// --- Tatoeba: Sätze, Links, Umschriften, Tags (CC BY 2.0 FR) --------------------------------------------------

const TAT = `${SRC}tatoeba/`;
const rows = (name) => bz2Lines(TAT + name).filter(Boolean).map((l) => l.split('\t'));
const cmnText = new Map(rows('cmn_sentences.tsv.bz2').map(([id, , text]) => [Number(id), (text ?? '').trim()]));
const latnOf = new Map();
const hasHant = new Set();
const hansOf = new Map();
for (const [id, , script, , text] of rows('cmn_transcriptions.tsv.bz2')) {
  if (script === 'Latn') latnOf.set(Number(id), text ?? '');
  else if (script === 'Hant') hasHant.add(Number(id));
  else if (script === 'Hans') hansOf.set(Number(id), text ?? '');
}
const tagsOf = new Map();
for (const [id, tag] of rows('cmn_tags.tsv.bz2')) {
  if (!tagsOf.has(Number(id))) tagsOf.set(Number(id), []);
  tagsOf.get(Number(id)).push(tag);
}
const cmnToDeu = new Map();
const deuToCmn = new Map();
for (const [c, d] of rows('cmn-deu_links.tsv.bz2')) {
  const ci = Number(c);
  const di = Number(d);
  if (!cmnToDeu.has(ci)) cmnToDeu.set(ci, []);
  cmnToDeu.get(ci).push(di);
  if (!deuToCmn.has(di)) deuToCmn.set(di, []);
  deuToCmn.get(di).push(ci);
}
const deuText = new Map();
for (const line of bz2Lines(`${TAT}deu_sentences.tsv.bz2`)) {
  const t1 = line.indexOf('\t');
  const id = Number(line.slice(0, t1));
  if (!deuToCmn.has(id)) continue;
  deuText.set(id, line.slice(line.indexOf('\t', t1 + 1) + 1).trim());
}

// Ausschlüsse (kuratiert): Satz-IDs, Tags, deutsche Wortanfänge, chinesische Wörter.
const excl = { id: new Set(), tag: new Set(), tagPrefix: [], de: [], zh: new Set() };
for (const [type, value] of tsv('ausschluss.tsv')) {
  if (type === 'id') excl.id.add(Number(value));
  else if (type === 'tag') { if (value.endsWith('*')) excl.tagPrefix.push(value.slice(0, -1)); else excl.tag.add(value); }
  else if (type === 'de') excl.de.push(value);
  else if (type === 'zh') excl.zh.add(value);
}
const DE_BAD = excl.de.length ? new RegExp(`(^|[^\\p{L}])(${excl.de.join('|')})`, 'iu') : null;
const DE_NAMES = /\b(Tom|Maria|Mary|John|Jack|Mike|Ken|Bob|Jane|Lucy|Emily|Tony|Paul|Peter|Jim|Bill|Sami|Layla|Ziri|Yanni|Skura|Rima|Mennad|Baya|Mayuko|Taro|Hanako|Jeff|Dan|Linda|Alice|Lisa|Anna|Kate|Nancy|Susan|Betty|Meg|Judy|Yumi|Yoko|Wang|Li|Zhang|Liu|Xiao)\b/;
const badTag = (t) => excl.tag.has(t) || excl.tagPrefix.some((p) => t.startsWith(p));
const ZH_OK = /^[\p{Script=Han}，。！？、；：,.!?;:…“”]+$/u;
const isSimplified = (id, text) => hasHant.has(id) || hansOf.get(id) === text;
const PUNCT_READING = { '，': ',', '、': ',', '。': '.', '！': '!', '？': '?', '；': ';', '：': ':', '…': '…', ',': ',', '.': '.', '!': '!', '?': '?', ';': ';', ':': ':' };

/** Satz zerlegen: Hanzi-Abschnitte zwischen Satzzeichen. Ergebnis { tokens } oder { fail: Grund }. */
function segmentSentence(zh) {
  const tokens = [];
  for (const run of zh.split(/[^\p{Script=Han}]+/u).filter(Boolean)) {
    const seg = segmentRun([...run]);
    if (!seg) return { fail: 'fehlt' };
    tokens.push(...seg);
  }
  if (tokens.some((t) => lex.get(t).unknown)) return { fail: 'unbekannt' };
  return { tokens };
}

/** Teile eines Satzes, die nicht im Kurswortschatz stehen (für Fehlermeldungen zu eigenen Sätzen). */
function segmentUnknown(zh) {
  const out = [];
  for (const run of zh.split(/[^\p{Script=Han}]+/u).filter(Boolean)) {
    const seg = segmentRun([...run]);
    if (!seg) out.push(run);
    else for (const t of seg) if (lex.get(t)?.unknown) out.push(t);
  }
  return out;
}

// Kontextregeln für häufige Mehrfachlesungen; sie gehen vor, weil die automatische Tatoeba-Umschrift
// gerade hier oft danebenliegt (十三只猫 „zhi3“, 过得真快 „de2“). null = keine Regel, Umschrift entscheidet.
const NUM_OR_DEM = /^[一二三四五六七八九十两几百千万这那哪每半有]+$/u;
/** Ist das Token ein Verb? Glossen von Verben stehen im Infinitiv und klein („lieben“, „anrufen“). */
const isVerbToken = (t) => (lex.get(t)?.words ?? []).some((i) => /^(sich )?[a-zäöü]+(en|ern|eln)$/.test(words[i].native[0]));
const READING_RULES = {
  只: (prev) => (prev && NUM_OR_DEM.test(prev) ? 'zhī' : 'zhǐ'),
  得: (prev, next) => (!prev || next === '了' || next === '过' || /^[一二三四五六七八九十两几百千万第]/u.test(next ?? '') ? 'dé' : 'de'),
  了: (prev) => (prev === '不' || prev === '得' ? 'liǎo' : 'le'),
  过: (prev, next) => (next !== '了' && prev && isVerbToken(prev) ? 'guo' : 'guò'),
};

/** Lesung je Token; bei mehrdeutigen Formen (还 hái/huán …) entscheiden Kontextregel bzw. Tatoeba-Umschrift. */
function resolveTokens(zh, tokens, latn) {
  const hanCount = [...zh].filter((ch) => HAN.test(ch)).length;
  const syls = latn ? latn.match(/[a-zA-Zü:]+[0-5]/g) ?? [] : [];
  const aligned = syls.length === hanCount;
  let pos = 0;
  const out = [];
  for (const [ti, t] of tokens.entries()) {
    const len = [...t].length;
    const tat = aligned ? syls.slice(pos, pos + len) : null;
    pos += len;
    const entry = lex.get(t);
    if (entry.name && !entry.words.length) { out.push({ form: t, reading: entry.name.reading, words: [], name: entry.name }); continue; }
    const ws = entry.words.map((i) => words[i]);
    const readingOf = (w) => w.readings[w.forms.indexOf(t)];
    const ruled = READING_RULES[t]?.(tokens[ti - 1], tokens[ti + 1]);
    const byRule = ruled ? ws.filter((w) => readingOf(w) === ruled) : [];
    if (byRule.length && new Set(ws.map(readingOf)).size > 1) {
      out.push({ form: t, reading: ruled, words: byRule.map((w) => w.idx) });
      continue;
    }
    let chosen = ws;
    if (new Set(ws.map((w) => pinyinLetters(readingOf(w)))).size > 1) {
      if (!tat) return null;
      const tl = pinyinLetters(tat.map(markSyllable).join(''));
      chosen = ws.filter((w) => pinyinLetters(readingOf(w)) === tl);
      if (!chosen.length) return null;
    }
    // Gleiche Buchstaben, anderer Ton (只 zhǐ „nur“ / zhī Zählwort): ebenfalls nach der Umschrift entscheiden.
    if (new Set(chosen.map((w) => pinyinTones(readingOf(w)))).size > 1) {
      if (!tat) return null;
      const tt = pinyinTones(joinSyllables(tat.map(markSyllable)));
      const byTone = chosen.filter((w) => pinyinTones(readingOf(w)) === tt);
      if (!byTone.length) return null;
      chosen = byTone;
    }
    out.push({ form: t, reading: readingOf(chosen[0]), words: chosen.map((w) => w.idx) });
  }
  return out;
}

/** Lesung des Satzes: Wort-Lesungen mit Leerzeichen, Satzzeichen hängen am vorigen Wort. */
function sentenceReading(zh, toks) {
  const parts = toks.map((t) => t.reading);
  let at = 0;
  toks.forEach((t, i) => {
    const start = zh.indexOf(t.form, at);
    at = start + t.form.length;
    const nextStart = i + 1 < toks.length ? zh.indexOf(toks[i + 1].form, at) : zh.length;
    for (const ch of zh.slice(at, nextStart)) if (PUNCT_READING[ch]) parts[i] += PUNCT_READING[ch];
  });
  return parts.join(' ');
}

const stat = { links: cmnToDeu.size, ausschluss: 0, tags: 0, traditionell: 0, zeichen: 0, deutsch: 0, fehlt: 0, unbekannt: 0, laenge: 0, inhalt: 0, lesung: 0, doppelt: 0 };
const sentences = [];
const byStripped = new Map();

/** Deutsche Übersetzungen filtern (Inhalt, Länge, fremde Namen) und sortieren (kurz zuerst). */
function germanList(deIds, allowedNames) {
  const seen = new Set();
  return deIds.map((d) => ({ id: d, text: deuText.get(d) })).filter((x) => x.text)
    .filter((x) => x.text.length <= 100 && !(DE_BAD && DE_BAD.test(x.text)) && !/[@#<>]|https?:/.test(x.text))
    .filter((x) => { const m = x.text.match(new RegExp(DE_NAMES, 'g')) ?? []; return m.every((n) => allowedNames.has(n)); })
    .sort((a, b) => a.text.length - b.text.length || a.id - b.id)
    .filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

// Gleiche Form und Lesung, verschiedene Wörter (会 „können“/„Versammlung“, 花 „Blume“/„ausgeben“):
// das Wort nehmen, dessen Bedeutung in der deutschen Übersetzung vorkommt (Wortstamm).
const STOP_DE = new Set(['der', 'die', 'das', 'ein', 'eine', 'einen', 'sich', 'für', 'und', 'oder', 'etwas', 'jemand', 'jemandem', 'jemanden', 'mit', 'von', 'nach', 'vor', 'auf', 'als', 'aus', 'bei', 'über', 'unter', 'nicht', 'sein', 'haben', 'werden']);
const stemsOf = (w) => [...new Set(w.native.flatMap((g) => g.replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^\p{L}]+/u))
  .filter((x) => x.length >= 3 && !STOP_DE.has(x)).map((x) => x.slice(0, Math.max(3, Math.min(5, x.length - 1)))))];
function refineByGerman(toks, deList) {
  const de = deList.map((d) => d.text.toLowerCase()).join(' ');
  for (const t of toks) {
    if (t.words.length < 2) continue;
    const hit = t.words.filter((i) => stemsOf(words[i]).some((st) => de.includes(st)));
    if (hit.length && hit.length < t.words.length) t.words = hit;
  }
}

/** Kandidat aufnehmen (Tatoeba oder eigener Satz). */
function addCandidate({ id, zh, de, latn, own }) {
  const seg = segmentSentence(zh);
  if (seg.fail) { stat[seg.fail]++; return; }
  const { tokens } = seg;
  if (tokens.length < 2 || tokens.length > 12 || [...zh].length > 24) { stat.laenge++; return; }
  if (tokens.some((t) => excl.zh.has(t))) { stat.inhalt++; return; }
  const toks = resolveTokens(zh, tokens, latn);
  if (!toks) { stat.lesung++; if (own) fatal.push(`eigener Satz ${id}: Lesung mehrdeutig – Pinyin-Spalte ergänzen`); return; }
  const allowedNames = new Set(toks.filter((t) => t.name).map((t) => t.name.de));
  const deList = typeof de === 'function' ? de(allowedNames) : de;
  if (!deList.length) { stat.deutsch++; return; }
  refineByGerman(toks, deList);
  const key = stripNonWord(zh);
  const prev = byStripped.get(key);
  if (prev) {
    stat.doppelt++;
    for (const d of deList) if (!prev.de.some((x) => x.text === d.text)) prev.de.push(d);
    return;
  }
  const needs = [];
  const seenNeed = new Set();
  for (const t of toks) {
    if (!t.words.length) continue;
    const k = t.words.join(',');
    if (!seenNeed.has(k)) { seenNeed.add(k); needs.push(t.words); }
  }
  const s = { id, zh, tokens, toks, needs, de: deList, own: !!own, reading: sentenceReading(zh, toks) };
  s.q = -Math.abs(tokens.length - 6) - (deList[0].text.length > 60 ? 2 : 0) - (allowedNames.size ? 1 : 0) - (own ? 6 : 0);
  byStripped.set(key, s);
  sentences.push(s);
}
const stripNonWord = (t) => String(t).normalize('NFC').replace(/[\p{P}\p{S}\s]/gu, '');

for (const id of [...cmnToDeu.keys()].sort((a, b) => a - b)) {
  const zh = cmnText.get(id);
  if (!zh) continue;
  if (excl.id.has(id)) { stat.ausschluss++; continue; }
  if ((tagsOf.get(id) ?? []).some(badTag)) { stat.tags++; continue; }
  if (!isSimplified(id, zh)) { stat.traditionell++; continue; }
  if (!ZH_OK.test(zh)) { stat.zeichen++; continue; }
  addCandidate({ id, zh, latn: latnOf.get(id), de: (allowed) => germanList(cmnToDeu.get(id), allowed) });
}
const tatoebaCount = sentences.length;
for (const [id, zh, de, latn] of tsv('eigene-saetze.tsv')) {
  addCandidate({ id, zh, latn, own: true, de: de.split(/\s*\|\s*/).map((text) => ({ id: 0, text })) });
}
// Eigene Beispielsätze (eigene-beispiele.tsv: Wort, Satz, Deutsch[, Pinyin mit Tonziffern]). Nur als Beispiel des
// genannten Worts, nie in Übungen, und vor Tatoeba. Geprüft wird nach dem Lehrplan (Wort im Satz, Wortschatz bekannt).
// Zum Testen einer anderen Datei: --beispiele datei (mit --nur-pruefen wird nichts geschrieben).
const ownExamples = [];
for (const [i, row] of tsv('eigene-beispiele.tsv', argValue('--beispiele') ?? CUR + 'eigene-beispiele.tsv').entries()) {
  const [wort, zh, de, latn] = row;
  const where = `eigenes Beispiel ${i + 1} (${wort ?? '?'})`;
  if (!wort || !zh || !de) { fatal.push(`${where}: braucht Wort, Satz und Deutsch (Tabulator getrennt)`); continue; }
  if (!/[。？！]$/u.test(zh) || !/^[„"]?[A-ZÄÖÜ0-9]/u.test(de) || !/[.?!"“]$/u.test(de)) { fatal.push(`${where}: Satzzeichen – „${zh}“ / „${de}“`); continue; }
  const seg = segmentSentence(zh);
  if (seg.fail) {
    const what = seg.fail === 'unbekannt' ? 'Wörter außerhalb des Kurses' : 'nicht zerlegbar (Zeichen außerhalb des Kurses)';
    fatal.push(`${where}: „${zh}“ – ${what}: ${segmentUnknown(zh).join(' ') || zh}`);
    continue;
  }
  const before = sentences.length;
  addCandidate({ id: 900000000 + i, zh, latn, own: true, de: de.split(/\s*\|\s*/).map((text) => ({ id: 0, text })) });
  if (sentences.length === before) { fatal.push(`${where}: „${zh}“ abgelehnt (zu lang, Lesung unklar, Inhalt oder Satz schon vorhanden)`); continue; }
  const sObj = sentences.at(-1);
  sObj.exampleOnly = true;
  ownExamples.push({ s: sObj, si: sentences.length - 1, wort, where });
}
console.log(`Tatoeba: ${stat.links} cmn-Sätze mit deutscher Übersetzung → ${tatoebaCount} Kandidaten (${JSON.stringify(stat)})`);
if (args.has('--warnungen')) console.log(warn.join('\n'));

// --- Lehrplan: Abschnitte und Einheiten von leicht nach schwer (data/build/zh/lehrplan.json) ------------------
// Je HSK-Stufe zuerst Themen-Einheiten (häufigste Wörter zuerst), dann Regel-Einheiten mit Regeltext, zuletzt der
// übrige Wortschatz. Ein Satz kommt erst in die Einheit, in der sein letztes Wort gelernt wird (i+1) – Sätze mit
// Regelwörtern wie 了, 把 oder 被 erscheinen deshalb erst ab der passenden Regel-Einheit.

const plan = JSON.parse(readText(CUR + 'lehrplan.json'));
const themeByKey = new Map();
for (const [form, reading, theme, gloss] of tsv('themen.tsv')) {
  if (!plan.themenNamen[theme]) fatal.push(`themen.tsv: unbekanntes Thema „${theme}“ bei ${form}`);
  themeByKey.set(`${form}|${reading}|${gloss}`, theme);
  if (!themeByKey.has(`${form}|${reading}`)) themeByKey.set(`${form}|${reading}`, theme);
}
const themeOf = (w) => themeByKey.get(`${w.forms[0]}|${w.readings[0]}|${w.native[0]}`) ?? themeByKey.get(`${w.forms[0]}|${w.readings[0]}`) ?? 'allg';
const whitelist = new Set(tsv('saetze-geprueft.txt').map((r) => Number(r[0])));
const byLevel = [1, 2, 3].map((L) => words.filter((w) => w.level === L).sort((a, b) => a.rank - b.rank || a.n - b.n));

const normDe = (g) => normalize(g, 'de');
/** Gleiche Hanzi-Form oder gleiche deutsche Hauptbedeutung (auch gegen Nebenbedeutungen) in derselben Einheit? */
function conflicts(w, unitWords) {
  const wm = normDe(w.native[0]);
  return unitWords.some((u) => w.forms.some((f) => u.forms.includes(f))
    || u.native.some((g) => normDe(g) === wm) || w.native.some((g) => normDe(g) === normDe(u.native[0])));
}

const usedW = new Set();
/** Häufigste freie Wörter der Themen (null = alle Themen) einer HSK-Stufe, ohne Konflikt in derselben Einheit. */
function take(themes, count, level, from = byLevel[level - 1], into = []) {
  for (const w of from) {
    if (into.length >= count) break;
    if (usedW.has(w.idx) || (themes && !themes.includes(themeOf(w))) || conflicts(w, into)) continue;
    into.push(w);
  }
  return into;
}

const stages = []; // { title }
const units = []; // { stage, title, intro?, words[] }
function addUnit(stage, title, words, intro) {
  words.forEach((w) => usedW.add(w.idx));
  units.push({ stage, title, words, ...(intro ? { intro } : {}) });
}
/** Wenige übrige Wörter an eine Einheit des Abschnitts hängen (bevorzugt ohne Konflikt) – kein HSK-Wort fällt weg. */
function attachLeftovers(stage, leftovers) {
  for (const w of leftovers) {
    const cands = units.filter((u) => u.stage === stage);
    const target = [...cands].reverse().find((u) => !conflicts(w, u.words)) ?? cands.at(-1);
    target.words.push(w);
    usedW.add(w.idx);
  }
}
for (const st of plan.stufen) {
  if (st.rest) {
    const rest = byLevel[st.hsk - 1].filter((w) => !usedW.has(w.idx));
    const bands = Math.max(1, Math.round(rest.length / (st.proStufe ?? 400)));
    const size = Math.ceil(rest.length / bands);
    for (let b = 0; b < bands; b++) {
      const band = rest.slice(b * size, (b + 1) * size);
      const stage = stages.push({ title: bands > 1 ? `${st.titel} ${b + 1}` : st.titel }) - 1;
      const seen = new Map();
      const titled = (t) => { const n = (seen.get(t) ?? 0) + 1; seen.set(t, n); return n > 1 ? `${t} ${n}` : t; };
      for (const th of Object.keys(plan.themenNamen)) {
        for (;;) {
          const pick = take([th], 16, st.hsk, band);
          if (pick.length < 8) break;
          addUnit(stage, titled(th === 'allg' ? 'Grundwortschatz' : plan.themenNamen[th]), pick);
        }
      }
      for (;;) {
        const pick = take(null, 16, st.hsk, band);
        if (!pick.length) break;
        if (pick.length < 4) { attachLeftovers(stage, pick); break; }
        addUnit(stage, titled('Gemischte Wörter'), pick);
      }
    }
    continue;
  }
  const stage = stages.push({ title: st.titel }) - 1;
  for (const u of st.einheiten) {
    for (let n = 0; ; n++) {
      const pick = take(u.themen, u.anzahl ?? 16, st.hsk);
      // Weitere Einheit nur ab 8 Wörtern; der Rest kommt in den Wortschatz-Abschnitt der Stufe.
      if (n > 0 && pick.length < 8) break;
      if (pick.length < 4) take(['allg'], 4, st.hsk, undefined, pick); // zu kleine Einheit auffüllen
      if (pick.length < 4) take(null, 4, st.hsk, undefined, pick);
      if (!pick.length) break;
      addUnit(stage, n ? `${u.titel} ${n + 1}` : u.titel, pick, n ? undefined : u.intro);
      if (!u.alle) break;
    }
  }
}
const unplaced = words.filter((w) => !usedW.has(w.idx));
if (unplaced.length) fatal.push(`Nicht im Lehrplan: ${unplaced.map((w) => w.forms[0]).join(' ')}`);
if (fatal.length) {
  console.error(`Abbruch (${fatal.length} Fehler):\n  ${fatal.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}

// Positionen im Lernpfad; learnOrder entscheidet bei mehrdeutigen Bausteinen, welches Wort gemeint ist.
const learnOrder = new Array(words.length).fill(Infinity);
const unitStart = [];
let position = 0;
units.forEach((u) => {
  unitStart.push(position);
  u.words.forEach((w) => { learnOrder[w.idx] = position++; });
});
const unitOfPos = (pos) => { let u = unitStart.length - 1; while (unitStart[u] > pos) u--; return u; };
const lessonsAll = units.flatMap((u) => Array.from({ length: Math.ceil(u.words.length / WORDS_PER_LESSON) }, (_, k) => ({ unit: u, k })));

// --- Sätze den Lektionen zuordnen ----------------------------------------------------------------------------
// Lektion k einer Einheit nutzt die Sätze 3k…3k+3 (siehe buildLesson): Lektion 0 braucht 4, jede weitere 3.
// Zuerst Sätze, die in dieser Lektion lernbar werden (möglichst viele neue Wörter), dann frühere Lektionen der
// Einheit, dann unbenutzte Sätze früherer Einheiten (neueste zuerst). Von Hand geprüfte Sätze haben Vorrang.

sentences.forEach((s) => {
  s.newest = Math.max(...s.needs.map((need) => Math.min(...need.map((w) => learnOrder[w]))));
  if (whitelist.has(s.id)) s.q += 4;
});
const byUnit = units.map(() => []);
sentences.forEach((s, si) => { if (Number.isFinite(s.newest) && !s.exampleOnly) byUnit[unitOfPos(s.newest)].push(si); });
const reserve = [];
let deficit = 0;
units.forEach((unit, ui) => {
  const start = unitStart[ui];
  const lessons = Math.ceil(unit.words.length / WORDS_PER_LESSON);
  const lessonOf = (si) => Math.floor((sentences[si].newest - start) / WORDS_PER_LESSON);
  const covered = new Set();
  const chosen = [];
  const pickFrom = (pool) => {
    let best = -1;
    let bestScore = -Infinity;
    for (const si of pool) {
      const s = sentences[si];
      if (s.taken) continue;
      const fresh = s.needs.flat().filter((w) => learnOrder[w] >= start && !covered.has(w)).length;
      const score = s.q + 2 * fresh;
      if (score > bestScore || (score === bestScore && s.id < sentences[best].id)) { best = si; bestScore = score; }
    }
    if (best < 0) return false;
    sentences[best].taken = true;
    sentences[best].needs.flat().forEach((w) => covered.add(w));
    chosen.push(best);
    return true;
  };
  const cands = byUnit[ui];
  for (let k = 0; k < lessons; k++) {
    const quota = k === 0 ? 4 : 3;
    let got = 0;
    const own = cands.filter((si) => lessonOf(si) === k);
    while (got < quota && pickFrom(own)) got++;
    const earlier = cands.filter((si) => lessonOf(si) < k);
    while (got < quota && pickFrom(earlier)) got++;
    while (got < quota) {
      let found = -1;
      for (let i = reserve.length - 1; i >= 0 && found < 0; i--) if (!sentences[reserve[i]].taken) found = i;
      if (found < 0) break;
      const si = reserve.splice(found, 1)[0];
      sentences[si].taken = true;
      chosen.push(si);
      got++;
    }
    deficit += quota - got;
    if (quota > got) (unit.deficits ??= []).push({ lesson: k + 1, missing: quota - got });
  }
  unit.sentences = chosen;
  for (const si of cands.filter((x) => !sentences[x].taken).sort((a, b) => sentences[a].newest - sentences[b].newest || sentences[a].q - sentences[b].q || sentences[b].id - sentences[a].id)) reserve.push(si);
});

// --- Beispielsätze je Wort ------------------------------------------------------------------------------------
// Zu jedem Wort ein Satz, der zeigt, wie man es benutzt: nur von Hand geprüft, mit bis dahin bekannten Wörtern,
// kurz, möglichst nicht derselbe Satz wie in den Übungen. Fehlt einer, landet der beste ungeprüfte Kandidat im Bericht.

const sentencesOfWord = new Map();
sentences.forEach((s, si) => {
  if (!Number.isFinite(s.newest) || s.exampleOnly) return;
  for (const t of s.toks) for (const w of t.words) {
    if (!sentencesOfWord.has(w)) sentencesOfWord.set(w, []);
    if (sentencesOfWord.get(w).at(-1) !== si) sentencesOfWord.get(w).push(si);
  }
});
const exampleUsed = new Set();
const exampleCandidates = new Map();
const exampleOf = new Map();
// Eigene Beispiele: Wort muss im Satz vorkommen; erlaubt sind Wörter bis zum Ende der nächsten Einheit (am Anfang
// die ersten 120 Wörter), damit die ersten Wörter überhaupt Sätze bekommen können.
const ownOf = new Map();
for (const ex of ownExamples) {
  const inSentence = new Set(ex.s.toks.flatMap((t) => t.words));
  const cand = words.filter((w) => w.forms.includes(ex.wort) && inSentence.has(w.idx));
  if (!cand.length) { fatal.push(`${ex.where}: „${ex.s.zh}“ enthält das Wort nicht (oder es wird anders zerlegt: ${ex.s.tokens.join(' ')})`); continue; }
  const w = cand[0];
  const ui = unitOfPos(learnOrder[w.idx]);
  const end = unitStart[ui] + units[ui].words.length;
  const limit = Math.max(end + 16, 120);
  if (!(ex.s.newest < limit)) {
    const late = [...new Set(ex.s.toks.filter((t) => t.words.length && Math.min(...t.words.map((x) => learnOrder[x])) >= limit).map((t) => t.form))];
    fatal.push(`${ex.where}: „${ex.s.zh}“ – erst später gelernt: ${late.join(' ')}`);
    continue;
  }
  if (ownOf.has(w.idx)) { fatal.push(`${ex.where}: für dieses Wort gibt es schon ein eigenes Beispiel`); continue; }
  ownOf.set(w.idx, ex.si);
}
if (fatal.length) {
  console.error(`Abbruch (${fatal.length} Fehler):\n  ${fatal.slice(0, 200).join('\n  ')}`);
  process.exit(1);
}
units.forEach((unit, ui) => {
  const end = unitStart[ui] + unit.words.length;
  for (const w of unit.words) {
    if (ownOf.has(w.idx)) { exampleOf.set(w.idx, ownOf.get(w.idx)); continue; }
    let best = -1;
    let bestScore = -Infinity;
    let fallback = -1;
    let fallbackScore = -Infinity;
    for (const si of sentencesOfWord.get(w.idx) ?? []) {
      const s = sentences[si];
      if (exampleUsed.has(si) || s.own) continue;
      const n = s.tokens.length;
      // Am liebsten nur bekannte Wörter; ein paar Wörter der nächsten Einheiten sind erlaubt (Übersetzung steht dabei).
      const known = s.newest < end ? 6 : s.newest < end + 64 ? 1 : -10;
      const score = known + (s.taken ? -4 : 0) + (n >= 3 && n <= 8 ? 2 : 0) - n * 0.2 + s.q * 0.5;
      if (whitelist.has(s.id)) {
        if (score > bestScore || (score === bestScore && s.id < sentences[best].id)) { best = si; bestScore = score; }
      } else if (score > fallbackScore || (score === fallbackScore && s.id < sentences[fallback].id)) { fallback = si; fallbackScore = score; }
    }
    if (best >= 0 && bestScore > 0) {
      exampleUsed.add(best);
      exampleOf.set(w.idx, best);
    } else if (fallback >= 0 && fallbackScore > 0) exampleCandidates.set(fallback, true);
  }
});

const unreviewedPath = process.argv.includes('--ungeprueft') ? process.argv[process.argv.indexOf('--ungeprueft') + 1] : null;
const unreviewed = new Set();
for (const u of units) for (const si of u.sentences) if (!whitelist.has(sentences[si].id) && !sentences[si].own) unreviewed.add(si);
for (const si of exampleCandidates.keys()) unreviewed.add(si);
if (unreviewedPath) {
  const rows = [...unreviewed].sort((a, b) => sentences[a].newest - sentences[b].newest || sentences[a].id - sentences[b].id)
    .map((si) => { const s = sentences[si]; return `${s.id} ${s.zh} | ${s.de[0].text} | ${s.reading}`; });
  writeFileSync(unreviewedPath, rows.join('\n') + (rows.length ? '\n' : ''));
}

// --- Erklärungen zu Sätzen ----------------------------------------------------------------------------------
// „Wörter: 我 wǒ = ich · 是 shì = sein …“ – neue Wörter der Einheit zuerst behalten, alte zuerst kürzen.

const NOTE_MAX = 250;
const unitOfWord = new Map();
units.forEach((u, ui) => u.words.forEach((w) => unitOfWord.set(w.idx, ui)));
const plainGloss = (g) => g.replace(/\s*\([^()]*\)/g, '').trim() || g;

function sentenceNote(s, ui) {
  const parts = [];
  const seen = new Set();
  let hint = '';
  for (const t of s.toks) {
    if (seen.has(t.form)) continue;
    seen.add(t.form);
    if (t.name) { parts.push({ text: `${t.form} ${t.reading} = ${t.name.de}${t.name.art ? ` (${t.name.art})` : ''}`, prio: 1 }); continue; }
    const w = words[t.words.reduce((a, b) => (learnOrder[b] < learnOrder[a] ? b : a))];
    const wu = unitOfWord.get(w.idx);
    const prio = wu === ui ? 0 : wu >= ui - 2 ? 1 : 2;
    if (prio === 0 && w.note && !hint) hint = `${t.form}: ${w.note}`;
    parts.push({ text: `${t.form} ${t.reading} = ${w.native[0]}`, prio });
  }
  const join = (list) => `Wörter: ${list.map((p) => p.text).join(' · ')}`;
  let list = parts;
  for (let prio = 2; prio >= 1 && join(list).length > NOTE_MAX; prio--) {
    while (join(list).length > NOTE_MAX && list.some((p) => p.prio === prio)) {
      const i = list.findLastIndex((p) => p.prio === prio);
      list = list.filter((_, j) => j !== i);
    }
  }
  while (join(list).length > NOTE_MAX && list.length > 1) list = list.slice(0, -1);
  const note = join(list).slice(0, NOTE_MAX);
  return hint && note.length + hint.length + 3 <= NOTE_MAX ? `${note} – ${hint}` : note;
}

// --- Kurs schreiben ----------------------------------------------------------------------------------------

const attribution = [
  { name: 'HSK 3.0 Wortliste (Pleco Inc., elkmovie/hsk30)', url: 'https://github.com/elkmovie/hsk30', license: 'MIT', usage: 'Wortschatz und Stufen HSK 3.0, Stufe 1–3.' },
  { name: 'complete-hsk-vocabulary (drkameleon)', url: 'https://github.com/drkameleon/complete-hsk-vocabulary', license: 'MIT', usage: 'Pinyin, Häufigkeitsrang und Stufen im alten HSK 2.0 (nur diese Felder, keine Bedeutungen).' },
  { name: 'HanDeDict (Zydeo)', url: 'https://handedict.zydeo.net/', license: 'CC BY-SA 3.0', usage: 'Kandidaten für die deutschen Bedeutungen; alle Bedeutungen von Hand geprüft und bereinigt.' },
  { name: 'Wiktionary (deutsch), aufbereitet von kaikki.org/Wiktextract', url: 'https://kaikki.org/dewiktionary/Chinesisch/', license: 'CC BY-SA 4.0', usage: 'Weitere Kandidaten für die deutschen Bedeutungen.' },
  { name: 'Tatoeba', url: 'https://tatoeba.org/', license: 'CC BY 2.0 FR', usage: 'Beispielsätze Chinesisch–Deutsch mit Übersetzungen; Pinyin-Umschriften zur Wahl der Lesung mehrdeutiger Zeichen. Autor und Übersetzungen auf der verlinkten Satzseite.' },
];

// Gleiche deutsche Übersetzung bei mehreren Sätzen: beim Übersetzen gilt auch der andere chinesische Satz.
const sameGerman = new Map();
const deKey = (s) => normDe(s.de[0].text);
for (const u of units) for (const si of u.sentences) {
  const k = deKey(sentences[si]);
  if (!sameGerman.has(k)) sameGerman.set(k, []);
  sameGerman.get(k).push(si);
}
/** Weitere chinesische Fassungen: andere Tatoeba-Übersetzungen des ersten deutschen Satzes, gleiche Übersetzung im Kurs. */
function alternatives(s) {
  const out = [];
  const seen = new Set([stripNonWord(s.zh)]);
  const add = (t) => { const k = stripNonWord(t); if (!seen.has(k) && out.length < 4) { seen.add(k); out.push(t); } };
  for (const ci of [...(deuToCmn.get(s.de[0].id) ?? [])].sort((a, b) => a - b)) {
    const t = cmnText.get(ci);
    if (ci !== s.id && t && !excl.id.has(ci) && isSimplified(ci, t) && ZH_OK.test(t) && !(tagsOf.get(ci) ?? []).some(badTag)) add(t);
  }
  for (const si of sameGerman.get(deKey(s)) ?? []) if (sentences[si] !== s) add(sentences[si].zh);
  return out;
}

const levels = stages.map((st, i) => ({ id: `zh-s${String(i + 1).padStart(2, '0')}`, title: st.title, units: [] }));
let sentenceCount = 0;
let ownCount = 0;
let altCount = 0;
let exampleCount = 0;
const inSentences = new Set();
const toExample = (s) => ({
  target: s.zh, native: s.de[0].text, reading: s.reading,
  source: s.own ? { name: 'Wortweg' } : { name: 'Tatoeba', id: String(s.id), url: `https://tatoeba.org/de/sentences/show/${s.id}` },
});
units.forEach((unit, ui) => {
  const sents = unit.sentences.map((si) => {
    const s = sentences[si];
    s.needs.flat().forEach((w) => inSentences.add(w));
    const alts = alternatives(s);
    altCount += alts.length;
    if (s.own) ownCount++;
    const source = s.own ? { name: 'Wortweg' } : { name: 'Tatoeba', id: String(s.id), url: `https://tatoeba.org/de/sentences/show/${s.id}` };
    return { native: s.de.slice(0, 5).map((d) => d.text), target: [s.zh, ...alts], tokens: s.tokens, reading: s.reading, note: sentenceNote(s, ui), source };
  });
  sentenceCount += sents.length;
  let description = unit.words.map((w) => w.forms[0]).join('、');
  if (description.length > 200) description = `${description.slice(0, 198)}…`;
  levels[unit.stage].units.push({
    id: `zh-u-${String(ui + 1).padStart(3, '0')}`,
    title: unit.title,
    description,
    ...(unit.intro ? { intro: unit.intro } : {}),
    words: unit.words.map((w) => {
      const out = { native: w.native, target: w.forms, reading: w.readings[0] };
      if (w.note) out.note = w.note;
      out.tags = [...w.tags, `thema-${themeOf(w)}`];
      if (exampleOf.has(w.idx)) { out.examples = [toExample(sentences[exampleOf.get(w.idx)])]; exampleCount++; }
      return out;
    }),
    sentences: sents,
  });
});

const courseJson = {
  id: 'de-zh',
  title: 'Chinesisch',
  subtitle: 'HSK 1–3 (HSK 3.0)',
  nativeLang: 'de',
  targetLang: 'zh',
  ttsLang: 'zh-CN',
  license: 'CC BY-SA 4.0',
  generated: true,
  attribution,
  levels,
};

/** JSON mit je einer Zeile pro Wort/Satz (kompakt, aber gut vergleichbar). */
function serialize(c) {
  const { levels: lv, ...head } = c;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  const unitsText = (l) => l.units.map((un) => {
    const { words: ws, sentences: ss, ...uh } = un;
    return `${JSON.stringify(uh).slice(0, -1)},"words":[\n${ws.map((x) => JSON.stringify(x)).join(',\n')}],\n"sentences":[\n${ss.map((x) => JSON.stringify(x)).join(',\n')}]}`;
  }).join(',\n');
  const body = lv.map((l) => `${JSON.stringify({ id: l.id, title: l.title }).slice(0, -1)},"units":[\n${unitsText(l)}]}`).join(',\n');
  return `${top},\n  "levels": [\n${body}]\n}\n`;
}

const check = validateCourse(courseJson);
if (!check.ok) {
  console.error(check.errors.slice(0, 20).join('\n'));
  process.exit(1);
}
for (const w of check.warnings) console.warn(`Warnung: ${w}`);
const text = serialize(courseJson);
JSON.parse(text);
if (!process.argv.includes('--nur-pruefen')) writeFileSync(OUT, text);

// Bericht für die Arbeit an eigenen Sätzen: Wörter ohne Beispiel, Lektionen mit Fehlbestand, Wortschatz in Lernreihenfolge.
const reportPath = argValue('--bericht');
if (reportPath) {
  const unitOf = (w) => unitOfPos(learnOrder[w.idx]);
  const missing = words.filter((w) => Number.isFinite(learnOrder[w.idx]) && !exampleOf.has(w.idx)).map((w) => {
    const ui = unitOf(w);
    return { wort: w.forms[0], formen: w.forms, pinyin: w.readings[0], deutsch: w.native, hsk: w.level, position: learnOrder[w.idx],
      einheit: `zh-u-${String(ui + 1).padStart(3, '0')}`, einheitTitel: units[ui].title, erlaubtBisPosition: Math.max(unitStart[ui] + units[ui].words.length + 16, 120) - 1 };
  }).sort((a, b) => a.position - b.position);
  const vocab = words.filter((w) => Number.isFinite(learnOrder[w.idx])).sort((a, b) => learnOrder[a.idx] - learnOrder[b.idx])
    .map((w) => ({ position: learnOrder[w.idx], formen: w.forms, pinyin: w.readings[0], deutsch: w.native[0] }));
  const deficits = units.flatMap((u, ui) => (u.deficits ?? []).map((d) => ({ einheit: `zh-u-${String(ui + 1).padStart(3, '0')}`, titel: u.title, ...d,
    woerter: u.words.map((w) => w.forms[0]), erlaubtBisPosition: unitStart[ui] + u.words.length - 1 })));
  writeFileSync(reportPath, JSON.stringify({ missing, deficits, vocab }, null, 1));
}

const perLevel = [1, 2, 3].map((L) => words.filter((w) => w.level === L).length);
console.log(`Fertig in ${((performance.now() - started) / 1000).toFixed(1)} s: Wörter ${words.length} (HSK 1/2/3: ${perLevel.join('/')}; ${merged.length} doppelte Listeneinträge zusammengeführt), `
  + `${stages.length} Abschnitte, ${units.length} Einheiten, ${lessonsAll.length} Lektionen, ${sentenceCount} Sätze (${sentenceCount - ownCount} Tatoeba, ${ownCount} eigene; ${altCount} Alternativen), `
  + `${exampleCount} Beispiele, ${unreviewed.size} ungeprüft, ${inSentences.size} Wörter in Sätzen, Fehlbestand ${deficit}, ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB`);
console.log(`Hauptbedeutungen: ${JSON.stringify(glossSource.main)}; alle Bedeutungen: ${JSON.stringify(glossSource.all)}; Warnungen: ${warn.length}`);
