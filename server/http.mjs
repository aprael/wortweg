// HTTP-Grundlagen ohne Framework: Fehlerklasse, Router, JSON-Body mit Limit, Sicherheitsheader, statische Dateien.
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

export class HttpError extends Error {
  constructor(status, code, message, extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), microphone=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

const COMPRESS_MIN = 1024;

/** gzip, wenn der Client es versteht und es sich lohnt (große Datenkurse, app.js). Ergänzt die Header. */
function maybeGzip(req, body, headers) {
  if (!req || body.length < COMPRESS_MIN || !/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return body;
  headers['Content-Encoding'] = 'gzip';
  headers.Vary = 'Accept-Encoding';
  return gzipSync(body);
}

/** req ist optional; mit req wird die Antwort bei Bedarf komprimiert. */
export function sendJson(res, status, body, headers = {}, req = null) {
  const out = { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
  const data = maybeGzip(req, Buffer.from(JSON.stringify(body)), out);
  res.writeHead(status, out);
  res.end(data);
}

export function sendError(res, err) {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { ok: false, error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
  } else {
    sendJson(res, 500, { ok: false, error: { code: 'server_error', message: 'Interner Fehler. Bitte später noch einmal versuchen.' } });
  }
}

/** Liest einen JSON-Body mit Größenlimit. Leerer Body → {}. */
export function readJson(req, limit) {
  return new Promise((resolveBody, reject) => {
    const type = String(req.headers['content-type'] ?? '');
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      reject(new HttpError(413, 'too_large', 'Die Anfrage ist zu groß.'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'too_large', 'Die Anfrage ist zu groß.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      if (size === 0) return resolveBody({});
      if (!/^application\/json\b/i.test(type)) return reject(new HttpError(415, 'unsupported_type', 'Erwartet wird JSON (Content-Type: application/json).'));
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data == null || typeof data !== 'object' || Array.isArray(data)) throw new Error('kein Objekt');
        resolveBody(data);
      } catch {
        reject(new HttpError(400, 'bad_json', 'Der Inhalt ist kein gültiges JSON-Objekt.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'bad_request', 'Die Anfrage konnte nicht gelesen werden.')));
  });
}

/**
 * Schreibende Anfragen nur von der eigenen Seite: Ist ein Origin-Header vorhanden, muss er zum Host passen.
 * Zusammen mit SameSite=Strict und dem JSON-Zwang (kein einfaches Formular möglich) ist das der CSRF-Schutz.
 */
export function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'bad_origin', 'Anfrage von fremder Herkunft abgelehnt.');
  }
  if (host !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Anfrage von fremder Herkunft abgelehnt.');
}

/** Router: Pfadmuster mit :param, z. B. "/api/admin/units/:pk". */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, n) => {
      names.push(n);
      return '([^/]+)';
    })}$`);
    routes.push({ method, re, names, handler, opts });
  };
  return {
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    patch: (p, h, o) => add('PATCH', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
    match(method, path) {
      let pathFound = false;
      for (const r of routes) {
        const m = r.re.exec(path);
        if (!m) continue;
        pathFound = true;
        if (r.method !== method) continue;
        const params = {};
        r.names.forEach((n, i) => {
          try {
            params[n] = decodeURIComponent(m[i + 1]);
          } catch {
            params[n] = '';
          }
        });
        return { route: r, params };
      }
      return pathFound ? { notAllowed: true } : null;
    },
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const STATIC_ALLOWED = ['index.html', 'styles.css', 'src/', 'assets/'];
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest']);

/** Liefert eine Datei aus der Positivliste aus. Gibt false zurück, wenn es keine passende Datei gibt. */
export async function serveStatic(req, res, root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return false;
  }
  if (rel.includes('\0') || rel.split('/').some((p) => p === '..' || p.startsWith('.'))) return false;
  if (!STATIC_ALLOWED.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)))) return false;
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    const ext = extname(file);
    const headers = { ...SECURITY_HEADERS, 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' };
    const raw = await readFile(file);
    const body = COMPRESSIBLE.has(ext) ? maybeGzip(req, raw, headers) : raw;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}
