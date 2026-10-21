// Startpunkt: Datenbank öffnen, Migrationen anwenden, mitgelieferte Kurse einspielen/aktualisieren, HTTP-Server starten.
import { createServer } from 'node:http';
import { openDb, migrate, DEFAULT_DB_PATH } from './db.mjs';
import { seedCourses } from './seed.mjs';
import { createApp } from './app.mjs';

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.WORTWEG_DB || DEFAULT_DB_PATH;

const db = openDb(DB_PATH);
const applied = migrate(db);
if (applied.length) console.log(`Migrationen angewendet: ${applied.join(', ')}`);
const seeded = seedCourses(db);
if (seeded.imported.length) console.log(`Kurse eingespielt: ${seeded.imported.join(', ')}`);
if (seeded.updated.length) console.log(`Kurse aktualisiert: ${seeded.updated.join(', ')}`);

const app = createApp({
  db,
  secureCookies: process.env.COOKIE_SECURE === '1',
  log: process.env.LOG === '0' ? null : (line) => console.log(line),
});

const server = createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(PORT, HOST, () => {
  console.log(`Wortweg läuft auf http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    console.log('Hinweis: Noch kein Admin-Konto. Anlegen mit: npm run admin -- --email du@example.org');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
