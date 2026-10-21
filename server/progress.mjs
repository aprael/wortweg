// Lernstand: Abbildung zwischen dem Zustandsobjekt aus src/progress.js (v2) und den Tabellen.
// Die Lernlogik selbst (XP, Serie, Boxen, Freischaltung) bleibt in src/progress.js – hier wird nur gelesen und geschrieben.
import { createInitialState, sanitizeState } from '../src/progress.js';
import { tx } from './db.mjs';

const parseSettings = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

export function loadState(db, userId) {
  const base = createInitialState();
  const ls = db.prepare('SELECT * FROM learner_state WHERE user_id = ?').get(userId);
  if (!ls) return base;
  const raw = {
    version: base.version,
    activeCourseId: ls.active_course_id,
    xpTotal: ls.xp_total,
    xpByDay: {},
    dailyGoal: ls.daily_goal,
    streak: { current: ls.streak_current, best: ls.streak_best, lastDay: ls.streak_last_day },
    courses: {},
    review: {},
    settings: parseSettings(ls.settings),
  };
  for (const r of db.prepare('SELECT day, xp FROM xp_days WHERE user_id = ?').all(userId)) raw.xpByDay[r.day] = r.xp;
  const course = (id) => (raw.courses[id] ??= { completed: {}, checkpoints: {} });
  for (const r of db.prepare('SELECT * FROM lesson_progress WHERE user_id = ?').all(userId)) {
    course(r.course_id).completed[r.lesson_id] = { completions: r.completions, bestScore: r.best_score, lastAt: r.last_at };
  }
  for (const r of db.prepare('SELECT * FROM checkpoint_progress WHERE user_id = ?').all(userId)) {
    course(r.course_id).checkpoints[r.level_id] = { passed: r.passed === 1, bestScore: r.best_score, attempts: r.attempts, lastAt: r.last_at };
  }
  for (const r of db.prepare('SELECT * FROM review_items WHERE user_id = ?').all(userId)) {
    raw.review[`${r.course_id}|${r.kind}|${r.unit_id}|${r.idx}`] = {
      courseId: r.course_id, kind: r.kind, unitId: r.unit_id, index: r.idx, box: r.box, due: r.due, wrong: r.wrong, seen: r.seen,
    };
  }
  return sanitizeState(raw);
}

/** Schreibt den kompletten Zustand (ersetzt die Zeilen des Benutzers). Läuft in einer Transaktion. */
export function saveState(db, userId, input, now = Date.now()) {
  const state = sanitizeState(input);
  tx(db, () => {
    db.prepare(`INSERT INTO learner_state (user_id, active_course_id, daily_goal, settings, xp_total, streak_current, streak_best, streak_last_day, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET active_course_id = excluded.active_course_id, daily_goal = excluded.daily_goal,
        settings = excluded.settings, xp_total = excluded.xp_total, streak_current = excluded.streak_current,
        streak_best = excluded.streak_best, streak_last_day = excluded.streak_last_day, updated_at = excluded.updated_at`).run(
      userId, state.activeCourseId, state.dailyGoal, JSON.stringify(state.settings), Math.round(state.xpTotal),
      Math.round(state.streak.current), Math.round(state.streak.best), state.streak.lastDay, now,
    );
    for (const table of ['xp_days', 'lesson_progress', 'checkpoint_progress', 'review_items']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    const insDay = db.prepare('INSERT INTO xp_days (user_id, day, xp) VALUES (?, ?, ?)');
    for (const [day, xp] of Object.entries(state.xpByDay)) insDay.run(userId, day, Math.round(xp));
    const insLesson = db.prepare('INSERT INTO lesson_progress (user_id, course_id, lesson_id, completions, best_score, last_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insCp = db.prepare('INSERT INTO checkpoint_progress (user_id, course_id, level_id, passed, best_score, attempts, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [courseId, c] of Object.entries(state.courses)) {
      for (const [lessonId, l] of Object.entries(c.completed ?? {})) insLesson.run(userId, courseId, lessonId, Math.round(l.completions), l.bestScore, Math.round(l.lastAt));
      for (const [levelId, cp] of Object.entries(c.checkpoints ?? {})) insCp.run(userId, courseId, levelId, cp.passed ? 1 : 0, cp.bestScore, Math.round(cp.attempts), Math.round(cp.lastAt));
    }
    const insReview = db.prepare('INSERT OR REPLACE INTO review_items (user_id, course_id, kind, unit_id, idx, box, due, wrong, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const it of Object.values(state.review)) {
      insReview.run(userId, it.courseId, it.kind, it.unitId, it.index, it.box, it.due == null ? null : Math.round(it.due), Math.round(it.wrong), Math.round(it.seen));
    }
  });
  return state;
}

export function recordAttempt(db, userId, { courseId, kind, target, total, firstTryCorrect, xp }, now) {
  db.prepare('INSERT INTO attempts (user_id, course_id, kind, target, total, first_try_correct, xp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, courseId, kind, String(target).slice(0, 140), total, firstTryCorrect, xp, now);
}

export function stats(db, userId, lookupItem) {
  const days = db.prepare('SELECT day, xp FROM xp_days WHERE user_id = ? ORDER BY day DESC LIMIT 30').all(userId).reverse().map((r) => ({ day: r.day, xp: r.xp }));
  const byKind = { lesson: 0, review: 0, checkpoint: 0 };
  let total = 0;
  let correct = 0;
  for (const r of db.prepare('SELECT kind, count(*) AS n, sum(total) AS t, sum(first_try_correct) AS c FROM attempts WHERE user_id = ? GROUP BY kind').all(userId)) {
    byKind[r.kind] = r.n;
    total += r.t ?? 0;
    correct += r.c ?? 0;
  }
  const hardItems = db.prepare('SELECT course_id, kind, unit_id, idx, wrong, box FROM review_items WHERE user_id = ? AND wrong > 0 ORDER BY wrong DESC, due ASC LIMIT 10').all(userId)
    .map((r) => {
      const item = lookupItem(r.course_id, r.kind, r.unit_id, r.idx);
      return item ? { courseId: r.course_id, kind: r.kind, unitId: r.unit_id, index: r.idx, wrong: r.wrong, box: r.box, native: item.native[0], target: item.target[0] } : null;
    })
    .filter(Boolean);
  const mastered = db.prepare('SELECT count(*) AS n FROM review_items WHERE user_id = ? AND due IS NULL').get(userId).n;
  const learning = db.prepare('SELECT count(*) AS n FROM review_items WHERE user_id = ? AND due IS NOT NULL').get(userId).n;
  return { days, attempts: byKind, accuracy: total ? correct / total : null, answered: total, hardItems, items: { learning, mastered } };
}
