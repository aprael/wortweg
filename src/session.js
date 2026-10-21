// Ablauf einer Lektion/Wiederholung: Warteschlange mit einmaliger Wiederholung falscher Übungen.
// gradeSubmission bewertet dieselbe Lektion nachträglich aus Rohantworten (Server) mit gleichem Ergebnis.

import { gradeExercise } from './grading.js';
import { fallbackExercise } from './exercises.js';

/** Alle Lernobjekte einer Übung (match hat mehrere). */
function exerciseRefs(ex) {
  if (Array.isArray(ex.refs)) return ex.refs;
  return ex.ref ? [ex.ref] : [];
}

export function createSession(exercises) {
  return {
    queue: exercises.map((ex) => ({ ex, retry: false })),
    pos: 0,
    total: exercises.length,
    results: {},
  };
}

export function currentItem(session) {
  return session.queue[session.pos] ?? null;
}

export function isFinished(session) {
  return session.pos >= session.queue.length;
}

/**
 * Speichert eine Antwort. Falsche Antworten im ersten Durchgang werden einmal ans Ende gestellt.
 * Gibt eine neue Sitzung zurück (unveränderlich).
 */
export function recordAnswer(session, correct) {
  const item = currentItem(session);
  if (!item) return session;
  const { ex, retry } = item;
  const prev = session.results[ex.id];
  const results = {
    ...session.results,
    [ex.id]: prev
      ? { ...prev, attempts: prev.attempts + 1, finalCorrect: correct }
      : { ref: ex.ref ?? null, refs: exerciseRefs(ex), attempts: 1, firstTry: correct, finalCorrect: correct },
  };
  const queue = !correct && !retry ? [...session.queue, { ex, retry: true }] : session.queue;
  return { ...session, results, queue };
}

export function advance(session) {
  return { ...session, pos: session.pos + 1 };
}

/** Anteil erledigter Schritte für die Fortschrittsleiste (0..1). */
export function sessionProgress(session) {
  return session.queue.length ? Math.min(1, session.pos / session.queue.length) : 1;
}

/** Refs der im ersten Versuch falschen Übungen, ohne Duplikate (Reihenfolge wie die Übungen). */
function collectWrongRefs(results) {
  const seen = new Set();
  const out = [];
  for (const r of Object.values(results)) {
    if (r.firstTry) continue;
    for (const ref of r.refs) {
      const key = `${ref.kind}|${ref.unitId}|${ref.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

export function summarize(session) {
  const values = Object.values(session.results);
  const firstTryCorrect = values.filter((r) => r.firstTry).length;
  const wrongRefs = collectWrongRefs(session.results);
  return { total: session.total, firstTryCorrect, wrongRefs, accuracy: session.total ? firstTryCorrect / session.total : 0 };
}

/**
 * Bewertet eine abgeschickte Lektion/Wiederholung/Checkpoint aus Rohantworten (Server-Autorität).
 * Ergebnis wie createSession → recordAnswer → summarize mit denselben Antworten.
 * @param {object[]} exercises  deterministisch nachgebaute Übungen
 * @param {{[exerciseId: string]: {answers: unknown[], fallback?: boolean}}} responses
 *   answers = [erster Versuch, zweiter Versuch?]; fehlt die Antwort oder hat sie die falsche Form → falsch.
 * @param {object} course  für fallbackExercise (Hören/Sprechen → Übersetzen)
 * @returns {{total: number, firstTryCorrect: number, accuracy: number, wrongRefs: object[], results: object}}
 */
export function gradeSubmission(exercises, responses, course) {
  const list = Array.isArray(exercises) ? exercises : [];
  const map = responses != null && typeof responses === 'object' && !Array.isArray(responses) ? responses : {};
  const results = {};
  for (const original of list) {
    const resp = Object.hasOwn(map, original.id) ? map[original.id] : null;
    const answers = resp != null && typeof resp === 'object' && Array.isArray(resp.answers) ? resp.answers : null;
    const base = { ref: original.ref ?? null, refs: exerciseRefs(original) };
    if (!answers || answers.length < 1 || answers.length > 2) {
      results[original.id] = { ...base, attempts: 0, firstTry: false, finalCorrect: false };
      continue;
    }
    const ex = resp.fallback === true ? fallbackExercise(original, course) : original;
    const first = gradeExercise(ex, answers[0]).correct;
    // Ein zweiter Versuch zählt nur nach falschem ersten (wie die Warteschlange im Browser).
    if (first || answers.length < 2) {
      results[original.id] = { ...base, attempts: 1, firstTry: first, finalCorrect: first };
    } else {
      results[original.id] = { ...base, attempts: 2, firstTry: false, finalCorrect: gradeExercise(ex, answers[1]).correct };
    }
  }
  const values = Object.values(results);
  const firstTryCorrect = values.filter((r) => r.firstTry).length;
  return {
    total: list.length,
    firstTryCorrect,
    accuracy: list.length ? firstTryCorrect / list.length : 0,
    wrongRefs: collectWrongRefs(results),
    results,
  };
}
