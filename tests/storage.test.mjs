import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readLegacyState, clearLegacyState, legacyExportPayload, parseJsonText, checkProgressExport, summarizeState, readFileText,
  LEGACY_STATE_KEY,
} from '../src/storage.js';
import { createInitialState, applyLessonResult, sanitizeState } from '../src/progress.js';
import { listLessons } from '../src/content.js';
import { lessonItems } from '../src/exercises.js';
import { loadCourse, memoryBackend, T0 } from './helpers.mjs';

const course = loadCourse('de-en.json');
const lesson = listLessons(course)[0];
const played = () => applyLessonResult(createInitialState(), {
  courseId: course.id, lessonId: lesson.id, total: 9, firstTryCorrect: 9, items: lessonItems(lesson.unit, 0), wrongRefs: [], now: T0,
}).state;

/** So sah der Stand der lokalen Version 0.1 aus (Zustand v1, ohne checkpoints/speaking). */
function v1State() {
  const s = played();
  const { speaking: _s, ...settings } = s.settings;
  return {
    ...s,
    version: 1,
    courses: Object.fromEntries(Object.entries(s.courses).map(([id, c]) => [id, { completed: c.completed }])),
    settings,
  };
}

test('alter lokaler Stand wird gelesen und zusammengefasst', () => {
  const backend = memoryBackend();
  backend.setItem(LEGACY_STATE_KEY, JSON.stringify(v1State()));
  const lg = readLegacyState(backend);
  assert.ok(lg);
  assert.equal(lg.raw.version, 1);
  assert.equal(lg.summary.lessons, 1);
  assert.equal(lg.summary.xpTotal, 19);
  assert.ok(lg.summary.items > 0);
  assert.equal(lg.state.version, 2, 'bereinigt auf Zustand v2');
});

test('kein, leerer oder kaputter alter Stand → null', () => {
  assert.equal(readLegacyState(memoryBackend()), null);
  const empty = memoryBackend();
  empty.setItem(LEGACY_STATE_KEY, JSON.stringify(createInitialState()));
  assert.equal(readLegacyState(empty), null, 'Startzustand ohne Fortschritt wird nicht angeboten');
  const broken = memoryBackend();
  broken.setItem(LEGACY_STATE_KEY, '{kaputt');
  assert.equal(readLegacyState(broken), null);
  broken.setItem(LEGACY_STATE_KEY, '[1,2]');
  assert.equal(readLegacyState(broken), null);
  assert.equal(readLegacyState(null), null, 'ohne Speicher');
});

test('gesperrter Speicher wirft nicht', () => {
  const backend = { getItem: () => { throw new Error('SecurityError'); }, removeItem: () => { throw new Error('SecurityError'); } };
  assert.equal(readLegacyState(backend), null);
  assert.equal(clearLegacyState(backend), false);
});

test('Löschen entfernt nur den alten Stand', () => {
  const backend = memoryBackend();
  backend.setItem(LEGACY_STATE_KEY, JSON.stringify(v1State()));
  backend.setItem('anderer-schluessel', 'bleibt');
  assert.equal(clearLegacyState(backend), true);
  assert.equal(backend.getItem(LEGACY_STATE_KEY), null);
  assert.equal(backend.getItem('anderer-schluessel'), 'bleibt');
});

test('Importformat für den Server: { app, version: 1, state } und verlustfrei bereinigbar', () => {
  const raw = v1State();
  const payload = legacyExportPayload(raw);
  assert.deepEqual(Object.keys(payload).sort(), ['app', 'state', 'version']);
  assert.equal(payload.app, 'wortweg');
  assert.equal(payload.version, 1);
  const again = sanitizeState(payload.state);
  assert.equal(again.xpTotal, raw.xpTotal);
  assert.deepEqual(again.courses[course.id].completed, raw.courses[course.id].completed);
  assert.equal(again.settings.speaking, false, 'Sprechen bleibt nach der Übernahme aus');
});

test('JSON-Dateien: verständliche Fehler', () => {
  assert.throws(() => parseJsonText('nope'), /kein gültiges JSON/);
  assert.throws(() => parseJsonText('[1]'), /kein JSON-Objekt/);
  assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
  assert.throws(() => checkProgressExport({ app: 'andere', state: {} }), /kein Wortweg-Fortschrittsexport/);
  assert.throws(() => checkProgressExport({ app: 'wortweg' }), /kein Wortweg-Fortschrittsexport/);
  const ok = { app: 'wortweg', version: 2, state: {} };
  assert.equal(checkProgressExport(ok), ok);
});

test('Dateien: Größenlimit', async () => {
  await assert.rejects(readFileText({ size: 3_000_000, text: async () => '' }), /zu groß/);
  assert.equal(await readFileText({ size: 2, text: async () => '{}' }), '{}');
  assert.equal(await readFileText(null), null);
});

test('summarizeState ist robust gegen fremde Formen', () => {
  assert.deepEqual(summarizeState(null), { xpTotal: 0, lessons: 0, items: 0, hasProgress: false });
  assert.equal(summarizeState(played()).hasProgress, true);
});
