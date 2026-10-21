// Wortweg-Server: Routen für Konten, Lernen und Administration. createApp() ist ohne Netzwerk testbar.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { findLesson, findUnit, lessonCount } from '../src/content.js';
import { buildLesson, buildCheckpoint, buildReviewExercise, lessonItems } from '../src/exercises.js';
import { gradeSubmission } from '../src/session.js';
import {
  applyLessonResult, applyCheckpointResult, applyReviewAnswer, finishReview, dailyGoalReached, dueReviewItems,
  isLessonUnlocked, isCheckpointUnlocked, sanitizeState, createInitialState, DAILY_GOALS, STATE_VERSION,
} from '../src/progress.js';
import {
  SESSION_COOKIE, SESSION_TTL, checkEmail, checkPassword, cleanDisplayName, clearCookie, createRateLimiter,
  createSession, deleteSession, dummyVerify, hashPassword, normalizeEmail, publicUser, readCookie, sessionCookie,
  userForToken, verifyPassword,
} from './auth.mjs';
import * as content from './content.mjs';
import { tx } from './db.mjs';
import { HttpError, checkOrigin, createRouter, readJson, sendError, sendJson, serveStatic, SECURITY_HEADERS } from './http.mjs';
import { loadState, recordAttempt, saveState, stats } from './progress.mjs';

const DEFAULT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BODY_LIMIT = 256 * 1024;
const IMPORT_LIMIT = 2 * 1024 * 1024;
const MAX_RESPONSES = 60;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Prüft die Form der Antworten. Die Inhalte selbst bewertet gradeExercise (robust gegen beliebige Werte). */
function checkResponses(responses) {
  if (!isObj(responses)) throw new HttpError(400, 'invalid', 'responses fehlt.');
  const keys = Object.keys(responses);
  if (keys.length > MAX_RESPONSES) throw new HttpError(400, 'invalid', 'Zu viele Antworten.');
  const out = Object.create(null);
  for (const k of keys) {
    const r = responses[k];
    if (k.length > 200 || !isObj(r) || !Array.isArray(r.answers) || r.answers.length < 1 || r.answers.length > 2) {
      throw new HttpError(400, 'invalid', 'Antwortformat ungültig.');
    }
    out[k] = { answers: r.answers, fallback: r.fallback === true };
  }
  return out;
}

function checkOptions(o) {
  return { listening: isObj(o) && o.listening === true, speaking: isObj(o) && o.speaking === true };
}

/** Alle Lektionen einer Einheit mit ihren Übungen; Fehler beim Erzeugen werden gemeldet statt geworfen. */
function previewLessons(course, unit) {
  if (!unit || unit.words.length < 1) return [];
  const out = [];
  for (let i = 0; i < lessonCount(unit); i++) {
    try {
      out.push({ index: i, exercises: buildLesson(course, unit, i, { listening: true, speaking: true }) });
    } catch (err) {
      out.push({ index: i, error: `Lektion ${i + 1} lässt sich nicht erzeugen: ${err.message}` });
    }
  }
  return out;
}

export function createApp({ db, root = DEFAULT_ROOT, clock = () => Date.now(), secureCookies = false, log = null } = {}) {
  const router = createRouter();
  const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
  const signupLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });

  const requireUser = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'Bitte melde dich an oder starte als Gast.');
    return ctx.user;
  };

  function startSession(ctx, user, now) {
    const { token, maxAge } = createSession(db, user.id, user.isGuest ? SESSION_TTL.guest : SESSION_TTL.user, now);
    if (ctx.token) deleteSession(db, ctx.token);
    ctx.setCookie = sessionCookie(token, maxAge, secureCookies);
  }

  function userById(id) {
    const u = db.prepare('SELECT id, email, display_name, role, is_guest FROM users WHERE id = ?').get(id);
    return u ? { id: u.id, email: u.email, displayName: u.display_name, role: u.role, isGuest: u.is_guest === 1 } : null;
  }

  function publishedCourse(id) {
    if (typeof id !== 'string' || !content.SLUG_RE.test(id)) throw new HttpError(400, 'invalid', 'Kurs-ID ungültig.');
    const course = content.assembleCourse(db, id);
    if (!course) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden oder nicht veröffentlicht.');
    return course;
  }

  function checkVersion(course, version) {
    if (version !== course.version) {
      throw new HttpError(409, 'course_changed', 'Der Kurs wurde inzwischen geändert. Bitte starte die Übung neu.', { version: course.version });
    }
  }

  // ---------- Konten ----------

  router.get('/api/me', (ctx) => ({ user: publicUser(ctx.user) }));

  router.post('/api/auth/guest', (ctx) => {
    const now = clock();
    if (signupLimiter.blocked(ctx.ip, now)) throw new HttpError(429, 'rate_limited', 'Zu viele neue Konten von dieser Adresse. Bitte später erneut versuchen.');
    signupLimiter.hit(ctx.ip, now);
    if (ctx.user) return { user: publicUser(ctx.user) };
    const user = tx(db, () => {
      const r = db.prepare("INSERT INTO users (email, display_name, password_hash, role, is_guest, created_at) VALUES (NULL, 'Gast', NULL, 'learner', 1, ?)").run(now);
      return userById(Number(r.lastInsertRowid));
    });
    startSession(ctx, user, now);
    return { user: publicUser(user) };
  });

  /** Meldet sich ein Gast mit einem bestehenden Konto an, wird das Gastkonto entfernt (sonst bliebe es unerreichbar). */
  function dropGuest(guest) {
    db.prepare('DELETE FROM users WHERE id = ? AND is_guest = 1').run(guest.id);
  }

  router.post('/api/auth/register', async (ctx) => {
    const now = clock();
    const { email: rawEmail, password, displayName } = ctx.body;
    const email = normalizeEmail(rawEmail);
    if (!checkEmail(email)) throw new HttpError(400, 'invalid_email', 'Bitte gib eine gültige E-Mail-Adresse ein.');
    const pwError = checkPassword(password);
    if (pwError) throw new HttpError(400, 'weak_password', pwError);
    const name = cleanDisplayName(displayName);
    if (!name) throw new HttpError(400, 'invalid_name', 'Der Anzeigename muss 1–40 Zeichen haben.');
    if (signupLimiter.blocked(ctx.ip, now)) throw new HttpError(429, 'rate_limited', 'Zu viele neue Konten von dieser Adresse. Bitte später erneut versuchen.');
    signupLimiter.hit(ctx.ip, now);
    const hash = await hashPassword(password);
    const user = tx(db, () => {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'email_taken', 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.');
      if (ctx.user?.isGuest) {
        // Gast wird zum Konto: Fortschritt bleibt erhalten.
        db.prepare('UPDATE users SET email = ?, display_name = ?, password_hash = ?, is_guest = 0, last_login_at = ? WHERE id = ?').run(email, name, hash, now, ctx.user.id);
        return userById(ctx.user.id);
      }
      const r = db.prepare("INSERT INTO users (email, display_name, password_hash, role, is_guest, created_at, last_login_at) VALUES (?, ?, ?, 'learner', 0, ?, ?)").run(email, name, hash, now, now);
      return userById(Number(r.lastInsertRowid));
    });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    ctx.token = null;
    startSession(ctx, user, now);
    return { user: publicUser(user) };
  });

  router.post('/api/auth/login', async (ctx) => {
    const now = clock();
    const email = normalizeEmail(ctx.body.email);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 500) : '';
    const key = `${email}|${ctx.ip}`;
    if (loginLimiter.blocked(key, now)) throw new HttpError(429, 'rate_limited', 'Zu viele Fehlversuche. Bitte warte 15 Minuten.');
    const row = checkEmail(email) ? db.prepare('SELECT id, password_hash FROM users WHERE email = ? AND is_guest = 0').get(email) : null;
    const ok = row ? await verifyPassword(password, row.password_hash) : await dummyVerify(password);
    if (!ok) {
      loginLimiter.hit(key, now);
      throw new HttpError(401, 'bad_credentials', 'E-Mail oder Passwort stimmt nicht.');
    }
    loginLimiter.clear(key);
    if (ctx.user?.isGuest && ctx.user.id !== row.id) dropGuest(ctx.user);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);
    const user = userById(row.id);
    startSession(ctx, user, now);
    return { user: publicUser(user) };
  });

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.token) deleteSession(db, ctx.token);
    ctx.setCookie = clearCookie(secureCookies);
    return {};
  });

  router.patch('/api/account', (ctx) => {
    const user = requireUser(ctx);
    const name = cleanDisplayName(ctx.body.displayName);
    if (!name) throw new HttpError(400, 'invalid_name', 'Der Anzeigename muss 1–40 Zeichen haben.');
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, user.id);
    return { user: publicUser(userById(user.id)) };
  });

  router.post('/api/account/delete', async (ctx) => {
    const user = requireUser(ctx);
    if (!user.isGuest) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      const password = typeof ctx.body.password === 'string' ? ctx.body.password.slice(0, 500) : '';
      if (!(await verifyPassword(password, row.password_hash))) throw new HttpError(403, 'bad_credentials', 'Das Passwort stimmt nicht.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    ctx.setCookie = clearCookie(secureCookies);
    return {};
  });

  // ---------- Inhalte ----------

  router.get('/api/languages', () => ({ languages: content.listLanguages(db) }));
  router.get('/api/courses', () => ({ courses: content.listPublishedCourses(db) }));
  router.get('/api/courses/:id', (ctx) => {
    if (ctx.query.get('preview') === '1') {
      if (ctx.user?.role !== 'admin') throw new HttpError(403, 'forbidden', 'Nur für Admins.');
      const course = content.assembleCourse(db, ctx.params.id, { includeDrafts: true });
      if (!course) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
      return { course };
    }
    return { course: publishedCourse(ctx.params.id) };
  });

  // ---------- Fortschritt ----------

  router.get('/api/progress', (ctx) => ({ state: loadState(db, requireUser(ctx).id) }));

  router.patch('/api/progress/settings', (ctx) => {
    const user = requireUser(ctx);
    const { dailyGoal, activeCourseId, settings } = ctx.body;
    return tx(db, () => {
      const state = loadState(db, user.id);
      const next = { ...state, settings: { ...state.settings } };
      if (dailyGoal !== undefined) {
        if (!DAILY_GOALS.includes(dailyGoal)) throw new HttpError(400, 'invalid', `Tagesziel muss eins von ${DAILY_GOALS.join(', ')} sein.`);
        next.dailyGoal = dailyGoal;
      }
      if (activeCourseId !== undefined) {
        if (activeCourseId !== null) publishedCourse(activeCourseId);
        next.activeCourseId = activeCourseId;
      }
      if (settings !== undefined) {
        if (!isObj(settings)) throw new HttpError(400, 'invalid', 'settings muss ein Objekt sein.');
        for (const [k, v] of Object.entries(settings)) {
          if (!Object.hasOwn(state.settings, k) || typeof v !== 'boolean') throw new HttpError(400, 'invalid', `Unbekannte Einstellung: ${k}`);
          next.settings[k] = v;
        }
      }
      return { state: saveState(db, user.id, next, clock()) };
    });
  });

  router.post('/api/progress/lesson', (ctx) => {
    const user = requireUser(ctx);
    const { courseId, lessonId, version, seed } = ctx.body;
    const course = publishedCourse(courseId);
    checkVersion(course, version);
    if (!isInt(seed, 0, 1_000_000)) throw new HttpError(400, 'invalid', 'seed ungültig.');
    const responses = checkResponses(ctx.body.responses);
    const lesson = typeof lessonId === 'string' ? findLesson(course, lessonId) : null;
    if (!lesson) throw new HttpError(404, 'not_found', 'Lektion nicht gefunden.');
    const now = clock();
    return tx(db, () => {
      const state = loadState(db, user.id);
      if (!isLessonUnlocked(state, course, lesson.id)) throw new HttpError(403, 'locked', 'Diese Lektion ist noch gesperrt.');
      const exercises = buildLesson(course, lesson.unit, lesson.index, { seed, ...checkOptions(ctx.body.options) });
      const sum = gradeSubmission(exercises, responses, course);
      const before = dailyGoalReached(state, now);
      const res = applyLessonResult(state, {
        courseId: course.id, lessonId: lesson.id, total: sum.total, firstTryCorrect: sum.firstTryCorrect,
        items: lessonItems(lesson.unit, lesson.index), wrongRefs: sum.wrongRefs, now,
      });
      const saved = saveState(db, user.id, res.state, now);
      recordAttempt(db, user.id, { courseId: course.id, kind: 'lesson', target: lesson.id, total: sum.total, firstTryCorrect: sum.firstTryCorrect, xp: res.xp }, now);
      return { state: saved, result: resultOf(sum, res.xp, !before && dailyGoalReached(saved, now)) };
    });
  });

  router.post('/api/progress/checkpoint', (ctx) => {
    const user = requireUser(ctx);
    const { courseId, levelId, version, seed } = ctx.body;
    const course = publishedCourse(courseId);
    checkVersion(course, version);
    if (!isInt(seed, 0, 1_000_000)) throw new HttpError(400, 'invalid', 'seed ungültig.');
    const responses = checkResponses(ctx.body.responses);
    const level = course.levels.find((l) => l.id === levelId);
    if (!level) throw new HttpError(404, 'not_found', 'Abschnitt nicht gefunden.');
    const now = clock();
    return tx(db, () => {
      const state = loadState(db, user.id);
      if (!isCheckpointUnlocked(state, course, level.id)) throw new HttpError(403, 'locked', 'Dieser Checkpoint ist noch gesperrt.');
      const exercises = buildCheckpoint(course, level, { seed, ...checkOptions(ctx.body.options) });
      const sum = gradeSubmission(exercises, responses, course);
      const before = dailyGoalReached(state, now);
      const res = applyCheckpointResult(state, { courseId: course.id, levelId: level.id, total: sum.total, firstTryCorrect: sum.firstTryCorrect, wrongRefs: sum.wrongRefs, now });
      const saved = saveState(db, user.id, res.state, now);
      recordAttempt(db, user.id, { courseId: course.id, kind: 'checkpoint', target: level.id, total: sum.total, firstTryCorrect: sum.firstTryCorrect, xp: res.xp }, now);
      return { state: saved, result: { ...resultOf(sum, res.xp, !before && dailyGoalReached(saved, now)), passed: res.passed } };
    });
  });

  router.post('/api/progress/review', (ctx) => {
    const user = requireUser(ctx);
    const course = publishedCourse(ctx.body.courseId);
    checkVersion(course, ctx.body.version);
    const responses = checkResponses(ctx.body.responses);
    const now = clock();
    return tx(db, () => {
      let state = loadState(db, user.id);
      // Nur Objekte, die jetzt fällig sind und beantwortet wurden, werden nachgebaut und bewertet.
      const due = dueReviewItems(state, course.id, now, 99).filter((it) => responses[`review:${it.key}`]);
      if (!due.length) throw new HttpError(400, 'nothing_due', 'Keine der Antworten gehört zu einer fälligen Wiederholung.');
      const exercises = due.map((it) => buildReviewExercise(course, it, { seed: it.seen, box: it.box })).filter(Boolean);
      const sum = gradeSubmission(exercises, responses, course);
      for (const ex of exercises) {
        state = applyReviewAnswer(state, ex.id.slice('review:'.length), Boolean(sum.results[ex.id]?.firstTry), now);
      }
      const before = dailyGoalReached(state, now);
      const res = finishReview(state, sum.firstTryCorrect, now);
      const saved = saveState(db, user.id, res.state, now);
      recordAttempt(db, user.id, { courseId: course.id, kind: 'review', target: 'review', total: sum.total, firstTryCorrect: sum.firstTryCorrect, xp: res.xp }, now);
      return { state: saved, result: resultOf(sum, res.xp, !before && dailyGoalReached(saved, now)) };
    });
  });

  function resultOf(sum, xp, goalJustReached) {
    return { xp, total: sum.total, firstTryCorrect: sum.firstTryCorrect, accuracy: sum.accuracy, wrongRefs: sum.wrongRefs, goalJustReached };
  }

  router.get('/api/progress/export', (ctx) => {
    const state = loadState(db, requireUser(ctx).id);
    ctx.download = `wortweg-fortschritt-${new Date(clock()).toISOString().slice(0, 10)}.json`;
    return { app: 'wortweg', version: STATE_VERSION, exportedAt: new Date(clock()).toISOString(), state };
  });

  router.post('/api/progress/import', (ctx) => {
    const user = requireUser(ctx);
    const data = ctx.body.data;
    if (!isObj(data) || data.app !== 'wortweg' || !isObj(data.state)) throw new HttpError(400, 'invalid_import', 'Die Datei ist kein Wortweg-Export.');
    if (typeof data.version !== 'number' || data.version > STATE_VERSION) throw new HttpError(400, 'invalid_import', 'Der Export stammt von einer neueren App-Version.');
    return { state: saveState(db, user.id, sanitizeState(data.state), clock()) };
  }, { limit: IMPORT_LIMIT });

  router.post('/api/progress/reset', (ctx) => {
    const user = requireUser(ctx);
    const keep = loadState(db, user.id);
    const fresh = { ...createInitialState(), activeCourseId: keep.activeCourseId, settings: keep.settings, dailyGoal: keep.dailyGoal };
    return tx(db, () => {
      db.prepare('DELETE FROM attempts WHERE user_id = ?').run(user.id);
      return { state: saveState(db, user.id, fresh, clock()) };
    });
  });

  router.get('/api/stats', (ctx) => {
    const user = requireUser(ctx);
    const lookup = (courseId, kind, unitId, index) => {
      const course = content.assembleCourse(db, courseId);
      const unit = course ? findUnit(course, unitId) : null;
      return unit ? (kind === 'w' ? unit.words : unit.sentences)[index] ?? null : null;
    };
    return { stats: stats(db, user.id, lookup) };
  });

  // ---------- Administration ----------

  const admin = { admin: true };
  const adminTx = (ctx, action, target, fn) => tx(db, () => {
    const out = fn(clock());
    content.audit(db, ctx.user.id, action, String(target), '', clock());
    return out;
  });
  const pk = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'invalid', 'Ungültiger Schlüssel.');
    return n;
  };

  router.get('/api/admin/overview', () => content.adminOverview(db), admin);
  router.post('/api/admin/languages', (ctx) => ({ language: adminTx(ctx, 'language.create', ctx.body.code, () => content.upsertLanguage(db, ctx.body, { create: true })) }), admin);
  router.patch('/api/admin/languages/:code', (ctx) => ({ language: adminTx(ctx, 'language.update', ctx.params.code, () => content.upsertLanguage(db, { ...ctx.body, code: ctx.params.code }, { create: false })) }), admin);
  router.delete('/api/admin/languages/:code', (ctx) => {
    adminTx(ctx, 'language.delete', ctx.params.code, () => content.deleteLanguage(db, ctx.params.code));
    return {};
  }, admin);

  router.post('/api/admin/courses', (ctx) => {
    const id = adminTx(ctx, 'course.create', ctx.body.id, (now) => content.createCourse(db, ctx.body, now));
    return { course: content.adminCourse(db, id) };
  }, admin);
  router.get('/api/admin/courses/:id', (ctx) => {
    const course = content.adminCourse(db, ctx.params.id);
    if (!course) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
    return { course };
  }, admin);
  router.patch('/api/admin/courses/:id', (ctx) => {
    adminTx(ctx, ctx.body.status ? `course.status.${ctx.body.status}` : 'course.update', ctx.params.id, (now) => content.updateCourse(db, ctx.params.id, ctx.body, now));
    return { course: content.adminCourse(db, ctx.params.id) };
  }, admin);
  router.delete('/api/admin/courses/:id', (ctx) => {
    adminTx(ctx, 'course.delete', ctx.params.id, () => content.deleteCourse(db, ctx.params.id));
    return {};
  }, admin);
  router.post('/api/admin/courses/:id/validate', (ctx) => {
    const v = content.checkPublishable(db, ctx.params.id);
    const draft = content.assembleCourse(db, ctx.params.id, { includeDrafts: true });
    const warnings = [];
    for (const l of draft.levels) {
      for (const u of l.units) if (u.status === 'draft') warnings.push(`Einheit „${u.title}“ ist ein Entwurf und für Lernende unsichtbar.`);
      if (!l.units.length) warnings.push(`Abschnitt „${l.title}“ hat keine Einheiten.`);
    }
    return { ok: v.ok, errors: v.errors, warnings };
  }, admin);
  router.get('/api/admin/courses/:id/export', (ctx) => {
    const course = content.exportCourse(db, ctx.params.id);
    if (!course) throw new HttpError(404, 'not_found', 'Kurs nicht gefunden.');
    ctx.download = `${course.id}.json`;
    return course;
  }, admin);
  router.post('/api/admin/import', (ctx) => {
    const id = adminTx(ctx, 'course.import', ctx.body.course?.id ?? '?', (now) => content.importCourse(db, ctx.body.course, { status: 'draft', now, provenance: 'Admin-Import' }));
    return { course: content.adminCourse(db, id) };
  }, { ...admin, limit: IMPORT_LIMIT });

  router.post('/api/admin/courses/:id/sections', (ctx) => {
    const sectionPk = adminTx(ctx, 'section.create', `${ctx.params.id}/${ctx.body.slug}`, (now) => content.createSection(db, ctx.params.id, ctx.body, now));
    return { pk: sectionPk, course: content.adminCourse(db, ctx.params.id) };
  }, admin);
  router.patch('/api/admin/sections/:pk', (ctx) => {
    const courseId = adminTx(ctx, 'section.update', ctx.params.pk, (now) => content.updateSection(db, pk(ctx.params.pk), ctx.body, now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);
  router.delete('/api/admin/sections/:pk', (ctx) => {
    const courseId = adminTx(ctx, 'section.delete', ctx.params.pk, (now) => content.deleteSection(db, pk(ctx.params.pk), now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);

  router.post('/api/admin/sections/:pk/units', (ctx) => {
    const unitPk = adminTx(ctx, 'unit.create', ctx.body.slug, (now) => content.createUnit(db, pk(ctx.params.pk), ctx.body, now));
    const courseId = db.prepare('SELECT course_id FROM units WHERE pk = ?').get(unitPk).course_id;
    return { pk: unitPk, course: content.adminCourse(db, courseId) };
  }, admin);
  router.patch('/api/admin/units/:pk', (ctx) => {
    const courseId = adminTx(ctx, ctx.body.status ? `unit.status.${ctx.body.status}` : 'unit.update', ctx.params.pk, (now) => content.updateUnit(db, pk(ctx.params.pk), ctx.body, now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);
  router.delete('/api/admin/units/:pk', (ctx) => {
    const courseId = adminTx(ctx, 'unit.delete', ctx.params.pk, (now) => content.deleteUnit(db, pk(ctx.params.pk), now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);
  router.get('/api/admin/units/:pk/preview', (ctx) => {
    const u = db.prepare('SELECT course_id, slug FROM units WHERE pk = ?').get(pk(ctx.params.pk));
    if (!u) throw new HttpError(404, 'not_found', 'Einheit nicht gefunden.');
    const course = content.assembleCourse(db, u.course_id, { includeDrafts: true });
    const unit = findUnit(course, u.slug);
    return { lessons: previewLessons(course, unit) };
  }, admin);

  router.post('/api/admin/units/:pk/items', (ctx) => {
    const itemPk = adminTx(ctx, 'item.create', ctx.params.pk, (now) => content.createItem(db, pk(ctx.params.pk), ctx.body, now));
    const courseId = db.prepare('SELECT u.course_id FROM items i JOIN units u ON u.pk = i.unit_pk WHERE i.pk = ?').get(itemPk).course_id;
    return { pk: itemPk, course: content.adminCourse(db, courseId) };
  }, admin);
  router.patch('/api/admin/items/:pk', (ctx) => {
    const courseId = adminTx(ctx, 'item.update', ctx.params.pk, (now) => content.updateItem(db, pk(ctx.params.pk), ctx.body, now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);
  router.delete('/api/admin/items/:pk', (ctx) => {
    const courseId = adminTx(ctx, 'item.delete', ctx.params.pk, (now) => content.deleteItem(db, pk(ctx.params.pk), now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);
  router.post('/api/admin/items/:pk/move', (ctx) => {
    const courseId = adminTx(ctx, 'item.move', ctx.params.pk, (now) => content.moveItem(db, pk(ctx.params.pk), ctx.body.direction, now));
    return { course: content.adminCourse(db, courseId) };
  }, admin);

  // ---------- Verarbeitung ----------

  return async function handle(req, res) {
    const started = clock();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const ctx = {
      ip: req.socket?.remoteAddress ?? 'unknown',
      query: url.searchParams,
      token: readCookie(req.headers.cookie, SESSION_COOKIE),
      user: null,
      body: {},
      params: {},
      setCookie: null,
      download: null,
    };
    let status = 200;
    try {
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt.');
        const served = await serveStatic(req, res, root, path === '/' ? '/index.html' : path);
        if (!served) {
          status = 404;
          res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
        }
        return;
      }
      const m = router.match(req.method, path);
      if (!m) throw new HttpError(404, 'not_found', 'Unbekannte Schnittstelle.');
      if (m.notAllowed) throw new HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt.');
      ctx.params = m.params;
      ctx.user = userForToken(db, ctx.token, started);
      if (!ctx.user && ctx.token) {
        // Abgelaufenes oder unbekanntes Cookie: beim Antworten löschen.
        ctx.token = null;
        ctx.setCookie = clearCookie(secureCookies);
      }
      if (req.method !== 'GET') {
        checkOrigin(req);
        ctx.body = await readJson(req, m.route.opts.limit ?? BODY_LIMIT);
      }
      if (m.route.opts.admin) {
        requireUser(ctx);
        if (ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Nur für Admins.');
      }
      const data = await m.route.handler(ctx);
      const headers = {};
      if (ctx.setCookie) headers['Set-Cookie'] = ctx.setCookie;
      if (ctx.download) {
        headers['Content-Disposition'] = `attachment; filename="${ctx.download.replace(/[^a-zA-Z0-9._-]/g, '_')}"`;
        sendJson(res, 200, data, headers, req);
      } else {
        sendJson(res, 200, { ok: true, ...data }, headers, req);
      }
    } catch (err) {
      status = err instanceof HttpError ? err.status : 500;
      if (status === 500 && log) log(`Fehler bei ${req.method} ${path}: ${err?.stack ?? err}`);
      if (ctx.setCookie) res.setHeader('Set-Cookie', ctx.setCookie);
      sendError(res, err);
    } finally {
      // Nur Methode, Pfad ohne Query, Status, Dauer – keine Bodys, Cookies oder E-Mail-Adressen.
      if (log) log(`${req.method} ${path} ${status} ${clock() - started}ms`);
    }
  };
}
