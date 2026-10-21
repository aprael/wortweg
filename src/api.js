// Wortweg – kleiner fetch-Wrapper für die Server-API (docs/ARCHITEKTUR.md §6).
// Alle Anfragen: same-origin mit Cookie, JSON hin und zurück. Fehler kommen als ApiError mit deutscher Meldung.

/** Betriebsart: 'server' (diese Datei) oder 'local' (src/local-api.js im App-Build). */
export const MODE = 'server';

const TIMEOUT_MS = 20_000;

/** Fehler einer API-Anfrage. status 0 = keine Verbindung bzw. Zeitüberschreitung. */
export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetwork() {
    return this.status === 0;
  }
}

const FALLBACK_MESSAGES = {
  400: 'Die Eingabe ist ungültig.',
  401: 'Bitte melde dich an oder starte als Gast.',
  403: 'Dafür fehlen dir die Rechte.',
  404: 'Nicht gefunden.',
  409: 'Das passt nicht zum aktuellen Stand. Bitte lade die Seite neu.',
  413: 'Die Datei oder Anfrage ist zu groß.',
  415: 'Der Server erwartet JSON.',
  429: 'Zu viele Versuche. Bitte warte einen Moment.',
};

export const NETWORK_MESSAGE = 'Keine Verbindung zum Server. Prüfe deine Verbindung und versuche es noch einmal.';
const TIMEOUT_MESSAGE = 'Der Server antwortet gerade nicht. Bitte versuche es gleich noch einmal.';

export function fallbackMessage(status) {
  if (FALLBACK_MESSAGES[status]) return FALLBACK_MESSAGES[status];
  if (status >= 500) return 'Auf dem Server ist ein Fehler aufgetreten. Bitte später noch einmal versuchen.';
  return `Unerwartete Antwort vom Server (Status ${status}).`;
}

/** Dateiname aus Content-Disposition (nur sichere Zeichen). */
export function filenameFromDisposition(header, fallback) {
  const m = /filename="?([^";]+)"?/i.exec(String(header ?? ''));
  const name = m ? m[1].replace(/[^a-zA-Z0-9._-]/g, '_') : '';
  return name || fallback;
}

/**
 * Eine Anfrage an die API.
 * @param {string} method
 * @param {string} path  beginnt mit /api/
 * @param {object} [body]
 * @param {{raw?: boolean}} [opts]  raw: Antwort ohne {ok}-Hülle (Downloads) – liefert {data, filename}
 */
export async function request(method, path, body, { raw = false } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller) {
    init.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  }
  let res;
  try {
    res = await globalThis.fetch(path, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw new ApiError(0, 'timeout', TIMEOUT_MESSAGE);
    throw new ApiError(0, 'network', NETWORK_MESSAGE);
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data && typeof data === 'object' ? data.error : null;
    const { code, message, ...details } = err && typeof err === 'object' ? err : {};
    throw new ApiError(res.status, typeof code === 'string' ? code : `http_${res.status}`,
      typeof message === 'string' && message ? message : fallbackMessage(res.status), details);
  }
  if (data == null || typeof data !== 'object') {
    throw new ApiError(res.status, 'bad_response', 'Der Server hat keine gültige Antwort geschickt.');
  }
  if (raw) {
    const header = typeof res.headers?.get === 'function' ? res.headers.get('Content-Disposition') : null;
    return { data, filename: filenameFromDisposition(header, null) };
  }
  if (data.ok === false) {
    const e = data.error ?? {};
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? fallbackMessage(400), {});
  }
  return data;
}

const enc = encodeURIComponent;
const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const patch = (p, b) => request('PATCH', p, b);
const del = (p) => request('DELETE', p);

// ---------- Konten ----------
export const getMe = () => get('/api/me');
export const startGuest = () => post('/api/auth/guest');
export const register = ({ email, password, displayName }) => post('/api/auth/register', { email, password, displayName });
export const login = ({ email, password }) => post('/api/auth/login', { email, password });
export const logout = () => post('/api/auth/logout');
export const deleteAccount = (password) => post('/api/account/delete', password == null ? {} : { password });
export const updateAccount = (displayName) => patch('/api/account', { displayName });

// ---------- Inhalte ----------
export const getLanguages = () => get('/api/languages');
export const getCourses = () => get('/api/courses');
export const getCourse = (id, { preview = false } = {}) => get(`/api/courses/${enc(id)}${preview ? '?preview=1' : ''}`);

// ---------- Fortschritt ----------
export const getProgress = () => get('/api/progress');
/** @param {{dailyGoal?: number, activeCourseId?: string|null, settings?: object}} changes */
export const saveSettings = (changes) => patch('/api/progress/settings', changes);
export const submitLesson = ({ courseId, lessonId, version, seed, options, responses }) =>
  post('/api/progress/lesson', { courseId, lessonId, version, seed, options, responses });
export const submitCheckpoint = ({ courseId, levelId, version, seed, options, responses }) =>
  post('/api/progress/checkpoint', { courseId, levelId, version, seed, options, responses });
export const submitReview = ({ courseId, version, responses }) => post('/api/progress/review', { courseId, version, responses });
/** @returns {Promise<{data: object, filename: string|null}>} */
export const exportProgress = () => request('GET', '/api/progress/export', undefined, { raw: true });
export const importProgress = (data) => post('/api/progress/import', { data });
export const resetProgress = () => post('/api/progress/reset');
export const getStats = () => get('/api/stats');

// ---------- Administration ----------
export const adminOverview = () => get('/api/admin/overview');
export const adminCreateLanguage = ({ code, name, nativeName }) => post('/api/admin/languages', { code, name, nativeName });
export const adminUpdateLanguage = (code, { name, nativeName }) => patch(`/api/admin/languages/${enc(code)}`, { name, nativeName });
export const adminDeleteLanguage = (code) => del(`/api/admin/languages/${enc(code)}`);
export const adminCreateCourse = (body) => post('/api/admin/courses', body);
export const adminGetCourse = (id) => get(`/api/admin/courses/${enc(id)}`);
export const adminUpdateCourse = (id, changes) => patch(`/api/admin/courses/${enc(id)}`, changes);
export const adminDeleteCourse = (id) => del(`/api/admin/courses/${enc(id)}`);
export const adminValidateCourse = (id) => post(`/api/admin/courses/${enc(id)}/validate`);
/** @returns {Promise<{data: object, filename: string|null}>} */
export const adminExportCourse = (id) => request('GET', `/api/admin/courses/${enc(id)}/export`, undefined, { raw: true });
export const adminImportCourse = (course) => post('/api/admin/import', { course });
export const adminCreateSection = (courseId, { slug, title }) => post(`/api/admin/courses/${enc(courseId)}/sections`, { slug, title });
export const adminUpdateSection = (pk, changes) => patch(`/api/admin/sections/${enc(pk)}`, changes);
export const adminDeleteSection = (pk) => del(`/api/admin/sections/${enc(pk)}`);
export const adminCreateUnit = (sectionPk, body) => post(`/api/admin/sections/${enc(sectionPk)}/units`, body);
export const adminUpdateUnit = (pk, changes) => patch(`/api/admin/units/${enc(pk)}`, changes);
export const adminDeleteUnit = (pk) => del(`/api/admin/units/${enc(pk)}`);
export const adminPreviewUnit = (pk) => get(`/api/admin/units/${enc(pk)}/preview`);
export const adminCreateItem = (unitPk, body) => post(`/api/admin/units/${enc(unitPk)}/items`, body);
export const adminUpdateItem = (pk, changes) => patch(`/api/admin/items/${enc(pk)}`, changes);
export const adminDeleteItem = (pk) => del(`/api/admin/items/${enc(pk)}`);
export const adminMoveItem = (pk, direction) => post(`/api/admin/items/${enc(pk)}/move`, { direction });
