import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './server-helpers.mjs';
import { hashPassword, verifyPassword } from '../server/auth.mjs';

const t = await startTestServer();
test.after(() => t.close());

test('Passwort-Hash: scrypt mit Salt, richtiges und falsches Passwort', async () => {
  const a = await hashPassword('geheim-geheim');
  const b = await hashPassword('geheim-geheim');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('geheim-geheim', a), true);
  assert.equal(await verifyPassword('geheim-geheiM', a), false);
  assert.equal(await verifyPassword('x', 'kaputt'), false);
});

test('ohne Anmeldung: /api/me ist null, Fortschritt 401', async () => {
  const c = t.client();
  assert.deepEqual((await c.get('/api/me')).data, { ok: true, user: null });
  const r = await c.get('/api/progress');
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'unauthenticated');
});

test('Gast → Registrieren behält den Fortschritt, Abmelden, Anmelden', async () => {
  const c = t.client();
  const g = await c.post('/api/auth/guest');
  assert.equal(g.status, 200);
  assert.equal(g.data.user.isGuest, true);
  assert.match(g.headers.get('set-cookie'), /ww_session=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+/);
  assert.equal((await c.post('/api/auth/guest')).data.user.id, g.data.user.id, 'zweiter Gast-Klick legt kein neues Konto an');
  await c.patch('/api/progress/settings', { dailyGoal: 30 });

  const reg = await c.post('/api/auth/register', { email: 'Ana@Example.org ', password: 'sehr-sicheres-pw', displayName: '  Ana  ' });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.deepEqual(reg.data.user, { id: g.data.user.id, displayName: 'Ana', email: 'ana@example.org', role: 'learner', isGuest: false });
  assert.equal((await c.get('/api/progress')).data.state.dailyGoal, 30);

  const oldCookie = c.cookie;
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal(c.cookie, null);
  c.cookie = oldCookie;
  assert.equal((await c.get('/api/me')).data.user, null, 'alte Sitzung ist nach dem Abmelden ungültig');

  const login = await c.post('/api/auth/login', { email: 'ana@example.org', password: 'sehr-sicheres-pw' });
  assert.equal(login.status, 200);
  assert.equal((await c.get('/api/progress')).data.state.dailyGoal, 30);
  assert.equal((await t.client().post('/api/auth/register', { email: 'ana@example.org', password: 'noch-ein-passwort', displayName: 'X' })).status, 409);
});

test('Registrieren: Eingaben werden geprüft', async () => {
  const c = t.client();
  assert.equal((await c.post('/api/auth/register', { email: 'kaputt', password: 'sehr-sicheres-pw', displayName: 'A' })).data.error.code, 'invalid_email');
  assert.equal((await c.post('/api/auth/register', { email: 'b@example.org', password: 'kurz', displayName: 'A' })).data.error.code, 'weak_password');
  assert.equal((await c.post('/api/auth/register', { email: 'b@example.org', password: 'sehr-sicheres-pw', displayName: '' })).data.error.code, 'invalid_name');
  assert.equal((await c.post('/api/auth/register', { email: 'b@example.org', password: 12345678901, displayName: 'A' })).data.error.code, 'weak_password');
});

test('Login: gleiche Meldung für falsche E-Mail und falsches Passwort, Rate-Limit nach 10 Fehlversuchen', async () => {
  const c = t.client();
  await c.post('/api/auth/register', { email: 'rate@example.org', password: 'richtiges-pw-123', displayName: 'R' });
  const a = await t.client().post('/api/auth/login', { email: 'rate@example.org', password: 'falsch-falsch' });
  const b = await t.client().post('/api/auth/login', { email: 'gibtsnicht@example.org', password: 'falsch-falsch' });
  assert.equal(a.status, 401);
  assert.deepEqual(a.data, b.data);
  for (let i = 0; i < 9; i++) await t.client().post('/api/auth/login', { email: 'rate@example.org', password: 'falsch-falsch' });
  const blocked = await t.client().post('/api/auth/login', { email: 'rate@example.org', password: 'richtiges-pw-123' });
  assert.equal(blocked.status, 429);
  t.clock.now += 16 * 60 * 1000;
  assert.equal((await t.client().post('/api/auth/login', { email: 'rate@example.org', password: 'richtiges-pw-123' })).status, 200);
});

test('Anmelden als Gast mit bestehendem Konto entfernt das Gastkonto', async () => {
  await t.client().post('/api/auth/register', { email: 'wechsel@example.org', password: 'wechsel-pw-123', displayName: 'W' });
  const c = t.client();
  const guest = (await c.post('/api/auth/guest')).data.user;
  await c.post('/api/auth/login', { email: 'wechsel@example.org', password: 'wechsel-pw-123' });
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM users WHERE id = ?').get(guest.id).n, 0);
});

test('Sitzungen laufen ab und liegen nur als Hash in der DB', async () => {
  const c = t.client();
  await c.post('/api/auth/guest');
  const token = c.cookie.split('=')[1];
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
  t.clock.now += 400 * 24 * 60 * 60 * 1000;
  const r = await c.get('/api/progress');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('Konto löschen: mit Passwort, danach ist alles weg', async () => {
  const c = t.client();
  const { user } = (await c.post('/api/auth/register', { email: 'weg@example.org', password: 'loesch-mich-123', displayName: 'Weg' })).data;
  assert.equal((await c.post('/api/account/delete', { password: 'falsch-falsch' })).status, 403);
  assert.equal((await c.post('/api/account/delete', { password: 'loesch-mich-123' })).status, 200);
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM users WHERE id = ?').get(user.id).n, 0);
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM learner_state WHERE user_id = ?').get(user.id).n, 0);
});

test('CSRF und Eingabeformat: fremder Origin, kein JSON, zu großer Body', async () => {
  const c = t.client();
  assert.equal((await c.post('/api/auth/guest', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.raw('POST', '/api/auth/login', 'email=a&password=b', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await c.raw('POST', '/api/auth/login', '{kaputt')).status, 400);
  assert.equal((await c.raw('POST', '/api/auth/login', JSON.stringify({ email: 'x'.repeat(300 * 1024) }))).status, 413);
  const host = new URL(t.base).host;
  assert.equal((await c.post('/api/auth/guest', {}, { Origin: `http://${host}` })).status, 200);
});

test('Sicherheitsheader und statische Positivliste', async () => {
  const c = t.client();
  const index = await c.get('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await c.get('/src/grading.js')).status, 200);
  for (const p of ['/server/app.mjs', '/data/wortweg.db', '/package.json', '/src/../server/auth.mjs', '/%2e%2e/package.json', '/.git/config', '/tests/server-helpers.mjs']) {
    assert.equal((await c.get(p)).status, 404, p);
  }
  assert.equal((await c.get('/api/gibtsnicht')).status, 404);
  assert.equal((await c.raw('PUT', '/api/me')).status, 405);
});
