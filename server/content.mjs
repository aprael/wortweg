// Kursinhalte in der Datenbank: Kursformat ↔ Tabellen, Veröffentlichung und Bearbeitung durch Admins.
import { validateCourse, listLessons } from '../src/content.js';
import { tx } from './db.mjs';
import { HttpError } from './http.mjs';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const COURSE_STATUS = ['draft', 'published', 'archived'];
const UNIT_STATUS = ['draft', 'published'];

/** Bekannte Sprachnamen für den Seed. Weitere Sprachen legen Admins an. */
export const KNOWN_LANGUAGES = {
  de: ['Deutsch', 'Deutsch'], en: ['Englisch', 'English'], es: ['Spanisch', 'Español'], fr: ['Französisch', 'Français'],
  it: ['Italienisch', 'Italiano'], pt: ['Portugiesisch', 'Português'], nl: ['Niederländisch', 'Nederlands'],
  tr: ['Türkisch', 'Türkçe'], pl: ['Polnisch', 'Polski'], sv: ['Schwedisch', 'Svenska'], zh: ['Chinesisch', '中文'],
  ja: ['Japanisch', '日本語'], ru: ['Russisch', 'Русский'], uk: ['Ukrainisch', 'Українська'], ar: ['Arabisch', 'العربية'],
};

const json = (v) => JSON.stringify(v);
const parseList = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const parseObject = (s) => {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Optionale Felder eines Lernobjekts (§9.1), die in items.extra liegen. */
const EXTRA_KEYS = ['reading', 'tokens', 'tags', 'source', 'examples'];

function pickExtras(item) {
  const out = {};
  for (const k of EXTRA_KEYS) if (item?.[k] != null) out[k] = item[k];
  return out;
}

const extraJson = (item) => {
  const e = pickExtras(item);
  return Object.keys(e).length ? json(e) : null;
};

// ---------- Lesen ----------

// Je Datenbank ein Cache. Schlüssel mit created_at: Wird ein Kurs gelöscht und unter derselben ID neu angelegt,
// beginnt die Version wieder bei 1 – der alte Eintrag darf dann nicht mehr passen.
const caches = new WeakMap();
const cacheFor = (db) => {
  let c = caches.get(db);
  if (!c) caches.set(db, (c = new Map()));
  return c;
};

/**
 * Baut einen Kurs im Kursformat aus der DB.
 * Ohne includeDrafts: nur veröffentlichte Kurse und Einheiten; Abschnitte ohne sichtbare Einheit fallen weg.
 * @returns {object|null}
 */
export function assembleCourse(db, id, { includeDrafts = false } = {}) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!c || (!includeDrafts && c.status !== 'published')) return null;
  const cache = cacheFor(db);
  const key = `${id}|${c.version}|${c.created_at}|${includeDrafts}`;
  if (cache.has(key)) return cache.get(key);
  const sections = db.prepare('SELECT pk, slug, title FROM sections WHERE course_id = ? ORDER BY position, pk').all(id);
  const units = db.prepare(`SELECT pk, section_pk, slug, title, description, intro, status FROM units WHERE course_id = ?
    ${includeDrafts ? '' : "AND status = 'published'"} ORDER BY position, pk`).all(id);
  const items = db.prepare(`SELECT i.unit_pk, i.kind, i.native, i.target, i.note, i.extra FROM items i
    JOIN units u ON u.pk = i.unit_pk WHERE u.course_id = ? ORDER BY i.unit_pk, i.kind, i.position`).all(id);
  const byUnit = new Map(units.map((u) => [u.pk, { words: [], sentences: [] }]));
  for (const it of items) {
    const bucket = byUnit.get(it.unit_pk);
    if (!bucket) continue;
    const entry = { native: parseList(it.native), target: parseList(it.target) };
    if (it.note) entry.note = it.note;
    Object.assign(entry, pickExtras(parseObject(it.extra)));
    (it.kind === 'w' ? bucket.words : bucket.sentences).push(entry);
  }
  const levels = sections.map((s) => ({
    id: s.slug,
    title: s.title,
    units: units.filter((u) => u.section_pk === s.pk).map((u) => ({
      id: u.slug,
      title: u.title,
      ...(u.description ? { description: u.description } : {}),
      ...(u.intro ? { intro: u.intro } : {}),
      ...(includeDrafts ? { status: u.status } : {}),
      ...byUnit.get(u.pk),
    })),
  })).filter((l) => includeDrafts || l.units.length > 0);
  const course = {
    id: c.id,
    title: c.title,
    ...(c.subtitle ? { subtitle: c.subtitle } : {}),
    nativeLang: c.native_lang,
    targetLang: c.target_lang,
    ...(c.tts_lang ? { ttsLang: c.tts_lang } : {}),
    demo: c.demo === 1,
    license: c.license,
    ...(c.generated ? { generated: true } : {}),
    ...(c.attribution ? { attribution: parseList(c.attribution) } : {}),
    version: c.version,
    status: c.status,
    levels,
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, course);
  return course;
}

export function courseStats(course) {
  const units = course.levels.flatMap((l) => l.units);
  return {
    levels: course.levels.length,
    units: units.length,
    lessons: units.length ? listLessons(course).length : 0,
    words: units.reduce((n, u) => n + u.words.length, 0),
    sentences: units.reduce((n, u) => n + u.sentences.length, 0),
  };
}

export function listPublishedCourses(db) {
  return db.prepare("SELECT id FROM courses WHERE status = 'published' ORDER BY position, title").all()
    .map((r) => assembleCourse(db, r.id))
    .filter((c) => c && c.levels.length > 0)
    .map((c) => ({
      id: c.id, title: c.title, subtitle: c.subtitle ?? '', nativeLang: c.nativeLang, targetLang: c.targetLang,
      demo: c.demo, license: c.license, generated: Boolean(c.generated), stats: courseStats(c),
    }));
}

export function listLanguages(db) {
  return db.prepare('SELECT code, name, native_name FROM languages ORDER BY name').all()
    .map((l) => ({ code: l.code, name: l.name, nativeName: l.native_name }));
}

/** Admin-Sicht: Kurs mit allen Entwürfen und den DB-Schlüsseln, damit die Oberfläche gezielt ändern kann. */
export function adminCourse(db, id) {
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!c) return null;
  const sections = db.prepare('SELECT pk, slug, title, position FROM sections WHERE course_id = ? ORDER BY position, pk').all(id);
  const units = db.prepare('SELECT pk, section_pk, slug, title, description, intro, status, position FROM units WHERE course_id = ? ORDER BY position, pk').all(id);
  const items = db.prepare(`SELECT i.pk, i.unit_pk, i.kind, i.position, i.native, i.target, i.note, i.extra FROM items i
    JOIN units u ON u.pk = i.unit_pk WHERE u.course_id = ? ORDER BY i.unit_pk, i.kind, i.position`).all(id);
  return {
    id: c.id, title: c.title, subtitle: c.subtitle, nativeLang: c.native_lang, targetLang: c.target_lang,
    ttsLang: c.tts_lang, status: c.status, demo: c.demo === 1, license: c.license, provenance: c.provenance,
    generated: c.generated === 1, attribution: parseList(c.attribution),
    version: c.version, position: c.position, createdAt: c.created_at, updatedAt: c.updated_at,
    sections: sections.map((s) => ({
      pk: s.pk, slug: s.slug, title: s.title,
      units: units.filter((u) => u.section_pk === s.pk).map((u) => ({
        pk: u.pk, slug: u.slug, title: u.title, description: u.description, intro: u.intro ?? '', status: u.status,
        items: items.filter((i) => i.unit_pk === u.pk).map((i) => ({
          pk: i.pk, kind: i.kind, position: i.position, native: parseList(i.native), target: parseList(i.target), note: i.note ?? '',
          ...pickExtras(parseObject(i.extra)),
        })),
      })),
    })),
  };
}

export function adminOverview(db) {
  const courses = db.prepare(`SELECT c.id, c.title, c.native_lang, c.target_lang, c.status, c.version, c.updated_at,
      (SELECT count(*) FROM units u WHERE u.course_id = c.id) AS units,
      (SELECT count(*) FROM items i JOIN units u ON u.pk = i.unit_pk WHERE u.course_id = c.id) AS items
    FROM courses c ORDER BY c.position, c.title`).all()
    .map((c) => ({ id: c.id, title: c.title, nativeLang: c.native_lang, targetLang: c.target_lang, status: c.status, version: c.version, updatedAt: c.updated_at, units: c.units, items: c.items }));
  const counts = db.prepare(`SELECT
      (SELECT count(*) FROM users WHERE is_guest = 0) AS accounts,
      (SELECT count(*) FROM users WHERE is_guest = 1) AS guests,
      (SELECT count(*) FROM attempts) AS attempts`).get();
  const audit = db.prepare(`SELECT a.action, a.target, a.detail, a.created_at, u.display_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 20`).all()
    .map((a) => ({ action: a.action, target: a.target, detail: a.detail, at: a.created_at, by: a.display_name ?? '–' }));
  return { courses, languages: listLanguages(db), counts: { ...counts }, audit };
}

// ---------- Prüfen von Eingaben ----------

function str(v, field, { min = 1, max = 200, optional = false } = {}) {
  if (v == null || v === '') {
    if (optional) return '';
    throw new HttpError(400, 'invalid', `${field} fehlt.`);
  }
  if (typeof v !== 'string') throw new HttpError(400, 'invalid', `${field} muss Text sein.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, 'invalid', `${field} muss ${min}–${max} Zeichen haben.`);
  return s;
}

function slug(v, field) {
  if (typeof v !== 'string' || !SLUG_RE.test(v)) throw new HttpError(400, 'invalid', `${field}: nur a–z, 0–9 und -, beginnend mit Buchstabe oder Ziffer.`);
  return v;
}

function textList(v, field) {
  if (!Array.isArray(v) || v.length === 0 || v.length > 12) throw new HttpError(400, 'invalid', `${field}: 1–12 Einträge nötig.`);
  const out = v.map((s) => (typeof s === 'string' ? s.trim() : ''));
  if (out.some((s) => !s || s.length > 300)) throw new HttpError(400, 'invalid', `${field}: jeder Eintrag 1–300 Zeichen.`);
  return out;
}

function oneOf(v, list, field) {
  if (!list.includes(v)) throw new HttpError(400, 'invalid', `${field} muss eins von ${list.join(', ')} sein.`);
  return v;
}

function lang(db, v, field) {
  if (typeof v !== 'string' || !LANG_RE.test(v)) throw new HttpError(400, 'invalid', `${field} ist kein Sprachcode.`);
  if (!db.prepare('SELECT 1 FROM languages WHERE code = ?').get(v)) throw new HttpError(400, 'invalid', `${field}: Sprache „${v}“ ist nicht angelegt.`);
  return v;
}

// ---------- Schreiben ----------

export function audit(db, userId, action, target, detail = '', now = Date.now()) {
  db.prepare('INSERT INTO audit_log (user_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(userId ?? null, action, target, String(detail).slice(0, 500), now);
}

function touchCourse(db, courseId, now) {
  db.prepare('UPDATE courses SET version = version + 1, updated_at = ? WHERE id = ?').run(now, courseId);
}

function slugTaken(db, courseId, s) {
  return Boolean(db.prepare('SELECT 1 FROM sections WHERE course_id = ? AND slug = ? UNION SELECT 1 FROM units WHERE course_id = ? AND slug = ?').get(courseId, s, courseId, s));
}

export function upsertLanguage(db, { code, name, nativeName }, { create }) {
  if (create) {
    if (typeof code !== 'string' || !LANG_RE.test(code)) throw new HttpError(400, 'invalid', 'Sprachcode ungültig (z. B. „fr“ oder „pt-BR“).');
    if (db.prepare('SELECT 1 FROM languages WHERE code = ?').get(code)) throw new HttpError(409, 'exists', 'Diese Sprache gibt es schon.');
    db.prepare('INSERT INTO languages (code, name, native_name) VALUES (?, ?, ?)').run(code, str(name, 'Name', { max: 60 }), str(nativeName, 'Eigenname', { max: 60, optional: true }));
  } else {
    const cur = db.prepare('SELECT * FROM languages WHERE code = ?').get(code);
    if (!cur) throw new HttpError(404, 'not_found', 'Sprache nicht gefunden.');
    db.prepare('UPDATE languages SET name = ?, native_name = ? WHERE code = ?').run(
      name === undefined ? cur.name : str(name, 'Name', { max: 60 }),
      nativeName === undefined ? cur.native_name : str(nativeName, 'Eigenname', { max: 60, optional: true }),
      code,
    );
  }
  return db.prepare('SELECT code, name, native_name AS nativeName FROM languages WHERE code = ?').get(code);
}

export function deleteLanguage(db, code) {
  const used = db.prepare('SELECT 1 FROM courses WHERE native_lang = ? OR target_lang = ?').get(code, code);
  if (used) throw new HttpError(409, 'in_use', 'Die Sprache wird noch von einem Kurs benutzt.');
  const r = db.prepare('DELETE FROM languages WHERE code = ?').run(code);
  if (!r.changes) throw new HttpError(404, 'not_found', 'Sprache nicht gefunden.');
}

export function createCourse(db, body, now) {
  const id = slug(body.id, 'Kurs-ID');
  if (db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id)) throw new HttpError(409, 'exists', 'Es gibt schon einen Kurs mit dieser ID.');
  const nativeLang = lang(db, body.nativeLang, 'Ausgangssprache');
  const targetLang = lang(db, body.targetLang, 'Zielsprache');
  if (nativeLang === targetLang) throw new HttpError(400, 'invalid', 'Ausgangs- und Zielsprache müssen sich unterscheiden.');
  const ttsLang = body.ttsLang ? (LANG_RE.test(body.ttsLang) ? body.ttsLang : null) : null;
  if (body.ttsLang && !ttsLang) throw new HttpError(400, 'invalid', 'Sprachausgabe-Code ungültig (z. B. „fr-FR“).');
  const pos = db.prepare('SELECT coalesce(max(position), -1) + 1 AS p FROM courses').get().p;
  db.prepare(`INSERT INTO courses (id, title, subtitle, native_lang, target_lang, tts_lang, status, demo, license, provenance, version, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 1, ?, ?, ?)`).run(
    id, str(body.title, 'Titel', { max: 80 }), str(body.subtitle, 'Untertitel', { max: 160, optional: true }), nativeLang, targetLang, ttsLang,
    body.demo ? 1 : 0, str(body.license, 'Lizenz', { max: 200, optional: true }), str(body.provenance, 'Herkunft', { max: 1000, optional: true }), pos, now, now,
  );
  return id;
}

/** Prüft, ob der veröffentlichte Teil eines Kurses gültig wäre (für Veröffentlichung und Admin-Prüfung). */
export function checkPublishable(db, id) {
  const asDraft = assembleCourse(db, id, { includeDrafts: true });
  if (!asDraft) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
  const visible = {
    ...asDraft,
    levels: asDraft.levels.map((l) => ({ ...l, units: l.units.filter((u) => u.status === 'published') })).filter((l) => l.units.length),
  };
  return validateCourse(visible);
}

export function updateCourse(db, id, body, now) {
  const cur = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
  const next = {
    title: body.title === undefined ? cur.title : str(body.title, 'Titel', { max: 80 }),
    subtitle: body.subtitle === undefined ? cur.subtitle : str(body.subtitle, 'Untertitel', { max: 160, optional: true }),
    tts_lang: body.ttsLang === undefined ? cur.tts_lang : (body.ttsLang ? (LANG_RE.test(body.ttsLang) ? body.ttsLang : undefined) : null),
    status: body.status === undefined ? cur.status : oneOf(body.status, COURSE_STATUS, 'Status'),
    license: body.license === undefined ? cur.license : str(body.license, 'Lizenz', { max: 200, optional: true }),
    provenance: body.provenance === undefined ? cur.provenance : str(body.provenance, 'Herkunft', { max: 1000, optional: true }),
    demo: body.demo === undefined ? cur.demo : (body.demo ? 1 : 0),
  };
  if (next.tts_lang === undefined) throw new HttpError(400, 'invalid', 'Sprachausgabe-Code ungültig (z. B. „fr-FR“).');
  if (next.status === 'published') {
    const hasUnit = db.prepare("SELECT 1 FROM units WHERE course_id = ? AND status = 'published'").get(id);
    if (!hasUnit) throw new HttpError(400, 'not_publishable', 'Kurs kann noch nicht veröffentlicht werden: Er braucht mindestens eine veröffentlichte Einheit mit je 4 Wörtern und 4 Sätzen.');
    const v = checkPublishable(db, id);
    if (!v.ok) throw new HttpError(400, 'not_publishable', `Kurs kann nicht veröffentlicht werden: ${v.errors.slice(0, 5).join(' ')}`, { errors: v.errors });
  }
  db.prepare('UPDATE courses SET title = ?, subtitle = ?, tts_lang = ?, status = ?, license = ?, provenance = ?, demo = ? WHERE id = ?')
    .run(next.title, next.subtitle, next.tts_lang, next.status, next.license, next.provenance, next.demo, id);
  touchCourse(db, id, now);
}

export function deleteCourse(db, id) {
  const r = db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
}

export function createSection(db, courseId, body, now) {
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
  const s = slug(body.slug, 'Abschnitts-ID');
  if (slugTaken(db, courseId, s)) throw new HttpError(409, 'exists', 'Diese ID ist im Kurs schon vergeben.');
  const pos = db.prepare('SELECT coalesce(max(position), -1) + 1 AS p FROM sections WHERE course_id = ?').get(courseId).p;
  const r = db.prepare('INSERT INTO sections (course_id, slug, title, position) VALUES (?, ?, ?, ?)').run(courseId, s, str(body.title, 'Titel', { max: 80 }), pos);
  touchCourse(db, courseId, now);
  return Number(r.lastInsertRowid);
}

function sectionRow(db, pk) {
  const s = db.prepare('SELECT * FROM sections WHERE pk = ?').get(pk);
  if (!s) throw new HttpError(404, 'not_found', 'Abschnitt nicht gefunden.');
  return s;
}

export function updateSection(db, pk, body, now) {
  const s = sectionRow(db, pk);
  if (body.title !== undefined) db.prepare('UPDATE sections SET title = ? WHERE pk = ?').run(str(body.title, 'Titel', { max: 80 }), pk);
  if (body.direction !== undefined) moveRow(db, 'sections', s, oneOf(body.direction, ['up', 'down'], 'Richtung'), 'course_id = ?', [s.course_id]);
  touchCourse(db, s.course_id, now);
  return s.course_id;
}

export function deleteSection(db, pk, now) {
  const s = sectionRow(db, pk);
  const slugs = db.prepare('SELECT slug FROM units WHERE section_pk = ?').all(pk).map((u) => u.slug);
  db.prepare('DELETE FROM sections WHERE pk = ?').run(pk);
  for (const u of slugs) db.prepare('DELETE FROM review_items WHERE course_id = ? AND unit_id = ?').run(s.course_id, u);
  guardPublished(db, s.course_id);
  touchCourse(db, s.course_id, now);
  return s.course_id;
}

export function createUnit(db, sectionPk, body, now) {
  const s = sectionRow(db, sectionPk);
  const u = slug(body.slug, 'Einheiten-ID');
  if (slugTaken(db, s.course_id, u)) throw new HttpError(409, 'exists', 'Diese ID ist im Kurs schon vergeben.');
  const pos = db.prepare('SELECT coalesce(max(position), -1) + 1 AS p FROM units WHERE section_pk = ?').get(sectionPk).p;
  const r = db.prepare('INSERT INTO units (course_id, section_pk, slug, title, description, intro, position, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    s.course_id, sectionPk, u, str(body.title, 'Titel', { max: 80 }), str(body.description, 'Beschreibung', { max: 200, optional: true }),
    introInput(body.intro), pos,
    body.status === undefined ? 'draft' : oneOf(body.status, UNIT_STATUS, 'Status'),
  );
  touchCourse(db, s.course_id, now);
  return Number(r.lastInsertRowid);
}

/** Regeltext einer Einheit; leer = keiner. */
const introInput = (v) => (v == null || v === '' ? null : str(v, 'Regeltext', { max: 2000 }));

function unitRow(db, pk) {
  const u = db.prepare('SELECT * FROM units WHERE pk = ?').get(pk);
  if (!u) throw new HttpError(404, 'not_found', 'Einheit nicht gefunden.');
  return u;
}

/** Vertauscht die Position einer Zeile mit ihrer Nachbarin (innerhalb der gleichen Gruppe). */
function moveRow(db, table, row, direction, groupSql, groupArgs) {
  const op = direction === 'up' ? '<' : '>';
  const order = direction === 'up' ? 'DESC' : 'ASC';
  const other = db.prepare(`SELECT pk, position FROM ${table} WHERE ${groupSql} AND position ${op} ? ORDER BY position ${order} LIMIT 1`).get(...groupArgs, row.position);
  if (!other) return false;
  db.prepare(`UPDATE ${table} SET position = ? WHERE pk = ?`).run(other.position, row.pk);
  db.prepare(`UPDATE ${table} SET position = ? WHERE pk = ?`).run(row.position, other.pk);
  return true;
}

export function updateUnit(db, pk, body, now) {
  const u = unitRow(db, pk);
  db.prepare('UPDATE units SET title = ?, description = ?, intro = ?, status = ? WHERE pk = ?').run(
    body.title === undefined ? u.title : str(body.title, 'Titel', { max: 80 }),
    body.description === undefined ? u.description : str(body.description, 'Beschreibung', { max: 200, optional: true }),
    body.intro === undefined ? u.intro : introInput(body.intro),
    body.status === undefined ? u.status : oneOf(body.status, UNIT_STATUS, 'Status'),
    pk,
  );
  if (body.direction !== undefined) moveRow(db, 'units', u, oneOf(body.direction, ['up', 'down'], 'Richtung'), 'section_pk = ?', [u.section_pk]);
  guardPublished(db, u.course_id);
  touchCourse(db, u.course_id, now);
  return u.course_id;
}

export function deleteUnit(db, pk, now) {
  const u = unitRow(db, pk);
  db.prepare('DELETE FROM units WHERE pk = ?').run(pk);
  db.prepare('DELETE FROM review_items WHERE course_id = ? AND unit_id = ?').run(u.course_id, u.slug);
  guardPublished(db, u.course_id);
  touchCourse(db, u.course_id, now);
  return u.course_id;
}

/** Aussprache (reading) und Wortbausteine (tokens) aus dem Admin-Formular; leer = entfernen. */
function extrasInput(body, kind, current) {
  const next = { ...current };
  if (body.reading !== undefined) {
    if (body.reading == null || body.reading === '') delete next.reading;
    else next.reading = str(body.reading, 'Aussprache', { max: 300 });
  }
  if (body.examples !== undefined) {
    if (body.examples == null || (Array.isArray(body.examples) && body.examples.length === 0)) delete next.examples;
    else if (kind !== 'w') throw new HttpError(400, 'invalid', 'Beispielsätze gibt es nur bei Wörtern.');
    else {
      const ok = Array.isArray(body.examples) && body.examples.length <= 3 && body.examples.every((e) => e && typeof e === 'object');
      if (!ok) throw new HttpError(400, 'invalid', 'Beispiele: höchstens 3, je mit Zielsprache und Deutsch.');
      // Herkunft (source) eines Beispiels bleibt erhalten, solange der Satz gleich bleibt.
      const kept = new Map((current.examples ?? []).map((e) => [e.target, e]));
      next.examples = body.examples.map((e) => {
        const ex = { target: str(e.target, 'Beispiel (Zielsprache)', { max: 300 }), native: str(e.native, 'Beispiel (Übersetzung)', { max: 300 }) };
        if (e.reading != null && e.reading !== '') ex.reading = str(e.reading, 'Beispiel (Aussprache)', { max: 300 });
        const old = kept.get(ex.target);
        if (old?.source) ex.source = old.source;
        return ex;
      });
    }
  }
  if (body.tokens !== undefined) {
    if (body.tokens == null || (Array.isArray(body.tokens) && body.tokens.length === 0)) delete next.tokens;
    else if (kind !== 's') throw new HttpError(400, 'invalid', 'Wortbausteine gibt es nur bei Sätzen.');
    else {
      const ok = Array.isArray(body.tokens) && body.tokens.length <= 100
        && body.tokens.every((t) => typeof t === 'string' && t.trim() && t.length <= 50 && !/\s/.test(t));
      if (!ok) throw new HttpError(400, 'invalid', 'Wortbausteine: 1–100 Bausteine ohne Leerzeichen (je max. 50 Zeichen).');
      next.tokens = body.tokens;
    }
  }
  return next;
}

function itemInput(body, kind, currentExtras = {}) {
  const note = body.note == null || body.note === '' ? null : str(body.note, 'Erklärung', { max: 500 });
  if (kind === 's' && !note) throw new HttpError(400, 'invalid', 'Sätze brauchen eine Erklärung (note).');
  const extras = extrasInput(body, kind, currentExtras);
  return { native: textList(body.native, 'Muttersprache'), target: textList(body.target, 'Zielsprache'), note, extra: extraJson(extras) };
}

export function createItem(db, unitPk, body, now) {
  const u = unitRow(db, unitPk);
  const kind = oneOf(body.kind, ['w', 's'], 'Art');
  const { native, target, note, extra } = itemInput(body, kind);
  const pos = db.prepare('SELECT count(*) AS n FROM items WHERE unit_pk = ? AND kind = ?').get(unitPk, kind).n;
  const r = db.prepare('INSERT INTO items (unit_pk, kind, position, native, target, note, extra) VALUES (?, ?, ?, ?, ?, ?, ?)').run(unitPk, kind, pos, json(native), json(target), note, extra);
  touchCourse(db, u.course_id, now);
  return Number(r.lastInsertRowid);
}

function itemRow(db, pk) {
  const it = db.prepare('SELECT i.*, u.course_id, u.slug AS unit_slug FROM items i JOIN units u ON u.pk = i.unit_pk WHERE i.pk = ?').get(pk);
  if (!it) throw new HttpError(404, 'not_found', 'Lernobjekt nicht gefunden.');
  return it;
}

function guardPublished(db, courseId) {
  const course = db.prepare('SELECT status FROM courses WHERE id = ?').get(courseId);
  if (course.status !== 'published') return;
  const v = checkPublishable(db, courseId);
  if (!v.ok) throw new HttpError(400, 'not_publishable', `Änderung würde den veröffentlichten Kurs ungültig machen: ${v.errors.slice(0, 5).join(' ')}`, { errors: v.errors });
}

export function updateItem(db, pk, body, now) {
  const it = itemRow(db, pk);
  const merged = {
    native: body.native === undefined ? parseList(it.native) : body.native,
    target: body.target === undefined ? parseList(it.target) : body.target,
    note: body.note === undefined ? it.note : body.note,
    reading: body.reading,
    tokens: body.tokens,
    examples: body.examples,
  };
  const { native, target, note, extra } = itemInput(merged, it.kind, pickExtras(parseObject(it.extra)));
  db.prepare('UPDATE items SET native = ?, target = ?, note = ?, extra = ? WHERE pk = ?').run(json(native), json(target), note, extra, pk);
  guardPublished(db, it.course_id);
  touchCourse(db, it.course_id, now);
  return it.course_id;
}

/**
 * Verschiebt Wiederholungs-Referenzen (idx) einer Einheit. Zweistufig über negative Werte,
 * damit der Primärschlüssel während des UPDATE nie kollidiert.
 */
function remapReviewIdx(db, courseId, unitSlug, kind, mapping) {
  const stmt = db.prepare('UPDATE review_items SET idx = ? WHERE course_id = ? AND unit_id = ? AND kind = ? AND idx = ?');
  for (const [from, to] of mapping) stmt.run(-1 - to, courseId, unitSlug, kind, from);
  db.prepare('UPDATE review_items SET idx = -1 - idx WHERE course_id = ? AND unit_id = ? AND kind = ? AND idx < 0').run(courseId, unitSlug, kind);
}

export function deleteItem(db, pk, now) {
  const it = itemRow(db, pk);
  db.prepare('DELETE FROM items WHERE pk = ?').run(pk);
  db.prepare('DELETE FROM review_items WHERE course_id = ? AND unit_id = ? AND kind = ? AND idx = ?').run(it.course_id, it.unit_slug, it.kind, it.position);
  const later = db.prepare('SELECT pk, position FROM items WHERE unit_pk = ? AND kind = ? AND position > ? ORDER BY position').all(it.unit_pk, it.kind, it.position);
  for (const row of later) db.prepare('UPDATE items SET position = ? WHERE pk = ?').run(row.position - 1, row.pk);
  remapReviewIdx(db, it.course_id, it.unit_slug, it.kind, later.map((row) => [row.position, row.position - 1]));
  guardPublished(db, it.course_id);
  touchCourse(db, it.course_id, now);
  return it.course_id;
}

export function moveItem(db, pk, direction, now) {
  const it = itemRow(db, pk);
  const to = it.position + (oneOf(direction, ['up', 'down'], 'Richtung') === 'up' ? -1 : 1);
  const other = db.prepare('SELECT pk FROM items WHERE unit_pk = ? AND kind = ? AND position = ?').get(it.unit_pk, it.kind, to);
  if (!other) return it.course_id;
  db.prepare('UPDATE items SET position = ? WHERE pk = ?').run(to, it.pk);
  db.prepare('UPDATE items SET position = ? WHERE pk = ?').run(it.position, other.pk);
  remapReviewIdx(db, it.course_id, it.unit_slug, it.kind, [[it.position, to], [to, it.position]]);
  touchCourse(db, it.course_id, now);
  return it.course_id;
}

function ensureLanguages(db, course) {
  for (const code of [course.nativeLang, course.targetLang]) {
    if (!db.prepare('SELECT 1 FROM languages WHERE code = ?').get(code)) {
      const [name, nativeName] = KNOWN_LANGUAGES[code] ?? [code, ''];
      db.prepare('INSERT INTO languages (code, name, native_name) VALUES (?, ?, ?)').run(code, name, nativeName);
    }
  }
}

/** Abschnitte, Einheiten und Lernobjekte eines Kurses einfügen (alle Einheiten veröffentlicht). */
function insertStructure(db, course) {
  const insSection = db.prepare('INSERT INTO sections (course_id, slug, title, position) VALUES (?, ?, ?, ?)');
  const insUnit = db.prepare("INSERT INTO units (course_id, section_pk, slug, title, description, intro, position, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'published')");
  const insItem = db.prepare('INSERT INTO items (unit_pk, kind, position, native, target, note, extra) VALUES (?, ?, ?, ?, ?, ?, ?)');
  course.levels.forEach((level, li) => {
    const sectionPk = Number(insSection.run(course.id, level.id, level.title.slice(0, 80), li).lastInsertRowid);
    level.units.forEach((unit, ui) => {
      const unitPk = Number(insUnit.run(course.id, sectionPk, unit.id, unit.title.slice(0, 80), String(unit.description ?? '').slice(0, 200),
        unit.intro ?? null, ui).lastInsertRowid);
      unit.words.forEach((w, i) => insItem.run(unitPk, 'w', i, json(w.native), json(w.target), w.note ?? null, extraJson(w)));
      unit.sentences.forEach((s, i) => insItem.run(unitPk, 's', i, json(s.native), json(s.target), s.note ?? null, extraJson(s)));
    });
  });
}

const attributionJson = (course) => (Array.isArray(course.attribution) && course.attribution.length ? json(course.attribution) : null);

/** Legt einen Kurs aus dem Kursformat an (Seed und Admin-Import). Wirft bei ungültigem Kurs oder vorhandener ID. */
export function importCourse(db, course, { status = 'draft', now = Date.now(), provenance = '' } = {}) {
  if (typeof course?.id === 'string' && db.prepare('SELECT 1 FROM courses WHERE id = ?').get(course.id)) {
    throw new HttpError(409, 'exists', `Es gibt schon einen Kurs mit der ID „${course.id}“.`);
  }
  const v = validateCourse(course);
  if (!v.ok) throw new HttpError(400, 'invalid_course', `Kurs ungültig: ${v.errors.slice(0, 5).join(' ')}`, { errors: v.errors });
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM courses WHERE id = ?').get(course.id)) throw new HttpError(409, 'exists', `Es gibt schon einen Kurs mit der ID „${course.id}“.`);
    ensureLanguages(db, course);
    const pos = db.prepare('SELECT coalesce(max(position), -1) + 1 AS p FROM courses').get().p;
    db.prepare(`INSERT INTO courses (id, title, subtitle, native_lang, target_lang, tts_lang, status, demo, license, provenance, version, position,
        created_at, updated_at, attribution, generated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(
      course.id, course.title.slice(0, 80), String(course.subtitle ?? '').slice(0, 160), course.nativeLang, course.targetLang, course.ttsLang ?? null,
      oneOf(status, COURSE_STATUS, 'Status'), course.demo ? 1 : 0, String(course.license ?? '').slice(0, 200), String(provenance).slice(0, 1000), pos, now, now,
      attributionJson(course), course.generated ? 1 : 0,
    );
    insertStructure(db, course);
    return course.id;
  });
}

/**
 * Ersetzt den Inhalt eines vorhandenen Kurses durch einen neuen Stand (nur für unveränderte mitgelieferte Kurse).
 * Status und Position bleiben, die Version steigt (offene Lektionen mit altem Stand bekommen 409).
 * Wiederholungs-Einträge, deren Lernobjekt es nicht mehr gibt, werden entfernt. @returns neue Version
 */
export function replaceCourseContent(db, course, { now = Date.now(), provenance = '' } = {}) {
  const v = validateCourse(course);
  if (!v.ok) throw new HttpError(400, 'invalid_course', `Kurs ungültig: ${v.errors.slice(0, 5).join(' ')}`, { errors: v.errors });
  return tx(db, () => {
    const cur = db.prepare('SELECT native_lang, target_lang FROM courses WHERE id = ?').get(course.id);
    if (!cur) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
    if (cur.native_lang !== course.nativeLang || cur.target_lang !== course.targetLang) {
      throw new HttpError(409, 'lang_changed', `Kurs „${course.id}“: Sprachen dürfen sich nicht ändern.`);
    }
    db.prepare('DELETE FROM sections WHERE course_id = ?').run(course.id);
    db.prepare(`UPDATE courses SET title = ?, subtitle = ?, tts_lang = ?, demo = ?, license = ?, provenance = ?, attribution = ?, generated = ?,
        version = version + 1, updated_at = ? WHERE id = ?`).run(
      course.title.slice(0, 80), String(course.subtitle ?? '').slice(0, 160), course.ttsLang ?? null, course.demo ? 1 : 0,
      String(course.license ?? '').slice(0, 200), String(provenance).slice(0, 1000), attributionJson(course), course.generated ? 1 : 0, now, course.id,
    );
    insertStructure(db, course);
    db.prepare(`DELETE FROM review_items WHERE course_id = ? AND NOT EXISTS (
        SELECT 1 FROM items i JOIN units u ON u.pk = i.unit_pk
        WHERE u.course_id = review_items.course_id AND u.slug = review_items.unit_id AND i.kind = review_items.kind AND i.position = review_items.idx)`).run(course.id);
    return db.prepare('SELECT version FROM courses WHERE id = ?').get(course.id).version;
  });
}

/** Kursformat zum Herunterladen (inkl. Entwürfe, ohne interne Felder). */
export function exportCourse(db, id) {
  const c = assembleCourse(db, id, { includeDrafts: true });
  if (!c) return null;
  const { version: _v, status: _s, ...rest } = c;
  return { ...rest, levels: rest.levels.map((l) => ({ ...l, units: l.units.map(({ status: _u, ...u }) => u) })) };
}
