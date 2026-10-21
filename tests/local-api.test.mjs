// App-Modus: src/local-api.js mit nachgebautem localStorage und fetch (Kurse aus data/courses).
// Prüft, dass Bewertung, XP, Freischaltung, Wiederholung und Datenverwaltung wie auf dem Server laufen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listLessons } from '../src/content.js';
import { buildLesson, buildCheckpoint, buildReviewExercise } from '../src/exercises.js';
import { solutionResponse } from '../src/grading.js';
import { dueReviewItems } from '../src/progress.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const COURSES = { 'de-es': 'de-es.json', 'de-fr': 'de-fr.json' };
const read = (file) => JSON.parse(readFileSync(new URL(`../data/courses/${file}`, import.meta.url), 'utf8'));
globalThis.fetch = async (path) => {
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  if (path === 'courses/index.json') {
    return json({
      courses: Object.entries(COURSES).map(([id, file]) => ({ id, title: read(file).title, file, stats: {} })),
      languages: [{ code: 'de', name: 'Deutsch', nativeName: 'Deutsch' }],
    });
  }
  const file = path.replace(/^courses\//, '');
  if (Object.values(COURSES).includes(file)) return json(read(file));
  return { ok: false, status: 404, json: async () => ({}) };
};

const api = await import('../src/local-api.js');
const answers = (exercises, wrong = 0) => Object.fromEntries(exercises.map((ex, i) => [ex.id, { answers: [i < wrong ? 'falsch' : solutionResponse(ex), solutionResponse(ex)] }]));

test('Profil: erst ohne, dann lokal angelegt; keine Konten im App-Modus', async () => {
  assert.equal(api.MODE, 'local');
  assert.equal((await api.getMe()).user, null);
  const { user } = await api.startGuest();
  assert.equal(user.local, true);
  assert.equal(user.isGuest, false);
  await assert.rejects(api.login({ email: 'a@b.de', password: 'x' }), { code: 'local_mode' });
  assert.equal((await api.updateAccount('  Lea  ')).user.displayName, 'Lea');
  await assert.rejects(api.updateAccount('   '), { status: 400 });
  assert.deepEqual((await api.getCourses()).courses.map((c) => c.id), ['de-es', 'de-fr']);
  assert.equal((await api.getCourses()).courses[0].file, undefined, 'Dateinamen bleiben intern');
});

test('Lektion: lokal bewertet, Fehler kommen in die Wiederholung, gesperrte Lektion wird abgelehnt', async () => {
  await api.saveSettings({ activeCourseId: 'de-es', dailyGoal: 10 });
  await assert.rejects(api.saveSettings({ dailyGoal: 7 }), { status: 400 });
  await assert.rejects(api.saveSettings({ settings: { hacker: true } }), { status: 400 });
  const { course } = await api.getCourse('de-es');
  const [first, second] = listLessons(course);
  await assert.rejects(api.submitLesson({ courseId: 'de-es', lessonId: second.id, seed: 0, responses: {} }), { status: 403 });
  const ex = buildLesson(course, first.unit, first.index, { seed: 0 });
  const done = await api.submitLesson({ courseId: 'de-es', lessonId: first.id, seed: 0, options: {}, responses: answers(ex, 2) });
  assert.equal(done.result.firstTryCorrect, ex.length - 2);
  assert.equal(done.result.goalJustReached, true);
  assert.ok(done.result.xp > 0);
  assert.ok(done.state.courses['de-es'].completed[first.id]);
  // Gespeichert: ein neuer Aufruf liest denselben Stand.
  assert.equal((await api.getProgress()).state.xpTotal, done.result.xp);

  const due = dueReviewItems(done.state, 'de-es', Date.now(), 10);
  assert.ok(due.length >= 1, 'Fehler sind sofort fällig');
  const rex = due.map((it) => buildReviewExercise(course, it, { seed: it.seen, box: it.box }));
  const rev = await api.submitReview({ courseId: 'de-es', responses: answers(rex) });
  assert.equal(rev.result.firstTryCorrect, due.length);
  await assert.rejects(api.submitReview({ courseId: 'de-es', responses: answers(rex) }), { code: 'nothing_due' });
});

test('Checkpoint schaltet den Abschnitt frei; Statistik, Export, Import und Zurücksetzen', async () => {
  const { course } = await api.getCourse('de-es');
  const level = course.levels[0];
  const cp = await api.submitCheckpoint({ courseId: 'de-es', levelId: level.id, seed: 0, options: {}, responses: answers(buildCheckpoint(course, level, { seed: 0 })) });
  assert.equal(cp.result.passed, true);
  const nextLevelLesson = listLessons(course).find((l) => l.levelId === course.levels[1].id);
  const ok = await api.submitLesson({ courseId: 'de-es', lessonId: nextLevelLesson.id, seed: 0, responses: answers(buildLesson(course, nextLevelLesson.unit, nextLevelLesson.index, { seed: 0 })) });
  assert.ok(ok.result.xp > 0);

  const { stats } = await api.getStats();
  assert.deepEqual(stats.attempts, { lesson: 2, review: 1, checkpoint: 1 });
  assert.ok(stats.accuracy > 0.8 && stats.accuracy < 1);
  assert.ok(stats.hardItems.length >= 1 && stats.hardItems[0].native);

  const exp = await api.exportProgress();
  assert.match(exp.filename, /^wortweg-fortschritt-\d{4}-\d{2}-\d{2}\.json$/);
  const xp = exp.data.state.xpTotal;
  await api.resetProgress();
  assert.equal((await api.getProgress()).state.xpTotal, 0);
  assert.equal((await api.getProgress()).state.activeCourseId, 'de-es', 'Kurswahl bleibt');
  await assert.rejects(api.importProgress({ app: 'fremd', state: {} }), { code: 'invalid_import' });
  assert.equal((await api.importProgress(exp.data)).state.xpTotal, xp);
});

test('Speicher kaputt oder voll: verständliche Fehler statt Absturz; Löschen entfernt alles', async () => {
  store.set('wortweg:app:v2', '{kaputt');
  assert.equal((await api.getMe()).user, null, 'kaputte Daten → wie neu starten');
  await api.startGuest();
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  await assert.rejects(api.saveSettings({ dailyGoal: 20 }), { code: 'storage_full' });
  globalThis.localStorage.setItem = setItem;
  await api.deleteAccount();
  assert.equal(store.size, 0);
  assert.equal((await api.getMe()).user, null);
});
