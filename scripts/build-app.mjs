// App-Modus (docs/ARCHITEKTUR.md §9.3): statischen, offlinefähigen Build nach dist/ erzeugen – z. B. für GitHub Pages.
// Kein Server, kein Konto: src/local-api.js ersetzt src/api.js, Kurse liegen als JSON unter courses/.
// Aufruf: node scripts/build-app.mjs [Zielordner]   (Standard: dist)
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validateCourse, listLessons } from '../src/content.js';
import { KNOWN_LANGUAGES } from '../server/content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = resolve(ROOT, process.argv[2] ?? 'dist');
if (OUT === ROOT || !OUT.startsWith(ROOT)) throw new Error(`Zielordner muss im Projekt liegen: ${OUT}`);
const started = performance.now();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'courses'), { recursive: true });
for (const dir of ['src', 'assets']) cpSync(join(ROOT, dir), join(OUT, dir), { recursive: true });
cpSync(join(ROOT, 'styles.css'), join(OUT, 'styles.css'));
cpSync(join(ROOT, 'LICENSE'), join(OUT, 'LICENSE.txt'));
cpSync(join(ROOT, 'data/courses/PROVENIENZ.md'), join(OUT, 'courses/PROVENIENZ.md'));
writeFileSync(join(OUT, '.nojekyll'), '');

// Oberfläche auf die lokale API umstellen (genau ein Import).
const appFile = join(OUT, 'src/app.js');
const appJs = readFileSync(appFile, 'utf8');
const IMPORT = "import * as api from './api.js';";
if (appJs.split(IMPORT).length !== 2) throw new Error('src/app.js: API-Import nicht eindeutig gefunden.');
writeFileSync(appFile, appJs.replace(IMPORT, "import * as api from './local-api.js';"));

// Kurse: prüfen, Kennzahlen vorberechnen, mit Inhalts-Hash im Namen ablegen (sicheres Caching im Service Worker).
const sha = (data) => createHash('sha256').update(data).digest('hex');
const courseDir = join(ROOT, 'data/courses');
const files = JSON.parse(readFileSync(join(courseDir, 'index.json'), 'utf8')).courses;
const courses = [];
const langs = new Set();
for (const file of files) {
  const course = JSON.parse(readFileSync(join(courseDir, file), 'utf8'));
  const v = validateCourse(course);
  if (!v.ok) throw new Error(`${file}: ${v.errors.slice(0, 3).join(' ')}`);
  const text = JSON.stringify({ ...course, version: 1 });
  const name = `${course.id}.${sha(text).slice(0, 10)}.json`;
  writeFileSync(join(OUT, 'courses', name), text);
  const units = course.levels.flatMap((l) => l.units);
  courses.push({
    id: course.id, title: course.title, subtitle: course.subtitle ?? '', nativeLang: course.nativeLang, targetLang: course.targetLang,
    demo: course.demo === true, license: course.license ?? '', generated: course.generated === true, file: name,
    stats: {
      levels: course.levels.length, units: units.length, lessons: listLessons(course).length,
      words: units.reduce((n, u) => n + u.words.length, 0), sentences: units.reduce((n, u) => n + u.sentences.length, 0),
    },
  });
  langs.add(course.nativeLang).add(course.targetLang);
}
const languages = [...langs].sort().map((code) => {
  const [name, nativeName] = KNOWN_LANGUAGES[code] ?? [code, ''];
  return { code, name, nativeName };
});
writeFileSync(join(OUT, 'courses/index.json'), JSON.stringify({ courses, languages }));

// Manifest: macht Wortweg installierbar (Windows/Mac über Edge, Chrome oder Safari, iPhone/Android über den Home-Bildschirm).
writeFileSync(join(OUT, 'manifest.webmanifest'), JSON.stringify({
  id: './',
  name: 'Wortweg – Sprachen lernen',
  short_name: 'Wortweg',
  description: 'Freie Sprachlern-App: Lernpfad, Übungen, Wiederholung. Offline, ohne Konto, ohne Werbung.',
  lang: 'de',
  start_url: './',
  scope: './',
  display: 'standalone',
  categories: ['education'],
  background_color: '#e9effc',
  theme_color: '#0d1e4b',
  icons: [
    { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'assets/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

// index.html: Manifest, iPhone-Angaben, Service Worker, CSP (statisches Hosting setzt keine Header).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
  + "worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'";
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const head = `  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="no-referrer">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="assets/icon-180.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Wortweg">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <script type="module" src="src/pwa.js"></script>
</head>`;
if (html.split('</head>').length !== 2) throw new Error('index.html: </head> nicht eindeutig.');
html = html.replace('</head>', head);
writeFileSync(join(OUT, 'index.html'), html);

// Service Worker: App-Hülle (versioniert) und alle Kursdateien (Name enthält den Hash) beim Installieren cachen,
// damit nach dem ersten Start jeder Kurs offline geht; Aufnahmen beim ersten Abspielen oder auf Wunsch (Seite „App“).
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const all = walk(OUT).map((p) => relative(OUT, p).split('\\').join('/')).filter((p) => p !== '.nojekyll').sort();
const courseFiles = courses.map((c) => `courses/${c.file}`);
// Aufnahmen (assets/audio/, ~100 MB) nicht vorab laden: nur die Verzeichnisse, die Dateien beim ersten Abspielen.
const isRecording = (p) => p.startsWith('assets/audio/') && !p.endsWith('/index.json');
const shell = all.filter((p) => !courseFiles.includes(p) && !isRecording(p) && !p.endsWith('.md') && !p.endsWith('.txt'));
const version = sha(all.map((p) => `${p}:${sha(readFileSync(join(OUT, p)))}`).join('\n')).slice(0, 12);
const swSource = `// Wortweg Service Worker (erzeugt von scripts/build-app.mjs – nicht von Hand ändern).
const VERSION = '${version}';
const SHELL = 'wortweg-shell-' + VERSION;
const COURSES = 'wortweg-courses';
const AUDIO = 'wortweg-audio';
const SHELL_FILES = ${JSON.stringify(['./', ...shell])};
const COURSE_FILES = ${JSON.stringify(courseFiles)};

self.addEventListener('install', (event) => {
  // cache: 'reload' – am HTTP-Cache vorbei, sonst könnte eine alte Datei in die neue Version geraten.
  const fresh = (f) => new Request(f, { cache: 'reload' });
  event.waitUntil(Promise.all([
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES.map(fresh))),
    caches.open(COURSES).then((cache) => cache.addAll(COURSE_FILES.map(fresh))),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('wortweg-shell-') && key !== SHELL) await caches.delete(key);
    const courses = await caches.open(COURSES);
    const keep = COURSE_FILES.map((f) => new URL(f, self.registration.scope).href);
    for (const req of await courses.keys()) if (!keep.includes(req.url)) await courses.delete(req);
    await self.clients.claim();
  })());
});

async function fromCache(cacheName, request, fallbackUrl) {
  const cache = await caches.open(cacheName);
  const hit = (await cache.match(request, { ignoreSearch: true })) ?? (fallbackUrl ? await cache.match(fallbackUrl) : null);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && cacheName !== SHELL) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fromCache(SHELL, req, new URL('./', self.registration.scope).href));
  } else if (COURSE_FILES.some((f) => url.href === new URL(f, self.registration.scope).href)) {
    event.respondWith(fromCache(COURSES, req));
  } else if (/\\/assets\\/audio\\/[a-z]+\\/[0-9a-f]+\\.(m4a|mp3)$/.test(url.pathname)) {
    // Aufnahmen: Dateiname = Inhalts-Hash, also dauerhaft gültig; einmal gehört, auch offline da.
    event.respondWith(fromCache(AUDIO, req));
  } else {
    event.respondWith(fromCache(SHELL, req));
  }
});
`;
// Schutz: Ein einfacher Backslash geht im Template verloren und machte sw.js schon einmal ungültig – dann ist die
// App nicht mehr offline nutzbar, ohne dass es jemand merkt. Deshalb hier parsen (nicht ausführen).
new Script(swSource, { filename: 'sw.js' });
writeFileSync(join(OUT, 'sw.js'), swSource);

const size = walk(OUT).reduce((n, p) => n + statSync(p).size, 0);
console.log(`✓ App-Build in ${relative(ROOT, OUT) || '.'}/ (Version ${version}): ${courses.length} Kurse, ${all.length + 1} Dateien, ${(size / 1e6).toFixed(1)} MB, ${((performance.now() - started) / 1000).toFixed(1)} s`);
for (const c of courses) console.log(`  · ${c.id}: ${c.stats.lessons} Lektionen, ${c.stats.words} Wörter, ${c.stats.sentences} Sätze → courses/${c.file}`);
