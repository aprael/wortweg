import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, responsesFor, modelAnswer } from './server-helpers.mjs';
import { listLessons } from '../src/content.js';
import { buildLesson, buildCheckpoint, buildReviewExercise } from '../src/exercises.js';
import { dueReviewItems } from '../src/progress.js';

const t = await startTestServer();
test.after(() => t.close());

async function learner() {
  const c = t.client();
  await c.post('/api/auth/guest');
  return c;
}

async function getCourse(c, id = 'de-en') {
  return (await c.get(`/api/courses/${id}`)).data.course;
}

function lessonBody(course, lesson, { seed = 0, pick, listening = false, speaking = false } = {}) {
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed, listening, speaking });
  return { courseId: course.id, lessonId: lesson.id, version: course.version, seed, options: { listening, speaking }, responses: responsesFor(exercises, pick) };
}

test('Kursliste und Kurs: nur veröffentlichte Kurse mit Kennzahlen', async () => {
  const c = t.client();
  const { courses } = (await c.get('/api/courses')).data;
  const en = courses.find((x) => x.id === 'de-en');
  assert.ok(en, 'de-en ist eingespielt');
  assert.equal(en.nativeLang, 'de');
  assert.ok(en.stats.lessons >= 36);
  const course = await getCourse(c);
  assert.equal(course.version, 1);
  assert.ok(course.levels.length >= 3);
  assert.equal((await c.get('/api/courses/gibtsnicht')).status, 404);
  assert.equal((await c.get('/api/courses/..%2F..')).status, 400);
  const langs = (await c.get('/api/languages')).data.languages;
  assert.ok(langs.some((l) => l.code === 'en' && l.name === 'Englisch'));
});

test('Lektion: Server bewertet selbst, XP und Fortschritt werden gespeichert', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const [first, second] = listLessons(course);
  const r = await c.post('/api/progress/lesson', { ...lessonBody(course, first), xp: 9999 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.result.firstTryCorrect, r.data.result.total);
  assert.equal(r.data.result.xp, r.data.result.total + 10, 'Fehlerfrei: 1 je Übung + 5 + 5');
  assert.equal(r.data.state.xpTotal, r.data.result.xp, 'vom Client geschicktes xp wird ignoriert');
  assert.ok(r.data.state.courses['de-en'].completed[first.id]);
  const again = (await c.get('/api/progress')).data.state;
  assert.equal(again.xpTotal, r.data.result.xp);
  assert.equal(again.streak.current, 1);
  assert.ok(Object.keys(again.review).length > 0, 'gelernte Objekte sind für die Wiederholung vorgemerkt');
  assert.equal((await c.post('/api/progress/lesson', lessonBody(course, second))).status, 200, 'zweite Lektion ist jetzt frei');
});

test('Lektion: falsche Antworten → weniger XP und sofort fällige Wiederholung', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const lesson = listLessons(course)[0];
  const r = await c.post('/api/progress/lesson', lessonBody(course, lesson, { pick: (_, i) => i % 2 === 0 }));
  assert.equal(r.status, 200);
  assert.ok(r.data.result.firstTryCorrect < r.data.result.total);
  assert.ok(r.data.result.wrongRefs.length > 0);
  const due = dueReviewItems(r.data.state, 'de-en', t.clock.now, 99);
  assert.ok(due.length >= 1);
});

test('Lektion: fehlende Antworten zählen als falsch, kaputte Antworten werfen nicht', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const lesson = listLessons(course)[0];
  const body = lessonBody(course, lesson);
  const ids = Object.keys(body.responses);
  delete body.responses[ids[0]];
  body.responses[ids[1]] = { answers: [{ boese: true }] };
  body.responses[ids[2]] = { answers: [['a'.repeat(5000)]] };
  const r = await c.post('/api/progress/lesson', body);
  assert.equal(r.status, 200);
  assert.equal(r.data.result.firstTryCorrect, r.data.result.total - 3);
  assert.equal((await c.post('/api/progress/lesson', { ...body, responses: { x: { answers: [] } } })).status, 400);
  assert.equal((await c.post('/api/progress/lesson', { ...body, responses: 'nein' })).status, 400);
  assert.equal((await c.post('/api/progress/lesson', { ...body, seed: -1 })).status, 400);
});

test('Lektion: gesperrt → 403, veraltete Kursversion → 409, unbekannt → 404', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const lessons = listLessons(course);
  assert.equal((await c.post('/api/progress/lesson', lessonBody(course, lessons[5]))).status, 403);
  assert.equal((await c.post('/api/progress/lesson', { ...lessonBody(course, lessons[0]), version: 0 })).data.error.code, 'course_changed');
  assert.equal((await c.post('/api/progress/lesson', { ...lessonBody(course, lessons[0]), lessonId: 'x:9' })).status, 404);
  await c.patch('/api/progress/settings', { settings: { unlockAll: true } });
  assert.equal((await c.post('/api/progress/lesson', lessonBody(course, lessons[5]))).status, 200, 'mit „alles freischalten“ erlaubt');
});

test('Lektion mit Hören, Sprechen und „kann gerade nicht“ (fallback)', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const lesson = listLessons(course)[0];
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed: 0, listening: true, speaking: true });
  assert.ok(exercises.some((e) => e.type === 'listen'));
  assert.ok(exercises.some((e) => e.type === 'speak'));
  const responses = responsesFor(exercises);
  for (const ex of exercises) {
    if (ex.type === 'listen' || ex.type === 'speak') {
      // Ersatzübung: Übersetzung desselben Satzes in die Zielsprache.
      responses[ex.id] = { answers: [ex.solution], fallback: true };
    }
  }
  const r = await c.post('/api/progress/lesson', { courseId: 'de-en', lessonId: lesson.id, version: course.version, seed: 0, options: { listening: true, speaking: true }, responses });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.firstTryCorrect, r.data.result.total);
});

test('Wiederholung: Server baut fällige Übungen nach und verschiebt Boxen', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const lesson = listLessons(course)[0];
  const first = await c.post('/api/progress/lesson', lessonBody(course, lesson, { pick: () => false }));
  const state = first.data.state;
  const due = dueReviewItems(state, 'de-en', t.clock.now, 10);
  assert.ok(due.length > 0);
  const responses = {};
  for (const it of due) {
    const ex = buildReviewExercise(course, it, { seed: it.seen, box: it.box });
    responses[ex.id] = { answers: [modelAnswer(ex)] };
  }
  const r = await c.post('/api/progress/review', { courseId: 'de-en', version: course.version, responses });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.result.firstTryCorrect, due.length);
  assert.equal(r.data.result.xp, due.length + 2);
  for (const it of due) assert.equal(r.data.state.review[it.key].box, 1);
  assert.equal((await c.post('/api/progress/review', { courseId: 'de-en', version: course.version, responses })).data.error.code, 'nothing_due');
});

test('Checkpoint: Bestehen schaltet den Abschnitt frei (Überspringen)', async () => {
  const c = await learner();
  const course = await getCourse(c);
  const [l1, l2] = course.levels;
  assert.equal((await c.post('/api/progress/checkpoint', { courseId: 'de-en', levelId: l2.id, version: course.version, seed: 0, options: {}, responses: {} })).status, 403);
  const exercises = buildCheckpoint(course, l1, { seed: 0 });
  const fail = await c.post('/api/progress/checkpoint', { courseId: 'de-en', levelId: l1.id, version: course.version, seed: 0, options: {}, responses: responsesFor(exercises, (_, i) => i < 3) });
  assert.equal(fail.status, 200);
  assert.equal(fail.data.result.passed, false);
  const ok = await c.post('/api/progress/checkpoint', { courseId: 'de-en', levelId: l1.id, version: course.version, seed: 1, options: {}, responses: responsesFor(buildCheckpoint(course, l1, { seed: 1 })) });
  assert.equal(ok.data.result.passed, true);
  assert.equal(ok.data.state.courses['de-en'].checkpoints[l1.id].passed, true);
  const lastOfLevel1 = listLessons(course).filter((l) => l.levelId === l1.id).at(-1);
  const firstOfLevel2 = listLessons(course).find((l) => l.levelId === l2.id);
  assert.equal((await c.post('/api/progress/lesson', lessonBody(course, lastOfLevel1))).status, 200, 'Lektionen des bestandenen Abschnitts sind frei');
  assert.equal((await c.post('/api/progress/lesson', lessonBody(course, firstOfLevel2))).status, 200, 'nächster Abschnitt ist frei');
});

test('Einstellungen werden geprüft', async () => {
  const c = await learner();
  assert.equal((await c.patch('/api/progress/settings', { dailyGoal: 7 })).status, 400);
  assert.equal((await c.patch('/api/progress/settings', { settings: { admin: true } })).status, 400);
  assert.equal((await c.patch('/api/progress/settings', { settings: { listening: 'ja' } })).status, 400);
  assert.equal((await c.patch('/api/progress/settings', { settings: { constructor: true } })).status, 400);
  assert.equal((await c.raw('PATCH', '/api/progress/settings', '{"settings":{"__proto__":true}}')).status, 400);
  assert.equal((await c.patch('/api/progress/settings', { activeCourseId: 'gibtsnicht' })).status, 404);
  const r = await c.patch('/api/progress/settings', { activeCourseId: 'de-es', dailyGoal: 50, settings: { speaking: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.activeCourseId, 'de-es');
  assert.equal(r.data.state.settings.speaking, true);
});

test('Export, Import (auch alter v1-Stand aus dem Browser) und Zurücksetzen', async () => {
  const c = await learner();
  const course = await getCourse(c);
  await c.post('/api/progress/lesson', lessonBody(course, listLessons(course)[0]));
  const exp = await c.get('/api/progress/export');
  assert.match(exp.headers.get('content-disposition'), /attachment; filename="wortweg-fortschritt-/);
  assert.equal(exp.data.app, 'wortweg');
  const xp = exp.data.state.xpTotal;
  assert.ok(xp > 0);

  const reset = await c.post('/api/progress/reset');
  assert.equal(reset.data.state.xpTotal, 0);
  const imp = await c.post('/api/progress/import', { data: exp.data });
  assert.equal(imp.data.state.xpTotal, xp);

  const v1 = { app: 'wortweg', version: 1, state: { xpTotal: 42, xpByDay: { '2026-10-17': 42 }, dailyGoal: 10, streak: { current: 1, best: 3, lastDay: '2026-10-17' }, courses: { 'de-en': { completed: { 'a1-greetings:0': { completions: 1, bestScore: 1, lastAt: 1 } } } }, review: {}, settings: { listening: false } } };
  const r = await c.post('/api/progress/import', { data: v1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.xpTotal, 42);
  assert.equal(r.data.state.settings.speaking, false);
  assert.equal((await c.post('/api/progress/import', { data: { app: 'anders', state: {} } })).status, 400);
  assert.equal((await c.post('/api/progress/import', { data: { ...v1, version: 99 } })).status, 400);
});

test('Statistik: Tage, Versuche, Trefferquote, schwierige Wörter', async () => {
  const c = await learner();
  const course = await getCourse(c);
  await c.post('/api/progress/lesson', lessonBody(course, listLessons(course)[0], { pick: (_, i) => i > 1 }));
  const { stats } = (await c.get('/api/stats')).data;
  assert.equal(stats.attempts.lesson, 1);
  assert.ok(stats.accuracy > 0 && stats.accuracy < 1);
  assert.equal(stats.days.length, 1);
  assert.ok(stats.hardItems.length >= 1);
  assert.equal(typeof stats.hardItems[0].target, 'string');
});
