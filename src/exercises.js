// Erzeugt Übungen deterministisch aus den Kursdaten (gleicher Seed → gleiche Übungen).

import { WORDS_PER_LESSON, findUnit } from './content.js';
import { normalize, tokenize, isChinese } from './grading.js';

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickIndices(start, count, length) {
  const out = [];
  for (let i = 0; i < count && out.length < length; i++) {
    const idx = (start + i) % length;
    if (!out.includes(idx)) out.push(idx);
  }
  return out;
}

/** Ein Lernobjekt (Wort oder Satz) eindeutig referenzieren – Grundlage für die Wiederholung. */
export function itemKey(courseId, ref) {
  return `${courseId}|${ref.kind}|${ref.unitId}|${ref.index}`;
}

function distinctBy(list, keyFn) {
  const seen = new Set();
  return list.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const NON_WORD_CHAR = /[\p{P}\p{S}\s]/u;

/**
 * Satzbau-Bausteine eines Satzes: `tokens` aus den Kursdaten, sonst bei Chinesisch Einzelzeichen
 * (ohne Satzzeichen), sonst Wörter an Leerzeichen.
 */
export function sentenceTokens(sentence, lang) {
  if (Array.isArray(sentence.tokens) && sentence.tokens.length) return sentence.tokens;
  if (isChinese(lang)) return Array.from(sentence.target[0].normalize('NFC')).filter((ch) => !NON_WORD_CHAR.test(ch));
  return tokenize(sentence.target[0]);
}

/** Lesung je Baustein, wenn `reading` genau so viele Wörter hat wie Bausteine (sonst null). */
function tokenReadings(sentence, tokens) {
  if (typeof sentence.reading !== 'string') return null;
  const parts = sentence.reading.split(/\s+/).map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')).filter(Boolean);
  return parts.length === tokens.length ? parts : null;
}

/** Text der Zielsprache → Lesung (aus Wörtern und zerlegten Sätzen der Einheit), für Auswahl-Optionen. */
function readingLookup(unit, lang) {
  const map = new Map();
  for (const w of unit.words) if (w.reading) map.set(normalize(w.target[0], lang), w.reading);
  for (const x of unit.sentences) {
    const tokens = sentenceTokens(x, lang);
    const r = tokenReadings(x, tokens);
    if (r) tokens.forEach((t, i) => { if (!map.has(normalize(t, lang))) map.set(normalize(t, lang), r[i]); });
  }
  return map;
}

/** Hängt Lesungen nur an, wenn es welche gibt – Übungen ohne Lesung bleiben wie bisher. */
function withReadings(ex, { reading, choiceReadings } = {}) {
  const out = { ...ex };
  if (reading) out.reading = reading;
  if (choiceReadings && choiceReadings.some(Boolean)) out.choiceReadings = choiceReadings;
  return out;
}

function wordExplanation(word, course, reverse) {
  const pair = reverse ? `„${word.target[0]}“ = „${word.native[0]}“` : `„${word.native[0]}“ = „${word.target[0]}“`;
  return word.note ? `${pair}. ${word.note}` : `${pair}.`;
}

function choiceExercise({ course, unit, wi, rng, reverse, id }) {
  const word = unit.words[wi];
  const side = reverse ? 'native' : 'target';
  const lang = reverse ? course.nativeLang : course.targetLang;
  const answer = word[side][0];
  const others = distinctBy(
    shuffle(unit.words.filter((_, i) => i !== wi), rng).map((w) => w[side][0]),
    (s) => normalize(s, lang),
  ).filter((s) => !word[side].some((a) => normalize(a, lang) === normalize(s, lang)));
  const choices = shuffle([answer, ...others.slice(0, 3)], rng);
  const lookup = !reverse && unit.words.some((w) => w.reading) ? readingLookup(unit, lang) : null;
  return withReadings({
    id,
    type: 'choice',
    instruction: reverse ? 'Was bedeutet dieses Wort?' : 'Wähle die richtige Übersetzung.',
    question: reverse ? word.target[0] : word.native[0],
    questionLang: reverse ? course.targetLang : course.nativeLang,
    choices,
    answer,
    accepted: [answer],
    answerLang: lang,
    solution: answer,
    explanation: wordExplanation(word, course, reverse),
    ref: { kind: 'w', unitId: unit.id, index: wi },
  }, {
    // reading = Lesung des zielsprachlichen Texts (rückwärts: der Frage), choiceReadings parallel zu choices.
    reading: word.reading,
    choiceReadings: lookup ? choices.map((c) => lookup.get(normalize(c, lang)) ?? null) : null,
  });
}

function translateWordExercise({ course, unit, wi, id }) {
  const word = unit.words[wi];
  return withReadings({
    id,
    type: 'translate',
    instruction: 'Übersetze ins ' + langName(course.targetLang) + '.',
    question: word.native[0],
    questionLang: course.nativeLang,
    accepted: word.target,
    answerLang: course.targetLang,
    solution: word.target[0],
    explanation: wordExplanation(word, course, false),
    ref: { kind: 'w', unitId: unit.id, index: wi },
  }, { reading: word.reading });
}

function translateSentenceExercise({ course, unit, si, id }) {
  const s = unit.sentences[si];
  return withReadings({
    id,
    type: 'translate',
    instruction: 'Übersetze ins ' + langName(course.targetLang) + '.',
    question: s.native[0],
    questionLang: course.nativeLang,
    accepted: s.target,
    answerLang: course.targetLang,
    solution: s.target[0],
    explanation: s.note,
    ref: { kind: 's', unitId: unit.id, index: si },
  }, { reading: s.reading });
}

function orderExercise({ course, unit, si, rng, id }) {
  const s = unit.sentences[si];
  const lang = course.targetLang;
  const tokens = sentenceTokens(s, lang);
  const own = new Set(tokens.map((t) => normalize(t, lang)));
  const pool = distinctBy(
    unit.sentences.filter((_, i) => i !== si).flatMap((x) => sentenceTokens(x, lang)),
    (t) => normalize(t, lang),
  ).filter((t) => !own.has(normalize(t, lang)));
  const distractors = shuffle(pool, rng).slice(0, 2);
  // Lesungen je Baustein: eigene aus reading des Satzes, Ablenker aus der Einheit.
  const ownReadings = tokenReadings(s, tokens);
  const lookup = s.reading || unit.words.some((w) => w.reading) ? readingLookup(unit, lang) : null;
  const tagged = [
    ...tokens.map((text, i) => ({ text, reading: ownReadings?.[i] ?? lookup?.get(normalize(text, lang)) })),
    ...distractors.map((text) => ({ text, reading: lookup?.get(normalize(text, lang)) })),
  ];
  const bank = shuffle(tagged, rng).map((t, i) => (t.reading ? { id: `t${i}`, text: t.text, reading: t.reading } : { id: `t${i}`, text: t.text }));
  return withReadings({
    id,
    type: 'order',
    instruction: 'Bilde den Satz.',
    question: s.native[0],
    questionLang: course.nativeLang,
    bank,
    accepted: s.target,
    answerLang: lang,
    solution: s.target[0],
    solutionTokens: [...tokens],
    explanation: s.note,
    ref: { kind: 's', unitId: unit.id, index: si },
  }, { reading: s.reading });
}

/** Lückentext ohne Leerzeichen (Chinesisch): Bausteine im Originalsatz suchen, Satzzeichen bleiben stehen. */
function splitAtToken(text, tokens, blank) {
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const at = text.indexOf(tokens[i], pos);
    if (at < 0) return null;
    if (i === blank) return { before: text.slice(0, at), after: text.slice(at + tokens[i].length) };
    pos = at + tokens[i].length;
  }
  return null;
}

function fillExercise({ course, unit, si, rng, id }) {
  const s = unit.sentences[si];
  const lang = course.targetLang;
  const zh = isChinese(lang);
  const tokens = zh ? sentenceTokens(s, lang) : tokenize(s.target[0]);
  const wordSet = new Set(unit.words.flatMap((w) => w.target).filter((t) => !t.includes(' ')).map((t) => normalize(t, lang)));
  let blank = tokens.findIndex((t) => wordSet.has(normalize(t, lang)));
  if (blank < 0) {
    blank = tokens.reduce((best, t, i) => (t.length > tokens[best].length ? i : best), 0);
  }
  const answer = tokens[blank];
  const inSentence = new Set(tokens.map((t) => normalize(t, lang)));
  const candidates = distinctBy(
    [
      ...shuffle(unit.words.map((w) => w.target[0]).filter((t) => !t.includes(' ')), rng),
      ...shuffle(unit.sentences.flatMap((x) => (zh ? sentenceTokens(x, lang) : tokenize(x.target[0]))), rng),
    ],
    (t) => normalize(t, lang),
  ).filter((t) => !inSentence.has(normalize(t, lang)) && (zh || t.length > 1));
  const choices = shuffle([answer, ...candidates.slice(0, 3)], rng);
  const lookup = s.reading || unit.words.some((w) => w.reading) ? readingLookup(unit, lang) : null;
  const choiceReadings = lookup ? choices.map((c) => lookup.get(normalize(c, lang)) ?? null) : null;
  const zhParts = zh ? splitAtToken(s.target[0].normalize('NFC'), tokens, blank) : null;
  // Satz mit Lücke anhand der Original-Schreibweise (Satzzeichen bleiben erhalten).
  const raw = s.target[0].split(/\s+/);
  const before = raw.slice(0, blank).join(' ');
  const after = raw.slice(blank + 1).join(' ');
  const rawBlank = raw[blank] ?? '';
  const trailing = rawBlank.slice(rawBlank.indexOf(answer) + answer.length);
  const leading = rawBlank.slice(0, rawBlank.indexOf(answer));
  return withReadings({
    id,
    type: 'fill',
    instruction: 'Fülle die Lücke.',
    question: s.native[0],
    questionLang: course.nativeLang,
    parts: zhParts ?? { before: `${before}${before ? ' ' : ''}${leading}`, after: `${trailing}${after ? ' ' : ''}${after}` },
    choices,
    answer,
    accepted: [answer],
    answerLang: lang,
    solution: s.target[0],
    explanation: s.note,
    ref: { kind: 's', unitId: unit.id, index: si },
  }, { reading: s.reading, choiceReadings });
}

function listenExercise({ course, unit, si, id }) {
  const s = unit.sentences[si];
  return withReadings({
    id,
    type: 'listen',
    instruction: 'Hör zu und schreib, was du hörst.',
    question: s.native[0],
    speak: s.target[0],
    speakLang: course.ttsLang || course.targetLang,
    questionLang: course.nativeLang,
    accepted: [s.target[0]],
    answerLang: course.targetLang,
    solution: s.target[0],
    explanation: `Bedeutung: „${s.native[0]}“. ${s.note}`,
    ref: { kind: 's', unitId: unit.id, index: si },
  }, { reading: s.reading });
}

function speakExercise({ course, unit, si, id }) {
  const s = unit.sentences[si];
  return withReadings({
    id,
    type: 'speak',
    instruction: 'Sprich diesen Satz.',
    question: s.target[0],
    speak: s.target[0],
    speakLang: course.ttsLang || course.targetLang,
    questionLang: course.targetLang,
    accepted: s.target,
    answerLang: course.targetLang,
    solution: s.target[0],
    explanation: `Bedeutung: „${s.native[0]}“. ${s.note}`,
    ref: { kind: 's', unitId: unit.id, index: si },
  }, { reading: s.reading });
}

/**
 * Paare zuordnen aus Kandidaten [{unit, wi}] (bevorzugte zuerst). Ein Wort wird übersprungen, wenn eine seiner
 * Varianten (normalisiert) mit einer Variante eines bereits gewählten Worts übereinstimmt – so ist jede Zuordnung
 * eindeutig. Weniger als 2 eindeutige Paare → null.
 */
function matchExercise({ course, candidates, rng, id, size = WORDS_PER_LESSON }) {
  const nl = course.nativeLang;
  const tl = course.targetLang;
  const usedNative = new Set();
  const usedTarget = new Set();
  const chosen = [];
  for (const c of candidates) {
    if (chosen.length >= size) break;
    const word = c.unit.words[c.wi];
    if (!word || chosen.some((x) => x.unit.id === c.unit.id && x.wi === c.wi)) continue;
    const n = word.native.map((t) => normalize(t, nl));
    const t = word.target.map((x) => normalize(x, tl));
    if (n.some((x) => usedNative.has(x)) || t.some((x) => usedTarget.has(x))) continue;
    n.forEach((x) => usedNative.add(x));
    t.forEach((x) => usedTarget.add(x));
    chosen.push({ ...c, word });
  }
  if (chosen.length < 2) return null;
  const leftOrder = shuffle(chosen.map((_, i) => i), rng);
  const rightOrder = shuffle(chosen.map((_, i) => i), rng);
  const left = leftOrder.map((ci, i) => ({ id: `l${i}`, text: chosen[ci].word.native[0], lang: nl }));
  const right = rightOrder.map((ci, i) => {
    const { reading } = chosen[ci].word;
    return reading ? { id: `r${i}`, text: chosen[ci].word.target[0], lang: tl, reading } : { id: `r${i}`, text: chosen[ci].word.target[0], lang: tl };
  });
  const pairs = chosen.map((_, ci) => [`l${leftOrder.indexOf(ci)}`, `r${rightOrder.indexOf(ci)}`]);
  return {
    id,
    type: 'match',
    instruction: 'Finde die Paare.',
    question: '',
    questionLang: nl,
    left,
    right,
    pairs,
    answerLang: tl,
    solution: chosen.map((c) => `${c.word.native[0]} = ${c.word.target[0]}`).join(' · '),
    explanation: chosen.map((c) => wordExplanation(c.word, course, false)).join(' '),
    refs: chosen.map((c) => ({ kind: 'w', unitId: c.unit.id, index: c.wi })),
    // Lesungen parallel zu right (Pinyin unter den zielsprachlichen Karten), nur wenn vorhanden.
    ...(right.some((r) => r.reading) ? { rightReadings: right.map((r) => r.reading ?? null) } : {}),
  };
}

const LANG_NAMES = {
  en: 'Englische', es: 'Spanische', de: 'Deutsche', fr: 'Französische', it: 'Italienische', tr: 'Türkische',
  zh: 'Chinesische', pt: 'Portugiesische', nl: 'Niederländische', pl: 'Polnische', sv: 'Schwedische',
  ja: 'Japanische', ru: 'Russische', uk: 'Ukrainische', ar: 'Arabische',
};
export function langName(code) {
  return LANG_NAMES[String(code).slice(0, 2)] ?? code;
}

/** Kandidaten fürs Zuordnen: zuerst die Wörter der Lektion, dann die übrigen der Einheit (falls Doppelte fehlen). */
function lessonMatchCandidates(unit, wordIdx) {
  const rest = unit.words.map((_, i) => i).filter((i) => !wordIdx.includes(i));
  return [...wordIdx, ...rest].map((wi) => ({ unit, wi }));
}

/**
 * Baut die Übungen einer Lektion (10 Übungen, mit Sprechen 11).
 * Reihenfolge: Auswahl, Auswahl, Paare, Satzbau, Auswahl (rückwärts), Lücke, Satz übersetzen, Wort übersetzen,
 * Hören (sonst Satzbau), [Sprechen], Satz übersetzen.
 * @param {object} course
 * @param {object} unit
 * @param {number} lessonIndex
 * @param {{seed?: string|number, listening?: boolean, speaking?: boolean}} [opts]
 */
export function buildLesson(course, unit, lessonIndex, { seed = '', listening = false, speaking = false } = {}) {
  const rng = createRng(`${course.id}|${unit.id}|${lessonIndex}|${seed}`);
  const w = pickIndices(lessonIndex * WORDS_PER_LESSON, WORDS_PER_LESSON, unit.words.length);
  const s = pickIndices(lessonIndex * 3, 4, unit.sentences.length);
  const base = { course, unit, rng };
  const list = [
    choiceExercise({ ...base, wi: w[0] }),
    choiceExercise({ ...base, wi: w[1 % w.length] }),
    matchExercise({ ...base, candidates: lessonMatchCandidates(unit, w) }),
    orderExercise({ ...base, si: s[0] }),
    choiceExercise({ ...base, wi: w[2 % w.length], reverse: true }),
    fillExercise({ ...base, si: s[1 % s.length] }),
    translateSentenceExercise({ ...base, si: s[2 % s.length] }),
    translateWordExercise({ ...base, wi: w[3 % w.length] }),
    listening
      ? listenExercise({ ...base, si: s[3 % s.length] })
      : orderExercise({ ...base, si: s[3 % s.length] }),
    // Sprechen erst nach der Übersetzung desselben Satzes, damit der gezeigte Satz nichts verrät.
    speaking ? speakExercise({ ...base, si: s[2 % s.length] }) : null,
    translateSentenceExercise({ ...base, si: s[0] }),
  ].filter(Boolean);
  // IDs nach Position vergeben; fällt eine Übung weg (z. B. kein eindeutiges Paar), bleiben sie lückenlos.
  return list.map((ex, i) => ({ ...ex, id: `${unit.id}:${lessonIndex}:${i + 1}` }));
}

/** Verteilt Lernobjekte reihum über alle Einheiten (je Einheit gemischt), damit jede Einheit vorkommt. */
function spreadRefs(units, key, rng) {
  const perUnit = shuffle(units, rng).map((unit) => shuffle(unit[key].map((_, i) => i), rng).map((i) => ({ unit, i })));
  const out = [];
  const longest = Math.max(...perUnit.map((l) => l.length));
  for (let r = 0; r < longest; r++) for (const l of perUnit) if (l[r]) out.push(l[r]);
  return out;
}

/**
 * Checkpoint am Ende eines Abschnitts: 10–12 Übungen aus allen Einheiten (10 Grundübungen, +1 Hören, +1 Sprechen).
 * Hören und Sprechen stehen am Ende, damit die gezeigten bzw. gesprochenen Sätze vorher nichts verraten.
 * @param {{seed?: string|number, listening?: boolean, speaking?: boolean}} [opts]
 */
export function buildCheckpoint(course, level, { seed = '', listening = false, speaking = false } = {}) {
  const rng = createRng(`${course.id}|checkpoint|${level.id}|${seed}`);
  const words = spreadRefs(level.units, 'words', rng);
  const sents = spreadRefs(level.units, 'sentences', rng);
  let si = 0;
  const nextSentence = () => sents[si++ % sents.length];
  const word = (n) => words[n % words.length];
  const sb = () => {
    const x = nextSentence();
    return { course, unit: x.unit, si: x.i, rng };
  };
  const wb = (n) => ({ course, unit: word(n).unit, wi: word(n).i, rng });
  const main = [
    choiceExercise(wb(0)),
    choiceExercise(wb(1)),
    choiceExercise({ ...wb(2), reverse: true }),
    orderExercise(sb()),
    orderExercise(sb()),
    translateSentenceExercise(sb()),
    translateSentenceExercise(sb()),
    fillExercise(sb()),
    fillExercise(sb()),
  ];
  // Paare aus den nächsten Wörtern; wenn keine eindeutigen Paare möglich sind, eine weitere Wortübung.
  const match = matchExercise({ course, rng, candidates: words.slice(3).concat(words.slice(0, 3)).map((x) => ({ unit: x.unit, wi: x.i })) });
  main.push(match ?? translateWordExercise(wb(3)));
  const list = shuffle(main, rng);
  if (listening) list.push(listenExercise(sb()));
  if (speaking) list.push(speakExercise(sb()));
  return list.map((ex, i) => ({ ...ex, id: `cp:${level.id}:${i + 1}` }));
}

/**
 * Barrierefreiheit: Hören/Sprechen → Übersetzen desselben Satzes (alle Zielvarianten gelten).
 * Andere Typen (oder unbekannte Sätze) kommen unverändert zurück.
 */
export function fallbackExercise(ex, course) {
  if (!ex || (ex.type !== 'listen' && ex.type !== 'speak') || ex.ref?.kind !== 's') return ex;
  const unit = course ? findUnit(course, ex.ref.unitId) : null;
  if (!unit?.sentences[ex.ref.index]) return ex;
  return translateSentenceExercise({ course, unit, si: ex.ref.index, id: ex.id });
}

/** Alle Lernobjekte, die eine Lektion einführt (für die spätere Wiederholung). */
export function lessonItems(unit, lessonIndex) {
  const w = pickIndices(lessonIndex * WORDS_PER_LESSON, WORDS_PER_LESSON, unit.words.length);
  const s = pickIndices(lessonIndex * 3, 4, unit.sentences.length);
  return [
    ...w.map((index) => ({ kind: 'w', unitId: unit.id, index })),
    ...s.map((index) => ({ kind: 's', unitId: unit.id, index })),
  ];
}

/** Übung für ein fälliges Wiederholungsobjekt. */
export function buildReviewExercise(course, ref, { seed = '', box = 0 } = {}) {
  const unit = findUnit(course, ref.unitId);
  if (!unit) return null;
  const rng = createRng(`${course.id}|review|${ref.unitId}|${ref.kind}|${ref.index}|${seed}`);
  const id = `review:${itemKey(course.id, ref)}`;
  if (ref.kind === 'w') {
    if (!unit.words[ref.index]) return null;
    return box === 0
      ? choiceExercise({ course, unit, wi: ref.index, rng, id })
      : translateWordExercise({ course, unit, wi: ref.index, id });
  }
  if (!unit.sentences[ref.index]) return null;
  return box < 2
    ? orderExercise({ course, unit, si: ref.index, rng, id })
    : translateSentenceExercise({ course, unit, si: ref.index, id });
}
