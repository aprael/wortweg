// Konten und Sitzungen: scrypt-Passwörter, zufällige Sitzungstokens (in der DB nur als Hash), einfaches Rate-Limit.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_COOKIE = 'ww_session';
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL = { user: 30 * DAY_MS, guest: 365 * DAY_MS };
export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Ein fester Hash, gegen den bei unbekannter E-Mail geprüft wird, damit die Antwortzeit nichts verrät. */
let dummyHash = null;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('wortweg-dummy-password');
  await verifyPassword(password, dummyHash);
  return false;
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function checkEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Das Passwort braucht mindestens ${PASSWORD_MIN} Zeichen.`;
  if (password.length > PASSWORD_MAX) return `Das Passwort darf höchstens ${PASSWORD_MAX} Zeichen haben.`;
  return null;
}

/** Anzeigename: Steuerzeichen entfernen, Leerraum zusammenfassen, 1–40 Zeichen. */
export function cleanDisplayName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 40 ? s : null;
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createSession(db, userId, ttl, now) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, now, now + ttl);
  return { token, maxAge: Math.floor(ttl / 1000) };
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** Liefert den Benutzer zur Sitzung oder null. Abgelaufene Sitzungen werden dabei entfernt. */
export function userForToken(db, token, now) {
  if (!token || token.length > 100) return null;
  const row = db.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.is_guest, s.expires_at, s.token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, isGuest: row.is_guest === 1 };
}

export function publicUser(u) {
  return u ? { id: u.id, displayName: u.displayName, email: u.email ?? null, role: u.role, isGuest: u.isGuest } : null;
}

export function sessionCookie(token, maxAge, secure) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Zählt Fehlversuche pro Schlüssel in einem festen Zeitfenster (nur im Speicher, siehe Demo-Hinweise). */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    blocked(key, now) {
      const h = hits.get(key);
      if (!h || now - h.start > windowMs) return false;
      return h.count >= limit;
    },
    hit(key, now) {
      const h = hits.get(key);
      if (!h || now - h.start > windowMs) hits.set(key, { start: now, count: 1 });
      else h.count++;
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    },
    clear(key) {
      hits.delete(key);
    },
  };
}
