// Wortweg – Oberfläche. Hash-Routing, Rendering per Template-Strings, Ereignis-Delegation.
// Der Server ist die Autorität für Fortschritt und XP; der Browser bewertet nur für sofortiges Feedback
// und schickt am Ende die Rohantworten (docs/ARCHITEKTUR.md §1, §4, §6).

import { listLessons, findLesson, findUnit } from './content.js';
import { buildLesson, buildCheckpoint, buildReviewExercise, fallbackExercise, lessonItems, itemKey } from './exercises.js';
import { gradeExercise, gradeMatchAttempt } from './grading.js';
import {
  dueReviewItems, displayStreak, xpToday, dailyGoalReached, isLessonCompleted, isLessonUnlocked, isCheckpointUnlocked,
  isCheckpointPassed, nextStep, courseProgress, dayKey, DAILY_GOALS, CHECKPOINT_PASS,
} from './progress.js';
import { createSession, currentItem, isFinished, recordAnswer, advance, sessionProgress } from './session.js';
import * as api from './api.js';
import {
  readLegacyState, clearLegacyState, legacyExportPayload, parseJsonText, checkProgressExport, readFileText, downloadJson,
  summarizeState,
} from './storage.js';
import {
  canSpeak, canSay, speak, stopSpeaking, canRecognize, startRecognition, useRecordings, allowDeviceVoice, hasRecordings,
  preloadRecordings,
} from './speech.js';
import { confetti, confettiFrom, tone, attachTapRings, motionOk } from './fx.js';
import { saveRunSnapshot, loadRunSnapshot, clearRunSnapshot, snapshotMatches } from './run-store.js';

// =====================================================================================================
// Reine Hilfsfunktionen (ohne DOM, in tests/ui-app.test.mjs geprüft)
// =====================================================================================================

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const PASSWORD_MIN = 10;

/** Kurse nach Ausgangs- (from) und Zielsprache (to) filtern; leerer Filter = alle. */
export function filterCourses(courses, { from = '', to = '' } = {}) {
  return (courses ?? []).filter((c) => (!from || c.nativeLang === from) && (!to || c.targetLang === to));
}

/** Sprachcodes, die in den Kursen auf einer Seite vorkommen (nativeLang | targetLang), sortiert nach Namen. */
export function courseLanguages(courses, side, nameOf = (c) => c) {
  const codes = [...new Set((courses ?? []).map((c) => c[side]).filter(Boolean))];
  return codes.sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), 'de'));
}

/** Die letzten n Tage (bis heute) mit XP, fehlende Tage = 0. */
export function lastDays(days, now, n = 14) {
  const map = new Map((days ?? []).map((d) => [d.day, d.xp]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = dayKey(d.getTime());
    out.push({ day: key, xp: map.get(key) ?? 0, time: d.getTime() });
  }
  return out;
}

/** Zustand der Paare-Übung. */
export function newMatchUi() {
  return { sel: { l: null, r: null }, attempts: [], found: [], wrong: null };
}

/**
 * Ein Klick in der Paare-Übung. side = 'l' | 'r'.
 * @returns {{match: object, attempt?: {pair: string[], correct: boolean}, done: boolean}}
 */
export function matchPick(match, ex, side, id) {
  const isFound = match.found.some(([l, r]) => (side === 'l' ? l : r) === id);
  if (isFound || (side !== 'l' && side !== 'r')) return { match, done: false };
  const sel = { ...match.sel, [side]: match.sel[side] === id ? null : id };
  if (!sel.l || !sel.r) return { match: { ...match, sel, wrong: null }, done: false };
  const pair = [sel.l, sel.r];
  const correct = gradeMatchAttempt(ex, sel.l, sel.r);
  const attempts = [...match.attempts, pair];
  const found = correct ? [...match.found, pair] : match.found;
  return {
    match: { sel: { l: null, r: null }, attempts, found, wrong: correct ? null : pair },
    attempt: { pair, correct },
    done: found.length === ex.pairs.length,
  };
}

/** Rohantwort einer Übung im Antwortformat aus §4.1. */
export function responseFor(ex, ui) {
  if (ex.type === 'choice' || ex.type === 'fill') return ui.selected;
  if (ex.type === 'order') return ui.picked.map((id) => ex.bank.find((b) => b.id === id)?.text ?? '');
  if (ex.type === 'match') return ui.match.attempts.map((p) => [...p]);
  return ui.text;
}

/** Antwort anhängen: responses[exId] = { answers: [erster, zweiter?], fallback? }. */
export function addResponse(responses, exId, answer, fallback = false) {
  const prev = responses[exId];
  const answers = prev ? [...prev.answers, answer].slice(0, 2) : [answer];
  const entry = { answers };
  if (fallback || prev?.fallback) entry.fallback = true;
  return { ...responses, [exId]: entry };
}

/** Kann geprüft werden? */
export function canCheck(ex, ui) {
  if (ex.type === 'choice' || ex.type === 'fill') return ui.selected != null;
  if (ex.type === 'order') return ui.picked.length > 0;
  if (ex.type === 'match') return false; // wird automatisch bewertet, sobald alle Paare gefunden sind
  return ui.text.trim().length > 0;
}

/** Warum ist eine Lektion gesperrt? (Text für Screenreader und Hinweise) */
export function lockReason(course, lessonId) {
  const lessons = listLessons(course);
  const idx = lessons.findIndex((l) => l.id === lessonId);
  if (idx < 0) return '';
  const lesson = lessons[idx];
  const prev = lessons[idx - 1];
  if (prev && prev.levelId === lesson.levelId) return `Schließe zuerst „${prev.unit.title}“, Lektion ${prev.index + 1} ab.`;
  const li = course.levels.findIndex((l) => l.id === lesson.levelId);
  return li > 0 ? `Bestehe zuerst den Checkpoint „${course.levels[li - 1].title}“.` : '';
}

/** Clientseitige Prüfung der Registrierung (der Server prüft noch einmal). */
export function validateRegistration({ email = '', password = '', displayName = '' }) {
  const errors = {};
  if (!displayName.trim()) errors.displayName = 'Bitte gib einen Anzeigenamen ein.';
  else if (displayName.trim().length > 40) errors.displayName = 'Der Anzeigename darf höchstens 40 Zeichen haben.';
  if (!email.trim()) errors.email = 'Bitte gib deine E-Mail-Adresse ein.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Das sieht nicht wie eine E-Mail-Adresse aus (z. B. name@example.org).';
  if (password.length < PASSWORD_MIN) errors.password = `Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen (bisher ${password.length}).`;
  return errors;
}

/** Server-Fehlercode → Formularfeld. */
export function fieldForError(code) {
  return ({ invalid_email: 'email', email_taken: 'email', weak_password: 'password', invalid_name: 'displayName', bad_credentials: 'password' })[code] ?? null;
}

/**
 * Was der Vorlese-Knopf einer Übung spricht: immer den Text in der Zielsprache – die Frage, wenn sie in der
 * Zielsprache steht, sonst die Musterlösung (dann verrät er sie: reveals = true). Hören/Sprechen und Paare
 * haben eigene Knöpfe → null.
 */
export function speechFor(ex, course) {
  if (!ex || !course || ex.type === 'listen' || ex.type === 'speak' || ex.type === 'match') return null;
  const lang = course.ttsLang || course.targetLang;
  if (ex.questionLang === course.targetLang && ex.question) return { text: ex.question, lang, reveals: false };
  if (ex.answerLang === course.targetLang && ex.solution) return { text: ex.solution, lang, reveals: true };
  return null;
}

/** Spielerstufe aus den Gesamt-XP: Stufe n braucht 40 + 20·n XP mehr als Stufe n − 1. */
export function playerLevel(xp) {
  let level = 1;
  let floor = 0;
  let need = 60;
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  while (total >= floor + need) {
    floor += need;
    level += 1;
    need = 40 + 20 * level;
  }
  return { level, into: total - floor, need };
}

/** Kronen (0–3) für das Ergebnis einer Runde: nach Trefferquote im ersten Versuch; Checkpoint nicht bestanden = 0. */
export function crownsFor(kind, result) {
  if (kind === 'checkpoint' && !result?.passed) return 0;
  const acc = Number(result?.accuracy) || 0;
  return acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
}

/** Regeltext (unit.intro) als HTML: Absätze, Zeilen mit „•“ oder „-“ als Liste. Alles wird escaped. */
export function introHtml(text) {
  const blocks = [];
  let list = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    const bullet = /^[•\-–]\s*/.exec(line);
    if (bullet && line.length > bullet[0].length) {
      list ??= [];
      list.push(`<li>${esc(line.slice(bullet[0].length))}</li>`);
      continue;
    }
    if (list) {
      blocks.push(`<ul class="rule-list">${list.join('')}</ul>`);
      list = null;
    }
    if (line) blocks.push(`<p>${esc(line)}</p>`);
  }
  if (list) blocks.push(`<ul class="rule-list">${list.join('')}</ul>`);
  return blocks.join('');
}

/**
 * Stelle eines Worts in einem Satz als [Start, Länge] oder [-1, 0]. Nur ganze Wörter (nicht „el“ in „botella“),
 * ohne Groß-/Kleinschreibung; Sprachen ohne Leerzeichen (Chinesisch, Japanisch) per Teilstring.
 */
export function findWordIn(sentence, word, lang = '') {
  const text = String(sentence ?? '');
  const w = String(word ?? '').trim();
  if (!w) return [-1, 0];
  if (/^(zh|ja)/.test(lang)) {
    const i = text.indexOf(w);
    return [i, i >= 0 ? w.length : 0];
  }
  const quoted = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])(${quoted})(?=$|[^\\p{L}\\p{N}])`, 'iu').exec(text);
  return m ? [m.index + m[1].length, m[2].length] : [-1, 0];
}

/** Wörter einer Lektion, die noch nie geübt wurden (kein Wiederholungs-Eintrag) – für die Wortkarten. */
export function newWordRefs(state, course, unit, lessonIndex) {
  return lessonItems(unit, lessonIndex).filter((ref) => ref.kind === 'w' && unit.words[ref.index] && !state?.review?.[itemKey(course.id, ref)]);
}

// =====================================================================================================
// Zustand der Oberfläche
// =====================================================================================================

const root = globalThis.document?.getElementById('app') ?? null;
const liveEl = globalThis.document?.getElementById('live') ?? null;

const app = {
  user: null,
  state: null,
  booting: true,
  bootError: null,
  courseFilter: { from: '', to: '' },
  forms: {},
  confirm: null, // offene Inline-Bestätigung (Schlüssel)
  notice: null, // { scope, kind, text } Meldung an einer Stelle der Seite
  pendingImport: null,
  legacy: null,
  legacyDismissed: false,
  busy: false,
  openLevels: new Map(), // courseId → Set der aufgeklappten Abschnitte im Lernpfad
};
const cache = new Map(); // key → { status: 'loading'|'ok'|'error', data, error, promise }
let run = null; // laufende Lektion, Checkpoint oder Wiederholung
let flash = null; // { kind, text, hash }
let pendingFocus = null;
let lastFigure = null; // { courseId, lessonId } – wo die Figur auf dem Brett zuletzt stand (Hüpf-Animation)
let lastHash = null;
let recognizer = null;
let wrongTimer = null;
let admin = null;
let adminLoading = null;
let adminError = null;

const enc = encodeURIComponent;
/** App-Version ohne Server (statischer Build, src/local-api.js): kein Konto, alles auf diesem Gerät. */
const LOCAL = api.MODE === 'local';

const ICONS = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.8l10.2-6.5a1 1 0 0 0 0-1.6L9.5 4.7A1 1 0 0 0 8 5.5z"/>',
  slow: '<path d="M4 6h3v12H4zM10 5.5v13l9-6.5z"/>',
  mic: '<path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V5.5a3.5 3.5 0 0 0-7 0V11a3.5 3.5 0 0 0 3.5 3.5zM18 11a6 6 0 0 1-12 0H4.2a7.8 7.8 0 0 0 6.9 7.7V21h1.8v-2.3a7.8 7.8 0 0 0 6.9-7.7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  lock: '<path d="M7 10V8a5 5 0 0 1 10 0v2h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10zm2.2 0h5.6V8a2.8 2.8 0 0 0-5.6 0z"/>',
  check: '<path d="M9.2 16.6 4.9 12.3l-1.6 1.6 5.9 5.9L21 8l-1.6-1.6z"/>',
  flag: '<path d="M5 3h2v18H5zM8.5 4h10.5l-2.6 4.5L19 13H8.5z"/>',
  close: '<path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/>',
  skip: '<path d="M5 6.5v11l8-5.5zM13 6.5v11l8-5.5z"/>',
  home: '<path d="M12 3.2 2.5 11h2.8v9.3h5.2v-6h3v6h5.2V11h2.8z"/>',
  repeat: '<path d="M17.7 6.3A8 8 0 0 0 4.1 11h2.1a6 6 0 0 1 10-3.3L13.5 10.5H20V4zM6.3 17.7A8 8 0 0 0 19.9 13h-2.1a6 6 0 0 1-10 3.3l2.7-2.8H4V20z"/>',
  chart: '<path d="M4 19h16v2H4zM5 17V10h3v7zm5.5 0V4h3v13zm5.5 0v-5h3v5z"/>',
  sliders: '<path d="M4 6.5h9.3a2.7 2.7 0 0 1 5.2 0H20v2h-1.5a2.7 2.7 0 0 1-5.2 0H4zm0 9h1.5a2.7 2.7 0 0 1 5.2 0H20v2h-9.3a2.7 2.7 0 0 1-5.2 0H4z"/>',
  shield: '<path d="M12 2.5 4 5.6v6c0 5 3.4 8.9 8 9.9 4.6-1 8-4.9 8-9.9v-6z"/>',
  speaker: '<path d="M3.5 9.2h3.6L12 5v14l-4.9-4.2H3.5zM15.3 8.6a4.6 4.6 0 0 1 0 6.8l-1.3-1.4a2.7 2.7 0 0 0 0-4zm2.6-2.8a8.4 8.4 0 0 1 0 12.4l-1.3-1.4a6.5 6.5 0 0 0 0-9.6z"/>',
  crown: '<path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19.3 18H4.7zM4.7 19.5h14.6V21H4.7z"/>',
  chest: '<path d="M4 9.5C4 6.5 6.5 4 9.5 4h5C17.5 4 20 6.5 20 9.5V10H4zM3.5 11.5h17V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19zm7 1.5v3.5h3V13z"/>',
  flame: '<path d="M12.6 2.5c.6 3-1 4.6-2.5 6.1-1.3 1.3-2.6 2.6-2.6 4.9 0 .8.2 1.5.5 2.1-1.7-.8-2.9-2.4-3-4.4-1.2 1.6-1.7 3.2-1.7 4.6 0 3.9 3.8 6.7 8.7 6.7s8.5-2.9 8.5-7.3c0-5.5-4.5-8.4-7.9-12.7zm-.3 18.4c-2 0-3.4-1.3-3.4-3 0-1.9 1.6-2.9 2.6-4.4.6 1.8 3.9 2.6 3.9 5.1 0 1.3-1.3 2.3-3.1 2.3z"/>',
  star: '<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v16H5.5A1.5 1.5 0 0 0 4 20.5zM13 3h5.5A1.5 1.5 0 0 1 20 4.5v16a1.5 1.5 0 0 0-1.5-1.5H13zM5.5 20H11v1H5.5z"/>',
  bulb: '<path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8.9.8 1.5V17h6v-1.2c0-.6.3-1.1.8-1.5A6.5 6.5 0 0 0 12 2.5zM9 18.5h6V20a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 20z"/>',
  pawn: '<path d="M12 2.6a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4zM8.4 11h7.2c0 1.1-.5 2.1-1.4 2.7l1.5 5.6H8.3l1.5-5.6A3.3 3.3 0 0 1 8.4 11zM6.5 20h11v2h-11z"/>',
  chevron: '<path d="M6.4 8.6 12 14.2l5.6-5.6L19 10l-7 7-7-7z"/>',
  ear: '<path d="M12 2.5A6.5 6.5 0 0 0 5.5 9h2a4.5 4.5 0 0 1 9 0c0 2-1.2 3-2.3 4-1 .9-1.9 1.8-2.2 3.2-.3 1.4-1.1 2.3-2.5 2.3a2 2 0 0 1-2-2h-2a4 4 0 0 0 4 4c2.4 0 3.9-1.6 4.4-3.8.2-.8.7-1.3 1.6-2.1 1.3-1.2 3-2.6 3-5.6A6.5 6.5 0 0 0 12 2.5z"/>',
};
const icon = (name, cls = '') => `<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;

// =====================================================================================================
// Daten laden (mit Lade- und Fehlerzustand)
// =====================================================================================================

function need(key, loader) {
  let e = cache.get(key);
  if (!e) {
    e = { status: 'loading', data: null, error: null, promise: null };
    cache.set(key, e);
    e.promise = loader().then(
      (data) => {
        e.status = 'ok';
        e.data = data;
        if (cache.get(key) === e) render();
        return data;
      },
      (error) => {
        e.status = 'error';
        e.error = error;
        if (cache.get(key) === e) {
          if (error?.status === 401 && app.user) sessionLost();
          else render();
        }
        throw error;
      },
    );
    e.promise.catch(() => {});
  }
  return e;
}

function invalidate(...keys) {
  for (const k of keys) cache.delete(k);
}

const coursesEntry = () => need('courses', () => api.getCourses().then((d) => d.courses));
const languagesEntry = () => need('languages', () => api.getLanguages().then((d) => d.languages));
const courseEntry = (id) => need(`course:${id}`, () => api.getCourse(id).then(async (d) => {
  await loadRecordings(d.course.targetLang);
  return d.course;
}));
const statsEntry = () => need('stats', () => api.getStats().then((d) => d.stats));

/** Aufnahme-Verzeichnis der Zielsprache laden (einmal je Sprache; fehlt es, gibt es eben keine Aufnahmen). */
const recordingIndexes = new Map();
function loadRecordings(lang) {
  if (!recordingIndexes.has(lang)) {
    recordingIndexes.set(lang, fetch(`assets/audio/${encodeURIComponent(lang)}/index.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((index) => useRecordings(lang, index)));
  }
  return recordingIndexes.get(lang);
}

/** Kurs laden und auf das Ergebnis warten (für Aktionen). */
async function loadCourse(id) {
  const e = courseEntry(id);
  if (e.status === 'ok') return e.data;
  return e.promise;
}

function languageName(code) {
  const list = cache.get('languages')?.data ?? [];
  return list.find((l) => l.code === code)?.name ?? code;
}

// =====================================================================================================
// Routing, Rendern, Fokus
// =====================================================================================================

const currentHash = () => location.hash || '#/';

export function parseRoute(hash) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter((p, i) => p !== '' || i === 0).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return '';
    }
  });
  return { name: parts[0] || 'home', args: parts.slice(1) };
}

function go(hash) {
  if (currentHash() === hash) render();
  else location.hash = hash;
}

function redirect(hash) {
  location.replace(hash);
  return null;
}

function setTitle(text) {
  document.title = text ? `${text} – Wortweg` : 'Wortweg';
}

function announce(text) {
  if (!liveEl || !text) return;
  liveEl.textContent = '';
  setTimeout(() => {
    liveEl.textContent = text;
  }, 60);
}

function showFlash(kind, text, hash = currentHash()) {
  flash = { kind, text, hash };
  announce(text);
}

function focusSelector(el) {
  if (!el || el === document.body || !root.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.tagName === 'H1') return 'h1';
  const action = el.dataset?.action;
  if (action) {
    let s = `[data-action="${CSS.escape(action)}"]`;
    for (const k of ['id', 'key', 'value', 'side', 'course', 'pk', 'code', 'rate', 'dir']) {
      if (el.dataset[k] != null) s += `[data-${k}="${CSS.escape(el.dataset[k])}"]`;
    }
    return s;
  }
  if (el.name) return `[name="${CSS.escape(el.name)}"]${el.type === 'radio' ? `[value="${CSS.escape(el.value)}"]` : ''}`;
  return null;
}

function render() {
  if (!root) return;
  const route = parseRoute(currentHash());
  if (run && run.hash !== currentHash()) endRun();
  let html;
  try {
    html = view(route);
  } catch (err) {
    html = layout(`<section class="card state-card is-error"><h1 tabindex="-1">Da ist etwas schiefgelaufen</h1>
      <p>${esc(err?.message ?? err)}</p><p><a class="btn" href="#/">Zur Startseite</a></p></section>`, '');
  }
  if (html == null) return; // Weiterleitung
  const prev = focusSelector(document.activeElement);
  root.innerHTML = html;
  document.documentElement.classList.toggle('reduce-motion', Boolean(app.state?.settings?.reduceMotion));
  allowDeviceVoice(app.state?.settings?.deviceVoice === true);
  afterRender(prev);
}

function afterRender(prevFocus) {
  const hash = currentHash();
  const changed = hash !== lastHash;
  lastHash = hash;
  let target = null;
  if (pendingFocus) {
    target = root.querySelector(pendingFocus);
    pendingFocus = null;
  }
  if (!target && changed) {
    window.scrollTo(0, 0);
    target = root.querySelector('[data-autofocus]') ?? root.querySelector('h1');
  }
  if (!target && prevFocus) {
    try {
      target = root.querySelector(prevFocus);
    } catch {
      target = null;
    }
  }
  if (!target && (document.activeElement === document.body || !document.activeElement)) {
    target = root.querySelector('[data-autofocus]') ?? root.querySelector('h1');
  }
  if (target) {
    target.focus({ preventScroll: true });
    const r = target.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) target.scrollIntoView({ block: 'nearest' });
  }
  animateFigureHop();
}

const PUBLIC_ROUTES = new Set(['welcome', 'login', 'register', 'about', 'recordings']);

function view({ name, args }) {
  if (app.booting) {
    setTitle('');
    return `<div class="boot"><img src="assets/logo.svg" alt="" width="64" height="64" class="boot-logo"><p class="loading" role="status">Wortweg wird geladen …</p></div>`;
  }
  if (app.bootError) return viewBootError();
  if (!app.user && !PUBLIC_ROUTES.has(name)) return redirect('#/welcome');
  switch (name) {
    case 'welcome': return app.user ? redirect('#/') : publicLayout(viewWelcome());
    case 'login':
      if (LOCAL) return redirect(app.user ? '#/' : '#/welcome');
      return app.user ? layout(viewLogin(), 'settings') : publicLayout(viewLogin());
    case 'register':
      if (LOCAL) return redirect(app.user ? '#/' : '#/welcome');
      return app.user ? layout(viewRegister(), 'settings') : publicLayout(viewRegister());
    case 'about': return app.user ? layout(viewAbout(), 'about') : publicLayout(viewAbout());
    case 'recordings': return app.user ? layout(viewRecordings(), 'about') : publicLayout(viewRecordings());
    case 'home': return app.state.activeCourseId ? layout(viewHome(), 'home') : redirect('#/courses');
    case 'courses': return layout(viewCourses(), 'courses');
    case 'onboarding': return layout(viewOnboarding(), 'courses');
    case 'learn': return app.state.activeCourseId ? layout(viewLearn(), 'learn') : redirect('#/courses');
    case 'lesson': return viewRunRoute('lesson', args[0]);
    case 'checkpoint': return viewRunRoute('checkpoint', args[0]);
    case 'review': return viewRunRoute('review');
    case 'stats': return layout(viewStats(), 'stats');
    case 'settings': return layout(viewSettings(), 'settings');
    case 'admin': return layout(viewAdmin(args), 'admin');
    default:
      setTitle('Nicht gefunden');
      return layout(`<section class="card state-card"><h1 tabindex="-1">Seite nicht gefunden</h1>
        <p>Diese Adresse gibt es in Wortweg nicht.</p><p><a class="btn btn-primary" href="#/">Zur Startseite</a></p></section>`, '');
  }
}

function loadingView(title = 'Wird geladen …') {
  return `<section class="card state-card" aria-busy="true"><h1 tabindex="-1">${esc(title)}</h1>
    <div class="spinner" aria-hidden="true"></div><p class="muted" role="status">Einen Moment bitte …</p></section>`;
}

function errorView(title, err, keys) {
  const net = err?.status === 0;
  return `<section class="card state-card is-error"><h1 tabindex="-1">${esc(title)}</h1>
    <p>${esc(err?.message ?? 'Unbekannter Fehler.')}</p>
    ${net && !LOCAL ? '<p class="muted small">Läuft der Wortweg-Server (<code>npm start</code>)? Deine bisherigen Daten sind sicher auf dem Server.</p>' : ''}
    <p><button type="button" class="btn btn-primary" data-action="retry-load" data-key="${esc(keys.join(','))}">Erneut versuchen</button></p></section>`;
}

/** Wartet auf Daten; zeigt Lade- bzw. Fehlerzustand. */
function withData(entries, keys, fn, { loading = 'Wird geladen …', error = 'Laden fehlgeschlagen' } = {}) {
  const failed = entries.findIndex((e) => e.status === 'error');
  if (failed >= 0) {
    setTitle(error);
    return errorView(error, entries[failed].error, keys);
  }
  if (entries.some((e) => e.status !== 'ok')) {
    setTitle(loading);
    return loadingView(loading);
  }
  return fn(...entries.map((e) => e.data));
}

function withCourse(id, fn) {
  const e = courseEntry(id);
  if (e.status === 'error' && e.error?.status === 404) {
    setTitle('Kurs nicht verfügbar');
    return `<section class="card state-card"><h1 tabindex="-1">Dieser Kurs ist nicht mehr verfügbar</h1>
      <p>Er wurde vielleicht archiviert oder umbenannt. Dein Fortschritt bleibt gespeichert.</p>
      <p><a class="btn btn-primary" href="#/courses">Anderen Kurs wählen</a></p></section>`;
  }
  return withData([e], [`course:${id}`], fn, { loading: 'Kurs wird geladen …', error: 'Kurs konnte nicht geladen werden' });
}

function viewBootError() {
  setTitle('Server nicht erreichbar');
  const err = app.bootError;
  return `<div class="boot"><img src="assets/logo.svg" alt="" width="64" height="64" class="boot-logo">
    <section class="card state-card is-error"><h1 tabindex="-1">${err?.status === 0 ? 'Server nicht erreichbar' : 'Wortweg konnte nicht starten'}</h1>
    <p>${esc(err?.message ?? 'Unbekannter Fehler.')}</p>
    <p class="muted small">Wortweg braucht den eigenen Server (<code>npm start</code>). Dein Fortschritt liegt dort sicher.</p>
    <p><button type="button" class="btn btn-primary" data-action="retry-boot" data-autofocus>Erneut versuchen</button></p></section></div>`;
}

// =====================================================================================================
// Gerüst
// =====================================================================================================

function flashHtml() {
  if (!flash || flash.hash !== currentHash()) return '';
  return `<div class="flash flash-${esc(flash.kind)}">${esc(flash.text)}</div>`;
}

function brand(href) {
  return `<a href="${href}" class="brand"><img src="assets/logo.svg" alt="" width="36" height="36" class="brand-logo"><span class="brand-name">Wortweg</span></a>`;
}

function footer() {
  return `<footer class="footer"><span>Wortweg · freie Lern-App${LOCAL ? ' · App-Version (offline)' : ''}</span> <a href="#/about">Über, Datenschutz &amp; Lizenzen</a></footer>`;
}

function layout(content, active) {
  const st = app.state;
  const due = st?.activeCourseId ? dueReviewItems(st, st.activeCourseId, Date.now(), 99).length : 0;
  // Symbol + Text: am Handy als Tab-Leiste unten (styles.css), sonst als Zeile oben.
  const link = (hash, key, ico, label, extra = '') =>
    `<a href="${hash}" class="nav-link nav-link-${key}${active === key ? ' is-active' : ''}"${active === key ? ' aria-current="page"' : ''}>${icon(ico)}<span class="nav-label">${label}</span>${extra}</a>`;
  const nav = `<nav aria-label="Hauptnavigation" class="nav nav-main">
      ${link('#/', 'home', 'home', 'Start')}
      ${link('#/learn', 'learn', 'flag', 'Lernpfad')}
      ${link('#/review', 'review', 'repeat', '<span class="label-long">Wiederholen</span><span class="label-short">Üben</span>', due ? ` <span class="badge"><span class="sr-only">, </span>${due}<span class="sr-only"> fällig</span></span>` : '')}
      ${link('#/stats', 'stats', 'chart', 'Statistik')}
      ${link('#/settings', 'settings', 'sliders', 'Optionen')}
      ${app.user?.role === 'admin' ? link('#/admin', 'admin', 'shield', 'Admin') : ''}
    </nav>`;
  return `<a class="skip-link" href="#main" data-action="skip">Zum Inhalt springen</a>
  <header class="topbar"><div class="topbar-inner">${brand('#/')}${nav}</div></header>
  <main id="main" class="page" tabindex="-1">${flashHtml()}${content}</main>
  ${footer()}`;
}

function publicLayout(content) {
  return `<a class="skip-link" href="#main" data-action="skip">Zum Inhalt springen</a>
  <header class="topbar"><div class="topbar-inner">${brand('#/welcome')}
    ${LOCAL ? '' : '<nav aria-label="Konto" class="nav nav-public"><a class="nav-link" href="#/login">Anmelden</a><a class="nav-link" href="#/register">Konto erstellen</a></nav>'}</div></header>
  <main id="main" class="page" tabindex="-1">${flashHtml()}${content}</main>
  ${footer()}`;
}

function meter(value, max, label, cls = '', { decorative = false } = {}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  // In Knöpfen steht der Wert schon als Text daneben – dort nur als Bild, sonst nennt der Screenreader ihn doppelt.
  if (decorative) return `<span class="meter${cls ? ` ${cls}` : ''}" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
  return `<span class="meter${cls ? ` ${cls}` : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.min(value, max)}" aria-valuetext="${Math.min(value, max)} von ${max}"><span style="width:${pct}%"></span></span>`;
}

function noticeHtml(scope) {
  const n = app.notice;
  if (!n || n.scope !== scope) return '';
  return `<p class="notice notice-${esc(n.kind)}" id="notice-${esc(scope)}" tabindex="-1"${n.kind === 'error' ? ' role="alert"' : ''}>${esc(n.text)}</p>`;
}

function setNotice(scope, kind, text, focus = false) {
  app.notice = { scope, kind, text };
  if (kind !== 'error') announce(text);
  if (focus) pendingFocus = `#notice-${CSS.escape(scope)}`;
}

function guestHint() {
  if (!app.user?.isGuest) return '';
  return `<p class="guest-hint">${icon('lock')}<span>Du lernst als Gast. <a href="#/register">Sichere deinen Fortschritt: Konto erstellen</a></span></p>`;
}

function legacyBanner() {
  const lg = app.legacy;
  if (!lg || app.legacyDismissed) return '';
  return `<section class="banner" aria-labelledby="legacy-banner-h">
    <h2 id="legacy-banner-h" class="banner-title">Fortschritt aus der alten Version gefunden</h2>
    <p>In diesem Browser liegt noch ein lokaler Stand von Wortweg 0.1 (${plural(lg.summary.xpTotal, 'XP', 'XP')}, ${plural(lg.summary.lessons, 'Lektion', 'Lektionen')}). Möchtest du ihn in dein ${app.user?.isGuest ? 'Gast-' : ''}Konto übernehmen?</p>
    <div class="row"><a class="btn btn-small btn-field" href="#/settings" data-action="goto-legacy">Ansehen &amp; übernehmen</a>
    <button type="button" class="btn btn-small btn-ghost" data-action="legacy-later">Später</button></div></section>`;
}

// =====================================================================================================
// Einstieg und Konto
// =====================================================================================================

function viewWelcome() {
  setTitle('Willkommen');
  const busy = app.busy;
  return `<section class="welcome" aria-labelledby="welcome-h">
    <div class="welcome-text">
      <h1 id="welcome-h" tabindex="-1">Sprachen lernen, Feld für Feld</h1>
      <p class="lead">Kurze Lektionen, sofortiges Feedback mit Erklärung und Wiederholung nach Plan. Ohne Werbung, ohne Herzen, ohne Strafen.</p>
      <div class="hero-actions">
        <button type="button" class="btn btn-primary btn-lg" data-action="guest" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? 'Wird gestartet …' : LOCAL ? 'Los geht’s' : 'Ohne Konto starten'}</button>
        ${LOCAL ? '' : '<a class="btn btn-lg" href="#/login">Anmelden</a><a class="btn btn-lg" href="#/register">Konto erstellen</a>'}
      </div>
      ${noticeHtml('welcome')}
      <p class="muted small">${LOCAL
    ? 'Ohne Konto, ohne Server: Dein Fortschritt bleibt auf diesem Gerät und die App funktioniert auch offline. Tipp fürs iPhone: In Safari „Teilen → Zum Home-Bildschirm“ – dann startet Wortweg wie eine App.'
    : '„Ohne Konto starten“ legt ein anonymes Gastkonto an; ein Cookie in diesem Browser merkt es sich. Du kannst es jederzeit in ein Konto mit E-Mail umwandeln.'}</p>
    </div>
    ${welcomeBoard()}
  </section>
  <section class="card legend-card" aria-labelledby="legend-h">
    <h2 id="legend-h">So funktioniert das Brett</h2>
    <ul class="legend">
      <li><span class="board-field is-current" aria-hidden="true">${icon('pawn', 'figure')}</span><span><strong>Deine Figur</strong> Sie steht auf der nächsten Lektion und rückt nach jeder Lektion ein Feld weiter.</span></li>
      <li><span class="board-field is-done" aria-hidden="true">${icon('crown')}</span><span><strong>Krone</strong> Lektion geschafft. Du kannst sie jederzeit wiederholen.</span></li>
      <li><span class="board-field is-rule" aria-hidden="true">${icon('bulb')}</span><span><strong>Regel-Feld</strong> Eine kurze Grammatikregel mit Beispielen, bevor es losgeht.</span></li>
      <li><span class="board-field is-checkpoint" aria-hidden="true">${icon('chest')}</span><span><strong>Checkpoint</strong> Am Ende jedes Abschnitts. Wer etwas schon kann, überspringt den Abschnitt per Test.</span></li>
    </ul>
    <p class="muted small">Kein Abo, keine Werbung, kein Tracking. Kurze Demo-Kurse und große Wortschatzkurse aus offenen Quellen – mit Quellenangabe, aber nicht muttersprachlich geprüft.</p>
  </section>`;
}

/** Beispiel-Brett für die Willkommensseite (nur Bild, ohne Links): drei Einheiten aus dem Spanischkurs. */
function welcomeBoard() {
  const row = (title, words, fields, cls) => `<section class="board-unit ${cls}">
      <div class="board-unit-head"><h3>${esc(title)}</h3><p class="board-words" lang="es">${esc(words)}</p></div>
      <ol class="board-row" style="--reach:${fields.lastIndexOf('done') >= 0 || fields.includes('current') ? Math.max(fields.lastIndexOf('done'), fields.indexOf('current')) : -1}">${fields.map((f, i) => `<li><span class="board-field${f === 'done' ? ' is-done' : f === 'current' ? ' is-current' : ' is-locked'}">${f === 'done' ? icon('crown') : f === 'current' ? icon('pawn', 'figure') : i + 1}</span></li>`).join('')}</ol>
    </section>`;
  return `<figure class="welcome-board" aria-hidden="true">
    <div class="board">
      ${row('Zahlen', 'dos, primero, tres, cuánto, segundo, cinco, el número, medio …', ['done', 'done', 'done', 'done'], 'is-first is-reached is-complete')}
      ${row('Farben', 'negro, blanco, rojo, color, azul, verde, amarillo, gris, marrón', ['done', 'current', 'locked'], 'is-rev is-reached')}
      ${row('Wichtige kleine Wörter 2', 'sí, eso, ver, yo, tu, bueno, le, como, aquí, ese …', ['locked', 'locked', 'locked', 'locked'], '')}
    </div>
  </figure>`;
}

function formState(name) {
  app.forms[name] ??= { values: {}, errors: {}, formError: null, busy: false };
  return app.forms[name];
}

function field({ form, name, label, type = 'text', autocomplete = 'off', hint = '', required = true, minlength = 0, maxlength = 0, keepValue = true, lang = '' }) {
  const f = formState(form);
  const id = `${form}-${name}`;
  const err = f.errors[name];
  const describedBy = [hint ? `${id}-hint` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ');
  const value = keepValue ? f.values[name] ?? '' : '';
  return `<div class="field${err ? ' has-error' : ''}">
    <label for="${id}">${esc(label)}</label>
    ${hint ? `<p class="field-hint" id="${id}-hint">${esc(hint)}</p>` : ''}
    <input id="${id}" name="${name}" type="${type}" autocomplete="${autocomplete}"${required ? ' required' : ''}${minlength ? ` minlength="${minlength}"` : ''}${maxlength ? ` maxlength="${maxlength}"` : ''}${lang ? ` lang="${esc(lang)}"` : ''} value="${esc(value)}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}${err ? ' aria-invalid="true"' : ''}>
    ${err ? `<p class="field-error" id="${id}-err">${esc(err)}</p>` : ''}
  </div>`;
}

function formErrorHtml(name) {
  const f = formState(name);
  return f.formError ? `<p class="form-error" role="alert" id="${name}-form-error" tabindex="-1">${esc(f.formError)}</p>` : '';
}

const demoNote = `<p class="note"><strong>Hinweis zu dieser Demo:</strong> Es gibt keine E-Mail-Bestätigung und kein Zurücksetzen des Passworts per E-Mail (Wortweg verschickt keine Mails). Merke dir dein Passwort gut.</p>`;

function guestHasProgress() {
  return summarizeState(app.state).hasProgress;
}

function viewLogin() {
  setTitle('Anmelden');
  const f = formState('login');
  const user = app.user;
  if (user && !user.isGuest) {
    return `<section class="card narrow"><h1 tabindex="-1">Du bist angemeldet</h1>
      <p>Angemeldet als <strong>${esc(user.displayName)}</strong> (${esc(user.email)}).</p>
      <div class="hero-actions"><a class="btn btn-primary" href="#/" data-autofocus>Zur Startseite</a><a class="btn" href="#/settings">Konto &amp; Abmelden</a></div></section>`;
  }
  const guestWarn = user?.isGuest ? `<div class="warn-box" id="login-guest-warn">
      <p><strong>Achtung, du bist gerade als Gast angemeldet.</strong> Meldest du dich mit einem bestehenden Konto an, wird dein Gastkonto <strong>mit seinem Fortschritt gelöscht</strong>. Er wird nicht übertragen.</p>
      <p>Möchtest du ihn behalten? Dann <a href="#/register">wandle den Gast in ein Konto um</a>.</p>
      ${guestHasProgress() ? `<div class="field${f.errors.discardGuest ? ' has-error' : ''}"><label class="check"><input type="checkbox" name="discardGuest" id="login-discardGuest"${f.values.discardGuest ? ' checked' : ''}${f.errors.discardGuest ? ' aria-invalid="true" aria-describedby="login-discardGuest-err"' : ''}> Ich weiß, dass mein Gast-Fortschritt verworfen wird.</label>
      ${f.errors.discardGuest ? `<p class="field-error" id="login-discardGuest-err">${esc(f.errors.discardGuest)}</p>` : ''}</div>` : ''}
    </div>` : '';
  return `<section class="card narrow auth">
    <h1 tabindex="-1">Anmelden</h1>
    ${guestWarn}
    <form data-form="login" novalidate>
      ${formErrorHtml('login')}
      ${field({ form: 'login', name: 'email', label: 'E-Mail-Adresse', type: 'email', autocomplete: 'username', maxlength: 254 })}
      ${field({ form: 'login', name: 'password', label: 'Passwort', type: 'password', autocomplete: 'current-password', keepValue: false, maxlength: 200 })}
      <label class="check small"><input type="checkbox" data-action="show-password"> Passwort anzeigen</label>
      <button type="submit" class="btn btn-primary btn-block"${f.busy ? ' disabled aria-busy="true"' : ''}>${f.busy ? 'Wird angemeldet …' : 'Anmelden'}</button>
    </form>
    <p class="muted small">Noch kein Konto? <a href="#/register">Konto erstellen</a>${user ? '' : ' oder <a href="#/welcome">ohne Konto starten</a>'}.</p>
    <p class="muted small">Passwort vergessen? In dieser Demo gibt es keinen Mailversand und daher kein Zurücksetzen per E-Mail.</p>
  </section>`;
}

function viewRegister() {
  setTitle('Konto erstellen');
  const f = formState('register');
  const user = app.user;
  if (user && !user.isGuest) {
    return `<section class="card narrow"><h1 tabindex="-1">Du hast schon ein Konto</h1>
      <p>Angemeldet als <strong>${esc(user.displayName)}</strong>.</p><p><a class="btn btn-primary" href="#/" data-autofocus>Zur Startseite</a></p></section>`;
  }
  return `<section class="card narrow auth">
    <h1 tabindex="-1">${user?.isGuest ? 'Gast in Konto umwandeln' : 'Konto erstellen'}</h1>
    ${user?.isGuest ? '<p class="ok-box">Dein bisheriger Gast-Fortschritt wird übernommen – nichts geht verloren.</p>' : '<p>Mit einem Konto meldest du dich auf anderen Geräten an und behältst deinen Fortschritt.</p>'}
    <form data-form="register" novalidate>
      ${formErrorHtml('register')}
      ${field({ form: 'register', name: 'displayName', label: 'Anzeigename', autocomplete: 'nickname', hint: 'So begrüßt dich Wortweg. 1–40 Zeichen.', maxlength: 40 })}
      ${field({ form: 'register', name: 'email', label: 'E-Mail-Adresse', type: 'email', autocomplete: 'email', hint: 'Dient nur zum Anmelden. Wir schicken keine Mails.', maxlength: 254 })}
      ${field({ form: 'register', name: 'password', label: 'Passwort', type: 'password', autocomplete: 'new-password', hint: `Mindestens ${PASSWORD_MIN} Zeichen. Ein Satz aus mehreren Wörtern ist leicht zu merken und sicher.`, minlength: PASSWORD_MIN, keepValue: false, maxlength: 200 })}
      <label class="check small"><input type="checkbox" data-action="show-password"> Passwort anzeigen</label>
      <button type="submit" class="btn btn-primary btn-block"${f.busy ? ' disabled aria-busy="true"' : ''}>${f.busy ? 'Wird erstellt …' : user?.isGuest ? 'Konto erstellen und Fortschritt behalten' : 'Konto erstellen'}</button>
    </form>
    ${demoNote}
    <p class="muted small">Schon ein Konto? <a href="#/login">Anmelden</a>.</p>
  </section>`;
}

async function afterAuth(user, message) {
  app.user = user;
  admin = null;
  adminLoading = null;
  adminError = null;
  run = null;
  invalidate('stats');
  const { state } = await api.getProgress();
  app.state = state;
  app.forms = {};
  languagesEntry();
  const target = state.activeCourseId ? '#/' : '#/courses';
  showFlash('ok', message, target);
  go(target);
}

function resetSession() {
  stopAll();
  app.user = null;
  app.state = null;
  app.forms = {};
  app.confirm = null;
  app.notice = null;
  app.pendingImport = null;
  run = null;
  admin = null;
  adminLoading = null;
  adminError = null;
  invalidate('stats');
}

function sessionLost() {
  resetSession();
  showFlash('warn', 'Deine Sitzung ist abgelaufen oder wurde beendet. Bitte melde dich erneut an oder starte als Gast.', '#/welcome');
  go('#/welcome');
}

/** Behandelt 401 zentral. true = erledigt. */
function handledAuthError(err) {
  if (err?.status === 401 && app.user) {
    sessionLost();
    return true;
  }
  return false;
}

async function startAsGuest() {
  if (app.busy) return;
  app.busy = true;
  app.notice = null;
  render();
  try {
    const { user } = await api.startGuest();
    app.busy = false;
    await afterAuth(user, 'Los geht’s! Du lernst als Gast. Wähle zuerst einen Kurs.');
  } catch (err) {
    app.busy = false;
    setNotice('welcome', 'error', err.message, true);
    render();
  }
}

function formValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) out[k] = typeof v === 'string' ? v : '';
  return out;
}

function focusFirstError(name) {
  pendingFocus = `[data-form="${name}"] [aria-invalid="true"], #${name}-form-error, #login-discardGuest[aria-invalid="true"]`;
}

async function submitLogin(form) {
  const v = formValues(form);
  const discard = root.querySelector('#login-discardGuest');
  const f = formState('login');
  f.values = { email: v.email ?? '', discardGuest: Boolean(discard?.checked) };
  f.errors = {};
  f.formError = null;
  if (!f.values.email.trim()) f.errors.email = 'Bitte gib deine E-Mail-Adresse ein.';
  if (!v.password) f.errors.password = 'Bitte gib dein Passwort ein.';
  if (discard && !discard.checked) f.errors.discardGuest = 'Bitte bestätige das – oder erstelle stattdessen ein Konto, um den Fortschritt zu behalten.';
  if (Object.keys(f.errors).length) {
    render();
    pendingFocus = null;
    root.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  f.busy = true;
  render();
  try {
    const { user } = await api.login({ email: f.values.email.trim(), password: v.password });
    f.busy = false;
    await afterAuth(user, `Willkommen zurück, ${user.displayName}!`);
  } catch (err) {
    f.busy = false;
    if (err.code === 'bad_credentials') f.formError = err.message;
    else f.formError = err.message;
    pendingFocus = '#login-form-error';
    render();
  }
}

async function submitRegister(form) {
  const v = formValues(form);
  const f = formState('register');
  f.values = { email: v.email ?? '', displayName: v.displayName ?? '' };
  f.formError = null;
  f.errors = validateRegistration({ email: v.email ?? '', password: v.password ?? '', displayName: v.displayName ?? '' });
  if (Object.keys(f.errors).length) {
    render();
    root.querySelector('[data-form="register"] [aria-invalid="true"]')?.focus();
    return;
  }
  f.busy = true;
  render();
  const wasGuest = app.user?.isGuest;
  try {
    const { user } = await api.register({ email: v.email.trim(), password: v.password, displayName: v.displayName.trim() });
    f.busy = false;
    await afterAuth(user, wasGuest ? 'Konto erstellt – dein Gast-Fortschritt ist jetzt gesichert.' : `Willkommen, ${user.displayName}! Dein Konto ist bereit.`);
  } catch (err) {
    f.busy = false;
    const fieldName = fieldForError(err.code);
    if (fieldName) f.errors[fieldName] = err.message;
    else f.formError = err.message;
    render();
    (root.querySelector('[data-form="register"] [aria-invalid="true"]') ?? root.querySelector('#register-form-error'))?.focus();
  }
}

// =====================================================================================================
// Start
// =====================================================================================================

function stepLink(step, course, { started = true, autofocus = true, big = true, block = false } = {}) {
  const af = autofocus ? ' data-autofocus' : '';
  const cls = `btn btn-primary${big ? ' btn-lg' : ''}${block ? ' btn-block' : ''}`;
  if (step?.kind === 'lesson') {
    return `<a class="${cls}"${af} href="#/lesson/${enc(step.lesson.id)}">${started ? 'Weiterlernen' : 'Erste Lektion starten'}<span class="btn-sub">${esc(step.lesson.unit.title)} · Lektion&nbsp;${step.lesson.index + 1}</span></a>`;
  }
  if (step?.kind === 'checkpoint') {
    return `<a class="${cls}"${af} href="#/checkpoint/${enc(step.level.id)}">Checkpoint machen<span class="btn-sub">${esc(step.level.title)}</span></a>`;
  }
  const allPassed = course.levels.every((l) => isCheckpointPassed(app.state, course.id, l.id));
  return allPassed
    ? '<p class="done-note"><strong>Kurs geschafft!</strong> Alle Checkpoints sind bestanden. Wiederhole, um das Gelernte zu festigen.</p>'
    : `<a class="${cls}"${af} href="#/learn">Zum Lernpfad</a>`;
}

/** Die eine Hauptaktion: eine angefangene Lektion fortsetzen, sonst der nächste Schritt (DESIGN.md §8.1, §8.5). */
function primaryAction(course, step, opts = {}) {
  const r = resumeInfo(course);
  if (r && /^#\/(lesson|checkpoint)\/[^/]+$/.test(r.hash)) {
    const cls = `btn btn-primary${opts.big === false ? '' : ' btn-lg'}${opts.block ? ' btn-block' : ''}`;
    return `<a class="${cls}"${opts.autofocus === false ? '' : ' data-autofocus'} href="${esc(r.hash)}">Weitermachen<span class="btn-sub">${esc(r.title)} · Übung&nbsp;${r.pos} von&nbsp;${r.total}</span></a>`;
  }
  return stepLink(step, course, opts);
}

const fmtNum = (n) => Number(n).toLocaleString('de-DE');

// =====================================================================================================
// Spielbrett (DESIGN.md §8.5): eine Reihe je Einheit, Schlangenweg, Figur auf dem nächsten Feld
// =====================================================================================================

/** Felder einer Einheit mit Zustand: geschafft, übersprungen, aktuell, offen oder gesperrt. */
function boardUnitHtml(course, unit, ui, { step, levelPassed, first, focusCurrent }) {
  const st = app.state;
  const lessons = listLessons(course).filter((l) => l.unitId === unit.id);
  const fields = [];
  if (unit.intro) {
    fields.push({ html: `<button type="button" class="board-field is-rule" data-action="open-rule" data-unit="${esc(unit.id)}" aria-haspopup="dialog" aria-label="Regel: ${esc(unit.title)}">${icon('bulb')}</button>`, reached: false });
  }
  let reachedAny = false;
  let complete = lessons.length > 0;
  for (const l of lessons) {
    const done = isLessonCompleted(st, course.id, l.id);
    const skipped = !done && levelPassed;
    const current = step?.kind === 'lesson' && step.lesson.id === l.id;
    const unlocked = isLessonUnlocked(st, course, l.id);
    const status = done ? 'geschafft' : skipped ? 'übersprungen (Checkpoint bestanden)' : current ? 'als Nächstes' : unlocked ? 'offen' : `gesperrt. ${lockReason(course, l.id)}`;
    const label = `${unit.title}, Lektion ${l.index + 1}: ${status}`;
    const href = `#/lesson/${enc(l.id)}`;
    const data = `data-lesson="${esc(l.id)}" aria-label="${esc(label)}"`;
    let html;
    if (current) html = `<a class="board-field is-current" href="${href}" ${data} aria-current="step"${focusCurrent ? ' data-autofocus' : ''}>${icon('pawn', 'figure')}</a>`;
    else if (done || skipped) html = `<a class="board-field is-done" href="${href}" ${data}>${icon(done ? 'crown' : 'skip')}</a>`;
    else if (unlocked) html = `<a class="board-field" href="${href}" ${data}>${l.index + 1}</a>`;
    else html = `<span class="board-field is-locked" role="img" ${data}>${l.index + 1}</span>`;
    const reached = done || skipped || current;
    reachedAny ||= reached;
    if (!(done || skipped)) complete = false;
    fields.push({ html, reached });
  }
  if (reachedAny && fields[0] && unit.intro) fields[0].reached = true;
  const reach = fields.reduce((r, f, i) => (f.reached ? i : r), -1);
  const cls = ['board-unit', ui % 2 ? 'is-rev' : '', reachedAny ? 'is-reached' : '', complete ? 'is-complete' : '', first ? 'is-first' : ''].filter(Boolean).join(' ');
  return `<section class="${cls}" aria-labelledby="bu-${esc(unit.id)}">
    <div class="board-unit-head"><h3 id="bu-${esc(unit.id)}">${esc(unit.title)}</h3>${unit.description ? `<p class="board-words"${course.generated ? ` lang="${esc(course.targetLang)}"` : ''}>${esc(unit.description)}</p>` : ''}</div>
    <ol class="board-row" style="--reach:${reach}">${fields.map((f) => `<li>${f.html}</li>`).join('')}</ol>
  </section>`;
}

/** Checkpoint-Feld am Ende eines Abschnitts. */
function boardCheckpointHtml(course, level, rev, step, focusCurrent = false) {
  const st = app.state;
  const passed = isCheckpointPassed(st, course.id, level.id);
  const unlocked = isCheckpointUnlocked(st, course, level.id);
  const isNext = step?.kind === 'checkpoint' && step.level.id === level.id;
  const href = `#/checkpoint/${enc(level.id)}`;
  const data = `data-lesson="checkpoint:${esc(level.id)}"`;
  let field;
  if (isNext) field = `<a class="board-field is-checkpoint is-current" href="${href}" ${data} aria-current="step"${focusCurrent ? ' data-autofocus' : ''} aria-label="Checkpoint ${esc(level.title)}: als Nächstes">${icon('pawn', 'figure')}${icon('chest')}</a>`;
  else if (passed) field = `<a class="board-field is-checkpoint is-done" href="${href}" ${data} aria-label="Checkpoint ${esc(level.title)}: bestanden">${icon('crown')}</a>`;
  else if (unlocked) field = `<a class="board-field is-checkpoint" href="${href}" ${data} aria-label="Checkpoint ${esc(level.title)}: offen, Abschnitt per Test überspringen">${icon('chest')}</a>`;
  else {
    const li = course.levels.findIndex((l) => l.id === level.id);
    const why = li > 0 ? ` Bestehe zuerst den Checkpoint „${course.levels[li - 1].title}“.` : '';
    field = `<span class="board-field is-checkpoint is-locked" role="img" ${data} aria-label="${esc(`Checkpoint ${level.title}: gesperrt.${why}`)}">${icon('lock')}</span>`;
  }
  const cls = ['board-unit', 'is-last', rev ? 'is-rev' : '', isNext || passed ? 'is-reached' : '', passed ? 'is-complete' : ''].filter(Boolean).join(' ');
  return `<section class="${cls}" aria-labelledby="bu-cp-${esc(level.id)}">
    <div class="board-unit-head"><h3 id="bu-cp-${esc(level.id)}">Checkpoint</h3><p class="board-words">${passed ? 'Bestanden – der Abschnitt zählt als geschafft' : 'Truhe am Ende des Abschnitts'}</p></div>
    <ol class="board-row" style="--reach:0"><li>${field}</li></ol>
  </section>`;
}

/** Brett eines Abschnitts; mit range nur ein Ausschnitt (Startseite: vorige, aktuelle, nächste Einheit). */
function levelBoardHtml(course, level, step, { range = null, hint = false, focusCurrent = false } = {}) {
  const levelPassed = isCheckpointPassed(app.state, course.id, level.id);
  const from = range ? range[0] : 0;
  const to = range ? range[1] : level.units.length - 1;
  const parts = [];
  for (let ui = from; ui <= to; ui++) parts.push(boardUnitHtml(course, level.units[ui], ui, { step, levelPassed, first: ui === 0, focusCurrent }));
  if (to === level.units.length - 1) parts.push(boardCheckpointHtml(course, level, level.units.length % 2 === 1, step, focusCurrent));
  const links = hint ? '<p class="board-hint"><a href="#/learn">Ganzes Brett ansehen</a><a href="#/courses">Kurs wechseln</a></p>' : '';
  return `<div class="board">${parts.join('')}${links}</div>`;
}

/** Signatur-Bewegung: Nach einer Lektion hüpft die Figur vom alten aufs neue Feld (Web Animations API). */
let hopObserver = null;
function animateFigureHop() {
  hopObserver?.disconnect();
  hopObserver = null;
  const fig = root.querySelector('.board .is-current .figure');
  const courseId = app.state?.activeCourseId;
  if (!fig || !courseId) return;
  const lessonId = fig.closest('[data-lesson]')?.dataset.lesson ?? null;
  const prev = lastFigure;
  lastFigure = { courseId, lessonId };
  if (!prev || prev.courseId !== courseId || prev.lessonId === lessonId || !motionOk() || !fig.animate) return;
  const from = root.querySelector(`.board [data-lesson="${CSS.escape(prev.lessonId)}"]`);
  if (!from) return;
  const play = () => {
    if (!fig.isConnected || !from.isConnected) return;
    const cs = getComputedStyle(document.documentElement);
    const duration = parseFloat(cs.getPropertyValue('--dur-3')) || 480;
    const easing = cs.getPropertyValue('--ease-hop').trim() || 'ease-out';
    const a = from.getBoundingClientRect();
    const b = fig.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    fig.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx / 2}px, ${dy / 2 - 28}px) scale(1.1)`, offset: 0.5 },
      { transform: 'none' },
    ], { duration, easing });
  };
  // Erst hüpfen, wenn das Brett zu sehen ist – sonst verpasst man die Bewegung.
  if (!globalThis.IntersectionObserver) return play();
  hopObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      hopObserver?.disconnect();
      hopObserver = null;
      play();
    }
  }, { threshold: 0.5 });
  hopObserver.observe(fig.closest('.board-unit') ?? fig);
}

// =====================================================================================================
// Start
// =====================================================================================================

function viewHome() {
  return withCourse(app.state.activeCourseId, (course) => {
    setTitle('Start');
    const st = app.state;
    const now = Date.now();
    const streak = displayStreak(st, now);
    const today = xpToday(st, now);
    const goal = st.dailyGoal;
    const prog = courseProgress(st, course);
    const step = nextStep(st, course);
    const due = dueReviewItems(st, course.id, now, 99).length;
    const started = prog.done > 0 || Object.keys(st.courses[course.id]?.completed ?? {}).length > 0;
    const lvl = playerLevel(st.xpTotal);
    const words = Object.keys(st.review ?? {}).filter((k) => k.startsWith(`${course.id}|w|`)).length;
    const reached = dailyGoalReached(st, now);
    const goalPct = goal > 0 ? Math.min(100, Math.round((today / goal) * 100)) : 0;
    const goalHint = goal > 0 ? (reached ? 'Tagesziel geschafft!' : `Noch ${goal - today} XP bis zum Tagesziel.`) : 'Kein Tagesziel gesetzt.';
    return `${legacyBanner()}${guestHint()}
    <div class="home-grid">
      <div class="home-main">
        <section class="home-hero" aria-labelledby="home-h">
          <h1 id="home-h" tabindex="-1">Hallo ${esc(app.user.displayName)}!</h1>
          <p class="home-sub">${esc(course.title)}${course.levels.length > 1 ? ` · ${esc(stageLabel(course, step))}` : ''}</p>
          ${primaryAction(course, step, { started, block: true })}
        </section>
        ${stageHtml(course, step, prog)}
      </div>
      <div class="home-side">
        <section class="home-values" aria-labelledby="values-h">
          <h2 id="values-h" class="sr-only">Deine Werte</h2>
          <ul class="tokens">
            <li class="token"><span class="stone stone-flame">${icon('flame')}${streak}</span>${streak === 1 ? 'Tag' : 'Tage'} Serie</li>
            <li class="token"><span class="stone stone-ring${reached ? ' is-open' : ''}" style="--p:${goalPct}">${reached ? icon('chest') : ''}<span>${today}</span></span>${goal > 0 ? `von ${goal} XP heute` : 'XP heute'}</li>
            <li class="token"><span class="stone stone-star">${icon('star')}${lvl.level}</span>Stufe <small>(noch ${lvl.need - lvl.into} XP)</small></li>
            <li class="token"><span class="stone stone-book">${icon('book')}<span${words > 999 ? ' class="stone-long"' : ''}>${fmtNum(words)}</span></span>${words === 1 ? 'Wort' : 'Wörter'}</li>
          </ul>
          <p class="small muted">${goalHint} Bester Serienwert: ${plural(st.streak.best, 'Tag', 'Tage')}. Pausen kosten nichts.</p>
          ${due ? `<a class="btn btn-field btn-block" href="#/review">${icon('repeat')} ${plural(due, 'Wiederholung', 'Wiederholungen')} fällig</a>` : ''}
        </section>
        ${step?.kind === 'lesson' ? nextLessonCard(course, step.lesson) : ''}
      </div>
    </div>
    ${sectionsOverview(course, step)}`;
  });
}

/** Abschnitt des nächsten Schritts (oder der letzte, wenn alles geschafft ist). */
function stageLevel(course, step) {
  const id = step?.kind === 'lesson' ? step.lesson.levelId : step?.kind === 'checkpoint' ? step.level.id : course.levels.at(-1)?.id;
  const li = Math.max(0, course.levels.findIndex((l) => l.id === id));
  return { level: course.levels[li], li };
}

function stageLabel(course, step) {
  const { li } = stageLevel(course, step);
  return `Abschnitt\u00a0${li + 1} von\u00a0${course.levels.length}`;
}

/** Abschnitts-Kopf mit Fortschritt und Brett-Ausschnitt um die Figur (DESIGN.md §7, §8.5). */
function stageHtml(course, step, prog) {
  const { level } = stageLevel(course, step);
  if (!level) return '';
  const st = app.state;
  const passed = isCheckpointPassed(st, course.id, level.id);
  const lessons = listLessons(course).filter((l) => l.levelId === level.id);
  const done = passed ? lessons.length : lessons.filter((l) => isLessonCompleted(st, course.id, l.id)).length;
  const cu = step?.kind === 'lesson' ? level.units.findIndex((u) => u.id === step.lesson.unitId) : level.units.length - 1;
  const range = [Math.max(0, cu - 1), Math.min(level.units.length - 1, cu + 1)];
  return `<section class="board-card" aria-labelledby="stage-h">
    <div class="stage-head">
      <h2 id="stage-h">${esc(level.title)}</h2>
      <p class="stage-meta"><span>${done} von ${plural(lessons.length, 'Lektion', 'Lektionen')}</span><span>Kurs: ${fmtNum(prog.done)} von ${fmtNum(prog.total)}</span></p>
      ${meter(done, lessons.length, `Fortschritt ${level.title}`)}
    </div>
    ${levelBoardHtml(course, level, step, { range, hint: true })}
  </section>`;
}

/** Vorschau „Als Nächstes“: Wörter der nächsten Lektion zum Anhören, Regel der Einheit. */
function nextLessonCard(course, lesson) {
  const unit = lesson.unit;
  const refs = lessonItems(unit, lesson.index).filter((r) => r.kind === 'w');
  const chips = refs.map((r) => {
    const w = unit.words[r.index];
    return `<li class="word-chip"><span class="word-chip-text"><span class="word-chip-target" lang="${esc(course.targetLang)}">${esc(w.target[0])}</span>${readingHtml(w.reading)}<span class="word-chip-native" lang="${esc(course.nativeLang)}">${esc(w.native[0])}</span></span>${sayBtn(w.target[0], `„${w.target[0]}“ vorlesen`)}</li>`;
  }).join('');
  return `<section class="card next-card" aria-labelledby="next-h">
    <h2 id="next-h">Als Nächstes</h2>
    <p class="next-meta">${esc(unit.title)} · Lektion&nbsp;${lesson.index + 1}</p>
    ${chips ? `<ul class="word-chips" aria-label="Wörter dieser Lektion">${chips}</ul>` : ''}
    ${unit.intro ? `<button type="button" class="btn" data-action="open-rule" data-unit="${esc(unit.id)}" aria-haspopup="dialog">${icon('bulb')} Regel ansehen</button>` : ''}
  </section>`;
}

/** Alle Abschnitte mit Fortschritt (aufklappbar); ein Klick öffnet den Abschnitt im Lernpfad. */
function sectionsOverview(course, step) {
  if (course.levels.length < 2) return '';
  const st = app.state;
  const all = listLessons(course);
  const current = step?.kind === 'lesson' ? step.lesson.levelId : step?.kind === 'checkpoint' ? step.level.id : null;
  const rows = course.levels.map((level, li) => {
    const passed = isCheckpointPassed(st, course.id, level.id);
    const lessons = all.filter((l) => l.levelId === level.id);
    const done = passed ? lessons.length : lessons.filter((l) => isLessonCompleted(st, course.id, l.id)).length;
    return `<li class="section-row${passed ? ' is-passed' : ''}${level.id === current ? ' is-current' : ''}">
      <button type="button" class="section-btn" data-action="goto-level" data-level="${esc(level.id)}">
        <span class="section-num" aria-hidden="true">${passed ? icon('crown') : li + 1}</span>
        <span class="section-main"><span class="section-title">${esc(level.title)}</span>${meter(done, lessons.length, '', '', { decorative: true })}</span>
        <span class="section-count">${done}/${lessons.length}<span class="sr-only"> Lektionen</span></span>
      </button></li>`;
  }).join('');
  return `<details class="card sections-card">
    <summary>Alle ${course.levels.length} Abschnitte ${icon('chevron')}</summary>
    <ol class="section-list">${rows}</ol>
  </details>`;
}

// =====================================================================================================
// Kurswahl und Onboarding
// =====================================================================================================

function onboardingSteps(active) {
  const steps = ['Kurs wählen', 'Tagesziel', 'Erste Lektion'];
  return `<ol class="steps" aria-label="Erste Schritte">${steps.map((s, i) => `<li class="${i === active ? 'is-active' : i < active ? 'is-done' : ''}"${i === active ? ' aria-current="step"' : ''}><span class="step-num" aria-hidden="true">${i + 1}</span> ${s}</li>`).join('')}</ol>`;
}

function courseCard(c, active) {
  const st = app.state;
  const full = cache.get(`course:${c.id}`);
  let done;
  if (full?.status === 'ok') done = courseProgress(st, full.data).done;
  else done = Math.min(c.stats.lessons, Object.keys(st.courses[c.id]?.completed ?? {}).length);
  const s = c.stats;
  const headingId = `course-${esc(c.id)}`;
  return `<li class="course-card${active ? ' is-active' : ''}">
    <p class="course-langs"><span>${esc(languageName(c.nativeLang))}</span> <span aria-hidden="true">→</span><span class="sr-only">nach</span> <span>${esc(languageName(c.targetLang))}</span></p>
    <h2 class="course-title" id="${headingId}">${esc(c.title)}</h2>
    ${c.subtitle ? `<p class="course-sub">${esc(c.subtitle)}</p>` : ''}
    <p class="course-meta">${plural(s.levels, 'Abschnitt', 'Abschnitte')} · ${plural(s.units, 'Einheit', 'Einheiten')} · ${plural(s.lessons, 'Lektion', 'Lektionen')} · ${plural(s.words, 'Wort', 'Wörter')} · ${plural(s.sentences, 'Satz', 'Sätze')}</p>
    <p class="course-tags">${c.demo ? '<span class="tag tag-demo">Demo-Inhalt</span>' : ''}${c.generated ? '<span class="tag tag-open">Aus offenen Quellen</span>' : ''}${c.license ? `<span class="tag">Lizenz: ${esc(c.license)}</span>` : ''}</p>
    ${meter(done, s.lessons, `Fortschritt ${c.title}`)}
    <p class="course-meta">${done} von ${s.lessons} Lektionen erledigt</p>
    ${active
      ? '<p class="course-active"><span class="tag tag-active">Aktiver Kurs</span> <a class="btn btn-primary btn-small" href="#/">Weiterlernen</a></p>'
      : `<button type="button" class="btn btn-small" data-action="select-course" data-course="${esc(c.id)}"${app.busy ? ' disabled' : ''}>${done ? 'Zu diesem Kurs wechseln' : 'Diesen Kurs lernen'}<span class="sr-only">: ${esc(c.title)}</span></button>`}
  </li>`;
}

function viewCourses() {
  const onboarding = !app.state.activeCourseId;
  return withData([coursesEntry(), languagesEntry()], ['courses', 'languages'], (courses) => {
    setTitle('Kurs wählen');
    const filter = app.courseFilter;
    const list = filterCourses(courses, filter);
    const opts = (side, selected) => courseLanguages(courses, side, languageName)
      .map((code) => `<option value="${esc(code)}"${selected === code ? ' selected' : ''}>${esc(languageName(code))}</option>`).join('');
    let body;
    if (!courses.length) {
      body = '<div class="empty"><p><strong>Noch keine Kurse veröffentlicht.</strong></p><p class="muted">Sobald ein Admin einen Kurs veröffentlicht, erscheint er hier.</p></div>';
    } else if (!list.length) {
      body = '<div class="empty"><p><strong>Kein Kurs passt zu diesem Filter.</strong></p><p><button type="button" class="btn" data-action="reset-filter">Filter zurücksetzen</button></p></div>';
    } else {
      body = `<ul class="course-list">${list.map((c) => courseCard(c, c.id === app.state.activeCourseId)).join('')}</ul>`;
    }
    return `${onboarding ? onboardingSteps(0) : ''}
      <h1 tabindex="-1">${onboarding ? 'Welche Sprache möchtest du lernen?' : 'Kurse'}</h1>
      <p class="muted">Neben kurzen, selbst geschriebenen <strong>Demo-Kursen</strong> gibt es große Wortschatzkurse, die aus <strong>offenen Quellen</strong> (Wörterbücher, Satzsammlungen) zusammengestellt sind. Keiner ist muttersprachlich geprüft, und Wortweg bietet nicht „alle Sprachen“. Weitere Kurse können Admins anlegen.</p>
      ${noticeHtml('courses')}
      <form class="filters" data-form="course-filter" aria-label="Kurse filtern">
        <div class="field"><label for="filter-from">Ich spreche</label>
          <select id="filter-from" name="from" data-action="filter"><option value="">Alle Sprachen</option>${opts('nativeLang', filter.from)}</select></div>
        <div class="field"><label for="filter-to">Ich lerne</label>
          <select id="filter-to" name="to" data-action="filter"><option value="">Alle Sprachen</option>${opts('targetLang', filter.to)}</select></div>
        <p class="filter-count" id="course-count">${plural(list.length, 'Kurs', 'Kurse')} von ${courses.length}</p>
      </form>
      ${body}`;
  }, { loading: 'Kurse werden geladen …', error: 'Kurse konnten nicht geladen werden' });
}

async function selectCourse(id) {
  if (app.busy) return;
  const onboarding = !app.state.activeCourseId;
  app.busy = true;
  render();
  try {
    const { state } = await api.saveSettings({ activeCourseId: id });
    app.state = state;
    app.busy = false;
    const title = cache.get('courses')?.data?.find((c) => c.id === id)?.title ?? id;
    if (onboarding) {
      go('#/onboarding');
    } else {
      showFlash('ok', `Aktiver Kurs: ${title}.`, '#/');
      go('#/');
    }
  } catch (err) {
    app.busy = false;
    if (handledAuthError(err)) return;
    setNotice('courses', 'error', err.message, true);
    render();
  }
}

function goalRadios(name, selected) {
  return DAILY_GOALS.map((g) => `<label class="radio"><input type="radio" name="${name}" value="${g}"${selected === g ? ' checked' : ''}${name === 'goal' ? ' data-action="goal"' : ''}> ${g === 0 ? 'Kein Ziel' : `${g} XP`}<span class="radio-hint">${g === 0 ? '' : g <= 10 ? 'locker' : g <= 20 ? 'normal' : g <= 30 ? 'fleißig' : 'intensiv'}</span></label>`).join('');
}

function viewOnboarding() {
  setTitle('Tagesziel wählen');
  if (!app.state.activeCourseId) return redirect('#/courses');
  const f = formState('onboarding');
  return `${onboardingSteps(1)}
    <section class="card narrow">
      <h1 tabindex="-1">Wie viel möchtest du am Tag üben?</h1>
      <p class="muted">Eine Lektion bringt etwa 10–20 XP. Das Ziel ist freiwillig – wer einen Tag auslässt, verliert nichts außer der Serienzählung.</p>
      <form data-form="onboarding" novalidate>
        ${formErrorHtml('onboarding')}
        <fieldset class="radios"><legend class="sr-only">Tagesziel</legend>${goalRadios('onboardingGoal', app.state.dailyGoal)}</fieldset>
        <div class="hero-actions">
          <button type="submit" class="btn btn-primary"${f.busy ? ' disabled aria-busy="true"' : ''}>${f.busy ? 'Wird gespeichert …' : 'Weiter zur ersten Lektion'}</button>
          <button type="button" class="btn btn-ghost" data-action="onboarding-skip">Überspringen</button>
        </div>
      </form>
    </section>`;
}

async function goToFirstStep() {
  try {
    const course = await loadCourse(app.state.activeCourseId);
    const step = nextStep(app.state, course);
    if (step?.kind === 'lesson') go(`#/lesson/${enc(step.lesson.id)}`);
    else if (step?.kind === 'checkpoint') go(`#/checkpoint/${enc(step.level.id)}`);
    else go('#/learn');
  } catch (err) {
    if (handledAuthError(err)) return;
    go('#/');
  }
}

async function submitOnboarding(form) {
  const f = formState('onboarding');
  const goal = Number(formValues(form).onboardingGoal ?? app.state.dailyGoal);
  f.busy = true;
  f.formError = null;
  render();
  try {
    const { state } = await api.saveSettings({ dailyGoal: goal });
    app.state = state;
    f.busy = false;
    await goToFirstStep();
  } catch (err) {
    f.busy = false;
    if (handledAuthError(err)) return;
    f.formError = err.message;
    pendingFocus = '#onboarding-form-error';
    render();
  }
}

// =====================================================================================================
// Lernpfad
// =====================================================================================================

function checkpointCard(course, level, li, step) {
  const st = app.state;
  const cp = st.courses[course.id]?.checkpoints?.[level.id];
  const passed = isCheckpointPassed(st, course.id, level.id);
  const unlocked = isCheckpointUnlocked(st, course, level.id);
  const isNext = step?.kind === 'checkpoint' && step.level.id === level.id;
  const href = `#/checkpoint/${enc(level.id)}`;
  const stats = cp ? `<p class="small muted">${plural(cp.attempts, 'Versuch', 'Versuche')} · beste Quote ${Math.round(cp.bestScore * 100)} %</p>` : '';
  let text;
  let action;
  if (passed) {
    text = 'Bestanden! Alle Lektionen dieses Abschnitts zählen als erledigt.';
    action = `<a class="btn btn-small" href="${href}">Checkpoint wiederholen</a>`;
  } else if (!unlocked) {
    text = li > 0 ? `Gesperrt: Bestehe zuerst den Checkpoint „${esc(course.levels[li - 1].title)}“.` : 'Gesperrt.';
    action = '';
  } else if (isNext) {
    text = `Alle Lektionen geschafft – zeig im Checkpoint, was du kannst. Bestanden ab ${Math.round(CHECKPOINT_PASS * 100)} % im ersten Versuch.`;
    action = `<a class="btn btn-field btn-small" href="${href}" data-autofocus>Checkpoint starten</a>`;
  } else {
    text = `Kannst du das schon? Bestehe den Checkpoint (mindestens ${Math.round(CHECKPOINT_PASS * 100)} % im ersten Versuch richtig), dann gelten alle Lektionen dieses Abschnitts als erledigt und der nächste Abschnitt öffnet sich. Du kannst es beliebig oft versuchen – ohne Nachteile.`;
    action = `<a class="btn btn-small" href="${href}">${icon('skip')} Abschnitt überspringen</a>`;
  }
  return `<div class="checkpoint${passed ? ' is-passed' : ''}${unlocked ? '' : ' is-locked'}${isNext ? ' is-current' : ''}">
    <span class="checkpoint-icon" aria-hidden="true">${passed ? icon('crown') : unlocked ? icon('chest') : icon('lock')}</span>
    <div class="checkpoint-body">
      <h3>Checkpoint: ${esc(level.title)}${passed ? ' <span class="tag tag-ok">bestanden</span>' : ''}</h3>
      <p class="small">${text}</p>${stats}
      ${action}
    </div>
  </div>`;
}

function viewLearn() {
  return withCourse(app.state.activeCourseId, (course) => {
    setTitle('Lernpfad');
    const st = app.state;
    const step = nextStep(st, course);
    const all = listLessons(course);
    // Große Kurse: nur der Abschnitt mit dem nächsten Schritt ist offen, die anderen lassen sich aufklappen.
    const currentLevel = step?.kind === 'lesson' ? step.lesson.levelId : step?.kind === 'checkpoint' ? step.level.id : null;
    const open = app.openLevels.get(course.id) ?? new Set(currentLevel ? [currentLevel] : course.levels.slice(0, 1).map((l) => l.id));
    app.openLevels.set(course.id, open);
    const levels = course.levels.map((level, li) => {
      const passed = isCheckpointPassed(st, course.id, level.id);
      const lessonsInLevel = all.filter((l) => l.levelId === level.id);
      const doneInLevel = passed ? lessonsInLevel.length : lessonsInLevel.filter((l) => isLessonCompleted(st, course.id, l.id)).length;
      const isOpen = open.has(level.id);
      const isCurrent = level.id === currentLevel;
      const locked = !isCheckpointUnlocked(st, course, level.id) && doneInLevel === 0 && !isCurrent;
      // Abschnittskopf als eine Zeile zum Auf- und Zuklappen (wie die Abschnittsliste auf der Startseite).
      const head = `<h2 id="lv-${esc(level.id)}" class="level-head" tabindex="-1">
          <button type="button" class="level-toggle" data-action="toggle-level" data-level="${esc(level.id)}" aria-expanded="${isOpen}"${isOpen ? ` aria-controls="lvb-${esc(level.id)}"` : ''}>
            <span class="level-num" aria-hidden="true">${passed ? icon('crown') : li + 1}</span>
            <span class="level-main"><span class="level-title">${esc(level.title)}</span>${meter(doneInLevel, lessonsInLevel.length, '', '', { decorative: true })}</span>
            <span class="level-count">${doneInLevel}/${lessonsInLevel.length}<span class="sr-only"> Lektionen erledigt</span></span>
            ${icon('chevron', 'level-chevron')}
          </button>
        </h2>`;
      if (!isOpen) {
        return `<section class="level is-collapsed${isCurrent ? ' is-current' : ''}${passed ? ' is-passed' : ''}${locked ? ' is-locked' : ''}" aria-labelledby="lv-${esc(level.id)}">${head}</section>`;
      }
      const board = levelBoardHtml(course, level, step, { focusCurrent: true });
      return `<section class="level${isCurrent ? ' is-current' : ''}${passed ? ' is-passed' : ''}" aria-labelledby="lv-${esc(level.id)}">
        ${head}
        <div id="lvb-${esc(level.id)}" class="level-body">${board}${checkpointCard(course, level, li, step)}</div>
      </section>`;
    }).join('');
    return `${guestHint()}<div class="page-head"><h1 tabindex="-1">Lernpfad · ${esc(course.title)}</h1>
      <p class="muted">Lektionen öffnen sich der Reihe nach${st.settings.unlockAll ? ' – aktuell sind alle freigeschaltet (Optionen)' : ''}. Am Ende jedes Abschnitts wartet ein Checkpoint mit Truhe.</p>
      <div class="hero-actions">${primaryAction(course, step, { autofocus: false, big: false })}</div></div>
      ${levels}
      ${courseInfoHtml(course)}`;
  });
}

/** Lizenz und Quellen eines Kurses (Pflicht bei CC BY/CC BY-SA). */
function courseInfoHtml(course) {
  const sources = (course.attribution ?? []).map((a) => {
    const name = /^https:\/\//.test(a.url ?? '') ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}</a>` : esc(a.name);
    return `<li>${name} – ${esc(a.license)}${a.usage ? `<br><span class="muted small">${esc(a.usage)}</span>` : ''}</li>`;
  }).join('');
  return `<details class="card course-info">
    <summary>Über diesen Kurs: Lizenz und Quellen</summary>
    <p>${course.demo ? 'Selbst geschriebener Demo-Inhalt. ' : ''}${course.generated ? 'Automatisch aus offenen Quellen zusammengestellt und stichprobenartig geprüft – Fehler sind möglich. ' : ''}Lizenz der Kursinhalte: <strong>${esc(course.license || 'nicht angegeben')}</strong>.</p>
    ${sources ? `<ul class="source-list">${sources}</ul>` : ''}
  </details>`;
}

// =====================================================================================================
// Lektion, Checkpoint, Wiederholung
// =====================================================================================================

function runOptions(course) {
  const s = app.state.settings;
  const hearable = hasRecordings(course.targetLang) || (s.deviceVoice === true && canSpeak());
  return { listening: Boolean(s.listening && hearable), speaking: Boolean(s.speaking && canRecognize()) };
}

function freshUi() {
  return { selected: null, picked: [], text: '', checked: null, match: newMatchUi(), rec: { active: false, error: null } };
}

function startRun(kind, course, target) {
  const st = app.state;
  const options = runOptions(course);
  let exercises = [];
  let seed = 0;
  let title = '';
  if (kind === 'lesson') {
    seed = st.courses[course.id]?.completed?.[target.id]?.completions ?? 0;
    exercises = buildLesson(course, target.unit, target.index, { seed, ...options });
    title = `${target.unit.title} · Lektion ${target.index + 1}`;
  } else if (kind === 'checkpoint') {
    seed = st.courses[course.id]?.checkpoints?.[target.id]?.attempts ?? 0;
    exercises = buildCheckpoint(course, target, { seed, ...options });
    title = `Checkpoint · ${target.title}`;
  } else {
    const due = dueReviewItems(st, course.id, Date.now(), 10);
    exercises = due.map((it) => buildReviewExercise(course, it, { seed: it.seen, box: it.box })).filter(Boolean);
    title = 'Wiederholung';
  }
  const targetId = kind === 'review' ? null : target.id;
  run = {
    kind, hash: currentHash(), course, courseId: course.id, version: course.version, seed, options, title, targetId,
    lessonId: kind === 'lesson' ? target.id : null, levelId: kind === 'checkpoint' ? target.id : null,
    level: kind === 'checkpoint' ? target : null, unit: kind === 'lesson' ? target.unit : null,
    session: createSession(exercises), ui: freshUi(), responses: {}, fallbackIds: new Set(),
    skip: { listen: false, speak: false }, phase: 'exercise', result: null, error: null, confirmQuit: false,
    intro: null, restored: false,
  };
  // Zwischenstand auf diesem Gerät? Dann genau dort weitermachen (ohne Wortkarten).
  if (kind !== 'review') {
    const snap = loadRunSnapshot();
    if (snapshotMatches(snap, { userId: app.user?.id, courseId: course.id, version: course.version, kind, targetId, seed })) {
      Object.assign(run, {
        session: snap.session, responses: snap.responses ?? {}, fallbackIds: new Set(snap.fallbackIds ?? []),
        skip: { listen: Boolean(snap.skip?.listen), speak: Boolean(snap.skip?.speak) },
        options: { listening: Boolean(snap.options?.listening), speaking: Boolean(snap.options?.speaking) }, restored: true,
      });
      preloadRunAudio(run);
      return;
    }
  }
  // Vor der ersten Übung: Regelkarte (erste Lektion einer Einheit mit Regeltext) und Karten für neue Wörter.
  if (kind === 'lesson') {
    const cards = [];
    if (target.index === 0 && target.unit.intro && !isLessonCompleted(st, course.id, target.id)) cards.push({ kind: 'rule', unit: target.unit });
    for (const ref of newWordRefs(st, course, target.unit, target.index)) cards.push({ kind: 'word', word: target.unit.words[ref.index] });
    if (cards.length) {
      run.intro = { cards, pos: 0 };
      run.phase = 'intro';
    }
  }
  preloadRunAudio(run);
}

/** Aufnahmen der Wortkarten und Übungen schon laden, damit sie beim Antippen sofort spielen (iOS). */
function preloadRunAudio(r) {
  const texts = [];
  for (const c of r.intro?.cards ?? []) if (c.word) texts.push(c.word.target[0], c.word.examples?.[0]?.target);
  for (const { ex } of r.session.queue) {
    texts.push(ex.speak, ex.solution, ex.question, ...(ex.choices ?? []), ...(ex.bank ?? []).map((t) => t.text));
  }
  preloadRecordings(texts.filter(Boolean), ttsLang(r.course));
}

/** Zwischenstand sichern (nur Lektion und Checkpoint, nur während der Übungen). */
function persistRun() {
  if (!run || run.kind === 'review' || run.phase !== 'exercise') return;
  saveRunSnapshot({
    v: 1, userId: app.user?.id, courseId: run.courseId, version: run.version, kind: run.kind, targetId: run.targetId,
    seed: run.seed, options: run.options, hash: run.hash, title: run.title, session: run.session, responses: run.responses,
    fallbackIds: [...run.fallbackIds], skip: run.skip, savedAt: Date.now(),
  });
}

/** Gespeicherter Zwischenstand für den aktiven Kurs (für „Weitermachen“ auf Start und im Lernpfad). */
function resumeInfo(course) {
  const snap = loadRunSnapshot();
  if (!snap || snap.userId !== app.user?.id || snap.courseId !== course.id || snap.version !== course.version) return null;
  if (snap.session.pos >= snap.session.queue.length || (run && run.hash === snap.hash)) return null;
  return { hash: snap.hash, title: snap.title, pos: snap.session.pos + 1, total: snap.session.queue.length };
}

function endRun() {
  stopAll();
  run = null;
}

function stopAll() {
  stopSpeaking();
  if (recognizer) {
    recognizer.stop();
    recognizer = null;
  }
  if (wrongTimer) {
    clearTimeout(wrongTimer);
    wrongTimer = null;
  }
}

function lessonShell(content, { showProgress = true } = {}) {
  const pct = run ? Math.round(sessionProgress(run.session) * 100) : 0;
  const pos = run ? Math.min(run.session.pos + 1, run.session.queue.length) : 0;
  return `<div class="lesson">
    <div class="lesson-top">
      <button type="button" class="icon-btn" data-action="quit" aria-label="${run?.kind === 'review' ? 'Wiederholung' : run?.kind === 'checkpoint' ? 'Checkpoint' : 'Lektion'} verlassen">${icon('close')}</button>
      ${showProgress && run ? `<div class="lesson-progress">${meter(pct, 100, 'Fortschritt')}</div><span class="small muted lesson-count">${pos}/${run.session.queue.length}<span class="sr-only"> Übungen</span></span>` : '<div class="lesson-progress"></div>'}
    </div>
    ${run?.confirmQuit ? quitConfirm() : ''}
    <main id="main" class="lesson-main" tabindex="-1">${flashHtml()}${content}</main>
  </div>`;
}

function quitConfirm() {
  const what = run.kind === 'review' ? 'Wiederholung' : run.kind === 'checkpoint' ? 'Checkpoint' : 'Lektion';
  if (run.kind === 'review') {
    return `<div class="confirm confirm-bar" role="group" aria-labelledby="quit-q">
      <p id="quit-q"><strong>${what} verlassen?</strong> Deine Antworten dieser ${what} werden nicht gespeichert.</p>
      <button type="button" class="btn btn-danger" data-action="quit-discard">Verlassen</button>
      <button type="button" class="btn btn-primary" data-action="quit-no" id="quit-no">Weiter üben</button>
    </div>`;
  }
  return `<div class="confirm confirm-bar confirm-pause" role="group" aria-labelledby="quit-q">
    <p id="quit-q"><strong>Pause machen?</strong> Dein Zwischenstand bleibt auf diesem Gerät gespeichert – später geht es genau bei dieser Übung weiter.</p>
    <button type="button" class="btn btn-primary" data-action="quit-no" id="quit-no">Weiter üben</button>
    <button type="button" class="btn" data-action="quit-yes">Pause – später weiter</button>
    <button type="button" class="btn btn-ghost btn-small" data-action="quit-discard">${what} abbrechen und verwerfen</button>
  </div>`;
}

function viewRunRoute(kind, arg) {
  if (!app.state.activeCourseId) return redirect('#/courses');
  const id = app.state.activeCourseId;
  const e = courseEntry(id);
  if (e.status !== 'ok') return layout(withCourse(id, () => ''), kind === 'review' ? 'review' : 'learn');
  const course = e.data;
  if (run && run.hash === currentHash() && run.courseId === course.id) return viewRun();
  if (kind === 'lesson') {
    const lesson = findLesson(course, arg ?? '');
    if (!lesson) {
      setTitle('Lektion nicht gefunden');
      return layout(`<section class="card state-card"><h1 tabindex="-1">Lektion nicht gefunden</h1><p>Diese Lektion gibt es im Kurs „${esc(course.title)}“ nicht (mehr).</p><p><a class="btn btn-primary" href="#/learn">Zum Lernpfad</a></p></section>`, 'learn');
    }
    if (!isLessonUnlocked(app.state, course, lesson.id)) {
      setTitle('Lektion gesperrt');
      return layout(`<section class="card state-card"><h1 tabindex="-1">Diese Lektion ist noch gesperrt</h1><p>${esc(lockReason(course, lesson.id))}</p>
        <p class="muted">Alternativ: den Checkpoint des Abschnitts machen oder in den Optionen alles freischalten.</p><p><a class="btn btn-primary" href="#/learn">Zum Lernpfad</a></p></section>`, 'learn');
    }
    startRun('lesson', course, lesson);
  } else if (kind === 'checkpoint') {
    const li = course.levels.findIndex((l) => l.id === arg);
    const level = course.levels[li];
    if (!level) {
      setTitle('Checkpoint nicht gefunden');
      return layout('<section class="card state-card"><h1 tabindex="-1">Checkpoint nicht gefunden</h1><p><a class="btn btn-primary" href="#/learn">Zum Lernpfad</a></p></section>', 'learn');
    }
    if (!isCheckpointUnlocked(app.state, course, level.id)) {
      setTitle('Checkpoint gesperrt');
      return layout(`<section class="card state-card"><h1 tabindex="-1">Dieser Checkpoint ist noch gesperrt</h1><p>${li > 0 ? `Bestehe zuerst den Checkpoint „${esc(course.levels[li - 1].title)}“.` : ''}</p><p><a class="btn btn-primary" href="#/learn">Zum Lernpfad</a></p></section>`, 'learn');
    }
    startRun('checkpoint', course, level);
  } else {
    startRun('review', course);
    if (run.session.total === 0) {
      run = null;
      setTitle('Wiederholen');
      return layout(`<section class="card state-card empty-state"><img src="assets/wegmarke.svg" alt="" width="72" height="72">
        <h1 tabindex="-1">Gerade ist nichts fällig</h1>
        <p>Wörter und Sätze aus abgeschlossenen Lektionen kommen hier in wachsenden Abständen wieder (nach 1, 3, 7, 14 und 30 Tagen). Fehler sind sofort fällig.</p>
        <p><a class="btn btn-primary" data-autofocus href="#/learn">Zum Lernpfad</a></p></section>`, 'review');
    }
  }
  if (run?.restored) {
    showFlash('ok', `Willkommen zurück! Es geht bei Übung ${run.session.pos + 1} von ${run.session.queue.length} weiter.`);
  }
  if (run?.phase === 'exercise') maybeAutoFallback();
  return viewRun();
}

function viewRun() {
  if (run.phase === 'summary') return layout(viewSummary(), run.kind === 'review' ? 'review' : 'learn');
  if (run.phase === 'intro') return lessonShell(viewIntro(), { showProgress: false });
  if (run.phase === 'submitting') {
    setTitle('Wird gespeichert');
    return lessonShell(`<section class="state-card" aria-busy="true"><h1 tabindex="-1">Ergebnis wird gespeichert …</h1><div class="spinner" aria-hidden="true"></div><p class="muted" role="status">Der Server bewertet deine Antworten.</p></section>`, { showProgress: false });
  }
  if (run.phase === 'error') return lessonShell(viewSubmitError(), { showProgress: false });
  return lessonShell(viewExercise());
}

function viewSubmitError() {
  const err = run.error;
  setTitle('Speichern fehlgeschlagen');
  const net = err?.status === 0;
  return `<section class="card state-card is-error"><h1 tabindex="-1">${net ? 'Keine Verbindung' : 'Speichern hat nicht geklappt'}</h1>
    <p>${esc(err?.message ?? 'Unbekannter Fehler.')}</p>
    <p><strong>Deine Antworten sind noch da.</strong> ${net ? 'Sobald die Verbindung wieder steht, sende sie erneut.' : 'Du kannst es noch einmal versuchen.'}</p>
    <div class="hero-actions"><button type="button" class="btn btn-primary" data-action="resubmit" data-autofocus>Erneut senden</button>
    <a class="btn" href="${run.kind === 'review' ? '#/' : '#/learn'}">Verwerfen</a></div></section>`;
}

function langLabel(code) {
  return languageName(String(code).split('-')[0]);
}

const showReadings = () => app.state?.settings?.showReading !== false;

/** Aussprachehilfe (z. B. Pinyin) unter einem Text – nur wenn vorhanden und in den Einstellungen an. */
function readingHtml(reading) {
  return reading && showReadings() ? `<span class="reading" lang="zh-Latn-pinyin">${esc(reading)}</span>` : '';
}

/** Herkunft eines Satzes (z. B. Tatoeba) für die Quellenangabe nach dem Prüfen. */
function sourceHtml(course, ref) {
  if (!ref || ref.kind !== 's') return '';
  const src = findUnit(course, ref.unitId)?.sentences?.[ref.index]?.source;
  if (!src?.name || src.name === 'Wortweg') return '';
  const label = `${src.name}${src.id ? ` #${src.id}` : ''}${src.author ? ` · ${src.author}` : ''}`;
  const link = /^https:\/\//.test(src.url ?? '') ? `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label);
  return `<p class="small muted source-line">Satzquelle: ${link}</p>`;
}

const ttsLang = (course) => course.ttsLang || course.targetLang;

/** Lautsprecher-Knopf: spricht data-text in der Zielsprache (data-rate optional). */
function sayBtn(text, label, { rate = 1, big = false, caption = '' } = {}) {
  if (!text || !canSay(text, activeTtsLang())) return '';
  return `<button type="button" class="say-btn${big ? ' say-btn-lg' : ''}" data-action="say" data-text="${esc(text)}"${rate !== 1 ? ` data-rate="${rate}"` : ''} aria-label="${esc(label)}" title="${esc(label)}">${icon(rate < 1 ? 'slow' : 'speaker')}${caption ? `<span class="say-label">${esc(caption)}</span>` : ''}</button>`;
}

/** Vorlese-Knöpfe einer Übung (normal und langsam) – siehe speechFor. */
function sayRow(ex) {
  const sp = speechFor(ex, run.course);
  if (!sp || !canSay(sp.text, sp.lang)) return '';
  const what = sp.reveals ? `Lösung auf ${langLabel(run.course.targetLang)} anhören` : `Auf ${langLabel(run.course.targetLang)} vorlesen`;
  return `<div class="say-row">${sayBtn(sp.text, what, { big: true, caption: sp.reveals ? 'Lösung anhören' : 'Anhören' })}${sayBtn(sp.text, `${what} – langsam`, { rate: 0.6 })}</div>`;
}

/** Beispielsatz eines Worts; das Wort selbst wird darin hervorgehoben, wenn es wörtlich vorkommt. */
function exampleHtml(word, course, { label = 'So benutzt man es' } = {}) {
  const ex = word?.examples?.[0];
  if (!ex) return '';
  const tl = course.targetLang;
  const [pos, len] = findWordIn(ex.target, word.target[0], tl);
  const target = pos >= 0
    ? `${esc(ex.target.slice(0, pos))}<mark>${esc(ex.target.slice(pos, pos + len))}</mark>${esc(ex.target.slice(pos + len))}`
    : esc(ex.target);
  const src = ex.source?.name && ex.source.name !== 'Wortweg'
    ? `<p class="example-source">Quelle: ${/^https:\/\//.test(ex.source.url ?? '') ? `<a href="${esc(ex.source.url)}" target="_blank" rel="noopener noreferrer">${esc(ex.source.name)}${ex.source.id ? ` #${esc(ex.source.id)}` : ''}</a>` : esc(ex.source.name)}</p>`
    : '';
  return `<div class="example">
    <p class="example-label">${esc(label)}</p>
    <p class="example-target"><span lang="${esc(tl)}">${target}</span> ${sayBtn(ex.target, 'Beispielsatz vorlesen')}</p>
    ${readingHtml(ex.reading)}
    <p class="example-native" lang="${esc(course.nativeLang)}">${esc(ex.native)}</p>${src}
  </div>`;
}

/** Wortkarten und Regelkarte vor der ersten Übung. */
function viewIntro() {
  const { cards, pos } = run.intro;
  const card = cards[pos];
  const course = run.course;
  const last = pos === cards.length - 1;
  const wordCards = cards.filter((c) => c.kind === 'word');
  let body;
  if (card.kind === 'rule') {
    setTitle(`Regel: ${card.unit.title}`);
    body = `<section class="intro-card rule-card" aria-labelledby="intro-h">
      <p class="card-meta">${icon('bulb')} Neue Regel</p>
      <h1 id="intro-h" tabindex="-1">${esc(card.unit.title)}</h1>
      <div class="rule-text">${introHtml(card.unit.intro)}</div>
    </section>`;
  } else {
    const w = card.word;
    const n = wordCards.indexOf(card) + 1;
    setTitle(`Neues Wort: ${w.target[0]}`);
    body = `<section class="intro-card word-card" aria-labelledby="intro-h">
      <p class="card-meta">Neues Wort ${n} von ${wordCards.length}</p>
      <div class="word-main">
        <h1 id="intro-h" tabindex="-1" class="word-target"><span lang="${esc(course.targetLang)}">${esc(w.target[0])}</span>${readingHtml(w.reading)}</h1>
        <div class="word-say">${sayBtn(w.target[0], `„${w.target[0]}“ vorlesen`, { big: true })}${sayBtn(w.target[0], 'Langsam vorlesen', { rate: 0.6 })}</div>
      </div>
      <p class="word-native" lang="${esc(course.nativeLang)}">${esc(w.native.join(' · '))}</p>
      ${w.target.length > 1 ? `<p class="word-alt">Auch richtig: <span lang="${esc(course.targetLang)}">${esc(w.target.slice(1).join(' · '))}</span></p>` : ''}
      ${w.note ? `<p class="word-note">${esc(w.note)}</p>` : ''}
      ${exampleHtml(w, course)}
    </section>`;
  }
  const dots = cards.length > 1
    ? `<ol class="intro-dots" aria-label="Karte ${pos + 1} von ${cards.length}">${cards.map((c, i) => `<li class="${i === pos ? 'is-current' : i < pos ? 'is-done' : ''}" aria-hidden="true"></li>`).join('')}</ol>`
    : '';
  return `<p class="small muted run-title">${esc(run.title)} · bevor es losgeht</p>
    ${body}
    ${dots}
    <div class="actions intro-actions">
      <button type="button" class="btn btn-ghost" data-action="intro-skip">Karten überspringen</button>
      ${pos > 0 ? '<button type="button" class="btn" data-action="intro-back">Zurück</button>' : ''}
      <button type="button" class="btn btn-primary btn-lg" data-action="intro-next" data-autofocus>${last ? 'Los geht’s!' : 'Nächste Karte'}</button>
    </div>`;
}

/** Karte wechseln (delta ±1) bzw. mit den Übungen beginnen. Spricht das neue Wort, wenn Hören an ist. */
function introStep(delta) {
  if (!run?.intro) return;
  const next = run.intro.pos + delta;
  if (next < 0) return;
  if (next >= run.intro.cards.length) {
    startExercises();
    return;
  }
  run.intro.pos = next;
  pendingFocus = '[data-action="intro-next"]';
  render();
  const card = run.intro.cards[next];
  if (card.kind === 'word' && app.state.settings.listening) speak(card.word.target[0], ttsLang(run.course));
}

function startExercises() {
  if (!run) return;
  run.phase = 'exercise';
  run.intro = null;
  maybeAutoFallback();
  pendingFocus = 'h1';
  render();
  const ex = currentItem(run.session)?.ex;
  if (ex?.type === 'listen') speak(ex.speak, ex.speakLang);
}

function viewExercise() {
  const item = currentItem(run.session);
  const ex = item.ex;
  const ui = run.ui;
  const checked = ui.checked;
  setTitle(run.title);
  // Aussprache zur Frage nur, wenn die Frage in der Zielsprache steht (sonst verriete sie die Antwort).
  const questionReading = ex.questionLang === run.course.targetLang && ex.type !== 'listen' ? readingHtml(ex.reading) : '';
  const q = ex.question ? `<p class="question" lang="${esc(ex.questionLang)}">${esc(ex.question)}${questionReading}</p>` : '';
  let body = '';
  const ready = canCheck(ex, ui);
  const isFallback = run.fallbackIds.has(ex.id);
  const say = sayRow(ex);

  if (ex.type === 'choice' || ex.type === 'fill') {
    const lead = ex.type === 'fill'
      ? `${q}<p class="fill-sentence" lang="${esc(ex.answerLang)}">${esc(ex.parts.before)} <span class="blank">${ui.selected ? esc(ui.selected) : '<span class="sr-only">Lücke</span><span aria-hidden="true">_____</span>'}</span>${/^[.,!?;:]/.test(ex.parts.after) ? '' : ' '}${esc(ex.parts.after)}</p>`
      : q;
    const opts = ex.choices.map((c, i) => {
      const sel = ui.selected === c;
      let mark = '';
      if (checked) mark = c === ex.answer ? ' is-right' : sel ? ' is-wrong' : '';
      return `<button type="button" class="choice${sel ? ' is-selected' : ''}${mark}" data-action="choose" data-value="${esc(c)}" aria-pressed="${sel}"${checked ? ' disabled' : ''}><kbd aria-hidden="true">${i + 1}</kbd> <span class="choice-text"><span lang="${esc(ex.answerLang)}">${esc(c)}</span>${readingHtml(ex.choiceReadings?.[i])}</span></button>`;
    }).join('');
    body = `${lead}${say}<div class="choices" role="group" aria-label="Antwortmöglichkeiten">${opts}</div>`;
  } else if (ex.type === 'order') {
    const picked = ui.picked.map((tid) => ex.bank.find((b) => b.id === tid)).filter(Boolean);
    const answer = picked.map((t) => `<button type="button" class="tile" data-action="unpick" data-id="${esc(t.id)}"${checked ? ' disabled' : ''} aria-label="${esc(t.text)} entfernen">${esc(t.text)}${readingHtml(t.reading)}</button>`).join('');
    const bank = ex.bank.map((t) => {
      const used = ui.picked.includes(t.id);
      return `<button type="button" class="tile${used ? ' is-used' : ''}" data-action="pick" data-id="${esc(t.id)}"${used || checked ? ' disabled' : ''}${used ? ' aria-hidden="true" tabindex="-1"' : ''}>${esc(t.text)}${readingHtml(t.reading)}</button>`;
    }).join('');
    body = `${q}${say}<p class="sr-only" id="answer-line-label">Deine Antwort</p><div class="answer-line" role="group" aria-labelledby="answer-line-label" lang="${esc(ex.answerLang)}">${answer || '<span class="placeholder">Tippe die Wörter in der richtigen Reihenfolge an.</span>'}</div>
      <p class="sr-only" id="bank-label">Wortbausteine</p><div class="bank" role="group" aria-labelledby="bank-label" lang="${esc(ex.answerLang)}">${bank}</div>
      <p class="muted small kbd-hint">Tastatur: Tab zu einem Baustein, Enter fügt ihn hinzu, Rücktaste entfernt den letzten.</p>`;
  } else if (ex.type === 'match') {
    body = viewMatch(ex, ui);
  } else if (ex.type === 'speak') {
    body = viewSpeak(ex, ui);
  } else {
    const listen = ex.type === 'listen';
    const audio = listen ? `<div class="listen-row">
        <button type="button" class="btn btn-field" data-action="speak" data-rate="1">${icon('play')} Abspielen</button>
        <button type="button" class="btn" data-action="speak" data-rate="0.6">${icon('slow')} Langsam</button>
      </div>
      ${!canSay(ex.speak, ex.speakLang) ? '<p class="inline-error">Zu diesem Satz gibt es keine Aufnahme. Nutze „Kann gerade nicht hören“.</p>' : ''}` : q + say;
    const skipRow = listen && !checked && !item.retry ? `<div class="skip-row">
        <button type="button" class="btn btn-ghost btn-small" data-action="no-audio">${icon('ear')} Kann gerade nicht hören</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="skip-listen-all">In dieser ${run.kind === 'checkpoint' ? 'Prüfung' : 'Lektion'} keine Hörübungen</button></div>` : '';
    body = `${audio}
      <label class="answer-label" for="answer">Deine Antwort auf ${esc(langLabel(ex.answerLang))}</label>
      <textarea id="answer" class="answer-input" rows="2" lang="${esc(ex.answerLang)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${ex.reading && String(ex.answerLang).startsWith('zh') ? 'Hanzi oder Pinyin eingeben …' : 'Antwort eingeben …'}"${checked ? ' readonly' : ' data-autofocus'}>${esc(ui.text)}</textarea>
      ${skipRow}`;
  }

  const feedback = checked ? feedbackHtml(ex, item, checked) : ex.type === 'match' ? '' : `
    <div class="actions">
      <button type="button" class="btn btn-primary btn-check" data-action="check"${ready ? '' : ' disabled'}>Prüfen</button>
    </div>`;

  return `<p class="small muted run-title">${esc(run.title)}${item.retry ? ' · zweiter Versuch' : ''}${isFallback ? ' · Ersatzübung' : ''}</p>
    <h1 tabindex="-1" class="instruction">${esc(ex.instruction)}</h1>
    <form class="exercise" data-form="exercise" data-type="${esc(ex.type)}" novalidate>${body}</form>
    ${feedback}`;
}

function feedbackHtml(ex, item, checked) {
  let solution = '';
  if (ex.type === 'match') {
    const pairs = ex.pairs.map(([l, r]) => {
      const lt = ex.left.find((x) => x.id === l);
      const rt = ex.right.find((x) => x.id === r);
      return `<li><span lang="${esc(lt?.lang)}">${esc(lt?.text)}</span> = <span lang="${esc(rt?.lang)}">${esc(rt?.text)}</span></li>`;
    }).join('');
    solution = checked.correct ? '' : `<p>Die Paare:</p><ul class="pair-list">${pairs}</ul>`;
  } else if (!checked.correct || checked.hint || ex.type === 'listen' || ex.type === 'speak') {
    const shown = checked.correct ? checked.matched : ex.solution;
    const reading = ex.answerLang === run.course.targetLang && shown === ex.solution ? readingHtml(ex.reading) : '';
    const speakable = ex.answerLang === run.course.targetLang ? sayBtn(shown, 'Lösung vorlesen') : '';
    solution = `<p class="solution-line">Lösung: <strong lang="${esc(ex.answerLang)}">${esc(shown)}</strong>${speakable}${reading}</p>`;
  }
  const word = ex.ref?.kind === 'w' ? findUnit(run.course, ex.ref.unitId)?.words?.[ex.ref.index] : null;
  const title = checked.correct ? (checked.hint ? 'Richtig – mit kleinem Hinweis' : 'Richtig!') : ex.type === 'match' ? 'Alle Paare gefunden – mit Fehlversuch.' : 'Noch nicht ganz.';
  return `<div class="feedback ${checked.correct ? 'is-correct' : 'is-incorrect'}">
      <p class="feedback-title"><span class="feedback-icon" aria-hidden="true">${checked.correct ? icon('check') : icon('close')}</span>${title}</p>
      ${checked.hint ? `<p>${esc(checked.hint)}</p>` : ''}
      ${solution}
      <p class="explain"><span class="explain-label">Erklärung:</span> ${esc(ex.explanation)}</p>
      ${word ? exampleHtml(word, run.course, { label: 'Beispiel' }) : ''}
      ${sourceHtml(run.course, ex.ref)}
      ${!checked.correct && !item.retry ? `<p class="small">Diese Übung kommt am Ende ${run.kind === 'review' ? 'der Wiederholung' : run.kind === 'checkpoint' ? 'des Checkpoints' : 'der Lektion'} noch einmal.</p>` : ''}
      <button type="button" class="btn btn-primary" data-action="continue" data-autofocus>Weiter</button>
    </div>`;
}

function viewMatch(ex, ui) {
  const m = ui.match;
  const checked = ui.checked;
  const n = ex.left.length;
  const foundL = new Set(m.found.map((p) => p[0]));
  const foundR = new Set(m.found.map((p) => p[1]));
  const wrong = m.wrong ?? [];
  const col = (side, items, offset) => items.map((it, i) => {
    const found = side === 'l' ? foundL.has(it.id) : foundR.has(it.id);
    const sel = m.sel[side] === it.id;
    const isWrong = (side === 'l' ? wrong[0] : wrong[1]) === it.id;
    const key = offset + i + 1;
    return `<li><button type="button" id="m-${side}-${esc(it.id)}" class="match-btn${found ? ' is-found' : ''}${sel ? ' is-selected' : ''}${isWrong ? ' is-wrong' : ''}" data-action="match-pick" data-side="${side}" data-id="${esc(it.id)}" aria-pressed="${sel}"${found || checked ? ' disabled' : ''}>
      ${key <= 9 ? `<kbd aria-hidden="true">${key}</kbd>` : ''}
      <span class="match-text"><span lang="${esc(it.lang)}">${esc(it.text)}</span>${side === 'r' ? readingHtml(ex.rightReadings?.[i]) : ''}</span>
      ${found ? `<span class="match-tag tag-ok">${icon('check')}<span class="sr-only">zugeordnet</span></span>` : ''}
      ${isWrong ? '<span class="match-tag tag-bad">passt nicht</span>' : ''}
    </button></li>`;
  }).join('');
  const mistakes = m.attempts.length - m.found.length;
  // Ein gemeinsames Raster für beide Spalten (styles.css: subgrid) – so sind alle Felder gleich hoch und auf einer Linie.
  return `<div class="match" style="--rows:${Math.max(ex.left.length, ex.right.length)}">
      <p class="match-head match-head-l" id="match-l">${esc(langLabel(ex.questionLang))}</p>
      <p class="match-head match-head-r" id="match-r">${esc(langLabel(ex.answerLang))}</p>
      <ul class="match-list match-list-l" aria-labelledby="match-l">${col('l', ex.left, 0)}</ul>
      <ul class="match-list match-list-r" aria-labelledby="match-r">${col('r', ex.right, n)}</ul>
    </div>
    <p class="match-status">${m.found.length} von ${n} Paaren gefunden${mistakes ? ` · ${plural(mistakes, 'Fehlversuch', 'Fehlversuche')}` : ''}</p>
    <p class="muted small kbd-hint">Wähle ein Wort und dann seine Übersetzung in der anderen Spalte. Tastatur: Tab und Enter oder Ziffern 1–${n} links, ${n + 1}–${Math.min(2 * n, 9)} rechts.</p>`;
}

function viewSpeak(ex, ui) {
  const checked = ui.checked;
  const item = currentItem(run.session);
  const rec = ui.rec;
  const recBtn = canRecognize()
    ? rec.active
      ? `<button type="button" class="btn btn-rec is-recording" data-action="rec-stop">${icon('stop')} Aufnahme beenden</button>`
      : `<button type="button" class="btn btn-field" data-action="rec-start"${checked ? ' disabled' : ' data-autofocus'}>${icon('mic')} Sprechen</button>`
    : '<p class="muted small">Dein Browser hat keine Spracherkennung. Tippe den Satz einfach ins Feld.</p>';
  return `<p class="question question-target" lang="${esc(ex.questionLang)}">${esc(ex.question)}${readingHtml(ex.reading)}</p>
    <div class="listen-row">
      ${canSay(ex.speak, ex.speakLang) ? `<button type="button" class="btn" data-action="speak" data-rate="1">${icon('play')} Vorlesen</button><button type="button" class="btn" data-action="speak" data-rate="0.6">${icon('slow')} Langsam</button>` : ''}
      ${recBtn}
    </div>
    ${rec.active ? '<p class="rec-status"><span class="rec-dot" aria-hidden="true"></span> Ich höre zu … sprich jetzt den Satz.</p>' : ''}
    ${rec.error ? `<p class="inline-error" id="rec-error">${esc(rec.error)}</p>` : ''}
    <label class="answer-label" for="answer">Erkannter Text – du kannst ihn bearbeiten oder selbst tippen</label>
    <textarea id="answer" class="answer-input" rows="2" lang="${esc(ex.answerLang)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Hier erscheint, was erkannt wurde …"${checked ? ' readonly' : canRecognize() ? '' : ' data-autofocus'}${rec.error ? ' aria-describedby="rec-error"' : ''}>${esc(ui.text)}</textarea>
    ${!checked && !item.retry ? `<div class="skip-row">
      <button type="button" class="btn btn-ghost btn-small" data-action="no-speak">Kann gerade nicht sprechen</button>
      <button type="button" class="btn btn-ghost btn-small" data-action="skip-speak-all">In dieser ${run.kind === 'checkpoint' ? 'Prüfung' : 'Lektion'} keine Sprechübungen</button></div>` : ''}`;
}

/** Ersatzübung (Übersetzen) für die aktuelle Hör- oder Sprechübung – nur im ersten Versuch. */
function applyFallback() {
  const item = currentItem(run.session);
  if (!item || item.retry || run.ui.checked) return false;
  const fb = fallbackExercise(item.ex, run.course);
  if (fb === item.ex) return false;
  stopAll();
  run.fallbackIds.add(fb.id);
  const pos = run.session.pos;
  run.session = { ...run.session, queue: run.session.queue.map((q, i) => (i === pos ? { ...q, ex: fb } : q)) };
  run.ui = freshUi();
  persistRun();
  return true;
}

function maybeAutoFallback() {
  const item = run && currentItem(run.session);
  if (!item || item.retry) return;
  // Hörübung ohne Aufnahme (und ohne erlaubte Gerätestimme): gleich als Übersetzung.
  const unheard = item.ex.type === 'listen' && (run.skip.listen || !canSay(item.ex.speak, item.ex.speakLang));
  if (unheard || (item.ex.type === 'speak' && run.skip.speak)) applyFallback();
}

function applyCheck(result, response) {
  const item = currentItem(run.session);
  const ex = item.ex;
  stopRecognition();
  run.ui.checked = result;
  run.responses = addResponse(run.responses, ex.id, response, run.fallbackIds.has(ex.id));
  run.session = recordAnswer(run.session, result.correct);
  const sol = ex.type === 'match' ? '' : !result.correct ? ` Lösung: ${ex.solution}.` : result.hint ? ` ${result.hint}` : '';
  announce(`${result.correct ? 'Richtig!' : ex.type === 'match' ? 'Alle Paare gefunden, aber mit Fehlversuch.' : 'Noch nicht ganz.'}${sol}`);
  pendingFocus = '[data-action="continue"]';
  render();
  persistRun();
  if (result.correct) {
    sfx('good');
    confettiFrom(root.querySelector('.feedback'), { count: 42, power: 0.75 });
  } else {
    sfx('bad');
  }
  // Nach dem Prüfen den Zielsatz vorlesen (wenn Hören an ist).
  const sp = ex.type === 'listen' || ex.type === 'speak' ? { text: ex.solution, lang: ex.speakLang } : speechFor(ex, run.course);
  if (sp && app.state.settings.listening) speak(sp.text, sp.lang);
}

/** Effektton, wenn „Soundeffekte“ an ist. */
function sfx(kind) {
  if (app.state?.settings?.sounds !== false) tone(kind);
}

/** Sprache für Vorlese-Knöpfe außerhalb einer Übung (z. B. Regelkarten im Lernpfad). */
function activeTtsLang() {
  if (run) return ttsLang(run.course);
  const c = cache.get(`course:${app.state?.activeCourseId}`)?.data;
  return c ? ttsLang(c) : 'de-DE';
}

function check() {
  const item = run && currentItem(run.session);
  if (!item || run.ui.checked || run.phase !== 'exercise') return;
  const ex = item.ex;
  if (!canCheck(ex, run.ui)) return;
  const response = responseFor(ex, run.ui);
  applyCheck(gradeExercise(ex, response), response);
}

function next() {
  if (!run || !run.ui.checked) return;
  stopAll();
  flash = null; // z. B. „Willkommen zurück“ nur bei der ersten Übung
  run.session = advance(run.session);
  run.ui = freshUi();
  if (isFinished(run.session)) {
    submitRun();
    return;
  }
  maybeAutoFallback();
  persistRun();
  render();
  const ex = currentItem(run.session)?.ex;
  if (ex?.type === 'listen') speak(ex.speak, ex.speakLang);
}

function matchClick(side, id) {
  const item = currentItem(run.session);
  const ex = item.ex;
  if (run.ui.checked) return;
  const { match, attempt, done } = matchPick(run.ui.match, ex, side, id);
  run.ui.match = match;
  // Zielsprachliche Karte antippen → Aussprache hören.
  const card = side === 'r' ? ex.right.find((x) => x.id === id) : null;
  if (card && card.lang === run.course.targetLang && match.sel.r === id) speak(card.text, ttsLang(run.course));
  if (attempt) sfx(attempt.correct ? 'pair' : 'bad');
  else sfx('pick');
  if (wrongTimer) {
    clearTimeout(wrongTimer);
    wrongTimer = null;
  }
  if (attempt) {
    const lt = ex.left.find((x) => x.id === attempt.pair[0])?.text ?? '';
    const rt = ex.right.find((x) => x.id === attempt.pair[1])?.text ?? '';
    if (done) {
      const result = gradeExercise(ex, responseFor(ex, run.ui));
      applyCheck(result, responseFor(ex, run.ui));
      return;
    }
    if (attempt.correct) {
      if (card) speak(card.text, ttsLang(run.course));
      announce(`Richtig: ${lt} gleich ${rt}. ${match.found.length} von ${ex.pairs.length} Paaren.`);
    } else {
      announce(`Passt nicht: ${lt} und ${rt}. Versuch es noch einmal.`);
      const ref = run.ui;
      wrongTimer = setTimeout(() => {
        wrongTimer = null;
        if (run && run.ui === ref && ref.match.wrong) {
          ref.match = { ...ref.match, wrong: null };
          render();
        }
      }, 1600);
    }
    const firstOpen = (s) => root.querySelector(`.match-list [data-side="${s}"]:not([disabled])`);
    render();
    (attempt.correct ? firstOpen('l') : root.querySelector(`#m-${side}-${CSS.escape(id)}`) ?? firstOpen('l'))?.focus();
    return;
  }
  render();
  // Nach der Wahl in einer Spalte zur ersten offenen Option der anderen Spalte springen (Tastaturfluss).
  if (match.sel[side] === id && !match.sel[side === 'l' ? 'r' : 'l']) {
    root.querySelector(`.match-list [data-side="${side === 'l' ? 'r' : 'l'}"]:not([disabled])`)?.focus();
  }
}

function stopRecognition() {
  if (recognizer) {
    recognizer.stop();
    recognizer = null;
  }
  if (run) run.ui.rec.active = false;
}

function startRec() {
  const item = currentItem(run.session);
  const ex = item.ex;
  const ui = run.ui;
  if (ui.checked || ui.rec.active) return;
  stopSpeaking();
  ui.rec = { active: true, error: null };
  const handle = startRecognition(ex.speakLang || ex.answerLang, {
    onResult(text) {
      if (!run || run.ui !== ui) return;
      ui.text = text;
      const ta = root.querySelector('#answer');
      if (ta) ta.value = text;
      const btn = root.querySelector('[data-action="check"]');
      if (btn) btn.disabled = !canCheck(ex, ui);
    },
    onError(message, code) {
      if (!run || run.ui !== ui) return;
      ui.rec = { active: false, error: code === 'aborted' ? null : message };
      recognizer = null;
      announce(message);
      pendingFocus = '[data-action="rec-start"]';
      render();
    },
    onEnd() {
      if (!run || run.ui !== ui || !ui.rec.active) return;
      ui.rec = { active: false, error: ui.rec.error };
      recognizer = null;
      announce(ui.text ? `Erkannt: ${ui.text}. Prüfe den Text und drücke Prüfen.` : 'Aufnahme beendet.');
      pendingFocus = ui.text ? '[data-action="check"]' : '[data-action="rec-start"]';
      render();
    },
  });
  if (!handle) return;
  recognizer = handle;
  announce('Aufnahme läuft. Sprich jetzt den Satz.');
  pendingFocus = '[data-action="rec-stop"]';
  render();
}

function quit() {
  if (!run) return;
  const answered = Object.keys(run.responses).length;
  if (run.phase === 'summary' || run.phase === 'intro' || (answered === 0 && run.phase === 'exercise')) {
    leaveRun();
    return;
  }
  run.confirmQuit = true;
  pendingFocus = '#quit-no';
  render();
}

/** Verlassen; discard = Zwischenstand verwerfen (sonst bleibt er für „Später weiter“). */
function leaveRun({ discard = false } = {}) {
  const target = run?.kind === 'review' ? '#/' : '#/learn';
  if (discard && run && run.kind !== 'review') clearRunSnapshot();
  endRun();
  go(target);
}

async function submitRun() {
  const r = run;
  if (!r || r.phase === 'submitting') return;
  r.phase = 'submitting';
  r.error = null;
  r.confirmQuit = false;
  render();
  const base = { courseId: r.courseId, version: r.version, responses: r.responses };
  try {
    let res;
    if (r.kind === 'lesson') res = await api.submitLesson({ ...base, lessonId: r.lessonId, seed: r.seed, options: r.options });
    else if (r.kind === 'checkpoint') res = await api.submitCheckpoint({ ...base, levelId: r.levelId, seed: r.seed, options: r.options });
    else res = await api.submitReview(base);
    app.state = res.state;
    invalidate('stats');
    if (r.kind !== 'review') clearRunSnapshot();
    r.result = res.result;
    r.phase = 'summary';
    r.celebrate = true;
    const what = r.kind === 'checkpoint' ? (res.result.passed ? 'Checkpoint bestanden' : 'Checkpoint noch nicht bestanden') : r.kind === 'review' ? 'Wiederholung abgeschlossen' : 'Lektion abgeschlossen';
    announce(`${what}. Plus ${res.result.xp} XP.`);
  } catch (err) {
    if (handledAuthError(err)) return;
    if (err?.status === 409 && err.code === 'course_changed') {
      invalidate(`course:${r.courseId}`);
      clearRunSnapshot();
      if (run === r) {
        run = null;
        showFlash('warn', `Der Kurs wurde gerade überarbeitet (neue Fassung). Deine Antworten passen nicht mehr dazu – ${r.kind === 'review' ? 'die Wiederholung' : r.kind === 'checkpoint' ? 'der Checkpoint' : 'die Lektion'} startet mit dem aktuellen Inhalt neu. Entschuldige!`);
      }
    } else {
      r.phase = 'error';
      r.error = err instanceof api.ApiError ? err : new api.ApiError(0, 'unknown', String(err?.message ?? err));
      announce(r.error.message);
    }
  }
  if (run === r || run === null) render();
  if (run === r && r.phase === 'summary' && r.celebrate) {
    r.celebrate = false;
    const crowns = crownsFor(r.kind, r.result);
    if (crowns >= 2 || (r.kind === 'checkpoint' && r.result.passed)) {
      sfx('win');
      confetti({ count: crowns === 3 ? 160 : 100, power: 1.1 });
    } else {
      sfx('good');
    }
  }
}

function viewSummary() {
  const r = run.result;
  const course = run.course;
  const st = app.state;
  const now = Date.now();
  const acc = Math.round((r.accuracy ?? 0) * 100);
  const step = nextStep(st, course);
  const mistakes = (r.wrongRefs ?? []).map((ref) => {
    const unit = findUnit(course, ref.unitId);
    const it = ref.kind === 'w' ? unit?.words[ref.index] : unit?.sentences[ref.index];
    return it ? `<li><span lang="${esc(course.targetLang)}">${esc(it.target[0])}</span> – <span lang="${esc(course.nativeLang)}">${esc(it.native[0])}</span></li>` : '';
  }).join('');
  const goal = st.dailyGoal;
  let heading = 'Lektion abgeschlossen';
  let intro = '';
  if (run.kind === 'review') heading = 'Wiederholung abgeschlossen';
  if (run.kind === 'checkpoint') {
    heading = r.passed ? 'Checkpoint bestanden!' : 'Checkpoint noch nicht bestanden';
    intro = r.passed
      ? `<p class="ok-box">Stark! Abschnitt „${esc(run.level.title)}“ gilt als erledigt${course.levels.findIndex((l) => l.id === run.levelId) < course.levels.length - 1 ? ', der nächste Abschnitt ist offen' : ''}.</p>`
      : `<p class="warn-box">Nötig sind ${Math.round(CHECKPOINT_PASS * 100)} % im ersten Versuch, du hattest ${acc} %. Das kostet nichts: Du kannst es jederzeit wieder versuchen – oder die Lektionen des Abschnitts lernen.</p>`;
  }
  setTitle(heading);
  const crowns = crownsFor(run.kind, r);
  const crownRow = `<div class="crowns" role="img" aria-label="${crowns} von 3 Kronen">${[1, 2, 3].map((i) => `<span class="crown${i <= crowns ? ' is-earned' : ''}" style="--i:${i}">${icon('crown')}</span>`).join('')}</div>`;
  const nextBtn = step?.kind === 'lesson'
    ? `<a class="btn btn-primary" data-autofocus href="#/lesson/${enc(step.lesson.id)}">${run.kind === 'lesson' ? 'Nächste Lektion' : 'Weiterlernen'}</a>`
    : step?.kind === 'checkpoint'
      ? `<a class="btn btn-primary" data-autofocus href="#/checkpoint/${enc(step.level.id)}">${run.kind === 'checkpoint' && !r.passed ? 'Checkpoint noch einmal' : `Checkpoint „${esc(step.level.title)}“`}</a>`
      : '';
  return `<section class="card summary${crowns === 3 ? ' is-perfect' : ''}">
    ${crownRow}
    <h1 tabindex="-1">${heading}</h1>
    ${intro}
    <dl class="facts">
      <div><dt>Verdient</dt><dd><span class="xp-pop">+${r.xp} XP</span></dd></div>
      <div><dt>Im ersten Versuch richtig</dt><dd>${r.firstTryCorrect}/${r.total}<small>${acc} %</small></dd></div>
      <div><dt>Serie</dt><dd>${icon('flame')} ${plural(displayStreak(st, now), 'Tag', 'Tage')}</dd></div>
    </dl>
    ${goal > 0 ? `<p>${r.goalJustReached ? '<strong>Tagesziel erreicht!</strong> ' : ''}Heute: ${xpToday(st, now)} / ${goal} XP</p>${meter(xpToday(st, now), goal, 'Tagesziel')}` : ''}
    ${mistakes ? `<h2>Das üben wir noch einmal</h2><ul class="mistakes">${mistakes}</ul><p class="muted small">Diese Einträge sind jetzt unter „Wiederholen“ fällig.</p>` : '<p>Fehlerfrei – stark!</p>'}
    <div class="hero-actions">
      ${nextBtn}
      ${mistakes ? (run.kind === 'review' ? '<button type="button" class="btn" data-action="restart-review">Noch eine Runde</button>' : '<a class="btn" href="#/review">Fehler wiederholen</a>') : ''}
      <a class="btn${nextBtn ? '' : ' btn-primary'}" href="#/learn"${nextBtn ? '' : ' data-autofocus'}>Zum Lernpfad</a>
    </div>
    ${guestHint()}
  </section>`;
}

// =====================================================================================================
// Statistik
// =====================================================================================================

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const fmtDate = (time) => new Date(time).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

function viewStats() {
  return withData([statsEntry(), coursesEntry()], ['stats', 'courses'], (s, courses) => {
    setTitle('Statistik');
    const now = Date.now();
    const days = lastDays(s.days, now, 14);
    const goal = app.state.dailyGoal;
    const max = Math.max(goal, ...days.map((d) => d.xp), 1);
    const sum = days.reduce((n, d) => n + d.xp, 0);
    const active = days.filter((d) => d.xp > 0).length;
    const best = days.reduce((b, d) => (d.xp > b.xp ? d : b), days[0]);
    const totalRuns = s.attempts.lesson + s.attempts.review + s.attempts.checkpoint;
    if (!totalRuns && !app.state.xpTotal) {
      return `<h1 tabindex="-1">Statistik</h1><section class="card state-card empty-state"><img src="assets/wegmarke.svg" alt="" width="72" height="72">
        <h2>Noch keine Statistik</h2><p>Sobald du die erste Lektion abgeschlossen hast, siehst du hier deine XP, Trefferquote und schwierige Wörter.</p>
        <p><a class="btn btn-primary" href="#/" data-autofocus>Jetzt lernen</a></p></section>`;
    }
    const bars = days.map((d) => {
      const pct = Math.round((d.xp / max) * 100);
      const wd = WEEKDAYS[new Date(d.time).getDay()];
      return `<li class="bar-item${d.day === dayKey(now) ? ' is-today' : ''}"><span class="bar-value">${d.xp || ''}</span><span class="bar" style="height:${pct}%"></span><span class="bar-label">${wd}</span></li>`;
    }).join('');
    const goalLine = goal > 0 ? `<span class="chart-goal" style="bottom:${Math.round((goal / max) * 100)}%"><span>Ziel ${goal}</span></span>` : '';
    const rows = days.slice().reverse().map((d) => `<tr><th scope="row">${esc(fmtDate(d.time))}</th><td>${d.xp}</td></tr>`).join('');
    const byId = new Map((courses ?? []).map((c) => [c.id, c]));
    const hard = (s.hardItems ?? []).map((h) => {
      const c = byId.get(h.courseId);
      return `<li><span class="hard-target"${c ? ` lang="${esc(c.targetLang)}"` : ''}>${esc(h.target)}</span> <span class="muted">–</span> <span${c ? ` lang="${esc(c.nativeLang)}"` : ''}>${esc(h.native)}</span> <span class="pill">${plural(h.wrong, 'Fehler', 'Fehler')}</span>${byId.size > 1 && c ? ` <span class="muted small">(${esc(c.title)})</span>` : ''}</li>`;
    }).join('');
    const accuracy = s.accuracy == null ? '–' : `${Math.round(s.accuracy * 100)} %`;
    return `<h1 tabindex="-1">Statistik</h1>
      <section class="card">
        <h2 id="chart-h">XP der letzten 14 Tage</h2>
        <figure class="chart-figure" aria-labelledby="chart-h">
          <div class="chart" aria-hidden="true">${goalLine}<ol class="bars">${bars}</ol></div>
          <figcaption class="chart-caption">${sum} XP in 14 Tagen, an ${plural(active, 'Tag', 'Tagen')} gelernt${best?.xp ? `. Bester Tag: ${esc(fmtDate(best.time))} mit ${best.xp} XP` : ''}${goal > 0 ? `. Tagesziel: ${goal} XP` : ''}.</figcaption>
        </figure>
        <details class="table-details"><summary>Werte als Tabelle anzeigen</summary>
          <table class="data-table"><caption class="sr-only">XP pro Tag, neueste zuerst</caption><thead><tr><th scope="col">Tag</th><th scope="col">XP</th></tr></thead><tbody>${rows}</tbody></table>
        </details>
      </section>
      <section class="card" aria-labelledby="facts-h">
        <h2 id="facts-h">Kennzahlen</h2>
        <dl class="facts">
          <div><dt>Trefferquote</dt><dd>${accuracy}<small>im ersten Versuch, über ${plural(s.answered ?? 0, 'Übung', 'Übungen')}</small></dd></div>
          <div><dt>Abgeschlossen</dt><dd>${s.attempts.lesson}<small>${plural(s.attempts.lesson, 'Lektion', 'Lektionen')}, ${plural(s.attempts.review, 'Wiederholung', 'Wiederholungen')}, ${plural(s.attempts.checkpoint, 'Checkpoint-Versuch', 'Checkpoint-Versuche')}</small></dd></div>
          <div><dt>Wörter und Sätze</dt><dd>${s.items?.learning ?? 0} + ${s.items?.mastered ?? 0}<small>${s.items?.learning ?? 0} in Wiederholung, ${s.items?.mastered ?? 0} gemeistert</small></dd></div>
          <div><dt>Gesamt</dt><dd>${fmtNum(app.state.xpTotal)} XP<small>Serie: bester Wert ${plural(app.state.streak.best, 'Tag', 'Tage')}</small></dd></div>
        </dl>
      </section>
      <section class="card">
        <h2>Schwierige Wörter und Sätze</h2>
        ${hard ? `<ul class="hard-list">${hard}</ul><p><a class="btn btn-small" href="#/review">Jetzt wiederholen</a></p>` : '<p class="muted">Noch nichts – bisher hast du keine Fehler gesammelt.</p>'}
      </section>`;
  }, { loading: 'Statistik wird geladen …', error: 'Statistik konnte nicht geladen werden' });
}

// =====================================================================================================
// Einstellungen
// =====================================================================================================

function confirmBox(key, question, yesLabel, extra = '') {
  return `<div class="confirm" role="group" aria-labelledby="confirm-${key}-q">
    <p id="confirm-${key}-q">${question}</p>${extra}
    <button type="button" class="btn btn-danger" data-action="confirm-yes" data-key="${key}">${yesLabel}</button>
    <button type="button" class="btn" data-action="confirm-no" data-key="${key}" id="confirm-${key}-no">Abbrechen</button>
  </div>`;
}

function viewSettings() {
  setTitle('Optionen');
  const st = app.state;
  const user = app.user;
  const s = st.settings;
  const tts = canSpeak();
  const asr = canRecognize();
  const c = app.confirm;
  const lg = app.legacy;
  const toggle = (key, label, hint, disabled = false) => `<div class="toggle-row">
      <label class="check"><input type="checkbox" data-action="setting" data-key="${key}"${s[key] ? ' checked' : ''}${disabled ? ' disabled' : ''}${hint ? ` aria-describedby="hint-${key}"` : ''}> ${label}</label>
      ${hint ? `<p class="field-hint" id="hint-${key}">${hint}</p>` : ''}</div>`;
  const pi = app.pendingImport;
  const dn = formState('display-name');
  if (dn.values.displayName == null) dn.values.displayName = user.displayName;
  return `<h1 tabindex="-1">Optionen</h1>
  ${app.user?.role === 'admin' ? '<p class="note admin-note"><a href="#/admin">Zum Admin-Bereich</a>: Kurse, Sprachen und Inhalte verwalten.</p>' : ''}
  ${lg ? `<section class="card banner-card" aria-labelledby="legacy-h">
    <h2 id="legacy-h" tabindex="-1">Fortschritt aus der alten lokalen Version übernehmen?</h2>
    <p>In diesem Browser liegt noch ein Stand von Wortweg 0.1: ${plural(lg.summary.xpTotal, 'XP', 'XP')}, ${plural(lg.summary.lessons, 'abgeschlossene Lektion', 'abgeschlossene Lektionen')}, ${plural(lg.summary.items, 'Lernobjekt', 'Lernobjekte')} in der Wiederholung.</p>
    <p class="muted small">Die Übernahme <strong>ersetzt</strong> deinen jetzigen Fortschritt auf dem Server. Der lokale Stand wird erst gelöscht, wenn die Übernahme geklappt hat.</p>
    ${noticeHtml('legacy')}
    ${c === 'legacy-import' ? confirmBox('legacy-import', `<strong>Alten Stand übernehmen?</strong> ${summarizeState(st).hasProgress ? `Dein aktueller Fortschritt (${st.xpTotal} XP) wird dabei überschrieben.` : ''}`, 'Ja, übernehmen')
      : c === 'legacy-discard' ? confirmBox('legacy-discard', '<strong>Alten lokalen Stand löschen?</strong> Das lässt sich nicht rückgängig machen.', 'Ja, löschen')
        : `<div class="hero-actions"><button type="button" class="btn btn-primary" data-action="confirm-open" data-key="legacy-import">Übernehmen</button>
          <button type="button" class="btn" data-action="confirm-open" data-key="legacy-discard">Alten Stand verwerfen</button></div>`}
  </section>` : ''}
  <section class="card" aria-labelledby="set-account">
    <h2 id="set-account">${LOCAL ? 'Profil' : 'Konto'}</h2>
    ${LOCAL ? '<p>Die App-Version speichert alles <strong>nur auf diesem Gerät</strong> – ohne Konto und ohne Server. Sichere deinen Fortschritt ab und zu als Datei (unten bei „Daten“).</p>'
    : user.isGuest
      ? `<p>Du lernst als <strong>Gast</strong>. Dein Fortschritt hängt an einem Cookie in diesem Browser.</p>
         <div class="hero-actions"><a class="btn btn-primary" href="#/register">Konto erstellen (Fortschritt bleibt)</a><a class="btn" href="#/login">Mit bestehendem Konto anmelden</a></div>
         <p class="muted small">Achtung: Beim Anmelden mit einem bestehenden Konto wird der Gast-Fortschritt verworfen.</p>`
      : `<dl class="kv"><dt>Name</dt><dd>${esc(user.displayName)}</dd><dt>E-Mail</dt><dd>${esc(user.email)}</dd><dt>Rolle</dt><dd>${user.role === 'admin' ? 'Admin' : 'Lernende:r'}</dd></dl>`}
    <form data-form="display-name" class="inline-form" novalidate>
      ${field({ form: 'display-name', name: 'displayName', label: 'Anzeigename', autocomplete: 'nickname', maxlength: 40 })}
      <button type="submit" class="btn">Namen speichern</button>
    </form>
    ${noticeHtml('account')}
    <div class="hero-actions">
      ${LOCAL || c === 'logout' ? '' : `<button type="button" class="btn" data-action="${user.isGuest ? 'confirm-open' : 'logout'}" data-key="logout">Abmelden</button>`}
      ${c === 'delete-account' ? '' : `<button type="button" class="btn btn-danger" data-action="confirm-open" data-key="delete-account">${LOCAL ? 'Alle Daten auf diesem Gerät löschen …' : 'Konto löschen …'}</button>`}
    </div>
    ${c === 'logout' ? confirmBox('logout', '<strong>Als Gast abmelden?</strong> Ohne Konto kommst du danach nicht mehr an diesen Fortschritt. Erstelle vorher besser ein Konto.', 'Trotzdem abmelden') : ''}
    ${c === 'delete-account' ? `<form data-form="delete-account" class="confirm" novalidate aria-labelledby="del-q">
      <p id="del-q">${LOCAL ? '<strong>Alle Wortweg-Daten auf diesem Gerät löschen?</strong> Fortschritt, Einstellungen und Name werden sofort und endgültig gelöscht. Tipp: vorher exportieren.' : '<strong>Konto wirklich löschen?</strong> Dein Konto und dein gesamter Fortschritt werden sofort und endgültig gelöscht.'}</p>
      ${formErrorHtml('delete-account')}
      ${user.isGuest || LOCAL ? '' : field({ form: 'delete-account', name: 'password', label: 'Zur Bestätigung: dein Passwort', type: 'password', autocomplete: 'current-password', keepValue: false })}
      <button type="submit" class="btn btn-danger">Ja, endgültig löschen</button>
      <button type="button" class="btn" data-action="confirm-no" data-key="delete-account" id="confirm-delete-account-no">Abbrechen</button>
    </form>` : ''}
  </section>
  <section class="card" aria-labelledby="set-goal">
    <h2 id="set-goal">Tagesziel</h2>
    <fieldset class="radios"><legend class="sr-only">Tagesziel wählen</legend>${goalRadios('goal', st.dailyGoal)}</fieldset>
    <p class="muted small">Freiwillig. Wer einen Tag auslässt, verliert nichts außer der Serienzählung.</p>
    ${noticeHtml('goal')}
  </section>
  <section class="card" aria-labelledby="set-learn">
    <h2 id="set-learn">Lernen</h2>
    ${toggle('listening', 'Hörübungen und Vorlesen', 'Hörübungen, und nach dem Prüfen wird der Satz vorgelesen – mit echten Aufnahmen von Menschen (Lingua Libre, Wikimedia Commons, Tatoeba). Die Lautsprecher-Knöpfe funktionieren immer.')}
    ${toggle('deviceVoice', 'Computerstimme als Ersatz', tts ? 'Nur für Wörter und Sätze, zu denen es noch keine Aufnahme gibt: Dann liest die Sprachausgabe deines Geräts vor. Aus heißt: nur echte Aufnahmen – Hörübungen ohne Aufnahme werden zu Übersetzungen.' : 'In diesem Browser gibt es keine Sprachausgabe.', !tts && !s.deviceVoice)}
    ${toggle('speaking', 'Sprechübungen (Mikrofon)', `${asr ? '' : '<strong>In diesem Browser nicht verfügbar.</strong> '}Standardmäßig aus. Achtung Datenschutz: Die Spracherkennung mancher Browser (z. B. Chrome) überträgt deine Aufnahme an den Browserhersteller. Wortweg selbst speichert keine Aufnahmen. Du kannst jede Sprechübung auch tippen oder überspringen.`, !asr && !s.speaking)}
    ${toggle('unlockAll', 'Alle Lektionen freischalten', 'Für alle, die schon etwas können. Checkpoints sind die Alternative.')}
    ${toggle('showReading', 'Aussprachehilfe anzeigen', 'Zeigt Pinyin unter chinesischen Wörtern und Sätzen.')}
    ${toggle('sounds', 'Soundeffekte', 'Kurze Töne bei Auswahl, richtigen und falschen Antworten. Das Vorlesen der Sätze hängt an „Hörübungen“.')}
    ${toggle('reduceMotion', 'Animationen reduzieren', 'Schaltet Bewegungen und Übergänge ab (das passiert auch automatisch, wenn dein System das wünscht).')}
    ${noticeHtml('settings')}
  </section>
  <section class="card" aria-labelledby="set-data">
    <h2 id="set-data">Daten</h2>
    <p class="muted small">${LOCAL
    ? 'Dein Fortschritt liegt nur im Speicher dieses Browsers. Löschst du die Website-Daten, ist er weg – sichere ihn deshalb ab und zu als Datei. Auf dem iPhone schützt „Zum Home-Bildschirm“ vor dem automatischen Aufräumen durch Safari.'
    : `Dein Fortschritt liegt auf dem Wortweg-Server in deinem ${user.isGuest ? 'Gast-' : ''}Konto. Du kannst ihn jederzeit als Datei sichern und wieder einspielen.`}</p>
    <div class="hero-actions">
      <button type="button" class="btn" data-action="export">Fortschritt exportieren</button>
      <label class="btn file-btn">Fortschritt importieren …<input type="file" accept="application/json,.json" data-action="import-file" class="sr-only"></label>
      ${c === 'reset' ? '' : '<button type="button" class="btn btn-danger" data-action="confirm-open" data-key="reset">Fortschritt zurücksetzen …</button>'}
    </div>
    ${noticeHtml('data')}
    ${pi ? confirmBox('import', `<strong>„${esc(pi.name)}“ importieren?</strong> Das <strong>ersetzt deinen gesamten Fortschritt</strong> (jetzt ${st.xpTotal} XP) durch den Stand aus der Datei (${plural(pi.summary.xpTotal, 'XP', 'XP')}, ${plural(pi.summary.lessons, 'Lektion', 'Lektionen')}). Tipp: vorher exportieren.`, 'Ja, ersetzen') : ''}
    ${c === 'reset' ? confirmBox('reset', '<strong>Wirklich alles zurücksetzen?</strong> XP, Serie, Lektionen, Checkpoints und Wiederholungen werden gelöscht. Einstellungen und Kurswahl bleiben. Tipp: vorher exportieren.', 'Ja, zurücksetzen') : ''}
    <p class="muted small">${LOCAL ? 'Eigene Kurse anlegen und bearbeiten geht in der Server-Version (Admin-Bereich).' : 'Eigene Kurse als JSON importieren können seit Version 0.2 nur noch Admins (im Admin-Bereich).'}</p>
  </section>`;
}

async function saveSetting(changes, scope, okText) {
  const before = app.state;
  app.state = {
    ...before,
    ...(changes.dailyGoal !== undefined ? { dailyGoal: changes.dailyGoal } : {}),
    settings: { ...before.settings, ...(changes.settings ?? {}) },
  };
  app.notice = null;
  render();
  try {
    const { state } = await api.saveSettings(changes);
    app.state = state;
    setNotice(scope, 'ok', okText);
  } catch (err) {
    if (handledAuthError(err)) return;
    app.state = before;
    setNotice(scope, 'error', `Nicht gespeichert: ${err.message}`);
  }
  render();
}

async function confirmYes(key) {
  app.confirm = null;
  try {
    if (key === 'reset') {
      const { state } = await api.resetProgress();
      app.state = state;
      invalidate('stats');
      setNotice('data', 'ok', 'Fortschritt wurde zurückgesetzt.', true);
    } else if (key === 'import') {
      const pi = app.pendingImport;
      app.pendingImport = null;
      const { state } = await api.importProgress(pi.data);
      app.state = state;
      invalidate('stats');
      setNotice('data', 'ok', `Fortschritt aus „${pi.name}“ importiert.`, true);
    } else if (key === 'legacy-import') {
      const lg = app.legacy;
      const { state } = await api.importProgress(legacyExportPayload(lg.raw));
      app.state = state;
      invalidate('stats');
      clearLegacyState();
      app.legacy = readLegacyState();
      setNotice('data', 'ok', 'Der alte lokale Fortschritt wurde übernommen und lokal gelöscht.', true);
    } else if (key === 'legacy-discard') {
      clearLegacyState();
      app.legacy = readLegacyState();
      setNotice('data', 'ok', 'Der alte lokale Stand wurde gelöscht.', true);
    } else if (key === 'logout') {
      await doLogout();
      return;
    }
  } catch (err) {
    if (handledAuthError(err)) return;
    const scope = key.startsWith('legacy') ? 'legacy' : 'data';
    setNotice(scope, 'error', err.message, true);
  }
  render();
}

async function doLogout() {
  try {
    await api.logout();
  } catch (err) {
    if (err?.status !== 401) {
      setNotice('account', 'error', `Abmelden hat nicht geklappt: ${err.message}`, true);
      render();
      return;
    }
  }
  resetSession();
  showFlash('ok', 'Du bist abgemeldet. Bis bald!', '#/welcome');
  go('#/welcome');
}

async function submitDisplayName(form) {
  const name = (formValues(form).displayName ?? '').trim();
  const f = formState('display-name');
  f.values = { displayName: name };
  f.errors = {};
  if (!name || name.length > 40) {
    f.errors.displayName = 'Der Anzeigename muss 1–40 Zeichen haben.';
    pendingFocus = '#display-name-displayName';
    render();
    return;
  }
  try {
    const { user } = await api.updateAccount(name);
    app.user = user;
    app.forms['display-name'] = null;
    delete app.forms['display-name'];
    setNotice('account', 'ok', 'Anzeigename gespeichert.');
  } catch (err) {
    if (handledAuthError(err)) return;
    f.errors.displayName = err.message;
    pendingFocus = '#display-name-displayName';
  }
  render();
}

async function submitDeleteAccount(form) {
  const f = formState('delete-account');
  const password = formValues(form).password ?? '';
  f.errors = {};
  f.formError = null;
  if (!app.user.isGuest && !LOCAL && !password) {
    f.errors.password = 'Bitte gib dein Passwort ein.';
    pendingFocus = '#delete-account-password';
    render();
    return;
  }
  try {
    await api.deleteAccount(app.user.isGuest || LOCAL ? null : password);
    resetSession();
    showFlash('ok', LOCAL ? 'Alle Daten auf diesem Gerät wurden gelöscht.' : 'Dein Konto und dein Fortschritt wurden gelöscht.', '#/welcome');
    go('#/welcome');
  } catch (err) {
    if (err?.status === 401 && app.user) {
      sessionLost();
      return;
    }
    if (err.code === 'bad_credentials') f.errors.password = err.message;
    else f.formError = err.message;
    pendingFocus = f.errors.password ? '#delete-account-password' : '#delete-account-form-error';
    render();
  }
}

async function doExport() {
  try {
    const { data, filename } = await api.exportProgress();
    downloadJson(filename ?? `wortweg-fortschritt-${dayKey(Date.now())}.json`, data);
    setNotice('data', 'ok', 'Export wurde heruntergeladen.');
  } catch (err) {
    if (handledAuthError(err)) return;
    setNotice('data', 'error', `Export fehlgeschlagen: ${err.message}`, true);
  }
  render();
}

async function pickImportFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await readFileText(file);
    const data = checkProgressExport(parseJsonText(text));
    app.pendingImport = { data, name: file.name, summary: summarizeState(data.state) };
    app.confirm = null;
    app.notice = null;
    pendingFocus = '#confirm-import-no';
  } catch (err) {
    app.pendingImport = null;
    setNotice('data', 'error', err.message, true);
  }
  render();
}

// =====================================================================================================
// Über
// =====================================================================================================

function viewAbout() {
  setTitle('Über Wortweg');
  return `<h1 tabindex="-1">Über Wortweg</h1>
  <section class="card prose">
    <p>Wortweg ist eine freie, werbefreie Lern-App ohne Bezahlschranke, ohne Herzen oder Energie und ohne Strafen.</p>
    <h2>${LOCAL ? 'Daten' : 'Konten und Daten'}</h2>
    ${LOCAL
    ? '<p>Dies ist die <strong>App-Version ohne Server</strong>: Lernstand, Einstellungen und Name liegen nur im Speicher dieses Browsers (localStorage). Nichts wird an einen Server geschickt – außer dem Laden der App- und Kursdateien. Kein Konto, kein Cookie, kein Tracking.</p><p>Du kannst deinen Fortschritt in den Optionen als Datei sichern, auf einem anderen Gerät wieder einspielen und alle Daten löschen.</p>'
    : '<p>Dein Fortschritt liegt auf dem Wortweg-Server (SQLite-Datenbank). Gespeichert werden nur: Anzeigename, E-Mail-Adresse und Passwort-Hash (bei Konten), Lernstand, Einstellungen und Lernversuche für die Statistik. Es gibt genau ein Cookie (<code>ww_session</code>) für die Anmeldung – kein Tracking, keine Drittanbieter.</p><p>Du kannst deinen Fortschritt jederzeit exportieren und dein Konto in den Optionen löschen.</p>'}
    ${LOCAL ? '' : demoNote}
    <h2>Inhalte</h2>
    <p>Es gibt zwei Arten von Kursen: kurze, <strong>selbst geschriebene Demo-Kurse</strong> (CC0 1.0) und große <strong>Wortschatzkurse aus offenen Quellen</strong> wie Tatoeba (Beispielsätze, CC BY 2.0 FR), Wiktionary/WikDict und HanDeDict (CC BY-SA) sowie offenen HSK-Wortlisten (MIT). Diese Kurse stehen unter CC BY-SA 4.0; die Quellen stehen im Lernpfad unter „Über diesen Kurs“, die Herkunft jedes Beispielsatzes erscheint nach dem Prüfen. Nichts wurde aus anderen Lern-Apps übernommen. Kein Kurs ist muttersprachlich oder von einem Lehrwerk geprüft; Wortweg bietet nicht „alle Sprachen“.</p>
    <h2>Audio und Sprechen</h2>
    <p>Vorgelesen wird mit <strong>echten Aufnahmen von Menschen</strong>, nicht mit Computer- oder KI-Stimmen: Wörter aus Lingua Libre und Wikimedia Commons (u. a. Shtooka-Projekt, meist CC BY-SA), Sätze von Tatoeba (je Aufnahme eigene Lizenz, meist CC BY-NC-ND 3.0: nicht kommerziell, unverändert). Wortweg hat die Wort-Aufnahmen gekürzt und in der Lautstärke angeglichen; die Tatoeba-Aufnahmen sind unverändert. Alle Dateien liegen in der App selbst, nichts wird von fremden Servern geladen. <a href="#/recordings">Alle Aufnahmen mit Sprechern und Lizenzen</a></p>
    <p>Wo es noch keine Aufnahme gibt, bleibt es still – außer du schaltest in den Optionen „Computerstimme als Ersatz“ ein; dann liest dort die Sprachausgabe deines Geräts vor. Sprechübungen sind standardmäßig aus; schaltest du sie ein, nutzt Wortweg die Spracherkennung deines Browsers. <strong>Manche Browser (z. B. Chrome) übertragen die Aufnahme dafür an den Browserhersteller.</strong> Wortweg selbst empfängt und speichert keine Aufnahmen.</p>
    <h2>Code, Grafiken und Schriften</h2>
    <p>Eigener Code (MIT-Lizenz). Logo, Illustrationen, Symbole, Kronen und Truhen sind eigene SVG-Zeichnungen dieses Projekts; das Spiel-Design (Blau, Gold, 3D-Knöpfe) ist selbst gestaltet und übernimmt keine Grafiken, Namen oder Schriften aus Spielen oder anderen Apps. Konfetti und Töne erzeugt der Browser selbst (Canvas, Web Audio) – keine Bild- oder Audiodateien, keine externen Bibliotheken.</p>
    <p>Schrift für Überschriften und Knöpfe: <strong>Lilita One</strong> von Juan Montoreano, lizenziert unter der <a href="assets/fonts/OFL-LilitaOne.txt" target="_blank" rel="noopener">SIL Open Font License 1.1</a>, mitgeliefert (kein Abruf von fremden Servern). Text und Lerninhalte: <strong>Atkinson Hyperlegible Next</strong> vom Braille Institute, ebenfalls <a href="assets/fonts/OFL-AtkinsonHyperlegibleNext.txt" target="_blank" rel="noopener">SIL Open Font License 1.1</a> und mitgeliefert. Chinesische Zeichen in der Systemschrift.</p>
  </section>`;
}

const RECORDING_LANGS = ['es', 'zh'];
const recordingCreditsEntry = (lang) => need(`credits:${lang}`, () => fetch(`assets/audio/${lang}/quellen.json`)
  .then((res) => (res.ok ? res.json() : []), () => Promise.reject(Object.assign(new Error('Die Liste der Aufnahmen konnte nicht geladen werden.'), { status: 0 }))));

/** Namensnennung aller Aufnahmen (Pflicht der CC-Lizenzen), gruppiert nach Sprecher und Lizenz. */
function viewRecordings() {
  setTitle('Aufnahmen');
  const entries = RECORDING_LANGS.map(recordingCreditsEntry);
  return withData(entries, RECORDING_LANGS.map((l) => `credits:${l}`), () => `<h1 tabindex="-1">Aufnahmen</h1>
  <section class="card prose">
    <p>Alle Aufnahmen in Wortweg stammen von Menschen, die sie unter einer freien Lizenz geteilt haben. Danke! Hier stehen sie mit Sprecherin oder Sprecher, Quelle und Lizenz; jeder Eintrag führt zur Originaldatei.</p>
    <p>Wort-Aufnahmen (Lingua Libre, Wikimedia Commons) hat Wortweg bearbeitet: Stille am Anfang und Ende gekürzt, Lautstärke angeglichen, als AAC gespeichert. Die bearbeiteten Fassungen stehen unter derselben Lizenz. Tatoeba-Aufnahmen sind unverändert.</p>
    <p><a href="#/about">Zurück zu „Über Wortweg“</a></p>
  </section>
  ${RECORDING_LANGS.map((lang, i) => recordingCreditsHtml(lang, entries[i].data)).join('')}`, { loading: 'Aufnahmen werden geladen …' });
}

function recordingCreditsHtml(lang, list) {
  if (!list?.length) return '';
  const groups = new Map();
  for (const c of list) {
    const k = [c.sprecher, c.quelle, c.lizenz].join('\u0000');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const rows = [...groups.values()].sort((a, b) => b.length - a.length).map((g) => {
    const c = g[0];
    const license = c.lizenzUrl ? `<a href="${esc(c.lizenzUrl)}" target="_blank" rel="noopener">${esc(c.lizenz)}</a>` : esc(c.lizenz);
    return `<details class="table-details"><summary>${esc(c.sprecher || 'ohne Namen')} · ${plural(g.length, 'Aufnahme', 'Aufnahmen')}</summary>
      <p class="muted small">${esc(c.quelle)} · Lizenz: ${license}${c.bearbeitet ? ' · von Wortweg bearbeitet' : ''}</p>
      <ul class="source-list">${g.map((x) => `<li><a href="${esc(x.seite)}" target="_blank" rel="noopener" lang="${esc(lang)}">${esc(x.text)}</a></li>`).join('')}</ul></details>`;
  }).join('');
  return `<section class="card" aria-labelledby="rec-${esc(lang)}">
    <h2 id="rec-${esc(lang)}">${esc(languageName(lang))}: ${plural(list.length, 'Aufnahme', 'Aufnahmen')}</h2>${rows}</section>`;
}

// =====================================================================================================
// Admin (eigenes Modul, per dynamischem import() geladen)
// =====================================================================================================

function adminContext() {
  return {
    api, esc, plural, announce, downloadJson, readFileText, parseJsonText, languageName,
    render: () => render(),
    go,
    focus: (selector) => {
      pendingFocus = selector;
    },
    onUnauthorized: () => sessionLost(),
    invalidatePublic: (courseId) => invalidate('courses', ...(courseId ? [`course:${courseId}`] : [])),
    setTitle,
  };
}

function viewAdmin(args) {
  setTitle('Admin');
  if (app.user?.role !== 'admin') {
    return `<section class="card state-card"><h1 tabindex="-1">Kein Zugriff</h1><p>Der Admin-Bereich ist nur für Admins.</p><p><a class="btn btn-primary" href="#/">Zur Startseite</a></p></section>`;
  }
  if (adminError) return errorView('Admin-Bereich konnte nicht geladen werden', { message: adminError.message, status: 0 }, ['admin-module']);
  if (!admin) {
    if (!adminLoading) {
      adminLoading = import('./admin.js').then(
        (m) => {
          admin = m.createAdmin(adminContext());
          render();
        },
        (err) => {
          adminError = err;
          adminLoading = null;
          render();
        },
      );
    }
    return loadingView('Admin-Bereich wird geladen …');
  }
  return admin.view(args);
}

// =====================================================================================================
// Ereignisse
// =====================================================================================================

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || !root.contains(el)) return;
  const action = el.dataset.action;
  if (parseRoute(currentHash()).name === 'admin' && admin && admin.handleClick(el, e)) return;
  switch (action) {
    case 'skip': {
      e.preventDefault();
      root.querySelector('#main')?.focus();
      break;
    }
    case 'retry-boot': boot(); break;
    case 'retry-load': {
      const keys = (el.dataset.key ?? '').split(',').filter(Boolean);
      if (keys.includes('admin-module')) {
        adminError = null;
        adminLoading = null;
      }
      invalidate(...keys);
      pendingFocus = 'h1';
      render();
      break;
    }
    case 'guest': startAsGuest(); break;
    case 'show-password': {
      const form = el.closest('form');
      form?.querySelectorAll('input[name="password"]').forEach((i) => {
        i.type = el.checked ? 'text' : 'password';
      });
      break;
    }
    case 'select-course': selectCourse(el.dataset.course); break;
    case 'reset-filter':
      app.courseFilter = { from: '', to: '' };
      pendingFocus = '#filter-from';
      render();
      break;
    case 'onboarding-skip': goToFirstStep(); break;
    case 'goto-legacy':
      e.preventDefault();
      pendingFocus = '#legacy-h';
      go('#/settings');
      break;
    case 'legacy-later':
      app.legacyDismissed = true;
      pendingFocus = 'h1';
      render();
      break;
    // --- Übungen ---
    case 'choose': {
      if (!run || run.ui.checked) break;
      run.ui.selected = el.dataset.value;
      const ex = currentItem(run.session).ex;
      sfx('pick');
      if (ex.answerLang === run.course.targetLang) speak(el.dataset.value, ttsLang(run.course));
      render();
      break;
    }
    case 'pick': {
      if (!run || run.ui.checked) break;
      run.ui.picked = [...run.ui.picked, el.dataset.id];
      const ex = currentItem(run.session).ex;
      const tile = ex.bank?.find((b) => b.id === el.dataset.id);
      sfx('pick');
      if (tile && ex.answerLang === run.course.targetLang) speak(tile.text, ttsLang(run.course));
      render();
      (root.querySelector('.bank .tile:not([disabled])') ?? root.querySelector('[data-action="check"]'))?.focus();
      break;
    }
    case 'unpick':
      if (!run || run.ui.checked) break;
      run.ui.picked = run.ui.picked.filter((id) => id !== el.dataset.id);
      render();
      (root.querySelector('.answer-line .tile') ?? root.querySelector('.bank .tile:not([disabled])'))?.focus();
      break;
    case 'match-pick': if (run) matchClick(el.dataset.side, el.dataset.id); break;
    case 'check': check(); break;
    case 'continue': next(); break;
    case 'quit': quit(); break;
    case 'quit-yes': leaveRun(); break;
    case 'quit-discard': leaveRun({ discard: true }); break;
    case 'intro-next': introStep(1); break;
    case 'intro-back': introStep(-1); break;
    case 'intro-skip': startExercises(); break;
    case 'say':
      stopRecognition();
      if (!speak(el.dataset.text ?? '', activeTtsLang(), Number(el.dataset.rate) || 1)) announce('Dazu gibt es noch keine Aufnahme.');
      break;
    case 'toggle-level': {
      const id = el.dataset.level;
      const open = app.openLevels.get(app.state.activeCourseId) ?? new Set();
      if (open.has(id)) open.delete(id);
      else open.add(id);
      app.openLevels.set(app.state.activeCourseId, open);
      pendingFocus = `[data-action="toggle-level"][data-level="${CSS.escape(id)}"]`;
      render();
      break;
    }
    case 'goto-level': {
      const id = el.dataset.level;
      const open = app.openLevels.get(app.state.activeCourseId) ?? new Set();
      open.add(id);
      app.openLevels.set(app.state.activeCourseId, open);
      pendingFocus = `#lv-${CSS.escape(id)}`;
      go('#/learn');
      break;
    }
    case 'open-rule': {
      // Regel als Ereigniskarte im Dialog (index.html, außerhalb von #app – überlebt ein Neuzeichnen).
      const course = cache.get(`course:${app.state?.activeCourseId}`)?.data;
      const unit = course ? findUnit(course, el.dataset.unit) : null;
      const dlg = document.getElementById('rule-dialog');
      if (!unit?.intro || !dlg) break;
      dlg.querySelector('#rule-title').textContent = unit.title;
      dlg.querySelector('#rule-icon').innerHTML = icon('bulb');
      dlg.querySelector('#rule-body').innerHTML = introHtml(unit.intro);
      if (dlg.showModal) dlg.showModal();
      else dlg.setAttribute('open', '');
      break;
    }
    case 'quit-no':
      if (!run) break;
      run.confirmQuit = false;
      pendingFocus = 'h1';
      render();
      break;
    case 'speak': {
      const ex = run && currentItem(run.session)?.ex;
      if (ex?.speak) {
        stopRecognition();
        if (!speak(ex.speak, ex.speakLang, Number(el.dataset.rate) || 1)) announce('Dazu gibt es noch keine Aufnahme.');
      }
      break;
    }
    case 'no-audio':
    case 'no-speak':
      if (run && applyFallback()) {
        announce('Ersatzübung: Übersetze den Satz.');
        pendingFocus = '#answer';
        render();
      }
      break;
    case 'skip-listen-all':
    case 'skip-speak-all':
      if (!run) break;
      run.skip[action === 'skip-listen-all' ? 'listen' : 'speak'] = true;
      if (applyFallback()) {
        announce(action === 'skip-listen-all' ? 'Keine Hörübungen mehr in dieser Runde. Übersetze stattdessen.' : 'Keine Sprechübungen mehr in dieser Runde. Übersetze stattdessen.');
        pendingFocus = '#answer';
        render();
      }
      break;
    case 'rec-start': if (run) startRec(); break;
    case 'rec-stop':
      if (recognizer) recognizer.stop();
      break;
    case 'resubmit': submitRun(); break;
    case 'restart-review':
      run = null;
      render();
      break;
    // --- Einstellungen ---
    case 'logout': doLogout(); break;
    case 'export': doExport(); break;
    case 'confirm-open':
      app.confirm = el.dataset.key;
      app.pendingImport = null;
      app.notice = null;
      pendingFocus = el.dataset.key === 'delete-account'
        ? (app.user.isGuest ? '#confirm-delete-account-no' : '#delete-account-password')
        : `#confirm-${CSS.escape(el.dataset.key)}-no`;
      render();
      break;
    case 'confirm-no': {
      const key = el.dataset.key;
      app.confirm = null;
      if (key === 'import') app.pendingImport = null;
      delete app.forms['delete-account'];
      pendingFocus = key === 'import' ? '.file-btn input' : key === 'logout' ? '[data-key="logout"]' : `[data-action="confirm-open"][data-key="${CSS.escape(key)}"]`;
      render();
      break;
    }
    case 'confirm-yes': confirmYes(el.dataset.key); break;
    default:
  }
}

function onInput(e) {
  if (e.target.id === 'answer' && run) {
    run.ui.text = e.target.value;
    const btn = root.querySelector('[data-action="check"]');
    if (btn) btn.disabled = !canCheck(currentItem(run.session).ex, run.ui);
    return;
  }
  if (parseRoute(currentHash()).name === 'admin' && admin) admin.handleInput?.(e.target, e);
}

function onChange(e) {
  const el = e.target;
  if (parseRoute(currentHash()).name === 'admin' && admin && admin.handleChange(el, e)) return;
  const action = el.dataset.action;
  if (action === 'goal') {
    saveSetting({ dailyGoal: Number(el.value) }, 'goal', `Tagesziel gespeichert: ${Number(el.value) ? `${el.value} XP` : 'kein Ziel'}.`);
  } else if (action === 'setting') {
    const labels = { listening: 'Hörübungen', deviceVoice: 'Computerstimme als Ersatz', speaking: 'Sprechübungen', unlockAll: 'Alle Lektionen freischalten', showReading: 'Aussprachehilfe', reduceMotion: 'Animationen reduzieren', sounds: 'Soundeffekte' };
    saveSetting({ settings: { [el.dataset.key]: el.checked } }, 'settings', `${labels[el.dataset.key] ?? el.dataset.key}: ${el.checked ? 'an' : 'aus'}.`);
  } else if (action === 'filter') {
    app.courseFilter = { ...app.courseFilter, [el.name]: el.value };
    render();
    const n = filterCourses(cache.get('courses')?.data ?? [], app.courseFilter).length;
    announce(`${plural(n, 'Kurs', 'Kurse')} gefunden.`);
  } else if (action === 'import-file') {
    pickImportFile(el);
  }
}

function onSubmit(e) {
  const form = e.target.closest('form');
  if (!form) return;
  e.preventDefault();
  if (parseRoute(currentHash()).name === 'admin' && admin && admin.handleSubmit(form, e)) return;
  switch (form.dataset.form) {
    case 'login': submitLogin(form); break;
    case 'register': submitRegister(form); break;
    case 'onboarding': submitOnboarding(form); break;
    case 'display-name': submitDisplayName(form); break;
    case 'delete-account': submitDeleteAccount(form); break;
    case 'exercise': check(); break;
    default:
  }
}

function onKeydown(e) {
  if (run?.phase === 'intro' && ['lesson', 'checkpoint'].includes(parseRoute(currentHash()).name)) {
    const onButton = e.target.matches?.('button, a, summary, label');
    if (e.key === 'Escape') {
      e.preventDefault();
      quit();
    } else if (e.key === 'Enter' && !onButton && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      introStep(1);
    }
    return;
  }
  if (!run || run.phase !== 'exercise' || !['lesson', 'checkpoint', 'review'].includes(parseRoute(currentHash()).name)) return;
  const item = currentItem(run.session);
  if (!item) return;
  const ex = item.ex;
  const inText = e.target.matches?.('textarea, input, select');
  const onButton = e.target.matches?.('button, a, summary, label');
  if (e.key === 'Escape') {
    e.preventDefault();
    if (run.confirmQuit) {
      run.confirmQuit = false;
      pendingFocus = 'h1';
      render();
    } else {
      quit();
    }
    return;
  }
  if (run.confirmQuit || e.altKey || e.ctrlKey || e.metaKey) return;
  if (run.ui.checked) {
    if (e.key === 'Enter' && !onButton) {
      e.preventDefault();
      next();
    }
    return;
  }
  if (e.key === 'Enter' && (inText ? !e.shiftKey : !onButton)) {
    e.preventDefault();
    check();
    return;
  }
  if (inText) return;
  if ((ex.type === 'choice' || ex.type === 'fill') && /^[1-9]$/.test(e.key)) {
    const choice = ex.choices[Number(e.key) - 1];
    if (choice != null) {
      run.ui.selected = choice;
      pendingFocus = '[data-action="check"]';
      render();
    }
  } else if (ex.type === 'match' && /^[1-9]$/.test(e.key)) {
    const k = Number(e.key) - 1;
    const n = ex.left.length;
    const target = k < n ? ['l', ex.left[k]?.id] : ['r', ex.right[k - n]?.id];
    if (target[1]) {
      e.preventDefault();
      matchClick(target[0], target[1]);
    }
  } else if (ex.type === 'order' && e.key === 'Backspace' && run.ui.picked.length) {
    e.preventDefault();
    run.ui.picked = run.ui.picked.slice(0, -1);
    render();
  }
}

function onHashChange() {
  const dlg = document.getElementById('rule-dialog');
  if (dlg?.open) dlg.close();
  if (flash && flash.hash !== currentHash()) flash = null;
  app.confirm = null;
  app.notice = null;
  app.pendingImport = null;
  // Eingaben in Anmelde-/Registrierformular bleiben erhalten, alte Fehlermeldungen nicht.
  for (const [k, f] of Object.entries(app.forms)) {
    if (k === 'login' || k === 'register') Object.assign(f, { errors: {}, formError: null, busy: false });
    else delete app.forms[k];
  }
  if (parseRoute(currentHash()).name === 'stats') invalidate('stats');
  admin?.onRouteChange?.();
  render();
}

async function boot() {
  app.booting = true;
  app.bootError = null;
  render();
  try {
    const { user } = await api.getMe();
    app.user = user;
    if (user) {
      const { state } = await api.getProgress();
      app.state = state;
      languagesEntry();
    }
  } catch (err) {
    app.bootError = err;
  }
  app.legacy = readLegacyState();
  app.booting = false;
  lastHash = null;
  render();
}

if (root) {
  attachTapRings(root);
  // App-Modus: den Browser bitten, die Daten nicht automatisch aufzuräumen (vor allem Safari auf dem iPhone).
  if (LOCAL) globalThis.navigator?.storage?.persist?.().catch(() => {});
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('hashchange', onHashChange);
  boot();
}
