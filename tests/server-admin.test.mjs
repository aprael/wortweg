import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, loginAdmin, responsesFor } from './server-helpers.mjs';
import { listLessons } from '../src/content.js';
import { buildLesson } from '../src/exercises.js';
import { zhCourse } from './zh-mini-course.mjs';

const t = await startTestServer();
test.after(() => t.close());
const admin = await loginAdmin(t);

const words = (prefix) => Array.from({ length: 4 }, (_, i) => ({ kind: 'w', native: [`${prefix}wort${i}`], target: [`${prefix}word${i}`] }));
const sentences = (prefix) => Array.from({ length: 4 }, (_, i) => ({ kind: 's', native: [`Das ist ${prefix}satz ${i}.`], target: [`This is ${prefix}sentence ${i}.`], note: 'Erklärung.' }));

test('Lernende und Gäste bekommen 403, ohne Anmeldung 401', async () => {
  const c = t.client();
  assert.equal((await c.get('/api/admin/overview')).status, 401);
  await c.post('/api/auth/guest');
  assert.equal((await c.get('/api/admin/overview')).status, 403);
  assert.equal((await c.post('/api/admin/courses', { id: 'x' })).status, 403);
  assert.equal((await c.get('/api/courses/de-en?preview=1')).status, 403);
});

test('Kurs anlegen, befüllen, prüfen, veröffentlichen – erst dann sichtbar', async () => {
  const lang = await admin.post('/api/admin/languages', { code: 'nl-be', name: 'Flämisch', nativeName: 'Vlaams' });
  assert.equal(lang.status, 200, JSON.stringify(lang.data));
  assert.equal((await admin.post('/api/admin/languages', { code: 'nl-be', name: 'X' })).status, 409);
  assert.equal((await admin.post('/api/admin/courses', { id: 'Bad ID', title: 'X', nativeLang: 'de', targetLang: 'nl' })).status, 400);
  assert.equal((await admin.post('/api/admin/courses', { id: 'de-xx', title: 'X', nativeLang: 'de', targetLang: 'xx' })).status, 400);

  const created = await admin.post('/api/admin/courses', { id: 'de-nl', title: 'Niederländisch', nativeLang: 'de', targetLang: 'nl-be', ttsLang: 'nl-BE', license: 'CC0 1.0' });
  assert.equal(created.status, 200);
  assert.equal(created.data.course.status, 'draft');
  assert.equal((await t.client().get('/api/courses/de-nl')).status, 404, 'Entwurf ist für Lernende unsichtbar');

  const sec = await admin.post('/api/admin/courses/de-nl/sections', { slug: 'a1', title: 'A1' });
  assert.equal((await admin.post('/api/admin/courses/de-nl/sections', { slug: 'a1', title: 'Doppelt' })).status, 409);
  const unit = await admin.post(`/api/admin/sections/${sec.data.pk}/units`, { slug: 'nl-hallo', title: 'Hallo', status: 'published' });
  assert.equal(unit.status, 200);
  assert.equal((await admin.post(`/api/admin/sections/${sec.data.pk}/units`, { slug: 'a1', title: 'kollidiert mit Abschnitt' })).status, 409);

  const early = await admin.patch('/api/admin/courses/de-nl', { status: 'published' });
  assert.equal(early.status, 400, 'leere Einheit kann nicht veröffentlicht werden');
  assert.equal(early.data.error.code, 'not_publishable');

  assert.equal((await admin.post(`/api/admin/units/${unit.data.pk}/items`, { kind: 's', native: ['A'], target: ['B'] })).status, 400, 'Satz ohne Erklärung');
  assert.equal((await admin.post(`/api/admin/units/${unit.data.pk}/items`, { kind: 'w', native: [], target: ['B'] })).status, 400);
  for (const item of [...words('nl'), ...sentences('nl')]) {
    const r = await admin.post(`/api/admin/units/${unit.data.pk}/items`, item);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const v = await admin.post('/api/admin/courses/de-nl/validate');
  assert.equal(v.data.ok, true, JSON.stringify(v.data));

  const preview = await admin.get(`/api/admin/units/${unit.data.pk}/preview`);
  assert.equal(preview.data.lessons.length, 1);
  assert.ok(preview.data.lessons[0].exercises.length >= 9);

  const pub = await admin.patch('/api/admin/courses/de-nl', { status: 'published' });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const learnerView = await t.client().get('/api/courses/de-nl');
  assert.equal(learnerView.status, 200);
  assert.ok(learnerView.data.course.version > 1);
  assert.ok((await t.client().get('/api/courses')).data.courses.some((c) => c.id === 'de-nl'));

  const overview = await admin.get('/api/admin/overview');
  assert.ok(overview.data.audit.some((a) => a.action === 'course.status.published' && a.target === 'de-nl'));
  assert.equal((await admin.del('/api/admin/languages/nl-be')).status, 409, 'benutzte Sprache lässt sich nicht löschen');
});

test('Entwurfs-Einheit bleibt unsichtbar; Änderungen, die einen veröffentlichten Kurs kaputt machen, werden abgelehnt', async () => {
  const course = (await admin.get('/api/admin/courses/de-nl')).data.course;
  const section = course.sections[0];
  const draft = await admin.post(`/api/admin/sections/${section.pk}/units`, { slug: 'nl-draft', title: 'Entwurf' });
  const pub = (await t.client().get('/api/courses/de-nl')).data.course;
  assert.equal(pub.levels[0].units.length, 1, 'Entwurf erscheint nicht');
  assert.equal((await admin.patch(`/api/admin/units/${draft.data.pk}`, { status: 'published' })).status, 400, 'leere Einheit nicht veröffentlichbar');
  const item = course.sections[0].units[0].items.find((i) => i.kind === 'w');
  assert.equal((await admin.del(`/api/admin/items/${item.pk}`)).status, 400, 'zu wenige Wörter → abgelehnt, Transaktion zurückgerollt');
  const after = (await admin.get('/api/admin/courses/de-nl')).data.course;
  assert.equal(after.sections[0].units[0].items.filter((i) => i.kind === 'w').length, 4);
});

test('Löschen/Verschieben von Lernobjekten hält Wiederholungs-Referenzen gültig', async () => {
  const c = t.client();
  await c.post('/api/auth/guest');
  let course = (await c.get('/api/courses/de-nl')).data.course;
  const lesson = listLessons(course)[0];
  const exercises = buildLesson(course, lesson.unit, lesson.index, { seed: 0 });
  await c.post('/api/progress/lesson', { courseId: 'de-nl', lessonId: lesson.id, version: course.version, seed: 0, options: {}, responses: responsesFor(exercises, () => false) });
  const reviewKeys = () => Object.values(t.db.prepare('SELECT kind, idx FROM review_items WHERE course_id = ?').all('de-nl')).map((r) => `${r.kind}${r.idx}`).sort();
  assert.ok(reviewKeys().includes('w0'));

  const adminCourse = (await admin.get('/api/admin/courses/de-nl')).data.course;
  const unitPk = adminCourse.sections[0].units[0].pk;
  await admin.post(`/api/admin/units/${unitPk}/items`, { kind: 'w', native: ['extra'], target: ['extra'] });
  const w0 = (await admin.get('/api/admin/courses/de-nl')).data.course.sections[0].units[0].items.find((i) => i.kind === 'w' && i.position === 0);
  const before = t.db.prepare("SELECT wrong FROM review_items WHERE course_id = 'de-nl' AND kind = 'w' AND idx = 1").get();
  assert.equal((await admin.post(`/api/admin/items/${w0.pk}/move`, { direction: 'down' })).status, 200);
  const moved = t.db.prepare("SELECT wrong FROM review_items WHERE course_id = 'de-nl' AND kind = 'w' AND idx = 0").get();
  assert.deepEqual(moved, before, 'Objekt an Index 1 ist jetzt an Index 0 – die Wiederholung wandert mit');

  const del = await admin.del(`/api/admin/items/${w0.pk}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  course = (await c.get('/api/courses/de-nl')).data.course;
  assert.equal(course.levels[0].units[0].words.length, 4);
  const maxIdx = t.db.prepare("SELECT max(idx) AS m FROM review_items WHERE course_id = 'de-nl' AND kind = 'w'").get().m;
  assert.ok(maxIdx < 4, 'keine Referenz zeigt ins Leere');
});

test('Kurs exportieren und als Entwurf wieder importieren', async () => {
  const exp = await admin.get('/api/admin/courses/de-nl/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.id, 'de-nl');
  assert.equal(exp.data.version, undefined);
  assert.equal((await admin.post('/api/admin/import', { course: exp.data })).status, 409);
  // Der Export enthält auch die leere Entwurfs-Einheit; für den Re-Import wird sie weggelassen.
  const levels = exp.data.levels.map((l) => ({ ...l, units: l.units.filter((u) => u.words.length) }));
  const copy = { ...exp.data, id: 'de-nl-copy', title: 'Kopie', levels };
  const imp = await admin.post('/api/admin/import', { course: copy });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.equal(imp.data.course.status, 'draft');
  assert.equal((await admin.post('/api/admin/import', { course: { id: 'kaputt' } })).data.error.code, 'invalid_course');
  assert.equal((await admin.del('/api/admin/courses/de-nl-copy')).status, 200);
  assert.equal((await admin.get('/api/admin/courses/de-nl-copy')).status, 404);
});

test('Admin-Vorschau zeigt Entwürfe, Lernende nicht', async () => {
  const r = await admin.get('/api/courses/de-nl?preview=1');
  assert.equal(r.status, 200);
  assert.ok(r.data.course.levels[0].units.some((u) => u.id === 'nl-draft'));
});

test('Chinesisch: Pinyin, Bausteine, Quellen und Lizenzangaben überstehen Import, Lesen, Export und Bearbeiten', async () => {
  const course = zhCourse();
  const imp = await admin.post('/api/admin/import', { course });
  assert.equal(imp.status, 200, JSON.stringify(imp.data));
  assert.equal((await admin.patch(`/api/admin/courses/${course.id}`, { status: 'published' })).status, 200);

  const read = (await t.client().get(`/api/courses/${course.id}`)).data.course;
  const [w0, s0] = [read.levels[0].units[0].words[0], read.levels[0].units[0].sentences[0]];
  const [ow0, os0] = [course.levels[0].units[0].words[0], course.levels[0].units[0].sentences[0]];
  assert.equal(w0.reading, ow0.reading);
  assert.deepEqual(w0.tags, ow0.tags);
  assert.deepEqual(s0.tokens, os0.tokens);
  assert.equal(s0.reading, os0.reading);
  assert.deepEqual(read.attribution, course.attribution);
  assert.equal(read.generated, undefined, 'generated:false wird nicht mitgeschickt');
  const listed = (await t.client().get('/api/courses')).data.courses.find((c) => c.id === course.id);
  assert.equal(listed.generated, false);

  const exported = (await admin.get(`/api/admin/courses/${course.id}/export`)).data;
  assert.deepEqual(exported.levels[0].units[0].sentences[0].tokens, os0.tokens);
  assert.deepEqual(exported.attribution, course.attribution);

  const full = (await admin.get(`/api/admin/courses/${course.id}`)).data.course;
  const item = full.sections[0].units[0].items.find((i) => i.kind === 'w');
  assert.equal(item.reading, ow0.reading);
  assert.equal((await admin.patch(`/api/admin/items/${item.pk}`, { reading: 'ni hao' })).status, 200);
  const after = (await admin.get(`/api/admin/courses/${course.id}`)).data.course.sections[0].units[0].items.find((i) => i.pk === item.pk);
  assert.equal(after.reading, 'ni hao');
  assert.deepEqual(after.tags, ow0.tags, 'nicht übergebene Zusatzfelder bleiben erhalten');
  assert.equal((await admin.patch(`/api/admin/items/${item.pk}`, { tokens: ['你', '好'] })).status, 400, 'Bausteine nur bei Sätzen');
  const sentence = full.sections[0].units[0].items.find((i) => i.kind === 's');
  assert.equal((await admin.patch(`/api/admin/items/${sentence.pk}`, { tokens: ['falsch'] })).status, 400, 'Bausteine müssen den Satz ergeben');
});

test('Regeltext (intro) und Beispielsätze (examples) überstehen Import, Lesen, Export und Bearbeiten', async () => {
  const course = {
    id: 'de-xx-regeln', title: 'Regeltest', nativeLang: 'de', targetLang: 'en', license: 'CC0-1.0',
    levels: [{ id: 'l1', title: 'Stufe', units: [{
      id: 'u1', title: 'Einheit', intro: 'Regel: Nach „to“ folgt die Grundform.\n\nAusnahme: keine.',
      words: words('rx').map(({ kind: _k, ...w }, i) => (i === 0
        ? { ...w, examples: [{ target: 'I like the word.', native: 'Ich mag das Wort.', source: { name: 'Tatoeba', id: '1', url: 'https://tatoeba.org/de/sentences/show/1' } }] }
        : w)),
      sentences: sentences('rx').map(({ kind: _k, ...s }) => s),
    }] }],
  };
  assert.equal((await admin.post('/api/admin/import', { course })).status, 200);
  assert.equal((await admin.patch(`/api/admin/courses/${course.id}`, { status: 'published' })).status, 200);
  const read = (await t.client().get(`/api/courses/${course.id}`)).data.course;
  const unit = read.levels[0].units[0];
  assert.equal(unit.intro, course.levels[0].units[0].intro);
  assert.deepEqual(unit.words[0].examples, course.levels[0].units[0].words[0].examples);
  assert.equal(unit.words[1].examples, undefined);
  const exp = (await admin.get(`/api/admin/courses/${course.id}/export`)).data;
  assert.equal((exp.course ?? exp).levels[0].units[0].intro, unit.intro);

  const full = (await admin.get(`/api/admin/courses/${course.id}`)).data.course;
  const u = full.sections[0].units[0];
  assert.equal(u.intro, unit.intro);
  assert.equal((await admin.patch(`/api/admin/units/${u.pk}`, { intro: 'Neue Regel.' })).status, 200);
  const [w0, w1] = u.items.filter((i) => i.kind === 'w');
  // Gleicher Satz → Quelle bleibt; zweites Wort bekommt ein neues Beispiel ohne Quelle.
  assert.equal((await admin.patch(`/api/admin/items/${w0.pk}`, { examples: [{ target: 'I like the word.', native: 'Ich mag dieses Wort.' }] })).status, 200);
  assert.equal((await admin.patch(`/api/admin/items/${w1.pk}`, { examples: [{ target: 'Another one.', native: 'Noch eins.' }] })).status, 200);
  const s0 = u.items.find((i) => i.kind === 's');
  assert.equal((await admin.patch(`/api/admin/items/${s0.pk}`, { examples: [{ target: 'x', native: 'y' }] })).status, 400, 'Beispiele nur bei Wörtern');
  assert.equal((await admin.patch(`/api/admin/items/${w1.pk}`, { examples: [{ target: 'Nur Zielsprache.' }] })).status, 400, 'Übersetzung fehlt');
  assert.equal((await admin.patch(`/api/admin/units/${u.pk}`, { intro: 'x'.repeat(2001) })).status, 400, 'Regeltext zu lang');
  const again = (await t.client().get(`/api/courses/${course.id}`)).data.course.levels[0].units[0];
  assert.equal(again.intro, 'Neue Regel.');
  assert.equal(again.words[0].examples[0].native, 'Ich mag dieses Wort.');
  assert.equal(again.words[0].examples[0].source.id, '1');
  assert.deepEqual(again.words[1].examples, [{ target: 'Another one.', native: 'Noch eins.' }]);
  assert.equal((await admin.patch(`/api/admin/units/${u.pk}`, { intro: '' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/items/${w1.pk}`, { examples: [] })).status, 200);
  const cleared = (await t.client().get(`/api/courses/${course.id}`)).data.course.levels[0].units[0];
  assert.equal(cleared.intro, undefined);
  assert.equal(cleared.words[1].examples, undefined);
});

test('Große Antworten werden mit gzip komprimiert, wenn der Client es anbietet', async () => {
  const res = await fetch(`${t.base}/api/courses/de-en`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  assert.ok((await res.json()).course.levels.length > 0);
  const js = await fetch(`${t.base}/src/app.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(js.headers.get('content-encoding'), 'gzip');
  const small = await fetch(`${t.base}/api/me`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(small.headers.get('content-encoding'), null);
});
