// Reine Hilfen des Admin-Bereichs (src/admin.js ist ohne DOM importierbar).
import test from 'node:test';
import assert from 'node:assert/strict';
import { linesToList, listToLines, exerciseSummary, createAdmin, TYPE_LABELS } from '../src/admin.js';
import { buildLesson } from '../src/exercises.js';
import { listLessons } from '../src/content.js';
import { loadCourse } from './helpers.mjs';

const course = loadCourse('de-en.json');

test('Varianten zeilenweise', () => {
  assert.deepEqual(linesToList(' hello \n\nhi\r\n  '), ['hello', 'hi']);
  assert.equal(listToLines(['a', 'b']), 'a\nb');
  assert.deepEqual(linesToList(listToLines(['x y', 'z'])), ['x y', 'z']);
});

test('Vorschau: jede erzeugte Übung hat Typ, Frage und Lösung', () => {
  const lesson = listLessons(course)[0];
  const exercises = buildLesson(course, lesson.unit, 0, { listening: true, speaking: true });
  const types = new Set();
  for (const ex of exercises) {
    const s = exerciseSummary(ex);
    types.add(ex.type);
    assert.equal(s.type, TYPE_LABELS[ex.type]);
    assert.ok(s.question.length > 0, `${ex.type}: Frage`);
    assert.ok(s.solution.length > 0, `${ex.type}: Lösung`);
  }
  for (const t of ['choice', 'match', 'order', 'fill', 'translate', 'listen', 'speak']) assert.ok(types.has(t), t);
});

test('createAdmin liefert die Handler ohne DOM-Zugriff', () => {
  const a = createAdmin({ api: {}, esc: (s) => s, plural: (n) => String(n), announce() {}, render() {}, go() {}, focus() {} });
  for (const k of ['view', 'handleClick', 'handleChange', 'handleSubmit', 'onRouteChange']) assert.equal(typeof a[k], 'function');
});
