// Reine Hilfsfunktionen der Oberfläche (src/app.js ist ohne DOM importierbar).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, filterCourses, courseLanguages, lastDays, newMatchUi, matchPick, responseFor, addResponse, canCheck, lockReason,
  validateRegistration, fieldForError, parseRoute,
} from '../src/app.js';
import { buildLesson, buildCheckpoint, fallbackExercise } from '../src/exercises.js';
import { gradeExercise, solutionResponse } from '../src/grading.js';
import { gradeSubmission, createSession, recordAnswer, advance, currentItem, isFinished, summarize } from '../src/session.js';
import { listLessons } from '../src/content.js';
import { loadCourse, T0, DAY } from './helpers.mjs';

const course = loadCourse('de-en.json');
const lesson = listLessons(course)[0];

test('esc maskiert HTML-Sonderzeichen', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(esc(null), '');
});

test('parseRoute', () => {
  assert.deepEqual(parseRoute(''), { name: 'home', args: [] });
  assert.deepEqual(parseRoute('#/'), { name: 'home', args: [] });
  assert.deepEqual(parseRoute('#/lesson/a1-greetings%3A0'), { name: 'lesson', args: ['a1-greetings:0'] });
  assert.deepEqual(parseRoute('#/admin/course/de-en/unit/7'), { name: 'admin', args: ['course', 'de-en', 'unit', '7'] });
  assert.deepEqual(parseRoute('#/lesson/%E0%A4%A'), { name: 'lesson', args: [''] }, 'kaputte Kodierung wirft nicht');
});

test('Kursfilter nach Ausgangs- und Zielsprache', () => {
  const list = [{ id: 'a', nativeLang: 'de', targetLang: 'en' }, { id: 'b', nativeLang: 'de', targetLang: 'es' }, { id: 'c', nativeLang: 'en', targetLang: 'es' }];
  assert.deepEqual(filterCourses(list, {}).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(filterCourses(list, { from: 'de' }).map((c) => c.id), ['a', 'b']);
  assert.deepEqual(filterCourses(list, { to: 'es' }).map((c) => c.id), ['b', 'c']);
  assert.deepEqual(filterCourses(list, { from: 'en', to: 'en' }), []);
  const names = { de: 'Deutsch', en: 'Englisch', es: 'Spanisch' };
  assert.deepEqual(courseLanguages(list, 'targetLang', (c) => names[c]), ['en', 'es']);
});

test('lastDays füllt Lücken mit 0 und endet heute', () => {
  const now = T0;
  const days = lastDays([{ day: '2026-10-17', xp: 12 }, { day: '2026-10-15', xp: 5 }], now, 7);
  assert.equal(days.length, 7);
  assert.equal(days.at(-1).day, '2026-10-17');
  assert.equal(days.at(-1).xp, 12);
  assert.equal(days.at(-3).xp, 5);
  assert.equal(days.reduce((n, d) => n + d.xp, 0), 17);
  assert.ok(days[0].time < now - 5 * DAY);
});

function matchOf(exercises) {
  const ex = exercises.find((e) => e.type === 'match');
  assert.ok(ex, 'Lektion enthält eine Paare-Übung');
  return ex;
}

test('Paare: fehlerfrei zugeordnet → richtig, Antwort im Vertragsformat', () => {
  const ex = matchOf(buildLesson(course, lesson.unit, 0, { seed: 0 }));
  let m = newMatchUi();
  for (const [l, r] of ex.pairs) {
    // abwechselnd links→rechts und rechts→links wählen
    const first = matchPick(m, ex, 'r', r);
    assert.equal(first.attempt, undefined);
    const second = matchPick(first.match, ex, 'l', l);
    assert.equal(second.attempt.correct, true);
    m = second.match;
  }
  assert.equal(m.found.length, ex.pairs.length);
  const response = responseFor(ex, { match: m });
  assert.deepEqual(response, ex.pairs.map((p) => [...p]));
  assert.equal(gradeExercise(ex, response).correct, true);
});

test('Paare: ein Fehlversuch → am Ende falsch; gefundene Einträge sind gesperrt; Abwahl möglich', () => {
  const ex = matchOf(buildLesson(course, lesson.unit, 0, { seed: 1 }));
  let m = newMatchUi();
  const [l0, r0] = ex.pairs[0];
  const wrongR = ex.pairs[1][1];
  let step = matchPick(m, ex, 'l', l0);
  assert.equal(step.match.sel.l, l0);
  step = matchPick(step.match, ex, 'l', l0);
  assert.equal(step.match.sel.l, null, 'nochmal klicken hebt die Auswahl auf');
  step = matchPick(matchPick(m, ex, 'l', l0).match, ex, 'r', wrongR);
  assert.equal(step.attempt.correct, false);
  assert.deepEqual(step.match.wrong, [l0, wrongR]);
  m = step.match;
  for (const [l, r] of ex.pairs) m = matchPick(matchPick(m, ex, 'l', l).match, ex, 'r', r).match;
  const again = matchPick(m, ex, 'l', l0);
  assert.equal(again.match, m, 'gefundenes Wort lässt sich nicht erneut wählen');
  assert.equal(m.found.length, ex.pairs.length);
  assert.equal(m.attempts.length, ex.pairs.length + 1);
  assert.equal(gradeExercise(ex, responseFor(ex, { match: m })).correct, false);
  void r0;
});

test('Antworten sammeln: erster und zweiter Versuch, Fallback-Kennzeichen', () => {
  let r = {};
  r = addResponse(r, 'x', 'a');
  r = addResponse(r, 'x', 'b');
  r = addResponse(r, 'x', 'c');
  assert.deepEqual(r.x, { answers: ['a', 'b'] });
  r = addResponse(r, 'y', 'hello', true);
  r = addResponse(r, 'y', 'hallo');
  assert.deepEqual(r.y, { answers: ['hello', 'hallo'], fallback: true });
});

test('canCheck je Übungstyp', () => {
  const ui = { selected: null, picked: [], text: ' ', match: newMatchUi() };
  assert.equal(canCheck({ type: 'choice' }, ui), false);
  assert.equal(canCheck({ type: 'choice' }, { ...ui, selected: 'x' }), true);
  assert.equal(canCheck({ type: 'order' }, { ...ui, picked: ['t0'] }), true);
  assert.equal(canCheck({ type: 'translate' }, ui), false);
  assert.equal(canCheck({ type: 'speak' }, { ...ui, text: 'hi' }), true);
  assert.equal(canCheck({ type: 'match' }, ui), false, 'Paare werden automatisch bewertet');
});

/**
 * Simuliert den Ablauf im Browser (Session + gesammelte Rohantworten) und prüft, dass gradeSubmission
 * (Server) zum selben Ergebnis kommt – inkl. Fallback und zweitem Versuch.
 */
function simulate(exercises, decide) {
  let session = createSession(exercises);
  let responses = {};
  const fallbackIds = new Set();
  while (!isFinished(session)) {
    const item = currentItem(session);
    let ex = item.ex;
    if (!item.retry && (ex.type === 'listen' || ex.type === 'speak')) {
      const fb = fallbackExercise(ex, course);
      fallbackIds.add(fb.id);
      session = { ...session, queue: session.queue.map((q, i) => (i === session.pos ? { ...q, ex: fb } : q)) };
      ex = fb;
    }
    const response = decide(ex, item.retry);
    const result = gradeExercise(ex, response);
    responses = addResponse(responses, ex.id, response, fallbackIds.has(ex.id));
    session = advance(recordAnswer(session, result.correct));
  }
  return { local: summarize(session), responses };
}

const wrongAnswer = (ex) => (ex.type === 'match' ? [[ex.pairs[0][0], ex.pairs[1][1]]] : ex.type === 'order' ? [] : 'xyz');

test('Browser-Ablauf und Server-Bewertung stimmen überein (Lektion mit Hören/Sprechen als Ersatzübung)', () => {
  const exercises = buildLesson(course, lesson.unit, 0, { seed: 3, listening: true, speaking: true });
  let n = 0;
  const { local, responses } = simulate(exercises, (ex, retry) => (retry || n++ % 3 ? solutionResponse(ex) : wrongAnswer(ex)));
  const server = gradeSubmission(exercises, responses, course);
  assert.equal(server.total, local.total);
  assert.equal(server.firstTryCorrect, local.firstTryCorrect);
  assert.deepEqual(server.wrongRefs, local.wrongRefs);
  assert.ok(Object.values(responses).some((r) => r.fallback), 'Fallback wurde markiert');
});

test('Checkpoint: alles richtig → Server zählt alles im ersten Versuch', () => {
  const level = course.levels[0];
  const exercises = buildCheckpoint(course, level, { seed: 0, listening: true });
  const { local, responses } = simulate(exercises, (ex) => solutionResponse(ex));
  const server = gradeSubmission(exercises, responses, course);
  assert.equal(server.firstTryCorrect, exercises.length);
  assert.equal(local.firstTryCorrect, exercises.length);
});

test('Sperrgrund für Lektionen', () => {
  const lessons = listLessons(course);
  assert.equal(lockReason(course, lessons[0].id), '');
  assert.match(lockReason(course, lessons[1].id), /Schließe zuerst/);
  const firstOfLevel2 = lessons.find((l) => l.levelId === course.levels[1].id);
  assert.match(lockReason(course, firstOfLevel2.id), /Checkpoint/);
});

test('Registrierung: Prüfungen und Fehlerzuordnung', () => {
  const e = validateRegistration({ email: 'kaputt', password: 'kurz', displayName: '' });
  assert.ok(e.email && e.password && e.displayName);
  assert.match(e.password, /mindestens 10/);
  assert.deepEqual(validateRegistration({ email: 'a@b.de', password: '0123456789', displayName: 'Ada' }), {});
  assert.equal(fieldForError('email_taken'), 'email');
  assert.equal(fieldForError('weak_password'), 'password');
  assert.equal(fieldForError('rate_limited'), null);
});
