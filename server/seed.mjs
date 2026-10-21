// Mitgelieferte Kurse (data/courses) in die Datenbank übernehmen – bei jedem Start, idempotent:
// neue Kurse einspielen, geänderte und von keinem Admin bearbeitete Kurse ersetzen, alles andere in Ruhe lassen.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { importCourse, replaceCourseContent, KNOWN_LANGUAGES } from './content.mjs';

const COURSES_DIR = new URL('../data/courses/', import.meta.url);

export function bundledCourseFiles(dir = COURSES_DIR) {
  return JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).courses;
}

/** @returns {{imported: string[], updated: string[], skipped: string[], kept: string[]}} kept = vom Admin bearbeitet oder gelöscht */
export function seedCourses(db, now = Date.now(), { dir = COURSES_DIR } = {}) {
  const result = { imported: [], updated: [], skipped: [], kept: [] };
  const insLang = db.prepare('INSERT OR IGNORE INTO languages (code, name, native_name) VALUES (?, ?, ?)');
  for (const [code, [name, nativeName]] of Object.entries(KNOWN_LANGUAGES)) insLang.run(code, name, nativeName);
  const remember = db.prepare(`INSERT INTO bundled_courses (course_id, file, hash, version, seeded_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (course_id) DO UPDATE SET file = excluded.file, hash = excluded.hash, version = excluded.version, seeded_at = excluded.seeded_at`);
  for (const file of bundledCourseFiles(dir)) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const hash = createHash('sha256').update(text).digest('hex');
    const course = JSON.parse(text);
    const provenance = `Mitgeliefert: data/courses/${file} (${course.license ?? 'Lizenz siehe Datei'})`;
    const row = db.prepare('SELECT version, provenance FROM courses WHERE id = ?').get(course.id);
    const record = db.prepare('SELECT hash, version FROM bundled_courses WHERE course_id = ?').get(course.id);
    if (!row) {
      if (record) {
        result.kept.push(course.id); // von einem Admin gelöscht
        continue;
      }
      importCourse(db, course, { status: 'published', now, provenance });
      remember.run(course.id, file, hash, 1, now);
      result.imported.push(course.id);
      continue;
    }
    // Datenbanken aus Version 0.2 kennen bundled_courses noch nicht: unveränderte Seed-Kurse (Version 1) übernehmen.
    const base = record ?? (row.version === 1 && String(row.provenance).startsWith('Mitgeliefert:') ? { hash: '', version: 1 } : null);
    if (!base || base.version !== row.version) {
      result.kept.push(course.id);
      continue;
    }
    if (base.hash === hash) {
      result.skipped.push(course.id);
      continue;
    }
    const version = replaceCourseContent(db, course, { now, provenance });
    remember.run(course.id, file, hash, version, now);
    result.updated.push(course.id);
  }
  return result;
}
