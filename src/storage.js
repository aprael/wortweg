// Wortweg – lokale Hilfen: Übernahme des alten localStorage-Stands (Version 0.1) und Datei-Helfer.
// Der Fortschritt selbst liegt seit 0.2 auf dem Server (siehe src/api.js).

import { sanitizeState } from './progress.js';

/** Schlüssel der lokalen Version 0.1. */
export const LEGACY_STATE_KEY = 'wortweg:state:v1';
export const MAX_FILE_BYTES = 2_000_000;

function defaultBackend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Zugriff kann z. B. in gesperrten Browser-Modi werfen.
    return null;
  }
}

/** Grobe Kennzahlen eines (bereinigten) Zustands, z. B. für den Hinweis „Fortschritt übernehmen?“. */
export function summarizeState(state) {
  const courses = Object.values(state?.courses ?? {});
  const lessons = courses.reduce((n, c) => n + Object.keys(c.completed ?? {}).length, 0);
  const items = Object.keys(state?.review ?? {}).length;
  return { xpTotal: state?.xpTotal ?? 0, lessons, items, hasProgress: (state?.xpTotal ?? 0) > 0 || lessons > 0 || items > 0 };
}

/**
 * Liest den alten lokalen Stand. Nichts vorhanden, unlesbar oder leer → null.
 * @returns {{raw: object, state: object, summary: {xpTotal: number, lessons: number, items: number, hasProgress: boolean}} | null}
 */
export function readLegacyState(backend = defaultBackend()) {
  if (!backend) return null;
  let text;
  try {
    text = backend.getItem(LEGACY_STATE_KEY);
  } catch {
    return null;
  }
  if (text == null) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = sanitizeState(raw);
  const summary = summarizeState(state);
  return summary.hasProgress ? { raw, state, summary } : null;
}

/** Entfernt den alten lokalen Stand (nur nach erfolgreicher Übernahme oder ausdrücklichem Wunsch aufrufen). */
export function clearLegacyState(backend = defaultBackend()) {
  if (!backend) return false;
  try {
    backend.removeItem(LEGACY_STATE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Exportformat für POST /api/progress/import. */
export function legacyExportPayload(raw) {
  return { app: 'wortweg', version: 1, state: raw };
}

/** JSON-Text einer Datei lesen; wirft verständliche Fehler. */
export function parseJsonText(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Die Datei enthält kein JSON-Objekt.');
  return data;
}

/** Prüft grob, ob ein Objekt ein Wortweg-Fortschrittsexport ist (die genaue Prüfung macht der Server). */
export function checkProgressExport(data) {
  if (!data || data.app !== 'wortweg' || !data.state || typeof data.state !== 'object') {
    throw new Error('Die Datei ist kein Wortweg-Fortschrittsexport.');
  }
  return data;
}

/** Text einer ausgewählten Datei lesen (mit Größenlimit). */
export async function readFileText(file, maxBytes = MAX_FILE_BYTES) {
  if (!file) return null;
  if (file.size > maxBytes) throw new Error(`Die Datei ist zu groß (höchstens ${Math.round(maxBytes / 1_000_000)} MB).`);
  return file.text();
}

/** Ein Objekt als JSON-Datei herunterladen (nur im Browser). */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
