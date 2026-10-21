// Testhilfen für den Server: In-Memory-DB, echter HTTP-Server auf freiem Port, Client mit Cookie.
import { createServer } from 'node:http';
import { openDb, migrate } from '../server/db.mjs';
import { seedCourses } from '../server/seed.mjs';
import { createApp } from '../server/app.mjs';
import { hashPassword } from '../server/auth.mjs';
import { tokenize } from '../src/grading.js';

export async function startTestServer({ now = Date.UTC(2026, 9, 20, 10) } = {}) {
  const db = openDb(':memory:');
  migrate(db, now);
  seedCourses(db, now);
  const clock = { now };
  const app = createApp({ db, clock: () => clock.now });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    clock,
    client: () => createClient(base),
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

export function createClient(base) {
  let cookie = null;
  async function request(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const value = set.split(';')[0];
      cookie = value.endsWith('=') ? null : value;
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
    get: (p, h) => request('GET', p, undefined, h),
    post: (p, b = {}, h) => request('POST', p, b, h),
    patch: (p, b = {}, h) => request('PATCH', p, b, h),
    del: (p, h) => request('DELETE', p, undefined, h),
    raw: request,
  };
}

/** Legt ein Admin-Konto direkt in der DB an und meldet den Client an. */
export async function loginAdmin(t, email = 'admin@example.org', password = 'admin-passwort-123') {
  t.db.prepare("INSERT INTO users (email, display_name, password_hash, role, is_guest, created_at) VALUES (?, 'Admin', ?, 'admin', 0, ?)")
    .run(email, await hashPassword(password), t.clock.now);
  const c = t.client();
  const r = await c.post('/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`Admin-Login fehlgeschlagen: ${JSON.stringify(r.data)}`);
  return c;
}

/** Musterantwort im Antwortformat des Vertrags (docs/ARCHITEKTUR.md §4.1). */
export function modelAnswer(ex) {
  switch (ex.type) {
    case 'choice':
    case 'fill':
      return ex.answer;
    case 'order':
      return tokenize(ex.solution);
    case 'match':
      return ex.pairs;
    default:
      return ex.solution;
  }
}

/** Absichtlich falsche Antwort im richtigen Format. */
export function wrongAnswer(ex) {
  switch (ex.type) {
    case 'choice':
    case 'fill':
      return ex.choices.find((c) => c !== ex.answer);
    case 'order':
      return ['falsch'];
    case 'match':
      return [[ex.pairs[0][0], ex.pairs[1][1]], ...ex.pairs];
    default:
      return 'völlig falsch';
  }
}

export function responsesFor(exercises, pick = () => true) {
  return Object.fromEntries(exercises.map((ex, i) => [ex.id, { answers: [pick(ex, i) ? modelAnswer(ex) : wrongAnswer(ex)] }]));
}
