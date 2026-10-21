import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, migrate } from '../server/db.mjs';
import { seedCourses } from '../server/seed.mjs';
import { assembleCourse, updateCourse } from '../server/content.mjs';
import { zhCourse } from './zh-mini-course.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wortweg-seed-'));
const dirUrl = pathToFileURL(`${dir}/`);
test.after(() => rmSync(dir, { recursive: true, force: true }));

function writeBundle(course) {
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ courses: ['zh.json'] }));
  writeFileSync(join(dir, 'zh.json'), JSON.stringify(course));
}

test('Mitgelieferte Kurse: neu einspielen, unverändert lassen, neuen Stand übernehmen', () => {
  const db = openDb(':memory:');
  migrate(db);
  const course = zhCourse();
  writeBundle(course);
  assert.deepEqual(seedCourses(db, 1, { dir: dirUrl }).imported, [course.id]);
  assert.deepEqual(seedCourses(db, 2, { dir: dirUrl }).skipped, [course.id], 'gleicher Stand → nichts zu tun');

  // Wiederholungs-Eintrag auf einen Satz, den es im neuen Stand nicht mehr gibt, und einer, der bleibt.
  db.prepare("INSERT INTO users (id, display_name, role, is_guest, created_at) VALUES (1, 'G', 'learner', 1, 0)").run();
  const ins = db.prepare('INSERT INTO review_items (user_id, course_id, kind, unit_id, idx, box, due, wrong, seen) VALUES (1, ?, ?, ?, ?, 0, 0, 1, 1)');
  ins.run(course.id, 's', 'zh1-essen', 3);
  ins.run(course.id, 'w', 'zh1-essen', 0);

  const next = zhCourse();
  next.title = 'Chinesisch (neu)';
  next.levels[0].units[1].sentences.pop();
  next.levels[0].units[1].sentences.push({ ...next.levels[0].units[1].sentences[0], note: 'Neu.' }, { ...next.levels[0].units[1].sentences[1], note: 'Neu 2.' });
  next.levels[0].units[1].sentences.splice(3, 1);
  writeBundle(next);
  const before = assembleCourse(db, course.id).version;
  assert.deepEqual(seedCourses(db, 3, { dir: dirUrl }).updated, [course.id]);
  const after = assembleCourse(db, course.id);
  assert.equal(after.title, 'Chinesisch (neu)');
  assert.equal(after.version, before + 1, 'neue Version: offene Lektionen mit altem Stand bekommen 409');
  assert.equal(after.levels[0].units[0].words[0].reading, course.levels[0].units[0].words[0].reading, 'Zusatzfelder bleiben erhalten');
  const left = db.prepare('SELECT kind, idx FROM review_items WHERE user_id = 1 ORDER BY kind').all().map((r) => `${r.kind}${r.idx}`);
  assert.deepEqual(left, ['s3', 'w0'], 'Satz 3 gibt es noch (neuer Inhalt) – beide Einträge bleiben gültig');
  db.close();
});

test('Vom Admin bearbeitete oder gelöschte mitgelieferte Kurse werden nicht überschrieben', () => {
  const db = openDb(':memory:');
  migrate(db);
  const course = zhCourse();
  writeBundle(course);
  seedCourses(db, 1, { dir: dirUrl });
  updateCourse(db, course.id, { title: 'Von Hand geändert' }, 2);
  const changed = zhCourse();
  changed.title = 'Neuer Stand';
  writeBundle(changed);
  assert.deepEqual(seedCourses(db, 3, { dir: dirUrl }).kept, [course.id]);
  assert.equal(assembleCourse(db, course.id).title, 'Von Hand geändert');

  db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
  const r = seedCourses(db, 4, { dir: dirUrl });
  assert.deepEqual(r.kept, [course.id], 'gelöscht bleibt gelöscht');
  assert.equal(assembleCourse(db, course.id), null);
  db.close();
});
