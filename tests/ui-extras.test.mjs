// Neue reine Hilfsfunktionen der Oberfläche (Vorlesen, Stufen, Kronen, Regeltext, Wortkarten, Installationsanleitung)
// und der Zwischenstand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { speechFor, playerLevel, crownsFor, introHtml, newWordRefs, findWordIn, detectPlatform, installGuideFor } from '../src/app.js';
import { saveRunSnapshot, loadRunSnapshot, clearRunSnapshot, snapshotMatches, RUN_MAX_AGE } from '../src/run-store.js';
import { buildLesson, itemKey } from '../src/exercises.js';
import { createSession, recordAnswer, advance } from '../src/session.js';
import { createInitialState } from '../src/progress.js';
import { listLessons } from '../src/content.js';
import { loadCourse, T0 } from './helpers.mjs';

const course = loadCourse('de-en.json');
const lesson = listLessons(course)[0];

test('speechFor liest immer den zielsprachlichen Text: Frage oder Lösung', () => {
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed: 1, listening: true, speaking: true });
  const lang = course.ttsLang || course.targetLang;
  for (const ex of exercises) {
    const sp = speechFor(ex, course);
    if (['listen', 'speak', 'match'].includes(ex.type)) {
      assert.equal(sp, null, `${ex.type} hat eigene Knöpfe`);
      continue;
    }
    assert.ok(sp, ex.type);
    assert.equal(sp.lang, lang);
    if (ex.questionLang === course.targetLang) assert.deepEqual(sp, { text: ex.question, lang, reveals: false });
    else assert.deepEqual(sp, { text: ex.solution, lang, reveals: true });
  }
  assert.equal(speechFor(null, course), null);
});

test('playerLevel: Stufen wachsen, Rest und Bedarf stimmen', () => {
  assert.deepEqual(playerLevel(0), { level: 1, into: 0, need: 60 });
  assert.deepEqual(playerLevel(59), { level: 1, into: 59, need: 60 });
  assert.deepEqual(playerLevel(60), { level: 2, into: 0, need: 80 });
  assert.deepEqual(playerLevel(140), { level: 3, into: 0, need: 100 });
  assert.deepEqual(playerLevel(-5), { level: 1, into: 0, need: 60 });
  assert.deepEqual(playerLevel('x'), { level: 1, into: 0, need: 60 });
  const big = playerLevel(100000);
  assert.ok(big.level > 20 && big.into < big.need);
});

test('crownsFor: 1–3 Kronen nach Trefferquote, Checkpoint nicht bestanden = 0', () => {
  assert.equal(crownsFor('lesson', { accuracy: 1 }), 3);
  assert.equal(crownsFor('lesson', { accuracy: 0.9 }), 3);
  assert.equal(crownsFor('lesson', { accuracy: 0.75 }), 2);
  assert.equal(crownsFor('review', { accuracy: 0.2 }), 1);
  assert.equal(crownsFor('checkpoint', { accuracy: 0.95, passed: false }), 0);
  assert.equal(crownsFor('checkpoint', { accuracy: 0.95, passed: true }), 3);
});

test('introHtml: Absätze und Aufzählungen, alles escaped', () => {
  const html = introHtml('Regel <b>fett</b>?\n• a + el = al\n• de + el = del\n\nAusnahme: keine.\n- Strich zählt auch');
  assert.equal(html, '<p>Regel &lt;b&gt;fett&lt;/b&gt;?</p><ul class="rule-list"><li>a + el = al</li><li>de + el = del</li></ul><p>Ausnahme: keine.</p><ul class="rule-list"><li>Strich zählt auch</li></ul>');
  assert.equal(introHtml(''), '');
  assert.equal(introHtml(null), '');
});

test('findWordIn: nur ganze Wörter, Chinesisch als Teilstring', () => {
  assert.deepEqual(findWordIn('Abre la botella.', 'el', 'es'), [-1, 0]);
  assert.deepEqual(findWordIn('El perro come.', 'el', 'es'), [0, 2]);
  assert.deepEqual(findWordIn('¿Dónde está el baño?', 'el', 'es'), [12, 2]);
  assert.deepEqual(findWordIn('Hola, ¿qué tal?', 'qué tal', 'es'), [7, 7]);
  assert.deepEqual(findWordIn('我是学生。', '学生', 'zh'), [2, 2]);
  assert.deepEqual(findWordIn('a (b) c', '(b)', 'en'), [2, 3], 'Sonderzeichen im Wort sind kein Regex');
  assert.deepEqual(findWordIn('x', '', 'en'), [-1, 0]);
});

test('newWordRefs: nur Wörter der Lektion ohne Wiederholungs-Eintrag', () => {
  const state = createInitialState();
  const all = newWordRefs(state, course, lesson.unit, lesson.index);
  assert.ok(all.length > 0 && all.every((r) => r.kind === 'w' && r.unitId === lesson.unit.id));
  const seen = { ...state, review: { [itemKey(course.id, all[0])]: { box: 1 } } };
  const rest = newWordRefs(seen, course, lesson.unit, lesson.index);
  assert.equal(rest.length, all.length - 1);
  assert.ok(!rest.some((r) => r.index === all[0].index));
});

// ---------- Zwischenstand (localStorage) ----------

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

function snapshot(overrides = {}) {
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed: 0 });
  let session = createSession(exercises);
  session = advance(recordAnswer(session, true));
  return {
    v: 1, userId: 7, courseId: course.id, version: 3, kind: 'lesson', targetId: lesson.id, seed: 0,
    options: { listening: false, speaking: false }, hash: `#/lesson/${encodeURIComponent(lesson.id)}`, title: 'T',
    session, responses: { [exercises[0].id]: { answers: ['x'] } }, fallbackIds: [], skip: { listen: false, speak: false },
    savedAt: T0, ...overrides,
  };
}

test('Zwischenstand: speichern, laden, verwerfen; kaputt, alt oder fremd → null', (t) => {
  const store = fakeStorage();
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  t.after(() => {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  });

  assert.equal(loadRunSnapshot(T0), null);
  const snap = snapshot();
  saveRunSnapshot(snap);
  const back = loadRunSnapshot(T0 + 1000);
  assert.deepEqual(back, JSON.parse(JSON.stringify(snap)));
  assert.equal(loadRunSnapshot(T0 + RUN_MAX_AGE + 1), null, 'zu alt');

  const want = { userId: 7, courseId: course.id, version: 3, kind: 'lesson', targetId: lesson.id, seed: 0 };
  assert.ok(snapshotMatches(back, want));
  assert.ok(!snapshotMatches(back, { ...want, userId: 8 }), 'anderer Nutzer');
  assert.ok(!snapshotMatches(back, { ...want, version: 4 }), 'Kurs wurde geändert');
  assert.ok(!snapshotMatches(back, { ...want, seed: 1 }), 'Lektion wurde inzwischen abgeschlossen (neuer Seed)');
  assert.ok(!snapshotMatches(back, { ...want, targetId: 'x:1' }), 'andere Lektion');
  const done = { ...back, session: { ...back.session, pos: back.session.queue.length } };
  assert.ok(!snapshotMatches(done, want), 'fertige Runde wird nicht fortgesetzt');

  store.setItem('wortweg:run:v1', '{kaputt');
  assert.equal(loadRunSnapshot(T0), null);
  store.setItem('wortweg:run:v1', JSON.stringify({ ...snap, v: 2 }));
  assert.equal(loadRunSnapshot(T0), null, 'unbekannte Version');
  store.setItem('wortweg:run:v1', JSON.stringify({ ...snap, session: { queue: 'x', pos: 0 } }));
  assert.equal(loadRunSnapshot(T0), null, 'ungültige Sitzung');

  clearRunSnapshot();
  assert.equal(store.data.size, 0);
});

test('Zwischenstand: gesperrter Speicher wirft nicht', (t) => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const broken = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('voll'); }, removeItem() { throw new Error('gesperrt'); } };
  Object.defineProperty(globalThis, 'localStorage', { value: broken, configurable: true, writable: true });
  t.after(() => {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  });
  assert.doesNotThrow(() => saveRunSnapshot(snapshot()));
  assert.equal(loadRunSnapshot(T0), null);
  assert.doesNotThrow(() => clearRunSnapshot());
});

test('detectPlatform: Gerät und Browser für die Installationsanleitung', () => {
  const ua = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  };
  assert.deepEqual(detectPlatform({ userAgent: ua.iphone }), { os: 'ios', browser: 'safari' });
  assert.deepEqual(detectPlatform({ userAgent: ua.ipad, maxTouchPoints: 5 }), { os: 'ios', browser: 'safari' });
  assert.deepEqual(detectPlatform({ userAgent: ua.ipad, maxTouchPoints: 0 }), { os: 'mac', browser: 'safari' });
  assert.deepEqual(detectPlatform({ userAgent: ua.macChrome }), { os: 'mac', browser: 'chrome' });
  assert.deepEqual(detectPlatform({ userAgent: ua.winEdge }), { os: 'windows', browser: 'edge' });
  assert.deepEqual(detectPlatform({ userAgent: ua.winFirefox }), { os: 'windows', browser: 'firefox' });
  assert.deepEqual(detectPlatform({ userAgent: ua.android }), { os: 'android', browser: 'chrome' });
  assert.deepEqual(detectPlatform({ userAgent: ua.linux }), { os: 'other', browser: 'chrome' });
  assert.deepEqual(detectPlatform(), { os: 'other', browser: 'other' });

  const text = (p) => installGuideFor(p).steps.join(' ');
  assert.match(text({ os: 'ios', browser: 'safari' }), /Zum Home-Bildschirm/);
  assert.match(text({ os: 'android', browser: 'chrome' }), /App installieren/);
  // Windows und Mac: Download der Desktop-App – egal mit welchem Browser, mit ehrlichem Hinweis auf die Warnung.
  for (const browser of ['edge', 'chrome', 'firefox', 'safari']) {
    assert.match(text({ os: 'windows', browser }), /releases\/latest\/download\/Wortweg-Windows\.exe/);
    assert.match(text({ os: 'windows', browser }), /Trotzdem ausführen/);
    assert.match(text({ os: 'mac', browser }), /releases\/latest\/download\/Wortweg-Mac\.dmg/);
    assert.match(text({ os: 'mac', browser }), /Dennoch öffnen/);
  }
  assert.match(installGuideFor({ os: 'mac', browser: 'safari' }).alt, /Zum Dock hinzufügen/);
  for (const os of ['windows', 'mac']) assert.equal(installGuideFor({ os }).buttonSteps.length, 2);
  assert.match(text({ os: 'other', browser: 'firefox' }), /Chrome/);
  assert.match(text({ os: 'other', browser: 'chrome' }), /App installieren/);
});
