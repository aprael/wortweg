import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, applyLessonResult, dueReviewItems, applyReviewAnswer, finishReview, displayStreak,
  xpToday, dailyGoalReached, isLessonUnlocked, nextLesson, courseProgress, lessonXp, sanitizeState, MASTERED_BOX,
  STATE_VERSION, CHECKPOINT_PASS, applyCheckpointResult, isCheckpointUnlocked, isCheckpointPassed, nextStep, unitProgress,
  isLessonCompleted,
} from '../src/progress.js';
import { listLessons } from '../src/content.js';
import { lessonItems } from '../src/exercises.js';
import { createSession, recordAnswer, advance, isFinished, currentItem, summarize } from '../src/session.js';
import { loadCourse, T0, DAY } from './helpers.mjs';

const course = loadCourse('de-en.json');
const lessons = listLessons(course);

function complete(state, lesson, now, { total = 9, firstTryCorrect = 9, wrongRefs = [] } = {}) {
  return applyLessonResult(state, {
    courseId: course.id, lessonId: lesson.id, total, firstTryCorrect,
    items: lessonItems(lesson.unit, lesson.index), wrongRefs, now,
  });
}

test('XP-Berechnung', () => {
  assert.equal(lessonXp(9, 9), 19);
  assert.equal(lessonXp(7, 9), 12);
});

test('Lernpfad: nur erste Lektion offen, danach der Reihe nach', () => {
  let s = createInitialState();
  assert.equal(isLessonUnlocked(s, course, lessons[0].id), true);
  assert.equal(isLessonUnlocked(s, course, lessons[1].id), false);
  assert.equal(nextLesson(s, course).id, lessons[0].id);
  s = complete(s, lessons[0], T0).state;
  assert.equal(isLessonUnlocked(s, course, lessons[1].id), true);
  assert.equal(nextLesson(s, course).id, lessons[1].id);
  assert.deepEqual(courseProgress(s, course), { done: 1, total: lessons.length, percent: Math.round(100 / lessons.length) });
  s = { ...s, settings: { ...s.settings, unlockAll: true } };
  assert.equal(isLessonUnlocked(s, course, lessons.at(-1).id), true);
});

test('Abschluss: XP, Tagesziel, Bestwert und Wiederholungen', () => {
  let s = createInitialState();
  const wrong = [{ kind: 'w', unitId: lessons[0].unitId, index: 1 }];
  const res = complete(s, lessons[0], T0, { firstTryCorrect: 8, wrongRefs: wrong });
  s = res.state;
  assert.equal(res.xp, 13);
  assert.equal(xpToday(s, T0), 13);
  assert.equal(dailyGoalReached(s, T0), false);
  s = complete(s, lessons[0], T0 + 1000).state;
  assert.equal(dailyGoalReached(s, T0), true);
  const rec = s.courses[course.id].completed[lessons[0].id];
  assert.equal(rec.completions, 2);
  assert.equal(rec.bestScore, 1);
  // Falsches Wort ist sofort fällig, der Rest erst morgen.
  const dueNow = dueReviewItems(s, course.id, T0 + 2000);
  assert.equal(dueNow.length, 1);
  assert.equal(dueNow[0].index, 1);
  assert.equal(dueReviewItems(s, course.id, T0 + DAY + 1).length, lessonItems(lessons[0].unit, 0).length);
});

test('Serie: Folgetage zählen hoch, Pause setzt nur die Anzeige zurück (keine Strafe)', () => {
  let s = createInitialState();
  s = complete(s, lessons[0], T0).state;
  assert.equal(displayStreak(s, T0), 1);
  s = complete(s, lessons[1], T0 + DAY).state;
  assert.equal(displayStreak(s, T0 + DAY), 2);
  assert.equal(displayStreak(s, T0 + 2 * DAY), 2, 'gestern gelernt → Serie noch sichtbar');
  assert.equal(displayStreak(s, T0 + 3 * DAY), 0);
  const xpBefore = s.xpTotal;
  s = complete(s, lessons[2], T0 + 3 * DAY).state;
  assert.equal(s.streak.current, 1);
  assert.equal(s.streak.best, 2);
  assert.ok(s.xpTotal > xpBefore, 'XP gehen nie verloren');
});

test('Wiederholung: Leitner-Boxen, falsch → zurück, Meister → nicht mehr fällig', () => {
  let s = complete(createInitialState(), lessons[0], T0, { firstTryCorrect: 8, wrongRefs: [{ kind: 's', unitId: lessons[0].unitId, index: 0 }] }).state;
  const [item] = dueReviewItems(s, course.id, T0);
  assert.equal(item.box, 0);
  s = applyReviewAnswer(s, item.key, true, T0);
  assert.equal(s.review[item.key].box, 1);
  assert.equal(dueReviewItems(s, course.id, T0).length, 0);
  s = applyReviewAnswer(s, item.key, false, T0 + DAY);
  assert.equal(s.review[item.key].box, 0);
  assert.equal(s.review[item.key].wrong, 2);
  for (let i = 0; i < MASTERED_BOX; i++) s = applyReviewAnswer(s, item.key, true, T0 + DAY);
  assert.equal(s.review[item.key].box, MASTERED_BOX);
  assert.ok(!dueReviewItems(s, course.id, T0 + 1000 * DAY).some((x) => x.key === item.key));
  const r = finishReview(s, 3, T0);
  assert.equal(r.xp, 5);
});

test('Sitzung: falsche Antwort kommt einmal ans Ende; Auswertung zählt ersten Versuch', () => {
  const exs = [1, 2, 3].map((n) => ({ id: `e${n}`, ref: { kind: 'w', unitId: 'u', index: n } }));
  let s = createSession(exs);
  s = advance(recordAnswer(s, true));
  s = advance(recordAnswer(s, false)); // e2 falsch → wird wiederholt
  s = advance(recordAnswer(s, true));
  assert.equal(isFinished(s), false);
  assert.equal(currentItem(s).ex.id, 'e2');
  assert.equal(currentItem(s).retry, true);
  s = advance(recordAnswer(s, false)); // auch im zweiten Versuch falsch → keine Endlosschleife
  assert.equal(isFinished(s), true);
  const sum = summarize(s);
  assert.equal(sum.firstTryCorrect, 2);
  assert.deepEqual(sum.wrongRefs, [{ kind: 'w', unitId: 'u', index: 2 }]);
});

test('sanitizeState repariert fremde oder kaputte Daten', () => {
  assert.deepEqual(sanitizeState(null), createInitialState());
  const s = sanitizeState({ xpTotal: -5, dailyGoal: 999, xpByDay: { evil: 3, '2026-10-17': 4 }, review: { a: { kind: 'x' } }, settings: { unlockAll: 'ja' } });
  assert.equal(s.xpTotal, 0);
  assert.equal(s.dailyGoal, 20);
  assert.deepEqual(s.xpByDay, { '2026-10-17': 4 });
  assert.deepEqual(s.review, {});
  assert.equal(s.settings.unlockAll, false);
});

// --- Zustand v2: Checkpoints -------------------------------------------------------------------------

const [L1, L2, L3] = course.levels;
const inLevel = (level) => lessons.filter((l) => l.levelId === level.id);
const checkpoint = (state, level, firstTryCorrect, { total = 10, wrongRefs = [], now = T0 } = {}) =>
  applyCheckpointResult(state, { courseId: course.id, levelId: level.id, total, firstTryCorrect, wrongRefs, now });
function completeLevel(state, level, now = T0) {
  for (const l of inLevel(level)) state = complete(state, l, now).state;
  return state;
}

test('Zustand v2: Version, Checkpoint-Grenze, Sprechen standardmäßig aus', () => {
  const s = createInitialState();
  assert.equal(STATE_VERSION, 2);
  assert.equal(s.version, 2);
  assert.equal(CHECKPOINT_PASS, 0.8);
  assert.equal(s.settings.speaking, false);
  const after = complete(s, lessons[0], T0).state;
  assert.deepEqual(after.courses[course.id].checkpoints, {});
});

test('Freischaltung: nächster Abschnitt erst nach bestandenem Checkpoint', () => {
  let s = completeLevel(createInitialState(), L1);
  const firstL2 = inLevel(L2)[0];
  assert.equal(isLessonUnlocked(s, course, firstL2.id), false, 'alle Lektionen von A1 reichen nicht');
  assert.equal(nextLesson(s, course), null);
  assert.deepEqual(nextStep(s, course), { kind: 'checkpoint', level: L1 });
  assert.equal(isCheckpointUnlocked(s, course, L1.id), true);
  assert.equal(isCheckpointUnlocked(s, course, L2.id), false);
  s = checkpoint(s, L1, 9).state;
  assert.equal(isCheckpointPassed(s, course.id, L1.id), true);
  assert.equal(isLessonUnlocked(s, course, firstL2.id), true);
  assert.equal(isLessonUnlocked(s, course, inLevel(L2)[1].id), false, 'innerhalb des Abschnitts der Reihe nach');
  assert.equal(isCheckpointUnlocked(s, course, L2.id), true);
  assert.equal(nextLesson(s, course).id, firstL2.id);
  assert.deepEqual(nextStep(s, course), { kind: 'lesson', lesson: nextLesson(s, course) });
});

test('Überspringen: Checkpoint ist sofort frei und öffnet bestanden den ganzen Abschnitt', () => {
  let s = createInitialState();
  assert.equal(isCheckpointUnlocked(s, course, L1.id), true, 'erste Lektion frei → Checkpoint frei');
  assert.deepEqual(nextStep(s, course), { kind: 'lesson', lesson: lessons[0] });
  s = checkpoint(s, L1, 8).state; // genau 80 % → bestanden
  assert.equal(isCheckpointPassed(s, course.id, L1.id), true);
  for (const l of inLevel(L1)) assert.equal(isLessonUnlocked(s, course, l.id), true, l.id);
  assert.equal(isLessonCompleted(s, course.id, lessons[0].id), false, 'Überspringen schließt nichts ab');
  assert.equal(isLessonUnlocked(s, course, inLevel(L2)[0].id), true);
  assert.equal(nextLesson(s, course).id, inLevel(L2)[0].id, 'Weiterlernen springt in den nächsten Abschnitt');
  assert.equal(courseProgress(s, course).done, inLevel(L1).length, 'übersprungene Lektionen zählen als erledigt');
  assert.deepEqual(unitProgress(s, course, L1.units[0]), { done: 3, total: 3 });
  // Auch den zweiten Abschnitt überspringen; der dritte (B1) öffnet sich.
  s = checkpoint(s, L2, 10).state;
  assert.equal(isLessonUnlocked(s, course, inLevel(L3)[0].id), true);
  assert.equal(isLessonUnlocked(s, course, inLevel(L3)[1].id), false);
  s = checkpoint(s, L3, 10).state;
  assert.equal(nextStep(s, course), null, 'alles bestanden');
  assert.equal(nextLesson(s, course), null);
  assert.equal(courseProgress(s, course).percent, 100);
});

test('applyCheckpointResult: XP, Bestehen ab 80 %, beliebig wiederholbar, falsche Refs → Box 0', () => {
  const ref = { kind: 'w', unitId: L1.units[0].id, index: 0 };
  let s = complete(createInitialState(), lessons[0], T0).state;
  const key = `${course.id}|w|${ref.unitId}|0`;
  assert.equal(s.review[key].box, 1);
  const xpBefore = s.xpTotal;
  const fail = checkpoint(s, L1, 7, { wrongRefs: [ref, { kind: 's', unitId: L1.units[1].id, index: 2 }], now: T0 + DAY });
  assert.equal(fail.passed, false);
  assert.equal(fail.xp, 7, 'Fehlversuch kostet nichts, nur kein Bonus');
  s = fail.state;
  assert.equal(s.xpTotal, xpBefore + 7);
  assert.equal(s.review[key].box, 0, 'bekanntes Wort zurück in Box 0');
  assert.equal(s.review[key].wrong, 1);
  assert.equal(s.review[`${course.id}|s|${L1.units[1].id}|2`].box, 0, 'neues Objekt in Box 0');
  assert.deepEqual(s.courses[course.id].checkpoints[L1.id], { passed: false, bestScore: 0.7, attempts: 1, lastAt: T0 + DAY });
  assert.ok(s.courses[course.id].completed[lessons[0].id], 'Lektionsfortschritt bleibt');
  const pass = checkpoint(s, L1, 9, { now: T0 + 2 * DAY });
  assert.equal(pass.passed, true);
  assert.equal(pass.xp, 19);
  s = checkpoint(pass.state, L1, 2, { now: T0 + 3 * DAY }).state;
  assert.deepEqual(s.courses[course.id].checkpoints[L1.id], { passed: true, bestScore: 0.9, attempts: 3, lastAt: T0 + 3 * DAY },
    'einmal bestanden bleibt bestanden');
  assert.equal(checkpoint(createInitialState(), L1, 0, { total: 0 }).passed, false);
  assert.equal(checkpoint(createInitialState(), L1, 9, { total: 12 }).passed, false, '75 % reichen nicht');
});

test('unlockAll öffnet alle Lektionen und Checkpoints; unbekannte IDs sind nie frei', () => {
  const s = { ...createInitialState(), settings: { ...createInitialState().settings, unlockAll: true } };
  for (const level of course.levels) assert.equal(isCheckpointUnlocked(s, course, level.id), true);
  assert.equal(isLessonUnlocked(s, course, inLevel(L3).at(-1).id), true);
  assert.equal(isLessonUnlocked(createInitialState(), course, 'gibt-es-nicht:0'), false);
  assert.equal(isCheckpointUnlocked(s, course, 'gibt-es-nicht'), false);
});

test('sanitizeState: v1-Zustand wird zu v2 (ohne Datenverlust)', () => {
  const v1 = {
    version: 1, activeCourseId: course.id, xpTotal: 40, xpByDay: { '2026-10-17': 40 }, dailyGoal: 30,
    streak: { current: 2, best: 3, lastDay: '2026-10-17' },
    courses: { [course.id]: { completed: { [lessons[0].id]: { completions: 2, bestScore: 0.9, lastAt: T0 } } } },
    review: { [`${course.id}|w|${lessons[0].unitId}|1`]: { courseId: course.id, kind: 'w', unitId: lessons[0].unitId, index: 1, box: 2, due: T0, wrong: 1, seen: 3 } },
    settings: { listening: false, unlockAll: false, reduceMotion: true },
  };
  const s = sanitizeState(v1);
  assert.equal(s.version, 2);
  assert.deepEqual(s.courses[course.id], { completed: v1.courses[course.id].completed, checkpoints: {} });
  assert.deepEqual(s.review, v1.review);
  assert.deepEqual(s.settings, { listening: false, deviceVoice: false, speaking: false, unlockAll: false, showReading: true, reduceMotion: true, sounds: true });
  assert.equal(s.xpTotal, 40);
  assert.equal(isLessonUnlocked(s, course, lessons[1].id), true);
  assert.deepEqual(sanitizeState(s), s, 'idempotent');
});

test('sanitizeState: v2 mit Checkpoints bleibt erhalten, kaputte Felder werden verworfen', () => {
  let played = complete(createInitialState(), lessons[0], T0).state;
  played = checkpoint(played, L1, 9).state;
  played = { ...played, settings: { ...played.settings, speaking: true } };
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(played))), played, 'Rundlauf über JSON');
  const raw = JSON.parse(`{
    "version": 2,
    "courses": {
      "a": { "checkpoints": { "a1": { "passed": "ja", "bestScore": 5, "attempts": -1, "lastAt": "gestern" },
                               "a2": [1, 2], "a3": null, "__proto__": { "passed": true } } },
      "b": { "completed": "kaputt", "checkpoints": 3 },
      "c": [],
      "__proto__": { "completed": {} }
    },
    "review": { "__proto__": { "courseId": "a", "kind": "w", "unitId": "u", "index": 0 } },
    "settings": { "speaking": "ja", "listening": 0 }
  }`);
  const s = sanitizeState(raw);
  assert.deepEqual(Object.keys(s.courses), ['a']);
  assert.deepEqual(s.courses.a, { completed: {}, checkpoints: { a1: { passed: false, bestScore: 1, attempts: 1, lastAt: 0 } } });
  assert.equal(Object.getPrototypeOf(s.courses), Object.prototype, 'kein Prototyp-Tausch');
  assert.equal(Object.getPrototypeOf(s.courses.a.checkpoints), Object.prototype);
  assert.deepEqual(s.review, {});
  assert.equal(s.settings.speaking, false);
  assert.equal(s.settings.listening, true);
});

// --- Große Kurse: kein quadratischer Aufwand -------------------------------------------------------

function bigCourse(levels = 13, units = 25) {
  return {
    id: 'gross', title: 'Groß', nativeLang: 'de', targetLang: 'es',
    levels: Array.from({ length: levels }, (_, li) => ({
      id: `l${li}`, title: `Abschnitt ${li}`,
      units: Array.from({ length: units }, (_, ui) => ({
        id: `l${li}-u${ui}`, title: 'Einheit',
        words: Array.from({ length: 16 }, (_, wi) => ({ native: [`wort${li}x${ui}x${wi}`], target: [`palabra${li}x${ui}x${wi}`] })),
        sentences: Array.from({ length: 4 }, (_, si) => ({ native: [`Satz ${si}.`], target: [`Frase ${si} ${ui}.`], note: 'n' })),
      })),
    })),
  };
}

test('große Kurse (1.300 Lektionen): Lernpfad, Freischaltung, nextStep und Fortschritt bleiben schnell', () => {
  const big = bigCourse();
  const all = listLessons(big);
  assert.equal(all.length, 1300);
  // Alles außer der letzten Lektion erledigt, alles freigeschaltet (schlechtester Fall für die Suche).
  const completed = Object.fromEntries(all.slice(0, -1).map((l) => [l.id, { completions: 1, bestScore: 1, lastAt: T0 }]));
  const s = sanitizeState({ settings: { unlockAll: true }, courses: { [big.id]: { completed } } });
  const t = performance.now();
  for (let r = 0; r < 20; r++) {
    for (const l of all) isLessonUnlocked(s, big, l.id);
    nextStep(s, big);
    nextLesson(s, big);
    courseProgress(s, big);
  }
  const ms = performance.now() - t;
  // Vorher (ohne Cache) dauerte schon ein einzelner Durchlauf über alle Lektionen ca. 35 ms; Grenze großzügig.
  assert.ok(ms < 500, `20 Durchläufe: ${ms.toFixed(1)} ms`);
  assert.equal(nextLesson(s, big).id, all.at(-1).id);
  assert.deepEqual(nextStep(s, big), { kind: 'checkpoint', level: big.levels[0] }, 'erst der Checkpoint des fertigen Abschnitts');
});

test('Lernpfad-Cache gilt je Kursobjekt (geänderte Kopie wird neu berechnet)', () => {
  const copy = structuredClone(course);
  copy.levels[0].units[0].words.push(...copy.levels[0].units[0].words.slice(0, 4));
  assert.equal(listLessons(copy).length, lessons.length + 1);
  assert.equal(listLessons(course).length, lessons.length);
  assert.equal(listLessons(course), listLessons(course), 'gleiche Liste ohne Neuberechnung');
  assert.ok(Object.isFrozen(listLessons(course)), 'gecachte Liste ist schreibgeschützt');
});
