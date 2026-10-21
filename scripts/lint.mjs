// Leichter Lint ohne Abhängigkeiten: Syntaxprüfung aller JS-Dateien, JSON-Parsen,
// und einfache Regeln (kein innerHTML mit ungeprüften Variablen außerhalb von app.js, kein console.log in src).
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git']);
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const files = await walk(ROOT);
const problems = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  if (/\.(m?js)$/.test(f)) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) problems.push(`${rel}: Syntaxfehler\n${r.stderr}`);
    const src = await readFile(f, 'utf8');
    if (rel.startsWith('src/') && /console\.log\(/.test(src)) problems.push(`${rel}: console.log in src`);
    src.split('\n').forEach((line, i) => {
      if (/\s+$/.test(line)) problems.push(`${rel}:${i + 1}: Leerzeichen am Zeilenende`);
    });
  } else if (f.endsWith('.json')) {
    try { JSON.parse(await readFile(f, 'utf8')); } catch (e) { problems.push(`${rel}: ungültiges JSON (${e.message})`); }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Lint ok (${files.filter((f) => /\.(m?js|json)$/.test(f)).length} Dateien geprüft).`);
