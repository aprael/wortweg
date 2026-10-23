// Fortschritt, XP, Tagesziel, Serie und Wiederholung. Reine Funktionen: Zustand rein, Zustand raus.

import { listLessons, lessonCount, coursePath } from './content.js';
import { itemKey } from './exercises.js';

export const STATE_VERSION = 2;
/** Checkpoint bestanden ab diesem Anteil richtiger Antworten im ersten Versuch. */
export const CHECKPOINT_PASS = 0.8;
export const DAILY_GOALS = [0, 10, 20, 30, 50];
/** Leitner-Intervalle in Tagen je Box (Box 0 = sofort fällig). */
export const REVIEW_INTERVALS = [0, 1, 3, 7, 14, 30];
export const MASTERED_BOX = REVIEW_INTERVALS.length;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createInitialState() {
  return {
    version: STATE_VERSION,
    activeCourseId: null,
    xpTotal: 0,
    xpByDay: {},
    dailyGoal: 20,
    streak: { current: 0, best: 0, lastDay: null },
    courses: {},
    review: {},
    // Sprechen nur nach Opt-in: die Spracherkennung mancher Browser schickt Audio an fremde Server.
    settings: { listening: true, deviceVoice: false, speaking: false, unlockAll: false, showReading: true, reduceMotion: false, sounds: true },
  };
}

/** Lokales Datum als YYYY-MM-DD. */
export function dayKey(now) {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function previousDayKey(now) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}

export function xpToday(state, now) {
  return state.xpByDay[dayKey(now)] ?? 0;
}

/** Angezeigte Serie: zählt nur, wenn heute oder gestern gelernt wurde. Keine Strafen, nur Zählung. */
export function displayStreak(state, now) {
  const { lastDay, current } = state.streak;
  if (lastDay === dayKey(now) || lastDay === previousDayKey(now)) return current;
  return 0;
}

export function dailyGoalReached(state, now) {
  return state.dailyGoal > 0 && xpToday(state, now) >= state.dailyGoal;
}

function bumpStreak(streak, now) {
  const today = dayKey(now);
  if (streak.lastDay === today) return streak;
  const current = streak.lastDay === previousDayKey(now) ? streak.current + 1 : 1;
  return { current, best: Math.max(streak.best, current), lastDay: today };
}

function addXp(state, xp, now) {
  const key = dayKey(now);
  return {
    ...state,
    xpTotal: state.xpTotal + xp,
    xpByDay: { ...state.xpByDay, [key]: (state.xpByDay[key] ?? 0) + xp },
    streak: bumpStreak(state.streak, now),
  };
}

/** XP einer Lektion: 1 je richtig im ersten Versuch, +5 fürs Abschließen, +5 ohne Fehler. */
export function lessonXp(firstTryCorrect, total) {
  return firstTryCorrect + 5 + (firstTryCorrect === total && total > 0 ? 5 : 0);
}

/** XP eines Checkpoints: 1 je richtig im ersten Versuch, +10 beim Bestehen. */
export function checkpointXp(firstTryCorrect, passed) {
  return firstTryCorrect + (passed ? 10 : 0);
}

/** XP einer Wiederholung: 1 je richtig im ersten Versuch, +2 fürs Abschließen. */
export function reviewXp(firstTryCorrect) {
  return firstTryCorrect + 2;
}

function scheduleItem(existing, { courseId, ref }, box, now) {
  return {
    courseId,
    kind: ref.kind,
    unitId: ref.unitId,
    index: ref.index,
    box,
    due: now + REVIEW_INTERVALS[Math.min(box, REVIEW_INTERVALS.length - 1)] * DAY_MS,
    wrong: (existing?.wrong ?? 0),
    seen: (existing?.seen ?? 0) + 1,
  };
}

function courseEntry(state, courseId) {
  return { completed: {}, checkpoints: {}, ...state.courses[courseId] };
}

/** Plant Lernobjekte ein: falsche → Box 0 (sofort fällig), neue richtige → Box 1, bekannte richtige bleiben. */
function scheduleRefs(oldReview, courseId, items, wrongRefs, now) {
  const review = { ...oldReview };
  const wrongKeys = new Set(wrongRefs.map((r) => itemKey(courseId, r)));
  for (const ref of items) {
    const key = itemKey(courseId, ref);
    const existing = review[key];
    if (wrongKeys.has(key)) {
      review[key] = { ...scheduleItem(existing, { courseId, ref }, 0, now), wrong: (existing?.wrong ?? 0) + 1 };
    } else if (!existing) {
      review[key] = scheduleItem(existing, { courseId, ref }, 1, now);
    }
  }
  for (const ref of wrongRefs) {
    const key = itemKey(courseId, ref);
    if (!review[key]) review[key] = { ...scheduleItem(undefined, { courseId, ref }, 0, now), wrong: 1 };
  }
  return review;
}

/**
 * Wendet ein Lektionsergebnis an.
 * @param {object} state
 * @param {{courseId: string, lessonId: string, total: number, firstTryCorrect: number,
 *          items: Array<{kind,unitId,index}>, wrongRefs: Array<{kind,unitId,index}>, now: number}} result
 * @returns {{state: object, xp: number}}
 */
export function applyLessonResult(state, { courseId, lessonId, total, firstTryCorrect, items, wrongRefs, now }) {
  const xp = lessonXp(firstTryCorrect, total);
  const course = courseEntry(state, courseId);
  const prev = course.completed[lessonId];
  const score = total > 0 ? firstTryCorrect / total : 0;
  const completed = {
    ...course.completed,
    [lessonId]: {
      completions: (prev?.completions ?? 0) + 1,
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      lastAt: now,
    },
  };
  const review = scheduleRefs(state.review, courseId, items, wrongRefs, now);
  const next = addXp({ ...state, courses: { ...state.courses, [courseId]: { ...course, completed } }, review }, xp, now);
  return { state: next, xp };
}

/**
 * Wendet ein Checkpoint-Ergebnis an. Bestanden ab CHECKPOINT_PASS; Fehlversuche kosten nichts.
 * Falsche Refs kommen in Wiederholungs-Box 0.
 * @param {{courseId: string, levelId: string, total: number, firstTryCorrect: number,
 *          wrongRefs: Array<{kind,unitId,index}>, now: number}} result
 * @returns {{state: object, xp: number, passed: boolean}}
 */
export function applyCheckpointResult(state, { courseId, levelId, total, firstTryCorrect, wrongRefs, now }) {
  const score = total > 0 ? firstTryCorrect / total : 0;
  const passed = total > 0 && score >= CHECKPOINT_PASS;
  const xp = checkpointXp(firstTryCorrect, passed);
  const course = courseEntry(state, courseId);
  const prev = course.checkpoints[levelId];
  const checkpoints = {
    ...course.checkpoints,
    [levelId]: {
      passed: Boolean(prev?.passed) || passed,
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      attempts: (prev?.attempts ?? 0) + 1,
      lastAt: now,
    },
  };
  // Falsche Refs als „items“ übergeben: so landen auch schon bekannte Objekte wieder in Box 0.
  const review = scheduleRefs(state.review, courseId, wrongRefs, wrongRefs, now);
  const next = addXp({ ...state, courses: { ...state.courses, [courseId]: { ...course, checkpoints } }, review }, xp, now);
  return { state: next, xp, passed };
}

/** Fällige Wiederholungen eines Kurses, die ältesten zuerst. */
export function dueReviewItems(state, courseId, now, limit = 10) {
  return Object.entries(state.review)
    .filter(([, it]) => it.courseId === courseId && it.box < MASTERED_BOX && it.due != null && it.due <= now)
    .sort((a, b) => a[1].due - b[1].due || b[1].wrong - a[1].wrong)
    .slice(0, limit)
    .map(([key, it]) => ({ key, ...it }));
}

/** Eine Wiederholungsantwort: richtig → nächste Box, falsch → zurück auf Box 0. */
export function applyReviewAnswer(state, key, correct, now) {
  const it = state.review[key];
  if (!it) return state;
  const box = correct ? Math.min(it.box + 1, MASTERED_BOX) : 0;
  const due = box >= MASTERED_BOX ? null : now + REVIEW_INTERVALS[box] * DAY_MS;
  return {
    ...state,
    review: { ...state.review, [key]: { ...it, box, due, wrong: it.wrong + (correct ? 0 : 1), seen: it.seen + 1 } },
  };
}

export function finishReview(state, firstTryCorrect, now) {
  const xp = reviewXp(firstTryCorrect);
  return { state: addXp(state, xp, now), xp };
}

export function isLessonCompleted(state, courseId, lessonId) {
  return Boolean(state.courses[courseId]?.completed?.[lessonId]);
}

export function isCheckpointPassed(state, courseId, levelId) {
  return Boolean(state.courses[courseId]?.checkpoints?.[levelId]?.passed);
}

/** Lektionen eines Abschnitts in Lernpfad-Reihenfolge (gecacht). */
function levelLessons(course, levelId) {
  return coursePath(course).levelLessons.get(levelId) ?? [];
}

/**
 * Freischaltung: der Reihe nach innerhalb eines Abschnitts. Die erste Lektion eines Abschnitts braucht den
 * bestandenen Checkpoint des vorherigen Abschnitts; ein bestandener Checkpoint öffnet seinen ganzen Abschnitt.
 */
export function isLessonUnlocked(state, course, lessonId) {
  const path = coursePath(course);
  const lesson = path.byId.get(lessonId);
  if (!lesson) return false;
  if (state.settings.unlockAll) return true;
  if (isCheckpointPassed(state, course.id, lesson.levelId)) return true;
  const prev = path.lessons[lesson.pos - 1];
  if (prev && prev.levelId === lesson.levelId) return isLessonCompleted(state, course.id, prev.id);
  const li = path.levelIndex.get(lesson.levelId);
  return li === 0 || isCheckpointPassed(state, course.id, course.levels[li - 1].id);
}

/** Checkpoint frei, sobald die erste Lektion seines Abschnitts frei ist (auch zum Überspringen). */
export function isCheckpointUnlocked(state, course, levelId) {
  const first = levelLessons(course, levelId)[0];
  return first ? isLessonUnlocked(state, course, first.id) : false;
}

/** Als erledigt gilt eine Lektion, wenn sie abgeschlossen oder ihr Abschnitt per Checkpoint bestanden ist. */
function isLessonDone(state, course, lesson) {
  return isLessonCompleted(state, course.id, lesson.id) || isCheckpointPassed(state, course.id, lesson.levelId);
}

/** Nächste offene, freigeschaltete Lektion (Abschnitte mit bestandenem Checkpoint werden übersprungen). */
export function nextLesson(state, course) {
  return listLessons(course).find((l) => !isLessonDone(state, course, l) && isLessonUnlocked(state, course, l.id)) ?? null;
}

/**
 * „Weiterlernen“: im ersten Abschnitt ohne bestandenen Checkpoint die erste offene, freie Lektion –
 * sind dort alle Lektionen erledigt, der Checkpoint. Alles bestanden → null.
 * @returns {{kind: 'lesson', lesson: object} | {kind: 'checkpoint', level: object} | null}
 */
export function nextStep(state, course) {
  for (const level of course.levels) {
    if (isCheckpointPassed(state, course.id, level.id)) continue;
    const lesson = levelLessons(course, level.id)
      .find((l) => !isLessonCompleted(state, course.id, l.id) && isLessonUnlocked(state, course, l.id));
    if (lesson) return { kind: 'lesson', lesson };
    return isCheckpointUnlocked(state, course, level.id) ? { kind: 'checkpoint', level } : null;
  }
  return null;
}

export function courseProgress(state, course) {
  const lessons = listLessons(course);
  const done = lessons.filter((l) => isLessonDone(state, course, l)).length;
  return { done, total: lessons.length, percent: lessons.length ? Math.round((done / lessons.length) * 100) : 0 };
}

export function unitProgress(state, course, unit) {
  const n = lessonCount(unit);
  const level = coursePath(course).levelOfUnit.get(unit.id);
  if (level && isCheckpointPassed(state, course.id, level.id)) return { done: n, total: n };
  let done = 0;
  for (let i = 0; i < n; i++) if (isLessonCompleted(state, course.id, `${unit.id}:${i}`)) done++;
  return { done, total: n };
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}
/** Schlüssel aus fremden Daten: Text mit begrenzter Länge, keine Prototyp-Namen. */
const safeKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(k);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

/**
 * Bereinigt geladene/importierte Daten (Zustand v1 oder v2): unbekannte oder kaputte Felder werden auf
 * Standardwerte gesetzt. Ergebnis ist immer Zustand v2.
 */
export function sanitizeState(raw) {
  const base = createInitialState();
  if (!isPlainObject(raw)) return base;
  const out = { ...base };
  out.activeCourseId = typeof raw.activeCourseId === 'string' ? raw.activeCourseId : null;
  out.xpTotal = num(raw.xpTotal);
  out.xpByDay = {};
  if (isPlainObject(raw.xpByDay)) {
    for (const [k, v] of Object.entries(raw.xpByDay)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out.xpByDay[k] = num(v);
  }
  out.dailyGoal = DAILY_GOALS.includes(raw.dailyGoal) ? raw.dailyGoal : base.dailyGoal;
  if (isPlainObject(raw.streak)) {
    out.streak = {
      current: num(raw.streak.current),
      best: num(raw.streak.best),
      lastDay: typeof raw.streak.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.streak.lastDay) ? raw.streak.lastDay : null,
    };
  }
  if (isPlainObject(raw.courses)) {
    for (const [cid, c] of Object.entries(raw.courses)) {
      // v1 kennt nur completed, v2 zusätzlich checkpoints; ein Kurs braucht mindestens eins davon.
      if (!safeKey(cid) || !isPlainObject(c) || (!isPlainObject(c.completed) && !isPlainObject(c.checkpoints))) continue;
      const completed = {};
      for (const [lid, l] of Object.entries(isPlainObject(c.completed) ? c.completed : {})) {
        if (!safeKey(lid) || !isPlainObject(l)) continue;
        completed[lid] = { completions: num(l.completions, 1), bestScore: Math.min(1, num(l.bestScore)), lastAt: num(l.lastAt) };
      }
      const checkpoints = {};
      for (const [lvl, cp] of Object.entries(isPlainObject(c.checkpoints) ? c.checkpoints : {})) {
        if (!safeKey(lvl) || !isPlainObject(cp)) continue;
        checkpoints[lvl] = {
          passed: cp.passed === true,
          bestScore: Math.min(1, num(cp.bestScore)),
          attempts: Math.floor(num(cp.attempts, 1)),
          lastAt: num(cp.lastAt),
        };
      }
      out.courses[cid] = { completed, checkpoints };
    }
  }
  if (isPlainObject(raw.review)) {
    for (const [key, it] of Object.entries(raw.review)) {
      if (!safeKey(key) || !isPlainObject(it) || (it.kind !== 'w' && it.kind !== 's') || typeof it.unitId !== 'string' || typeof it.courseId !== 'string') continue;
      out.review[key] = {
        courseId: it.courseId,
        kind: it.kind,
        unitId: it.unitId,
        index: Math.floor(num(it.index)),
        box: Math.min(MASTERED_BOX, Math.floor(num(it.box))),
        due: it.due === null ? null : num(it.due),
        wrong: num(it.wrong),
        seen: num(it.seen),
      };
    }
  }
  if (isPlainObject(raw.settings)) {
    out.settings = {
      listening: raw.settings.listening !== false,
      deviceVoice: raw.settings.deviceVoice === true,
      speaking: raw.settings.speaking === true,
      unlockAll: raw.settings.unlockAll === true,
      showReading: raw.settings.showReading !== false,
      reduceMotion: raw.settings.reduceMotion === true,
      sounds: raw.settings.sounds !== false,
    };
  }
  return out;
}
