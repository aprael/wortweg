// Zwischenstand einer laufenden Lektion bzw. eines Checkpoints auf diesem Gerät (localStorage).
// Wer die App schließt oder das Handy sperrt, macht später an derselben Übung weiter. Gilt in beiden
// Betriebsarten; der Server bekommt die Antworten erst am Ende (docs/ARCHITEKTUR.md §6).

const KEY = 'wortweg:run:v1';
/** Ältere Zwischenstände verfallen (Kurs oder Fortschritt haben sich dann meist geändert). */
export const RUN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Speichert den Zwischenstand. Fehler (voller oder gesperrter Speicher) werden ignoriert. */
export function saveRunSnapshot(snapshot) {
  try {
    storage()?.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Speicher voll oder gesperrt – die Lektion läuft trotzdem weiter.
  }
}

/** Liest den Zwischenstand oder null (fehlt, kaputt oder zu alt). */
export function loadRunSnapshot(now = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(storage()?.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || typeof raw.savedAt !== 'number') return null;
  if (now - raw.savedAt > RUN_MAX_AGE) return null;
  if (!raw.session || !Array.isArray(raw.session.queue) || typeof raw.session.pos !== 'number') return null;
  return raw;
}

export function clearRunSnapshot() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // nichts zu tun
  }
}

/**
 * Passt ein gespeicherter Zwischenstand zu dieser Lektion? Nutzer, Kurs samt Version, Lektion und Seed müssen
 * übereinstimmen – sonst passten die Antworten nicht zu den Übungen, die der Server nachbaut. Die Optionen
 * (Hören/Sprechen) kommen aus dem Zwischenstand und gehen so auch an den Server.
 */
export function snapshotMatches(snap, { userId, courseId, version, kind, targetId, seed }) {
  return Boolean(snap) && snap.userId === userId && snap.courseId === courseId && snap.version === version
    && snap.kind === kind && snap.targetId === targetId && String(snap.seed) === String(seed)
    && snap.session.pos < snap.session.queue.length;
}
