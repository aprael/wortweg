// Vorschau des App-Builds (dist/) ohne Wortweg-Server: nur lesen, nur localhost.
// Aufruf: node scripts/serve-dist.mjs [Port]   (vorher npm run build:app)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT) || 5174;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    rel = '';
  }
  const file = resolve(DIST, rel);
  try {
    if (!rel || rel.includes('\0') || !file.startsWith(DIST + sep)) throw new Error('verboten');
    const target = (await stat(file)).isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`App-Build: http://localhost:${PORT}/`));
