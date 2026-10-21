// Datenbank einrichten: Migrationen anwenden und mitgelieferte Kurse einspielen (idempotent).
// Mit --reset wird die Datenbankdatei vorher gelöscht (alle Konten und Fortschritte gehen verloren).
import { rmSync } from 'node:fs';
import { openDb, migrate, DEFAULT_DB_PATH } from '../server/db.mjs';
import { seedCourses } from '../server/seed.mjs';

const path = process.env.WORTWEG_DB || DEFAULT_DB_PATH;
if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  console.log(`Datenbank gelöscht: ${path}`);
}
const db = openDb(path);
const applied = migrate(db);
console.log(applied.length ? `Migrationen angewendet: ${applied.join(', ')}` : 'Migrationen: aktuell.');
const { imported, updated, skipped, kept } = seedCourses(db);
console.log(`Kurse eingespielt: ${imported.join(', ') || '–'}${updated.length ? ` · aktualisiert: ${updated.join(', ')}` : ''}${skipped.length ? ` · unverändert: ${skipped.join(', ')}` : ''}`);
if (kept.length) console.log(`Vom Admin bearbeitet oder gelöscht (nicht überschrieben): ${kept.join(', ')}`);
db.close();
