// Wortweg – App-Modus ohne Server (docs/ARCHITEKTUR.md §9.3): dieselben Funktionen wie src/api.js,
// aber Fortschritt im Browser (localStorage) und Kurse als statische Dateien unter courses/.
// Bewertung und XP rechnen dieselben Engine-Module wie auf dem Server. Kein Konto, kein Netzwerk außer den Kursdateien.

import { ApiError } from './api.js';
import { findLesson, findUnit } from './content.js';
import { buildLesson, buildCheckpoint, buildReviewExercise, lessonItems } from './exercises.js';
import { gradeSubmission } from './session.js';
import {
  STATE_VERSION, DAILY_GOALS, createInitialState, sanitizeState, applyLessonResult, applyCheckpointResult, applyReviewAnswer,
  finishReview, isLessonUnlocked, isCheckpointUnlocked, dueReviewItems, dailyGoalReached, dayKey,
} from './progress.js';

export { ApiError };
export const MODE = 'local';

const STORE_KEY = 'wortweg:app:v2';
const NAME_MAX = 40;

// ---------- Speicher ----------

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function emptyStats() {
  return { lesson: 0, review: 0, checkpoint: 0, total: 0, correct: 0 };
}

/** Liest Profil, Lernstand und Statistik. Kaputte Daten → null (die App bietet dann einen Neustart an). */
function load() {
  const s = storage();
  if (!s) return null;
  let raw;
  try {
    raw = JSON.parse(s.getItem(STORE_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !raw.profile) return null;
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  const stats = emptyStats();
  for (const k of Object.keys(stats)) if (Number.isFinite(st[k]) && st[k] >= 0) stats[k] = st[k];
  return {
    profile: { displayName: cleanName(raw.profile.displayName) || 'Du', createdAt: Number(raw.profile.createdAt) || Date.now() },
    state: sanitizeState(raw.state ?? {}),
    stats,
  };
}

function save(data) {
  const s = storage();
  if (!s) throw new ApiError(507, 'no_storage', 'Dieser Browser erlaubt keinen Speicher (z. B. privater Modus). Fortschritt kann nicht gesichert werden.');
  try {
    s.setItem(STORE_KEY, JSON.stringify({ version: STATE_VERSION, ...data }));
  } catch {
    throw new ApiError(507, 'storage_full', 'Der Speicher des Browsers ist voll. Exportiere deinen Fortschritt und lösche alte Daten.');
  }
  return data;
}

function need() {
  const data = load();
  if (!data) throw new ApiError(401, 'no_profile', 'Bitte starte zuerst.');
  return data;
}

const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, NAME_MAX) : '');
const userOf = (profile) => ({ id: 'local', displayName: profile.displayName, email: null, role: 'learner', isGuest: false, local: true });
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// ---------- Kurse (statisch) ----------

let indexPromise = null;
const coursePromises = new Map();

async function fetchJson(path) {
  let res;
  try {
    res = await globalThis.fetch(path, { cache: 'no-cache' });
  } catch {
    throw new ApiError(0, 'network', 'Kursdaten konnten nicht geladen werden. Bist du offline? Einmal online öffnen, dann geht es auch offline.');
  }
  if (!res.ok) throw new ApiError(res.status, 'not_found', res.status === 404 ? 'Nicht gefunden.' : `Kursdaten nicht ladbar (Status ${res.status}).`);
  return res.json();
}

function loadIndex() {
  indexPromise ??= fetchJson('courses/index.json').catch((err) => {
    indexPromise = null;
    throw err;
  });
  return indexPromise;
}

async function loadCourse(id) {
  const index = await loadIndex();
  const entry = index.courses.find((c) => c.id === id);
  if (!entry) throw new ApiError(404, 'not_found', 'Kurs nicht gefunden.');
  if (!coursePromises.has(id)) {
    coursePromises.set(id, fetchJson(`courses/${entry.file}`).then((course) => ({ ...course, version: course.version ?? 1, status: 'published' }))
      .catch((err) => {
        coursePromises.delete(id);
        throw err;
      }));
  }
  return coursePromises.get(id);
}

// ---------- Konto (lokales Profil) ----------

const noAccounts = () => Promise.reject(new ApiError(400, 'local_mode', 'In der App-Version gibt es keine Konten – dein Fortschritt bleibt auf diesem Gerät.'));

export async function getMe() {
  const data = load();
  return { user: data ? userOf(data.profile) : null };
}

export async function startGuest() {
  const data = load() ?? save({ profile: { displayName: 'Du', createdAt: Date.now() }, state: createInitialState(), stats: emptyStats() });
  return { user: userOf(data.profile) };
}

export const register = noAccounts;
export const login = noAccounts;
export const logout = async () => ({});

/** Löscht alle Wortweg-Daten auf diesem Gerät. */
export async function deleteAccount() {
  try {
    storage()?.removeItem(STORE_KEY);
  } catch { /* nichts zu löschen */ }
  return {};
}

export async function updateAccount(displayName) {
  const data = need();
  const name = cleanName(displayName);
  if (!name) throw new ApiError(400, 'invalid', `Der Name muss 1–${NAME_MAX} Zeichen haben.`, { field: 'displayName' });
  data.profile.displayName = name;
  save(data);
  return { user: userOf(data.profile) };
}

// ---------- Inhalte ----------

export async function getLanguages() {
  return { languages: (await loadIndex()).languages ?? [] };
}

export async function getCourses() {
  const { courses } = await loadIndex();
  return { courses: courses.map(({ file: _f, ...c }) => c) };
}

export async function getCourse(id) {
  return { course: await loadCourse(id) };
}

// ---------- Fortschritt ----------

export async function getProgress() {
  return { state: need().state };
}

export async function saveSettings({ dailyGoal, activeCourseId, settings } = {}) {
  const data = need();
  const next = { ...data.state, settings: { ...data.state.settings } };
  if (dailyGoal !== undefined) {
    if (!DAILY_GOALS.includes(dailyGoal)) throw new ApiError(400, 'invalid', `Tagesziel muss eins von ${DAILY_GOALS.join(', ')} sein.`);
    next.dailyGoal = dailyGoal;
  }
  if (activeCourseId !== undefined) {
    if (activeCourseId !== null) await loadCourse(activeCourseId);
    next.activeCourseId = activeCourseId;
  }
  if (settings !== undefined) {
    if (!isObj(settings)) throw new ApiError(400, 'invalid', 'settings muss ein Objekt sein.');
    for (const [k, v] of Object.entries(settings)) {
      if (!Object.hasOwn(data.state.settings, k) || typeof v !== 'boolean') throw new ApiError(400, 'invalid', `Unbekannte Einstellung: ${k}`);
      next.settings[k] = v;
    }
  }
  data.state = next;
  save(data);
  return { state: data.state };
}

const options = (o) => ({ listening: o?.listening === true, speaking: o?.speaking === true });

function finish(data, kind, sum, res, before, now) {
  data.state = res.state;
  data.stats[kind] += 1;
  data.stats.total += sum.total;
  data.stats.correct += sum.firstTryCorrect;
  save(data);
  const result = {
    xp: res.xp, total: sum.total, firstTryCorrect: sum.firstTryCorrect, accuracy: sum.accuracy, wrongRefs: sum.wrongRefs,
    goalJustReached: !before && dailyGoalReached(data.state, now),
  };
  return { state: data.state, result };
}

export async function submitLesson({ courseId, lessonId, seed, options: opts, responses }) {
  const course = await loadCourse(courseId);
  const lesson = findLesson(course, lessonId);
  if (!lesson) throw new ApiError(404, 'not_found', 'Lektion nicht gefunden.');
  const data = need();
  if (!isLessonUnlocked(data.state, course, lesson.id)) throw new ApiError(403, 'locked', 'Diese Lektion ist noch gesperrt.');
  const now = Date.now();
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed, ...options(opts) });
  const sum = gradeSubmission(exercises, isObj(responses) ? responses : {}, course);
  const before = dailyGoalReached(data.state, now);
  const res = applyLessonResult(data.state, {
    courseId: course.id, lessonId: lesson.id, total: sum.total, firstTryCorrect: sum.firstTryCorrect,
    items: lessonItems(lesson.unit, lesson.index), wrongRefs: sum.wrongRefs, now,
  });
  return finish(data, 'lesson', sum, res, before, now);
}

export async function submitCheckpoint({ courseId, levelId, seed, options: opts, responses }) {
  const course = await loadCourse(courseId);
  const level = course.levels.find((l) => l.id === levelId);
  if (!level) throw new ApiError(404, 'not_found', 'Abschnitt nicht gefunden.');
  const data = need();
  if (!isCheckpointUnlocked(data.state, course, level.id)) throw new ApiError(403, 'locked', 'Dieser Checkpoint ist noch gesperrt.');
  const now = Date.now();
  const exercises = buildCheckpoint(course, level, { seed, ...options(opts) });
  const sum = gradeSubmission(exercises, isObj(responses) ? responses : {}, course);
  const before = dailyGoalReached(data.state, now);
  const res = applyCheckpointResult(data.state, { courseId: course.id, levelId: level.id, total: sum.total, firstTryCorrect: sum.firstTryCorrect, wrongRefs: sum.wrongRefs, now });
  const out = finish(data, 'checkpoint', sum, res, before, now);
  return { ...out, result: { ...out.result, passed: res.passed } };
}

export async function submitReview({ courseId, responses }) {
  const course = await loadCourse(courseId);
  const data = need();
  const answers = isObj(responses) ? responses : {};
  const now = Date.now();
  const due = dueReviewItems(data.state, course.id, now, 99).filter((it) => answers[`review:${it.key}`]);
  if (!due.length) throw new ApiError(400, 'nothing_due', 'Keine der Antworten gehört zu einer fälligen Wiederholung.');
  const exercises = due.map((it) => buildReviewExercise(course, it, { seed: it.seen, box: it.box })).filter(Boolean);
  const sum = gradeSubmission(exercises, answers, course);
  let state = data.state;
  for (const ex of exercises) state = applyReviewAnswer(state, ex.id.slice('review:'.length), Boolean(sum.results[ex.id]?.firstTry), now);
  const before = dailyGoalReached(state, now);
  return finish(data, 'review', sum, finishReview(state, sum.firstTryCorrect, now), before, now);
}

export async function exportProgress() {
  const data = need();
  const now = Date.now();
  return {
    data: { app: 'wortweg', version: STATE_VERSION, exportedAt: new Date(now).toISOString(), state: data.state },
    filename: `wortweg-fortschritt-${dayKey(now)}.json`,
  };
}

export async function importProgress(file) {
  const data = need();
  if (!isObj(file) || file.app !== 'wortweg' || !isObj(file.state)) throw new ApiError(400, 'invalid_import', 'Die Datei ist kein Wortweg-Export.');
  if (typeof file.version !== 'number' || file.version > STATE_VERSION) throw new ApiError(400, 'invalid_import', 'Der Export stammt von einer neueren App-Version.');
  data.state = sanitizeState(file.state);
  save(data);
  return { state: data.state };
}

export async function resetProgress() {
  const data = need();
  const keep = data.state;
  data.state = { ...createInitialState(), activeCourseId: keep.activeCourseId, settings: keep.settings, dailyGoal: keep.dailyGoal };
  data.stats = emptyStats();
  save(data);
  return { state: data.state };
}

export async function getStats() {
  const { state, stats } = need();
  const days = Object.entries(state.xpByDay).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-30).map(([day, xp]) => ({ day, xp }));
  const items = Object.values(state.review);
  const hard = items.filter((it) => it.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || (a.due ?? Infinity) - (b.due ?? Infinity)).slice(0, 10);
  const hardItems = [];
  for (const it of hard) {
    const course = await loadCourse(it.courseId).catch(() => null);
    const unit = course ? findUnit(course, it.unitId) : null;
    const item = unit ? (it.kind === 'w' ? unit.words : unit.sentences)[it.index] : null;
    if (item) hardItems.push({ courseId: it.courseId, kind: it.kind, unitId: it.unitId, index: it.index, wrong: it.wrong, box: it.box, native: item.native[0], target: item.target[0] });
  }
  return {
    stats: {
      days,
      attempts: { lesson: stats.lesson, review: stats.review, checkpoint: stats.checkpoint },
      accuracy: stats.total ? stats.correct / stats.total : null,
      answered: stats.total,
      hardItems,
      items: { learning: items.filter((it) => it.due != null).length, mastered: items.filter((it) => it.due == null).length },
    },
  };
}

// ---------- Admin gibt es nur im Server-Modus ----------

const adminOnly = () => Promise.reject(new ApiError(403, 'local_mode', 'Der Kurs-Editor gibt es nur in der Server-Version.'));
export const adminOverview = adminOnly;
