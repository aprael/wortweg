// fetch-Wrapper src/api.js mit nachgebautem fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/api.js';

const realFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('GET: same-origin, JSON, Daten ohne Hülle', async () => {
  const calls = fakeFetch(() => response(200, { ok: true, user: null }));
  const r = await api.getMe();
  assert.deepEqual(r, { ok: true, user: null });
  assert.equal(calls[0].url, '/api/me');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.body, undefined);
});

test('POST/PATCH: JSON-Body und Content-Type', async () => {
  const calls = fakeFetch(() => response(200, { ok: true, state: {} }));
  await api.saveSettings({ dailyGoal: 10 });
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { dailyGoal: 10 });
  await api.startGuest();
  assert.equal(calls[1].init.body, '{}');
  await api.submitLesson({ courseId: 'de-en', lessonId: 'u:0', version: 3, seed: 0, options: { listening: false, speaking: false }, responses: {}, xp: 999 });
  assert.deepEqual(Object.keys(JSON.parse(calls[2].init.body)).sort(), ['courseId', 'lessonId', 'options', 'responses', 'seed', 'version'], 'nie XP mitschicken');
  await api.adminDeleteItem(5);
  assert.equal(calls[3].init.method, 'DELETE');
  assert.equal(calls[3].url, '/api/admin/items/5');
});

test('Server-Fehler → ApiError mit status, code, Meldung und Details', async () => {
  fakeFetch(() => response(409, { ok: false, error: { code: 'course_changed', message: 'Der Kurs wurde geändert.', version: 4 } }));
  await assert.rejects(api.submitReview({ courseId: 'x', version: 1, responses: {} }), (err) => {
    assert.ok(err instanceof api.ApiError);
    assert.equal(err.status, 409);
    assert.equal(err.code, 'course_changed');
    assert.equal(err.message, 'Der Kurs wurde geändert.');
    assert.equal(err.details.version, 4);
    return true;
  });
  fakeFetch(() => response(400, { ok: false, error: { code: 'not_publishable', message: 'x', errors: ['a', 'b'] } }));
  await assert.rejects(api.adminUpdateCourse('x', { status: 'published' }), (err) => err.details.errors.length === 2);
});

test('Fehler ohne JSON → deutsche Ersatzmeldung', async () => {
  fakeFetch(() => response(404, 'Nicht gefunden'));
  await assert.rejects(api.getCourse('nix'), (err) => err.status === 404 && err.code === 'http_404' && /Nicht gefunden/.test(err.message));
  fakeFetch(() => response(502, ''));
  await assert.rejects(api.getStats(), (err) => err.status === 502 && /Server/.test(err.message));
});

test('Netzwerkfehler → status 0 mit eigener Meldung', async () => {
  fakeFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(api.getProgress(), (err) => err.status === 0 && err.code === 'network' && err.isNetwork && err.message === api.NETWORK_MESSAGE);
});

test('Download-Endpunkte: Rohdaten und Dateiname', async () => {
  fakeFetch(() => response(200, { app: 'wortweg', version: 2, state: {} }, { 'Content-Disposition': 'attachment; filename="wortweg-fortschritt-2026-10-20.json"' }));
  const { data, filename } = await api.exportProgress();
  assert.equal(data.app, 'wortweg');
  assert.equal(filename, 'wortweg-fortschritt-2026-10-20.json');
  assert.equal(api.filenameFromDisposition('attachment; filename="../x y.json"', 'f'), '.._x_y.json');
  assert.equal(api.filenameFromDisposition(null, 'f'), 'f');
});

test('Pfade werden kodiert', async () => {
  const calls = fakeFetch(() => response(200, { ok: true }));
  await api.getCourse('a/b', { preview: true });
  assert.equal(calls[0].url, '/api/courses/a%2Fb?preview=1');
});
