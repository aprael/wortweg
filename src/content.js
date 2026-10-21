// Kursdaten: Validierung und Zugriff. Kurse sind reine JSON-Daten (siehe data/courses).

export const WORDS_PER_LESSON = 4;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function isStringList(v) {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 300);
}

const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** Satzzeichen, Symbole und Leerraum (alle Schriften) – für den Abgleich von tokens mit target[0]. */
const NON_WORD = /[\p{P}\p{S}\s]/gu;
export function stripNonWord(text) {
  return String(text ?? '').normalize('NFC').replace(NON_WORD, '');
}
const isChineseLang = (lang) => String(lang ?? '').slice(0, 2) === 'zh';

/** Optionale Felder eines Worts/Satzes (§9.1): reading, tags, tokens, source. */
function checkItemExtras(item, where, err, { sentence }) {
  if (item.reading != null && !isText(item.reading, 300)) err(`${where}: reading muss Text sein (max. 300 Zeichen).`);
  if (item.tags != null) {
    if (!Array.isArray(item.tags) || item.tags.length > 20 || !item.tags.every((t) => isText(t, 64) && !/\s/.test(t))) {
      err(`${where}: tags muss eine Liste kurzer Texte ohne Leerzeichen sein (max. 20).`);
    }
  }
  if (!sentence) {
    if (item.examples != null) {
      const ok = Array.isArray(item.examples) && item.examples.length <= 3 && item.examples.every((e) => e && typeof e === 'object'
        && isText(e.target, 300) && isText(e.native, 300) && (e.reading == null || isText(e.reading, 300)) && (e.source == null || isSource(e.source)));
      if (!ok) err(`${where}: examples muss eine Liste von Beispielen mit target und native (Text) sein (max. 3).`);
    }
    return;
  }
  if (item.tokens != null) {
    const ok = Array.isArray(item.tokens) && item.tokens.length > 0 && item.tokens.length <= 100
      && item.tokens.every((t) => isText(t, 50) && !/\s/.test(t) && stripNonWord(t).length > 0);
    if (!ok) err(`${where}: tokens muss eine Liste von Bausteinen ohne Leerraum sein (max. 100).`);
    else if (Array.isArray(item.target) && stripNonWord(item.tokens.join('')) !== stripNonWord(item.target[0])) {
      err(`${where}: tokens ergeben zusammen nicht target[0] (ohne Satzzeichen/Leerraum).`);
    }
  }
  if (item.source != null && !isSource(item.source)) err(`${where}: source braucht name (Text), optional id und url (http/https).`);
}

function isSource(src) {
  return Boolean(src) && typeof src === 'object' && !Array.isArray(src) && isText(src.name, 100)
    && (src.id == null || isText(String(src.id), 100)) && (src.url == null || isUrl(src.url));
}

function isUrl(v) {
  return typeof v === 'string' && v.length <= 500 && /^https?:\/\/[^\s]+$/.test(v);
}

/** Kursweite Zusatzfelder (§9.1): license, attribution, generated. */
function checkCourseExtras(course, err) {
  if (course.license != null && !isText(course.license, 200)) err('license muss Text sein.');
  if (course.generated != null && typeof course.generated !== 'boolean') err('generated muss true oder false sein.');
  if (course.attribution != null) {
    if (!Array.isArray(course.attribution) || course.attribution.length > 50) {
      err('attribution muss eine Liste sein (max. 50 Einträge).');
    } else {
      course.attribution.forEach((a, i) => {
        const ok = a && typeof a === 'object' && !Array.isArray(a) && isText(a.name, 200) && isText(a.license, 200)
          && (a.url == null || isUrl(a.url)) && (a.usage == null || isText(a.usage, 500));
        if (!ok) err(`attribution ${i + 1}: name und license (Text) nötig, url (http/https) und usage optional.`);
      });
    }
  }
}

/**
 * Prüft einen Kurs strukturell. Wird für mitgelieferte und importierte Kurse verwendet.
 * warnings: kein Fehler, aber schlechtere Übungen (z. B. chinesischer Satz ohne tokens/reading).
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateCourse(course) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    return { ok: false, errors: ['Kurs ist kein Objekt.'], warnings };
  }
  if (!ID_RE.test(course.id ?? '')) err('Kurs-id fehlt oder ist ungültig (a-z, 0-9, -).');
  if (typeof course.title !== 'string' || !course.title.trim()) err('Kurs-title fehlt.');
  for (const key of ['nativeLang', 'targetLang']) {
    if (!LANG_RE.test(course[key] ?? '')) err(`${key} fehlt oder ist kein Sprachcode.`);
  }
  if (course.ttsLang != null && !LANG_RE.test(course.ttsLang)) err('ttsLang ist kein Sprachcode.');
  checkCourseExtras(course, err);
  const zh = isChineseLang(course.targetLang);
  let missingTokens = 0;
  let missingReading = 0;
  if (!Array.isArray(course.levels) || course.levels.length === 0) {
    err('levels muss eine nicht-leere Liste sein.');
    return { ok: false, errors, warnings };
  }
  const ids = new Set();
  const uniq = (id, where) => {
    if (!ID_RE.test(id ?? '')) err(`${where}: id fehlt oder ist ungültig.`);
    else if (ids.has(id)) err(`${where}: id „${id}“ ist doppelt.`);
    else ids.add(id);
  };
  course.levels.forEach((level, li) => {
    const lw = `Stufe ${li + 1}`;
    uniq(level?.id, lw);
    if (typeof level?.title !== 'string' || !level.title.trim()) err(`${lw}: title fehlt.`);
    if (!Array.isArray(level?.units) || level.units.length === 0) {
      err(`${lw}: units muss eine nicht-leere Liste sein.`);
      return;
    }
    level.units.forEach((unit, ui) => {
      const uw = `${lw}, Einheit ${ui + 1}`;
      uniq(unit?.id, uw);
      if (typeof unit?.title !== 'string' || !unit.title.trim()) err(`${uw}: title fehlt.`);
      if (unit?.intro != null && !isText(unit.intro, 2000)) err(`${uw}: intro muss Text sein (max. 2000 Zeichen).`);
      if (!Array.isArray(unit?.words) || unit.words.length < WORDS_PER_LESSON) {
        err(`${uw}: mindestens ${WORDS_PER_LESSON} Wörter nötig.`);
      } else {
        unit.words.forEach((w, wi) => {
          if (!isStringList(w?.native) || !isStringList(w?.target)) err(`${uw}, Wort ${wi + 1}: native/target müssen Textlisten sein.`);
          if (w?.note != null && typeof w.note !== 'string') err(`${uw}, Wort ${wi + 1}: note muss Text sein.`);
          if (w && typeof w === 'object') checkItemExtras(w, `${uw}, Wort ${wi + 1}`, err, { sentence: false });
          if (zh && w?.reading == null) missingReading++;
        });
      }
      if (!Array.isArray(unit?.sentences) || unit.sentences.length < 4) {
        err(`${uw}: mindestens 4 Sätze nötig.`);
      } else {
        unit.sentences.forEach((s, si) => {
          if (!isStringList(s?.native) || !isStringList(s?.target)) err(`${uw}, Satz ${si + 1}: native/target müssen Textlisten sein.`);
          if (typeof s?.note !== 'string' || !s.note.trim()) err(`${uw}, Satz ${si + 1}: note (Erklärung) fehlt.`);
          if (s && typeof s === 'object') checkItemExtras(s, `${uw}, Satz ${si + 1}`, err, { sentence: true });
          if (zh && s?.tokens == null) missingTokens++;
          if (zh && s?.reading == null) missingReading++;
        });
      }
    });
  });
  if (missingTokens) warnings.push(`${missingTokens} chinesische Sätze ohne tokens – Satzbau zerlegt dann in Einzelzeichen.`);
  if (missingReading) warnings.push(`${missingReading} chinesische Wörter/Sätze ohne reading – keine Pinyin-Eingabe möglich.`);
  return { ok: errors.length === 0, errors, warnings };
}

export function lessonCount(unit) {
  return Math.max(1, Math.ceil(unit.words.length / WORDS_PER_LESSON));
}

export function lessonId(unitId, index) {
  return `${unitId}:${index}`;
}

// Große Kurse (>1.000 Lektionen): Lernpfad und Nachschlagetabellen einmal je Kursobjekt berechnen.
// Kursobjekte werden nach dem Laden nicht verändert; ein geänderter Kurs ist ein neues Objekt.
const pathCache = new WeakMap();

/**
 * Lernpfad mit Nachschlagetabellen (gecacht je Kursobjekt).
 * @returns {{lessons: object[], byId: Map, levelIndex: Map, levelLessons: Map, unitById: Map, levelOfUnit: Map}}
 */
export function coursePath(course) {
  let path = pathCache.get(course);
  if (path) return path;
  const lessons = [];
  const byId = new Map();
  const levelIndex = new Map();
  const levelLessons = new Map();
  const unitById = new Map();
  const levelOfUnit = new Map();
  course.levels.forEach((level, li) => {
    levelIndex.set(level.id, li);
    const inLevel = [];
    for (const unit of level.units) {
      if (!unitById.has(unit.id)) unitById.set(unit.id, unit);
      levelOfUnit.set(unit.id, level);
      const n = lessonCount(unit);
      for (let i = 0; i < n; i++) {
        const l = Object.freeze({ id: lessonId(unit.id, i), index: i, count: n, unitId: unit.id, levelId: level.id, unit, level, pos: lessons.length });
        lessons.push(l);
        inLevel.push(l);
        if (!byId.has(l.id)) byId.set(l.id, l);
      }
    }
    levelLessons.set(level.id, Object.freeze(inLevel));
  });
  path = { lessons: Object.freeze(lessons), byId, levelIndex, levelLessons, unitById, levelOfUnit };
  pathCache.set(course, path);
  return path;
}

/** Flache, geordnete Liste aller Lektionen eines Kurses (Lernpfad). Nur lesen – die Liste ist gecacht. */
export function listLessons(course) {
  return coursePath(course).lessons;
}

export function findLesson(course, id) {
  return coursePath(course).byId.get(id) ?? null;
}

export function findUnit(course, unitId) {
  return coursePath(course).unitById.get(unitId) ?? null;
}
