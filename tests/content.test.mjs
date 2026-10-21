import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCourse, listLessons } from '../src/content.js';
import { buildLesson, buildReviewExercise, lessonItems } from '../src/exercises.js';
import { gradeText, gradeChoice, gradeOrder, gradeExercise, gradeMatchAttempt, solutionResponse } from '../src/grading.js';
import { loadCourse } from './helpers.mjs';
import { zhCourse } from './zh-mini-course.mjs';

const courses = ['de-en.json', 'de-es.json'].map(loadCourse);

test('mitgelieferte Kurse sind gültig und als Demo markiert', () => {
  for (const c of courses) {
    assert.deepEqual(validateCourse(c).errors, []);
    assert.equal(c.demo, true);
  }
});

test('Validierung lehnt kaputte Kurse ab', () => {
  assert.equal(validateCourse(null).ok, false);
  assert.equal(validateCourse({ id: 'x', title: 'X', nativeLang: 'de', targetLang: 'en', levels: [] }).ok, false);
  const c = structuredClone(courses[0]);
  c.levels[0].units[1].id = c.levels[0].units[0].id;
  assert.match(validateCourse(c).errors.join(' '), /doppelt/);
  const d = structuredClone(courses[0]);
  delete d.levels[0].units[0].sentences[0].note;
  assert.match(validateCourse(d).errors.join(' '), /Erklärung/);
});

test('Übungen sind deterministisch (gleicher Seed → gleiche Übungen)', () => {
  const c = courses[0];
  const unit = c.levels[0].units[0];
  assert.deepEqual(buildLesson(c, unit, 0, { seed: 1 }), buildLesson(c, unit, 0, { seed: 1 }));
});

test('jede Lektion enthält alle Übungstypen; Hören und Sprechen nur wenn aktiviert', () => {
  const c = courses[0];
  const unit = c.levels[0].units[0];
  const types = new Set(buildLesson(c, unit, 0, { listening: true, speaking: true }).map((e) => e.type));
  for (const t of ['choice', 'translate', 'order', 'fill', 'listen', 'match', 'speak']) assert.ok(types.has(t), t);
  const plain = buildLesson(c, unit, 0);
  assert.ok(!plain.some((e) => e.type === 'listen' || e.type === 'speak'));
  assert.ok(plain.some((e) => e.type === 'match'), 'Paare zuordnen ist immer dabei');
});

test('Musterlösung jeder erzeugten Übung wird als richtig bewertet (alle Kurse, alle Lektionen)', () => {
  let count = 0;
  for (const c of courses) {
    for (const l of listLessons(c)) {
      for (const ex of buildLesson(c, l.unit, l.index, { listening: true, speaking: true })) {
        count++;
        let r;
        if (ex.type === 'match') {
          for (const [a, b] of ex.pairs) assert.equal(gradeMatchAttempt(ex, a, b), true, ex.id);
          r = gradeExercise(ex, ex.pairs);
        } else if (ex.type === 'choice' || ex.type === 'fill') {
          assert.ok(ex.choices.includes(ex.answer), `${ex.id}: Lösung fehlt in Auswahl`);
          assert.equal(new Set(ex.choices).size, ex.choices.length, `${ex.id}: doppelte Auswahl`);
          r = gradeChoice(ex.answer, ex.answer);
        } else if (ex.type === 'order') {
          const tokens = ex.solution.split(/\s+/).map((t) => t.replace(/^[¿¡]+|[.,!?;:]+$/g, ''));
          for (const t of tokens) assert.ok(ex.bank.some((b) => b.text === t), `${ex.id}: Baustein ${t} fehlt`);
          r = gradeOrder(tokens, ex.accepted, ex.answerLang);
        } else {
          for (const a of ex.accepted) assert.equal(gradeText(a, ex.accepted, ex.answerLang).exact, true, `${ex.id}: ${a}`);
          r = gradeText(ex.solution, ex.accepted, ex.answerLang);
        }
        assert.equal(r.correct, true, `${ex.id} (${ex.type})`);
        assert.equal(gradeExercise(ex, solutionResponse(ex)).correct, true, `${ex.id} (${ex.type}) über gradeExercise`);
        assert.ok(ex.explanation.length > 0);
      }
    }
  }
  assert.ok(count > 300);
});

test('Lückentext: Satz mit Lücke ergibt wieder den Originalsatz', () => {
  for (const c of courses) {
    for (const l of listLessons(c)) {
      for (const ex of buildLesson(c, l.unit, l.index).filter((e) => e.type === 'fill')) {
        const rebuilt = `${ex.parts.before} ${ex.answer} ${ex.parts.after}`.replace(/\s+/g, ' ').replace(/ ([.,!?])/g, '$1').trim();
        const strip = (s) => s.replace(/\s+/g, ' ').replace(/ ([.,!?])/g, '$1').trim();
        assert.equal(strip(rebuilt), strip(ex.solution), ex.id);
      }
    }
  }
});

test('Wiederholungsübungen lassen sich für alle Lernobjekte bauen', () => {
  const c = courses[0];
  for (const l of listLessons(c)) {
    for (const ref of lessonItems(l.unit, l.index)) {
      for (const box of [0, 1, 3]) assert.ok(buildReviewExercise(c, ref, { box }), JSON.stringify(ref));
    }
  }
  assert.equal(buildReviewExercise(c, { kind: 'w', unitId: 'gibt-es-nicht', index: 0 }), null);
});

test('validateCourse: neue optionale Felder (§9.1) werden angenommen und geprüft', () => {
  const ok = validateCourse(zhCourse());
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
  const broken = (mutate) => {
    const c = zhCourse();
    mutate(c, c.levels[0].units[0]);
    return validateCourse(c).errors.join(' ');
  };
  assert.match(broken((c, u) => { u.sentences[0].tokens = ['我', '是', '学']; }), /tokens ergeben/);
  assert.match(broken((c, u) => { u.sentences[0].tokens = ['我', '是', '学生', '吗']; }), /tokens ergeben/);
  assert.match(broken((c, u) => { u.sentences[0].tokens = ['我 是', '学生']; }), /tokens muss/);
  assert.match(broken((c, u) => { u.sentences[0].tokens = ['我', '是', '学生', '。']; }), /tokens muss/);
  assert.match(broken((c, u) => { u.sentences[0].tokens = 'x'; }), /tokens muss/);
  assert.match(broken((c, u) => { u.sentences[0].tokens = []; }), /tokens muss/);
  assert.match(broken((c, u) => { u.words[0].reading = 3; }), /reading/);
  assert.match(broken((c, u) => { u.words[0].reading = 'x'.repeat(301); }), /reading/);
  assert.match(broken((c, u) => { u.words[0].tags = ['hsk 1']; }), /tags/);
  assert.match(broken((c, u) => { u.words[0].tags = 'hsk1'; }), /tags/);
  assert.match(broken((c, u) => { u.words[0].tags = Array(21).fill('t'); }), /tags/);
  assert.match(broken((c, u) => { u.sentences[2].source = { id: '1' }; }), /source/);
  assert.match(broken((c, u) => { u.sentences[2].source = { name: 'X', url: 'javascript:alert(1)' }; }), /source/);
  assert.match(broken((c) => { c.attribution = [{ name: 'X' }]; }), /attribution 1/);
  assert.match(broken((c) => { c.attribution = 'X'; }), /attribution/);
  assert.match(broken((c) => { c.generated = 'ja'; }), /generated/);
  assert.match(broken((c) => { c.license = 5; }), /license/);
});

test('validateCourse: tokens auch bei Sprachen mit Leerzeichen; zh ohne tokens/reading → nur Warnung', () => {
  const en = structuredClone(courses[0]);
  en.levels[0].units[0].sentences[0].tokens = ['Hello', 'I', 'am', 'Anna'];
  assert.deepEqual(validateCourse(en).errors, []);
  const c = zhCourse();
  delete c.levels[0].units[0].sentences[0].tokens;
  delete c.levels[0].units[0].words[0].reading;
  const v = validateCourse(c);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 2);
  assert.match(v.warnings.join(' '), /ohne tokens/);
  assert.match(v.warnings.join(' '), /ohne reading/);
});
