import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, gradeText, gradeChoice, gradeOrder, tokenize, levenshtein, gradeExercise, solutionResponse, MAX_TEXT_LENGTH,
  parsePinyin, isChinese,
} from '../src/grading.js';
import { buildLesson } from '../src/exercises.js';
import { loadCourse } from './helpers.mjs';

test('normalize: Groß/Klein, Satzzeichen, Leerzeichen, Apostrophe', () => {
  assert.equal(normalize('  Hello,   I AM Anna! ', 'en'), 'hello i am anna');
  assert.equal(normalize('I’m hungry.', 'en'), 'i am hungry');
  assert.equal(normalize("He doesn't drink tea.", 'en'), 'he does not drink tea');
  assert.equal(normalize('Größe', 'de'), 'groesse');
});

test('Übersetzung: akzeptierte Alternativen und Kurzformen', () => {
  const acc = ['I am hungry.', "I'm hungry."];
  assert.equal(gradeText('i am hungry', acc, 'en').correct, true);
  assert.equal(gradeText("I'm hungry", acc, 'en').exact, true);
  assert.equal(gradeText('I have hunger', acc, 'en').correct, false);
  assert.equal(gradeText('', acc, 'en').correct, false);
});

test('Übersetzung: kleiner Tippfehler wird mit Hinweis akzeptiert', () => {
  const r = gradeText('My mothr is nice', ['My mother is nice.'], 'en');
  assert.equal(r.correct, true);
  assert.equal(r.exact, false);
  assert.match(r.hint, /Tippfehler/);
  assert.equal(gradeText('My brother is nice', ['My mother is nice.'], 'en').correct, false);
  assert.equal(gradeText('My mother is nice nice', ['My mother is nice.'], 'en').correct, false);
  assert.equal(gradeText('There is a tabel in the kitchen', ['There is a table in the kitchen.'], 'en').correct, true);
});

test('Übersetzung: kurze Wörter ohne Tippfehler-Toleranz', () => {
  assert.equal(gradeText('my naem is tom', ['My name is Tom.'], 'en').correct, true);
  assert.equal(gradeText('naem', ['name'], 'en').correct, false);
  assert.equal(gradeText('tee', ['tea'], 'en').correct, false);
  assert.equal(gradeText('no', ['yes'], 'en').correct, false);
});

test('Übersetzung: Akzente fehlen → richtig mit Hinweis', () => {
  const r = gradeText('Me gusta el cafe', ['Me gusta el café.'], 'es');
  assert.equal(r.correct, true);
  assert.match(r.hint, /Akzent/);
});

test('Deutsch: Umlaut-Umschreibung gilt als gleichwertig', () => {
  assert.equal(gradeText('Groesse', ['Größe'], 'de').exact, true);
});

test('Multiple Choice', () => {
  assert.equal(gradeChoice('hello', 'hello').correct, true);
  assert.equal(gradeChoice('bye', 'hello').correct, false);
  assert.equal(gradeChoice(null, 'hello').correct, false);
});

test('Satzbau: Reihenfolge zählt, keine Tippfehler-Toleranz', () => {
  const acc = ['My name is Tom.'];
  assert.equal(gradeOrder(['My', 'name', 'is', 'Tom'], acc, 'en').correct, true);
  assert.equal(gradeOrder(['name', 'My', 'is', 'Tom'], acc, 'en').correct, false);
  assert.equal(gradeOrder(['My', 'name', 'is'], acc, 'en').correct, false);
});

test('tokenize entfernt Satzzeichen am Rand', () => {
  assert.deepEqual(tokenize('¿Cómo te llamas?'), ['Cómo', 'te', 'llamas']);
  assert.deepEqual(tokenize("It's three o'clock."), ["It's", 'three', "o'clock"]);
});

test('levenshtein', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('tabel', 'table'), 1);
});

test('gradeExercise: Musterlösung je Typ richtig, Ergebnisform wie gradeText', () => {
  const c = loadCourse('de-en.json');
  for (const ex of buildLesson(c, c.levels[0].units[0], 0, { listening: true, speaking: true })) {
    const r = gradeExercise(ex, solutionResponse(ex));
    assert.equal(r.correct, true, ex.type);
    assert.deepEqual(Object.keys(r).sort(), ['correct', 'exact', 'hint', 'matched']);
  }
});

test('gradeExercise: falsche Antwortformen und bösartige Eingaben → falsch, nie eine Ausnahme', () => {
  const c = loadCourse('de-en.json');
  const list = buildLesson(c, c.levels[0].units[0], 0, { listening: true, speaking: true });
  const hostile = [
    undefined, null, 0, 42, NaN, true, '', {}, [], [[]], [null], [42], ['x'.repeat(10_000)], { toString: () => 'hello' },
    'x'.repeat(10_000), Array(10_000).fill('hello'), [['l0', 'r0', 'zu viel']], [['__proto__', 'constructor']],
    JSON.parse('{"__proto__": {"correct": true}}'), Array(65).fill(['l0', 'r0']),
  ];
  for (const ex of list) {
    for (const h of hostile) {
      const r = gradeExercise(ex, h);
      assert.equal(r.correct, false, `${ex.type}: ${String(h).slice(0, 20)}`);
      assert.equal(typeof r.matched, 'string');
    }
  }
  for (const ex of [null, undefined, 'x', {}, { type: 'unbekannt' }, { type: 'match' }, { type: 'order' }, { type: 'choice' }]) {
    assert.equal(gradeExercise(ex, 'hello').correct, false);
  }
});

test('gradeExercise: Längengrenze, Auswahl nur aus den Optionen, Satzbau nur aus der Bank', () => {
  const c = loadCourse('de-en.json');
  const list = buildLesson(c, c.levels[0].units[0], 0);
  const tr = list.find((e) => e.type === 'translate');
  const padded = tr.solution + ' '.repeat(MAX_TEXT_LENGTH);
  assert.equal(gradeText(padded, tr.accepted, tr.answerLang).correct, true, 'inhaltlich richtig …');
  assert.equal(gradeExercise(tr, padded).correct, false, '… aber zu lang');
  assert.equal(gradeExercise(tr, tr.solution.padEnd(MAX_TEXT_LENGTH)).correct, true, 'genau an der Grenze ok');
  const choice = list.find((e) => e.type === 'choice');
  assert.equal(gradeExercise(choice, ` ${choice.answer}`).correct, false);
  const order = list.find((e) => e.type === 'order');
  const tokens = tokenize(order.solution);
  assert.equal(gradeExercise(order, tokens).correct, true);
  assert.equal(gradeExercise(order, [tokens.join(' ')]).correct, false, 'Satz als ein Baustein, der nicht in der Bank ist');
  assert.equal(gradeExercise(order, [...tokens, tokens[0]]).correct, false);
  assert.equal(gradeExercise(order, [tokens[0], ...tokens]).correct, false, 'Baustein öfter als vorhanden');
});

// --- Chinesisch (§9.2) -------------------------------------------------------------------------------

test('zh: Normalisierung ohne Leerraum und Satzzeichen, Vollbreite → Halbbreite', () => {
  assert.equal(normalize('  我 是　学生。 ', 'zh'), '我是学生');
  assert.equal(normalize('“你好！”《书》（一）…——、；：，？', 'zh'), '你好书一');
  assert.equal(normalize('ＡＢＣ１２３！', 'zh'), 'abc123');
  assert.equal(normalize('Hello, World!', 'zh-CN'), 'helloworld');
  assert.equal(isChinese('zh-Hans'), true);
  assert.equal(isChinese('en'), false);
});

test('zh: Hanzi exakt (Leerraum/Satzzeichen egal), keine Tippfehler-Toleranz', () => {
  const acc = ['我是学生。'];
  assert.equal(gradeText('我 是 学生', acc, 'zh').exact, true);
  assert.equal(gradeText('我是学生！', acc, 'zh').exact, true);
  assert.equal(gradeText('我是學生', acc, 'zh').correct, false, 'Langzeichen sind ein anderes Zeichen');
  assert.equal(gradeText('我是学声', acc, 'zh').correct, false, 'ein falsches Zeichen');
  assert.equal(gradeText('我是学', acc, 'zh').correct, false, 'ein Zeichen fehlt');
  assert.equal(gradeText('你是学生', acc, 'zh').correct, false);
  const long = ['我们明天去北京看朋友。'];
  assert.equal(gradeText('我们明天去北京看朋有', long, 'zh').correct, false, 'auch lange Sätze ohne Toleranz');
  assert.equal(gradeText('多谢', ['谢谢', '多谢'], 'zh').exact, true);
});

test('zh: Pinyin mit Tonzeichen, Tonziffern oder ohne Töne', () => {
  const acc = ['我是学生。'];
  const readings = ['wǒ shì xuésheng.'];
  const g = (input) => gradeText(input, acc, 'zh', { readings });
  for (const ok of ['wǒ shì xuésheng', 'Wǒ shì xuésheng.', 'wǒshìxuésheng', 'wo3 shi4 xue2sheng', 'wo3shi4xue2sheng5', 'WO3 SHI4 XUE2 SHENG0']) {
    const r = g(ok);
    assert.equal(r.correct, true, ok);
    assert.equal(r.hint, 'Richtig in Pinyin.', ok);
    assert.equal(r.matched, '我是学生。');
  }
  for (const toneless of ['wo shi xuesheng', "wo shi xue'sheng", 'woshixuesheng']) {
    const r = g(toneless);
    assert.equal(r.correct, true, toneless);
    assert.match(r.hint, /ohne Töne/);
  }
  assert.match(g('wǒ shí xuésheng').hint, /Töne/, 'falscher Ton → richtig mit Hinweis');
  assert.equal(g('wo shi laoshi').correct, false);
  assert.equal(g('wo shi xueshen').correct, false, 'keine Tippfehler-Toleranz in Pinyin');
  assert.equal(gradeText('wo shi xuesheng', acc, 'zh').correct, false, 'ohne reading kein Pinyin');
  assert.equal(gradeText('ni hao', ['nǐ hǎo'], 'en', { readings: ['nǐ hǎo'] }).exact, false, 'Pinyin-Regeln nur bei zh');
});

test('zh: ü = v = u: in Pinyin, Apostrophe und Leerzeichen egal', () => {
  const r = (input) => gradeText(input, ['女儿'], 'zh', { readings: ["nǚ'ér"] });
  for (const x of ['nǚ ér', 'nǚér', 'nv3er2', 'nu:3 er2', "nü'er", 'nver', 'NÜ ÉR']) assert.equal(r(x).correct, true, x);
  assert.equal(r('nu er').correct, false, 'u ist nicht ü');
  assert.deepEqual(parsePinyin('nǚ\'ér'), { letters: 'nver', tones: [3, 2] });
  assert.deepEqual(parsePinyin('ni3 hao3'), { letters: 'nihao', tones: [3, 3] });
  assert.equal(parsePinyin('你好'), null);
  assert.equal(parsePinyin('ni9'), null);
  assert.equal(parsePinyin(''), null);
});

test('zh: Satzbau fügt ohne Leerzeichen zusammen', () => {
  const acc = ['你是老师吗？'];
  assert.equal(gradeOrder(['你', '是', '老师', '吗'], acc, 'zh').exact, true);
  assert.equal(gradeOrder(['是', '你', '老师', '吗'], acc, 'zh').correct, false);
  assert.equal(gradeOrder(['你', '是', '老师'], acc, 'zh').correct, false);
  assert.equal(gradeOrder(['My', 'name'], ['My name'], 'en').correct, true, 'andere Sprachen weiter mit Leerzeichen');
});
