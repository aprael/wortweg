import test from 'node:test';
import assert from 'node:assert/strict';
import { listLessons } from '../src/content.js';
import { buildLesson, buildCheckpoint, fallbackExercise, lessonItems, buildReviewExercise, sentenceTokens } from '../src/exercises.js';
import { gradeExercise, gradeMatchAttempt, solutionResponse, normalize, tokenize } from '../src/grading.js';
import { createSession, recordAnswer, advance, isFinished, currentItem, summarize, gradeSubmission } from '../src/session.js';
import { loadCourse } from './helpers.mjs';
import { zhCourse } from './zh-mini-course.mjs';

const course = loadCourse('de-en.json');
const courses = [course, loadCourse('de-es.json')];
const unit = course.levels[0].units[0];
const OPTION_SETS = [
  { listening: false, speaking: false },
  { listening: true, speaking: false },
  { listening: false, speaking: true },
  { listening: true, speaking: true },
];

/** Eine sicher falsche Antwort passend zum Übungstyp. */
function wrongResponse(ex) {
  if (ex.type === 'choice' || ex.type === 'fill') return ex.choices.find((c) => c !== ex.answer);
  if (ex.type === 'order') return tokenize(ex.solution).slice(0, -1);
  if (ex.type === 'match') return [[ex.pairs[0][0], ex.pairs[1][1]], ...ex.pairs];
  return 'zzz qqq';
}

/** Spielt eine Lektion wie der Browser durch (Warteschlange mit Wiederholung) und sammelt die Rohantworten. */
function playInBrowser(exercises, answerFor, c = course) {
  let s = createSession(exercises);
  const responses = {};
  while (!isFinished(s)) {
    const item = currentItem(s);
    const { response, fallback } = answerFor(item.ex, item.retry ? 1 : 0);
    const ex = fallback ? fallbackExercise(item.ex, c) : item.ex;
    const correct = gradeExercise(ex, response).correct;
    const entry = responses[item.ex.id] ?? (responses[item.ex.id] = { answers: [] });
    entry.answers.push(response);
    if (fallback) entry.fallback = true;
    s = advance(recordAnswer(s, correct));
  }
  return { session: s, responses };
}

// --- Paare zuordnen ---------------------------------------------------------------------------------

test('match: 4 eindeutige Wortpaare der Lektion, getrennt gemischt, IDs l0../r0..', () => {
  for (const l of listLessons(course)) {
    const ex = buildLesson(course, l.unit, l.index).find((e) => e.type === 'match');
    assert.ok(ex, l.id);
    assert.equal(ex.instruction, 'Finde die Paare.');
    assert.equal(ex.pairs.length, 4);
    assert.deepEqual(ex.left.map((x) => x.id), ['l0', 'l1', 'l2', 'l3']);
    assert.deepEqual(ex.right.map((x) => x.id), ['r0', 'r1', 'r2', 'r3']);
    assert.ok(ex.left.every((x) => x.lang === course.nativeLang) && ex.right.every((x) => x.lang === course.targetLang));
    assert.equal(ex.ref, undefined);
    assert.equal(ex.refs.length, 4);
    const lessonWords = lessonItems(l.unit, l.index).filter((r) => r.kind === 'w');
    for (const [i, [lid, rid]] of ex.pairs.entries()) {
      const ref = ex.refs[i];
      assert.ok(lessonWords.some((r) => r.index === ref.index && r.unitId === ref.unitId), 'Wort aus der Lektion');
      const word = l.unit.words[ref.index];
      assert.equal(ex.left.find((x) => x.id === lid).text, word.native[0]);
      assert.equal(ex.right.find((x) => x.id === rid).text, word.target[0]);
    }
    assert.equal(new Set(ex.left.map((x) => normalize(x.text, course.nativeLang))).size, 4);
    assert.equal(new Set(ex.right.map((x) => normalize(x.text, course.targetLang))).size, 4);
  }
});

test('match: doppelte Texte werden übersprungen, damit jede Zuordnung eindeutig ist', () => {
  const words = [
    { native: ['Hallo'], target: ['hello', 'hi'] },
    { native: ['Hi'], target: ['hi'] }, // Zielvariante „hi“ doppelt → übersprungen
    { native: ['hallo!'], target: ['hey'] }, // gleiche Muttersprache (normalisiert) → übersprungen
    { native: ['danke'], target: ['thanks'] },
    { native: ['bitte'], target: ['please'] },
    { native: ['ja'], target: ['yes'] },
  ];
  const sentences = Array.from({ length: 4 }, (_, i) => ({ native: [`Satz ${i}.`], target: [`Sentence number ${i}.`], note: 'n' }));
  const c = { ...course, levels: [{ id: 'x', title: 'X', units: [{ id: 'u', title: 'U', words, sentences }] }] };
  const ex = buildLesson(c, c.levels[0].units[0], 0).find((e) => e.type === 'match');
  // Lektionswörter 0–3 → nur 0 und 3 eindeutig; aufgefüllt mit den übrigen Wörtern der Einheit (4, 5).
  assert.deepEqual(ex.refs.map((r) => r.index), [0, 3, 4, 5]);
  assert.equal(gradeExercise(ex, ex.pairs).correct, true);
});

test('match: Bewertung je Versuch und gesamt (alle Versuche richtig und alle Paare gefunden)', () => {
  const ex = buildLesson(course, unit, 0).find((e) => e.type === 'match');
  const [p0, p1] = ex.pairs;
  assert.equal(gradeMatchAttempt(ex, p0[0], p0[1]), true);
  assert.equal(gradeMatchAttempt(ex, p0[0], p1[1]), false);
  assert.equal(gradeMatchAttempt(ex, 'l9', 'r0'), false);
  assert.equal(gradeMatchAttempt(ex, 1, 2), false);
  assert.equal(gradeMatchAttempt(null, 'l0', 'r0'), false);
  assert.equal(gradeExercise(ex, [...ex.pairs].reverse()).correct, true, 'Reihenfolge egal');
  assert.equal(gradeExercise(ex, [[p0[0], p1[1]], ...ex.pairs]).correct, false, 'ein Fehlversuch → falsch');
  assert.equal(gradeExercise(ex, ex.pairs.slice(0, 3)).correct, false, 'nicht alle gefunden');
  assert.equal(gradeExercise(ex, [...ex.pairs.slice(0, 3), p0]).correct, false, 'Paar doppelt statt fehlend');
  assert.equal(gradeExercise(ex, [...ex.pairs, p0]).correct, false);
});

// --- Sprechen ---------------------------------------------------------------------------------------

test('speak: nur mit speaking, zeigt den Zielsatz, Bewertung mit Tippfehler-Toleranz', () => {
  assert.ok(!buildLesson(course, unit, 0, { listening: true }).some((e) => e.type === 'speak'));
  const list = buildLesson(course, unit, 0, { speaking: true });
  const ex = list.find((e) => e.type === 'speak');
  assert.equal(ex.instruction, 'Sprich diesen Satz.');
  const s = unit.sentences[ex.ref.index];
  assert.equal(ex.question, s.target[0]);
  assert.equal(ex.speak, s.target[0]);
  assert.equal(ex.questionLang, course.targetLang);
  assert.equal(ex.speakLang, course.ttsLang);
  assert.deepEqual(ex.accepted, s.target);
  assert.equal(gradeExercise(ex, s.target[0].toLowerCase().replace(/[.,!?]/g, '')).correct, true);
  // Sprechen kommt nach der Übersetzung desselben Satzes (der gezeigte Satz verrät nichts mehr).
  const tIdx = list.findIndex((e) => e.type === 'translate' && e.ref.kind === 's' && e.ref.index === ex.ref.index);
  assert.ok(tIdx >= 0 && tIdx < list.indexOf(ex));
  // Langer Satz mit kleinem Erkennungsfehler.
  const speak = { ...ex, accepted: ['There is a table in the kitchen.'] };
  assert.equal(gradeExercise(speak, 'there is a tabel in the kitchen').correct, true);
  assert.equal(gradeExercise(speak, 'there is a chair in the kitchen').correct, false);
});

// --- Lektionsaufbau ---------------------------------------------------------------------------------

test('Lektion: 10 Übungen (mit Sprechen 11), feste Typfolge, lückenlose IDs', () => {
  const order = (o) => buildLesson(course, unit, 0, o).map((e) => e.type);
  assert.deepEqual(order({}), ['choice', 'choice', 'match', 'order', 'choice', 'fill', 'translate', 'translate', 'order', 'translate']);
  assert.deepEqual(order({ listening: true, speaking: true }),
    ['choice', 'choice', 'match', 'order', 'choice', 'fill', 'translate', 'translate', 'listen', 'speak', 'translate']);
  for (const c of courses) {
    for (const l of listLessons(c)) {
      for (const o of OPTION_SETS) {
        const list = buildLesson(c, l.unit, l.index, { ...o, seed: 3 });
        assert.equal(list.length, o.speaking ? 11 : 10, l.id);
        assert.deepEqual(list.map((e) => e.id), list.map((_, i) => `${l.id}:${i + 1}`));
        assert.deepEqual(list, buildLesson(c, l.unit, l.index, { ...o, seed: 3 }), 'deterministisch');
      }
    }
  }
});

// --- Fallback ---------------------------------------------------------------------------------------

test('fallbackExercise: Hören/Sprechen → Übersetzen desselben Satzes mit allen Zielvarianten', () => {
  const list = buildLesson(course, unit, 0, { listening: true, speaking: true });
  for (const type of ['listen', 'speak']) {
    const ex = list.find((e) => e.type === type);
    const s = unit.sentences[ex.ref.index];
    const fb = fallbackExercise(ex, course);
    assert.equal(fb.type, 'translate');
    assert.equal(fb.id, ex.id);
    assert.deepEqual(fb.ref, ex.ref);
    assert.equal(fb.question, s.native[0]);
    assert.equal(fb.questionLang, course.nativeLang);
    assert.deepEqual(fb.accepted, s.target);
    for (const t of s.target) assert.equal(gradeExercise(fb, t).correct, true);
  }
  const choice = list.find((e) => e.type === 'choice');
  assert.equal(fallbackExercise(choice, course), choice, 'andere Typen unverändert');
  const listen = list.find((e) => e.type === 'listen');
  const lost = { ...listen, ref: { kind: 's', unitId: 'gibt-es-nicht', index: 0 } };
  assert.equal(fallbackExercise(lost, course), lost, 'unbekannter Satz → unverändert');
});

// --- Checkpoint -------------------------------------------------------------------------------------

test('Checkpoint: 10–12 Übungen aus allen Einheiten des Abschnitts, IDs cp:<levelId>:<n>, deterministisch', () => {
  for (const c of courses) {
    for (const level of c.levels) {
      const unitIds = new Set(level.units.map((u) => u.id));
      for (const o of OPTION_SETS) {
        const list = buildCheckpoint(c, level, { ...o, seed: 7 });
        assert.equal(list.length, 10 + (o.listening ? 1 : 0) + (o.speaking ? 1 : 0), `${level.id} ${JSON.stringify(o)}`);
        assert.deepEqual(list.map((e) => e.id), list.map((_, i) => `cp:${level.id}:${i + 1}`));
        assert.deepEqual(list, buildCheckpoint(c, level, { ...o, seed: 7 }));
        const types = new Set(list.map((e) => e.type));
        for (const t of ['choice', 'order', 'translate', 'fill']) assert.ok(types.has(t), `${level.id}: ${t}`);
        assert.equal(types.has('listen'), o.listening);
        assert.equal(types.has('speak'), o.speaking);
        const refs = list.flatMap((e) => e.refs ?? [e.ref]);
        assert.ok(refs.every((r) => unitIds.has(r.unitId)), 'nur Einheiten dieses Abschnitts');
        const used = new Set(refs.map((r) => r.unitId));
        assert.equal(used.size, unitIds.size, `${level.id}: alle Einheiten kommen vor`);
        for (const ex of list) assert.equal(gradeExercise(ex, solutionResponse(ex)).correct, true, ex.id);
      }
    }
  }
  const lvl = course.levels[0];
  assert.ok(buildCheckpoint(course, lvl).some((e) => e.type === 'match'));
  assert.notDeepEqual(buildCheckpoint(course, lvl, { seed: 1 }), buildCheckpoint(course, lvl, { seed: 2 }));
});

// --- gradeSubmission --------------------------------------------------------------------------------

test('gradeSubmission ≡ Browser-Ablauf (createSession/recordAnswer/summarize) über alle Lektionen', () => {
  const scenarios = {
    'alles richtig': (ex) => ({ response: solutionResponse(ex) }),
    'jede 3. falsch, dann richtig': (ex, attempt) => {
      const n = Number(ex.id.split(':').at(-1));
      return { response: n % 3 === 0 && attempt === 0 ? wrongResponse(ex) : solutionResponse(ex) };
    },
    'gemischt mit zweimal falsch': (ex) => {
      const n = Number(ex.id.split(':').at(-1));
      return { response: n % 4 === 1 || ex.type === 'match' ? wrongResponse(ex) : solutionResponse(ex) };
    },
    'Hören/Sprechen per Fallback': (ex, attempt) => {
      const fallback = ex.type === 'listen' || ex.type === 'speak';
      return { response: attempt === 0 && ex.type === 'speak' ? 'falsch gesprochen' : solutionResponse(ex), fallback };
    },
  };
  let checked = 0;
  for (const l of listLessons(course)) {
    for (const o of OPTION_SETS) {
      const exercises = buildLesson(course, l.unit, l.index, { ...o, seed: l.index });
      for (const [name, answerFor] of Object.entries(scenarios)) {
        const { session, responses } = playInBrowser(exercises, answerFor);
        // Rundlauf über JSON wie beim Versand an den Server.
        const server = gradeSubmission(exercises, JSON.parse(JSON.stringify(responses)), course);
        const sum = summarize(session);
        assert.deepEqual(
          { total: server.total, firstTryCorrect: server.firstTryCorrect, accuracy: server.accuracy, wrongRefs: server.wrongRefs },
          sum, `${l.id} ${name}`,
        );
        assert.deepEqual(server.results, session.results, `${l.id} ${name}`);
        checked++;
      }
    }
  }
  assert.equal(checked, listLessons(course).length * OPTION_SETS.length * 4);
});

test('gradeSubmission: falsche Antworten zählen, match → alle Refs, wrongRefs ohne Duplikate', () => {
  const exercises = buildLesson(course, unit, 0);
  const all = Object.fromEntries(exercises.map((ex) => [ex.id, { answers: [wrongResponse(ex)] }]));
  const r = gradeSubmission(exercises, all, course);
  assert.equal(r.firstTryCorrect, 0);
  assert.equal(r.accuracy, 0);
  const keys = r.wrongRefs.map((x) => `${x.kind}|${x.unitId}|${x.index}`);
  assert.equal(new Set(keys).size, keys.length, 'keine Duplikate');
  const match = exercises.find((e) => e.type === 'match');
  for (const ref of match.refs) assert.ok(keys.includes(`w|${ref.unitId}|${ref.index}`));
  // Alle Lernobjekte der Lektion sind betroffen.
  assert.deepEqual(new Set(keys), new Set(lessonItems(unit, 0).map((x) => `${x.kind}|${x.unitId}|${x.index}`)));
});

test('gradeSubmission: fehlende, kaputte oder fremde Antworten gelten als falsch, ohne zu werfen', () => {
  const exercises = buildLesson(course, unit, 0, { listening: true });
  const good = (ex) => ({ answers: [solutionResponse(ex)] });
  for (const bad of [null, undefined, 42, 'x', [], {}]) {
    const r = gradeSubmission(exercises, bad, course);
    assert.equal(r.total, exercises.length);
    assert.equal(r.firstTryCorrect, 0);
  }
  const responses = Object.fromEntries(exercises.map((ex) => [ex.id, good(ex)]));
  const [e1, e2, , e3, e4] = exercises; // Übung 3 ist „match“ (ohne ref)
  responses[e1.id] = { answers: [solutionResponse(e1), 'x', 'y'] }; // zu viele Versuche
  responses[e2.id] = { answers: 'nope' };
  delete responses[e3.id];
  responses[e4.id] = { answers: [wrongResponse(e4)] }; // falsch ohne zweiten Versuch
  const extra = JSON.parse('{"__proto__": {"answers": ["x"]}, "fremd": {"answers": ["x"]}}');
  const r = gradeSubmission(exercises, { ...responses, ...extra }, course);
  assert.equal(r.total, exercises.length);
  assert.equal(r.firstTryCorrect, exercises.length - 4);
  assert.deepEqual(r.results[e3.id], { ref: e3.ref, refs: [e3.ref], attempts: 0, firstTry: false, finalCorrect: false });
  assert.deepEqual(r.results[e4.id], { ref: e4.ref, refs: [e4.ref], attempts: 1, firstTry: false, finalCorrect: false });
  assert.ok(!('fremd' in r.results));
  // Zweiter Versuch nach richtigem ersten wird ignoriert.
  const r2 = gradeSubmission([e1], { [e1.id]: { answers: [solutionResponse(e1), 'egal'] } }, course);
  assert.equal(r2.results[e1.id].attempts, 1);
  assert.equal(gradeSubmission([], {}, course).accuracy, 0);
});

test('gradeSubmission: fallback:true bewertet Hören als Übersetzung (alle Zielvarianten)', () => {
  const ex = buildLesson(course, unit, 0, { listening: true }).find((e) => e.type === 'listen');
  const alt = unit.sentences[ex.ref.index].target.at(-1);
  assert.equal(gradeSubmission([ex], { [ex.id]: { answers: [alt], fallback: true } }, course).firstTryCorrect, 1);
  // Ohne fallback zählt bei Hören nur der gesprochene Satz.
  if (alt !== ex.speak) assert.equal(gradeSubmission([ex], { [ex.id]: { answers: [alt] } }, course).firstTryCorrect, 0);
});

// --- Chinesisch (§9.2) -------------------------------------------------------------------------------

const zh = zhCourse();

test('zh: alle Lektionen und Checkpoints – Musterlösungen richtig, deterministisch, Pinyin-Felder', () => {
  for (const o of OPTION_SETS) {
    const all = [
      ...listLessons(zh).map((l) => [l.id, buildLesson(zh, l.unit, l.index, { ...o, seed: 5 }), () => buildLesson(zh, l.unit, l.index, { ...o, seed: 5 })]),
      ...zh.levels.map((lv) => [lv.id, buildCheckpoint(zh, lv, { ...o, seed: 5 }), () => buildCheckpoint(zh, lv, { ...o, seed: 5 })]),
    ];
    for (const [name, list, again] of all) {
      assert.deepEqual(list, again(), `${name}: deterministisch`);
      for (const ex of list) {
        assert.equal(gradeExercise(ex, solutionResponse(ex)).correct, true, `${ex.id} (${ex.type})`);
        assert.equal(typeof ex.reading === 'string' || ex.type === 'match', true, `${ex.id}: reading`);
        if (ex.choiceReadings) assert.equal(ex.choiceReadings.length, ex.choices.length);
        if (ex.type === 'choice' && ex.answerLang === 'zh') assert.ok(ex.choiceReadings.every(Boolean), ex.id);
        if (ex.type === 'match') {
          assert.deepEqual(ex.rightReadings, ex.right.map((r) => r.reading));
          assert.ok(ex.right.every((r) => r.reading));
        }
        if (ex.type === 'order') {
          assert.equal(ex.solutionTokens.join(''), ex.solution.replace(/[。！？，]/g, ''));
          for (const t of ex.solutionTokens) assert.ok(ex.bank.some((b) => b.text === t), `${ex.id}: ${t}`);
          assert.ok(ex.bank.every((b) => b.reading), `${ex.id}: Pinyin je Baustein`);
        }
        if (ex.type === 'fill') assert.equal(ex.parts.before + ex.answer + ex.parts.after, ex.solution, ex.id);
      }
    }
  }
});

test('zh: Satzbau-Bausteine kommen aus tokens; ohne tokens Einzelzeichen', () => {
  const unit = zh.levels[0].units[0];
  const ex = buildLesson(zh, unit, 0).find((e) => e.type === 'order');
  const s = unit.sentences[ex.ref.index];
  assert.deepEqual(ex.solutionTokens, s.tokens);
  assert.equal(gradeExercise(ex, s.tokens).exact, true);
  assert.equal(gradeExercise(ex, [...s.tokens].reverse()).correct, false);
  const noTokens = { ...s, tokens: undefined };
  assert.deepEqual(sentenceTokens(noTokens, 'zh'), Array.from(s.target[0].replace(/[。！？，]/g, '')));
  assert.deepEqual(sentenceTokens({ target: ['老师，再见！'] }, 'zh'), ['老', '师', '再', '见']);
  const c = zhCourse();
  for (const x of c.levels[0].units[0].sentences) delete x.tokens;
  for (const l of listLessons(c)) {
    for (const e of buildLesson(c, l.unit, l.index)) assert.equal(gradeExercise(e, solutionResponse(e)).correct, true, e.id);
  }
});

test('zh: Übersetzen nimmt Hanzi und Pinyin an; Rückwärts-Auswahl zeigt Pinyin zur Frage', () => {
  const unit = zh.levels[0].units[0];
  const list = buildLesson(zh, unit, 0, { listening: true, speaking: true });
  const word = list.find((e) => e.type === 'translate' && e.ref.kind === 'w');
  const w = unit.words[word.ref.index];
  assert.equal(word.instruction, 'Übersetze ins Chinesische.');
  assert.equal(word.reading, w.reading);
  assert.equal(gradeExercise(word, w.target[0]).exact, true);
  assert.equal(gradeExercise(word, w.reading).correct, true);
  assert.match(gradeExercise(word, w.reading.normalize('NFD').replace(/[\u0300-\u036f]/g, '')).hint, /ohne Töne/);
  const reverse = list.find((e) => e.type === 'choice' && e.answerLang === 'de');
  assert.equal(reverse.reading, unit.words[reverse.ref.index].reading);
  assert.equal(reverse.choiceReadings, undefined, 'deutsche Optionen ohne Pinyin');
  const sentence = list.find((e) => e.type === 'translate' && e.ref.kind === 's');
  assert.equal(gradeExercise(sentence, unit.sentences[sentence.ref.index].reading).correct, true);
  // Hören/Sprechen-Fallback behält Pinyin.
  const listen = list.find((e) => e.type === 'listen');
  const fb = fallbackExercise(listen, zh);
  assert.equal(fb.reading, listen.reading);
  assert.equal(gradeExercise(fb, 'laoshi zaijian').correct, true);
  // Wiederholung nutzt dieselben Bausteine.
  const review = buildReviewExercise(zh, { kind: 's', unitId: unit.id, index: 1 }, { box: 0 });
  assert.equal(review.type, 'order');
  assert.equal(gradeExercise(review, unit.sentences[1].tokens).exact, true);
});

test('zh: Kurse ohne reading bleiben unverändert (keine neuen Felder)', () => {
  const ex = buildLesson(course, unit, 0, { listening: true, speaking: true });
  for (const e of ex) {
    assert.equal('reading' in e, false, e.id);
    assert.equal('choiceReadings' in e, false, e.id);
    assert.equal('rightReadings' in e, false, e.id);
  }
});

test('zh: gradeSubmission ≡ Browser-Ablauf (inkl. Pinyin-Antworten)', () => {
  for (const l of listLessons(zh)) {
    const exercises = buildLesson(zh, l.unit, l.index, { listening: true, speaking: true, seed: 2 });
    const answerFor = (ex, attempt) => {
      const n = Number(ex.id.split(':').at(-1));
      if (n % 3 === 0 && attempt === 0) return { response: wrongResponse(ex) };
      if (ex.type === 'translate' && ex.reading) return { response: ex.reading };
      return { response: solutionResponse(ex), fallback: ex.type === 'listen' };
    };
    const { session, responses } = playInBrowser(exercises, answerFor, zh);
    const server = gradeSubmission(exercises, JSON.parse(JSON.stringify(responses)), zh);
    assert.deepEqual(server.results, session.results, l.id);
    assert.deepEqual(server.wrongRefs, summarize(session).wrongRefs);
  }
});
