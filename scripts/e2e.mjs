// End-to-End-Durchlauf gegen den echten Serverprozess (eigene Wegwerf-Datenbank, freier Port):
// Gast → Kurswahl → Lektion → Fortschritt nach Neustart → Wiederholung → Checkpoint → Konto → Ab-/Anmelden
// → Admin legt Kurs an, veröffentlicht ihn → Lernende sehen ihn. Ausgabe: eine Zeile pro Schritt.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listLessons } from '../src/content.js';
import { buildLesson, buildCheckpoint, buildReviewExercise } from '../src/exercises.js';
import { solutionResponse } from '../src/grading.js';
import { dueReviewItems } from '../src/progress.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'wortweg-e2e-'));
const DB = join(dir, 'e2e.db');
const PORT = 5300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, WORTWEG_DB: DB, PORT: String(PORT), LOG: '0' };
let server = null;
let step = 0;

function ok(cond, label, detail = '') {
  step++;
  if (!cond) throw new Error(`Schritt ${step} fehlgeschlagen: ${label}${detail ? ` – ${detail}` : ''}`);
  console.log(`✓ ${String(step).padStart(2)} ${label}`);
}

async function startServer() {
  server = spawn(process.execPath, ['server/main.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/me`)).ok) return;
    } catch { /* noch nicht bereit */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht.');
}

async function stopServer() {
  if (!server) return;
  const done = new Promise((r) => server.once('exit', r));
  server.kill('SIGTERM');
  await done;
  server = null;
}

function client() {
  let cookie = null;
  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? null : set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) };
}

const answersFor = (exercises) => Object.fromEntries(exercises.map((ex) => [ex.id, { answers: [solutionResponse(ex)] }]));

try {
  await startServer();
  ok(true, `Server läuft (${BASE}, frische Datenbank)`);
  const page = await fetch(BASE + '/');
  ok(page.ok && (await page.text()).includes('src/app.js'), 'Startseite wird ausgeliefert');

  const me = client();
  ok((await me.post('/api/auth/guest')).data.user.isGuest, 'Als Gast gestartet');
  const { courses } = (await me.get('/api/courses')).data;
  ok(courses.length >= 4, `Kurswahl: ${courses.map((c) => c.id).join(', ')}`);
  ok((await me.patch('/api/progress/settings', { activeCourseId: 'de-fr', dailyGoal: 10 })).status === 200, 'Kurs Französisch und Tagesziel 10 XP gewählt');

  let course = (await me.get('/api/courses/de-fr')).data.course;
  const lessons = listLessons(course);
  const lesson = lessons[0];
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed: 0 });
  const responses = answersFor(exercises);
  // Zwei Fehler im ersten Versuch, im zweiten richtig – wie im Browser.
  for (const ex of exercises.slice(0, 2)) responses[ex.id] = { answers: ['falsch', solutionResponse(ex)] };
  const done = await me.post('/api/progress/lesson', { courseId: course.id, lessonId: lesson.id, version: course.version, seed: 0, options: {}, responses });
  ok(done.status === 200 && done.data.result.firstTryCorrect === exercises.length - 2, `Lektion abgeschlossen: ${done.data.result.firstTryCorrect}/${done.data.result.total}, +${done.data.result.xp} XP`);
  ok(done.data.result.goalJustReached === true, 'Tagesziel erreicht gemeldet');

  await stopServer();
  await startServer();
  let state = (await me.get('/api/progress')).data.state;
  ok(state.xpTotal === done.data.result.xp && state.courses['de-fr'].completed[lesson.id], 'Fortschritt übersteht einen Server-Neustart');

  const due = dueReviewItems(state, 'de-fr', Date.now(), 10);
  ok(due.length >= 1, `${due.length} Wiederholung(en) sofort fällig (Fehler aus der Lektion)`);
  const reviewEx = due.map((it) => buildReviewExercise(course, it, { seed: it.seen, box: it.box }));
  const rev = await me.post('/api/progress/review', { courseId: 'de-fr', version: course.version, responses: answersFor(reviewEx) });
  ok(rev.status === 200 && rev.data.result.firstTryCorrect === due.length, `Wiederholung: ${due.length}/${due.length} richtig, +${rev.data.result.xp} XP`);
  ok(due.every((it) => rev.data.state.review[it.key].box === 1), 'Wiederholungsboxen aufgestiegen');

  const level = course.levels[0];
  const cpEx = buildCheckpoint(course, level, { seed: 0 });
  const cp = await me.post('/api/progress/checkpoint', { courseId: 'de-fr', levelId: level.id, version: course.version, seed: 0, options: {}, responses: answersFor(cpEx) });
  ok(cp.status === 200 && cp.data.result.passed, `Checkpoint „${level.title}“ bestanden (Abschnitt übersprungen)`);
  const nextLevelLesson = lessons.find((l) => l.levelId === course.levels[1].id);
  const nl = buildLesson(course, nextLevelLesson.unit, nextLevelLesson.index, { seed: 0 });
  ok((await me.post('/api/progress/lesson', { courseId: 'de-fr', lessonId: nextLevelLesson.id, version: course.version, seed: 0, options: {}, responses: answersFor(nl) })).status === 200, 'Nächster Abschnitt ist freigeschaltet');

  const reg = await me.post('/api/auth/register', { email: 'e2e@example.org', password: 'e2e-passwort-123', displayName: 'E2E' });
  ok(reg.status === 200 && !reg.data.user.isGuest, 'Gastkonto in echtes Konto umgewandelt');
  const xpBefore = (await me.get('/api/progress')).data.state.xpTotal;
  await me.post('/api/auth/logout');
  ok((await me.get('/api/progress')).status === 401, 'Abgemeldet');
  await me.post('/api/auth/login', { email: 'e2e@example.org', password: 'e2e-passwort-123' });
  ok((await me.get('/api/progress')).data.state.xpTotal === xpBefore, `Wieder angemeldet, Fortschritt da (${xpBefore} XP)`);
  const st = (await me.get('/api/stats')).data.stats;
  ok(st.attempts.lesson === 2 && st.attempts.review === 1 && st.attempts.checkpoint === 1, `Statistik: Trefferquote ${Math.round(st.accuracy * 100)} %`);

  const r = spawnSync(process.execPath, ['scripts/create-admin.mjs', '--email', 'admin-e2e@example.org'], { cwd: ROOT, env: { ...env, ADMIN_PASSWORD: 'admin-e2e-pw-123' }, encoding: 'utf8' });
  ok(r.status === 0, 'Admin per CLI angelegt');
  const admin = client();
  await admin.post('/api/auth/login', { email: 'admin-e2e@example.org', password: 'admin-e2e-pw-123' });
  ok((await me.get('/api/admin/overview')).status === 403, 'Lernende haben keinen Admin-Zugriff');
  const created = await admin.post('/api/admin/courses', { id: 'de-pt', title: 'Portugiesisch', nativeLang: 'de', targetLang: 'pt', ttsLang: 'pt-PT', license: 'CC0 1.0' });
  ok(created.status === 200 && created.data.course.status === 'draft', 'Admin legt Kurs Deutsch → Portugiesisch als Entwurf an', JSON.stringify(created.data?.error ?? ''));
  const sec = await admin.post('/api/admin/courses/de-pt/sections', { slug: 'pt-a1', title: 'A1' });
  const unit = await admin.post(`/api/admin/sections/${sec.data.pk}/units`, { slug: 'pt-ola', title: 'Olá', status: 'published' });
  ok(sec.status === 200 && unit.status === 200, 'Abschnitt und Einheit angelegt');
  const items = [
    ['w', 'Hallo', 'olá'], ['w', 'danke', 'obrigado'], ['w', 'ja', 'sim'], ['w', 'nein', 'não'],
    ['s', 'Hallo, ich bin Ana.', 'Olá, eu sou a Ana.'], ['s', 'Danke, gut.', 'Obrigado, bem.'], ['s', 'Ja, bitte.', 'Sim, por favor.'], ['s', 'Nein, danke.', 'Não, obrigado.'],
  ];
  const added = [];
  for (const [kind, n, tgt] of items) added.push(await admin.post(`/api/admin/units/${unit.data.pk}/items`, { kind, native: [n], target: [tgt], note: kind === 's' ? 'Eigene Testeingabe.' : undefined }));
  ok(added.every((a) => a.status === 200), '4 Wörter und 4 Sätze angelegt');
  ok((await me.get('/api/courses/de-pt')).status === 404, 'Neuer Kurs ist als Entwurf unsichtbar');
  const pub = await admin.patch('/api/admin/courses/de-pt', { status: 'published' });
  ok(pub.status === 200, 'Admin veröffentlicht den Kurs', JSON.stringify(pub.data?.error ?? ''));
  course = (await me.get('/api/courses/de-pt')).data.course;
  const ptLesson = listLessons(course)[0];
  const ptEx = buildLesson(course, ptLesson.unit, 0, { seed: 0 });
  ok((await me.post('/api/progress/lesson', { courseId: 'de-pt', lessonId: ptLesson.id, version: course.version, seed: 0, options: {}, responses: answersFor(ptEx) })).status === 200, 'Lernende absolvieren eine Lektion im neuen Kurs');
  console.log(`\nE2E bestanden: ${step} Schritte.`);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  rmSync(dir, { recursive: true, force: true });
}
