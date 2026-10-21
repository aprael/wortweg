// Antwortbewertung: reine Funktionen, ohne DOM. Wird von App und Tests genutzt.

const EN_CONTRACTIONS = [
  [/\bi'm\b/g, 'i am'],
  [/\b(you|we|they)'re\b/g, '$1 are'],
  [/\b(he|she|it|that|what|there|where|who)'s\b/g, '$1 is'],
  [/\b(i|you|we|they)'ve\b/g, '$1 have'],
  [/\b(i|you|he|she|it|we|they)'ll\b/g, '$1 will'],
  [/\b(i|you|he|she|it|we|they)'d\b/g, '$1 would'],
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'cannot'],
  [/\bcan not\b/g, 'cannot'],
  [/\b(do|does|did|is|are|was|were|has|have|had|could|would|should)n't\b/g, '$1 not'],
];

const PUNCTUATION = /[.,!?¿¡;:"“”„«»()…]/g;

/** Chinesisch (zh, zh-CN, zh-Hans …): Sprachen ohne Leerzeichen zwischen Wörtern. */
export function isChinese(lang) {
  return String(lang ?? '').slice(0, 2) === 'zh';
}

/** Alle Satzzeichen, Symbole und Leerraum – westlich und chinesisch (，。！？、；：“”《》（）…— usw.). */
const ZH_STRIP = /[\p{P}\p{S}\s]/gu;

/** Strenge Normalisierung: Groß/Klein, Satzzeichen, Leerzeichen, Apostrophe, Sprachregeln. */
export function normalize(text, lang = '') {
  if (isChinese(lang)) {
    // NFKC macht aus Vollbreite Halbbreite (Ａ１！ → a1!); danach fällt aller Leerraum und alle Satzzeichen weg.
    return String(text ?? '').normalize('NFKC').toLowerCase().replace(ZH_STRIP, '');
  }
  let s = String(text ?? '').normalize('NFC').toLowerCase();
  s = s.replace(/[’‘`´]/g, "'");
  s = s.replace(PUNCTUATION, ' ');
  s = s.replace(/-/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (lang === 'en') {
    for (const [re, rep] of EN_CONTRACTIONS) s = s.replace(re, rep);
  }
  if (lang === 'de') {
    s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Lockere Normalisierung: zusätzlich ohne Akzente (é → e). Chinesisch: wie normalize. */
export function looseNormalize(text, lang = '') {
  if (isChinese(lang)) return normalize(text, lang);
  return normalize(text, lang)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/'/g, '');
}

/** Editierdistanz inkl. Vertauschung benachbarter Zeichen (optimal string alignment). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function typoBudget(length, inSentence) {
  if (length >= 9) return 2;
  if (length >= (inSentence ? 4 : 5)) return 1;
  return 0;
}

/** Tippfehler werden pro Wort erlaubt: kurze Wörter müssen exakt stimmen, lange dürfen leicht abweichen. */
function typoDistance(input, target) {
  const a = input.split(' ');
  const b = target.split(' ');
  if (a.length !== b.length) return null;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const d = levenshtein(a[i], b[i]);
    if (d > typoBudget(b[i].length, b.length > 1)) return null;
    total += d;
  }
  return total;
}

// --- Pinyin ---------------------------------------------------------------------------------------

const TONE_MARKS = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4], ê: ['e', 0],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['v', 1], ǘ: ['v', 2], ǚ: ['v', 3], ǜ: ['v', 4], ü: ['v', 0],
  ń: ['n', 2], ň: ['n', 3], ǹ: ['n', 4], ḿ: ['m', 2],
};

/**
 * Zerlegt Pinyin in Buchstaben (ü = v = u:) und die Folge der Töne 1–4 (Tonzeichen oder Tonziffern;
 * 5/0 = neutral, zählt nicht). Leerzeichen, Apostrophe, Bindestriche und Satzzeichen sind egal.
 * Kein Pinyin (z. B. Hanzi) → null.
 */
export function parsePinyin(text) {
  const s = String(text ?? '').normalize('NFC').toLowerCase().replace(/u:/g, 'v');
  let letters = '';
  const tones = [];
  for (const ch of s) {
    const mark = TONE_MARKS[ch];
    if (mark) {
      letters += mark[0];
      if (mark[1]) tones.push(mark[1]);
    } else if (ch >= 'a' && ch <= 'z') {
      letters += ch;
    } else if (ch >= '1' && ch <= '4') {
      tones.push(Number(ch));
    } else if (!/[05\s'’‘`´·\-\p{P}]/u.test(ch)) {
      return null;
    }
  }
  return letters ? { letters, tones } : null;
}

/** Pinyin-Eingabe gegen eine Lesung: null = passt nicht, sonst das Bewertungsergebnis (ohne matched). */
function gradePinyin(input, reading) {
  const a = parsePinyin(input);
  const b = parsePinyin(reading);
  if (!a || !b || a.letters !== b.letters) return null;
  if (!a.tones.length && b.tones.length) return { correct: true, exact: false, hint: 'Richtig, aber ohne Töne – achte auf die Töne.' };
  if (a.tones.join() !== b.tones.join()) return { correct: true, exact: false, hint: 'Fast richtig – achte auf die Töne.' };
  return { correct: true, exact: false, hint: 'Richtig in Pinyin.' };
}

/**
 * Bewertet eine freie Texteingabe gegen akzeptierte Lösungen.
 * @returns {{correct: boolean, exact: boolean, hint: string|null, matched: string}}
 *   matched = die akzeptierte Lösung, die am besten passt (bzw. die Hauptlösung).
 * Chinesisch: keine Tippfehler-Toleranz auf Hanzi; zusätzlich gilt Pinyin aus `readings` (Lesung der Hauptlösung).
 */
export function gradeText(input, accepted, lang = '', { allowTypos = true, readings = [] } = {}) {
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(Boolean);
  const main = list[0] ?? '';
  const strictIn = normalize(input, lang);
  if (!strictIn) return { correct: false, exact: false, hint: null, matched: main };

  for (const a of list) {
    if (normalize(a, lang) === strictIn) return { correct: true, exact: true, hint: null, matched: a };
  }
  if (isChinese(lang)) {
    for (const r of (Array.isArray(readings) ? readings : [readings]).filter((x) => typeof x === 'string' && x)) {
      const p = gradePinyin(input, r);
      if (p) return { ...p, matched: main };
    }
    return { correct: false, exact: false, hint: null, matched: main };
  }
  const looseIn = looseNormalize(input, lang);
  for (const a of list) {
    if (looseNormalize(a, lang) === looseIn) {
      return { correct: true, exact: false, hint: 'Achte auf Akzente und Sonderzeichen.', matched: a };
    }
  }
  if (allowTypos) {
    let best = null;
    for (const a of list) {
      const d = typoDistance(looseIn, looseNormalize(a, lang));
      if (d != null && (!best || d < best.d)) best = { a, d };
    }
    if (best) return { correct: true, exact: false, hint: 'Fast richtig – kleiner Tippfehler.', matched: best.a };
  }
  return { correct: false, exact: false, hint: null, matched: main };
}

/** Multiple Choice / Lückentext mit Auswahl. */
export function gradeChoice(selected, answer) {
  return { correct: selected != null && selected === answer, exact: true, hint: null, matched: answer };
}

/** Satzbau: ausgewählte Bausteine in Reihenfolge, ohne Tippfehler-Toleranz (Chinesisch ohne Leerzeichen). */
export function gradeOrder(tokens, accepted, lang = '') {
  const sentence = (tokens ?? []).join(isChinese(lang) ? '' : ' ');
  return gradeText(sentence, accepted, lang, { allowTypos: false });
}

/** Zerlegt einen Satz in Bausteine (Satzzeichen am Rand werden entfernt). Für Sprachen mit Leerzeichen. */
export function tokenize(sentence) {
  return String(sentence)
    .split(/\s+/)
    .map((t) => t.replace(/^[¿¡"„“(]+|[.,!?;:"“”)]+$/g, ''))
    .filter(Boolean);
}

// --- Bewertung beliebiger Übungen (Browser und Server) ---------------------------------------------

/** Obergrenzen für fremde Eingaben: längere Antworten gelten als falsch, ohne teure Vergleiche. */
export const MAX_TEXT_LENGTH = 500;
const MAX_LIST_LENGTH = 64;
const TEXT_TYPES = new Set(['translate', 'listen', 'speak']);

function invalidResult(ex) {
  const main = ex?.answer ?? (Array.isArray(ex?.accepted) ? ex.accepted[0] : null) ?? ex?.solution ?? '';
  return { correct: false, exact: false, hint: null, matched: typeof main === 'string' ? main : '' };
}

const isShortString = (v) => typeof v === 'string' && v.length <= MAX_TEXT_LENGTH;

/** Ein einzelner Zuordnungsversuch bei „Paare zuordnen“ (für sofortiges Feedback je Paar). */
export function gradeMatchAttempt(ex, leftId, rightId) {
  if (!Array.isArray(ex?.pairs) || typeof leftId !== 'string' || typeof rightId !== 'string') return false;
  return ex.pairs.some((p) => Array.isArray(p) && p[0] === leftId && p[1] === rightId);
}

/** Paare zuordnen: richtig nur, wenn jeder Versuch ein korrektes Paar war und alle Paare gefunden wurden. */
function gradeMatch(ex, attempts) {
  const pairs = Array.isArray(ex.pairs) ? ex.pairs : [];
  if (!Array.isArray(attempts) || attempts.length !== pairs.length || pairs.length === 0) return false;
  const found = new Set();
  for (const a of attempts) {
    if (!Array.isArray(a) || a.length !== 2 || !gradeMatchAttempt(ex, a[0], a[1])) return false;
    const key = `${a[0]}|${a[1]}`;
    if (found.has(key)) return false;
    found.add(key);
  }
  return found.size === pairs.length;
}

/** Satzbau: nur Bausteine aus der Bank, jeder höchstens so oft wie vorhanden. */
function usesBank(ex, tokens) {
  const bank = Array.isArray(ex.bank) ? ex.bank : [];
  if (tokens.length > bank.length) return false;
  const left = new Map();
  for (const b of bank) left.set(b.text, (left.get(b.text) ?? 0) + 1);
  for (const t of tokens) {
    const n = left.get(t) ?? 0;
    if (n === 0) return false;
    left.set(t, n - 1);
  }
  return true;
}

/**
 * Bewertet eine Antwort für jeden Übungstyp. Die Antwort kann von außen kommen (Server):
 * falsche Form, zu lange Eingaben oder unbekannte IDs ergeben correct:false – es wird nie geworfen.
 * @returns {{correct: boolean, exact: boolean, hint: string|null, matched: string}}
 */
export function gradeExercise(ex, response) {
  try {
    if (!ex || typeof ex !== 'object') return invalidResult(null);
    if (ex.type === 'choice' || ex.type === 'fill') {
      if (!isShortString(response) || !Array.isArray(ex.choices) || !ex.choices.includes(response)) return invalidResult(ex);
      return gradeChoice(response, ex.answer);
    }
    if (TEXT_TYPES.has(ex.type)) {
      if (!isShortString(response)) return invalidResult(ex);
      return gradeText(response, ex.accepted, ex.answerLang, { readings: ex.reading ? [ex.reading] : [] });
    }
    if (ex.type === 'order') {
      if (!Array.isArray(response) || response.length > MAX_LIST_LENGTH || !response.every(isShortString)) return invalidResult(ex);
      if (!usesBank(ex, response)) return invalidResult(ex);
      return gradeOrder(response, ex.accepted, ex.answerLang);
    }
    if (ex.type === 'match') {
      if (!Array.isArray(response) || response.length > MAX_LIST_LENGTH) return invalidResult(ex);
      const correct = gradeMatch(ex, response);
      return { correct, exact: correct, hint: null, matched: ex.solution ?? '' };
    }
    return invalidResult(ex);
  } catch {
    return invalidResult(ex);
  }
}

/** Die Antwort, die der Musterlösung entspricht – für Prüfskripte, Tests und die Admin-Vorschau. */
export function solutionResponse(ex) {
  if (ex.type === 'choice' || ex.type === 'fill') return ex.answer;
  if (ex.type === 'order') return Array.isArray(ex.solutionTokens) ? [...ex.solutionTokens] : tokenize(ex.solution);
  if (ex.type === 'match') return ex.pairs.map((p) => [...p]);
  return ex.solution;
}
