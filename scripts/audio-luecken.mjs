// Listet die Kurswörter, zu denen es noch keine echte Aufnahme gibt – in Lernreihenfolge (frühe Lektionen zuerst),
// ein Wort pro Zeile. Die Datei lässt sich so in den Record Wizard von Lingua Libre (https://lingualibre.org)
// einfügen: Muttersprachler nehmen die Wörter dort frei lizenziert auf, danach holt scripts/audio-sammeln.mjs sie ab.
// Liest assets/audio/<sprache>/index.json (Ergebnis von scripts/audio-aufbereiten.mjs).
// Aufruf: node scripts/audio-luecken.mjs [es|zh]   → docs/aufnahmen-fehlend-<sprache>.txt
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRecording, recordingKey } from '../src/recordings.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COURSES = { es: ['de-es-wortschatz', 'de-es'], zh: ['de-zh'] };

const args = process.argv.slice(2).filter((a) => COURSES[a]);
for (const lang of args.length ? args : Object.keys(COURSES)) {
  const indexFile = join(ROOT, 'assets/audio', lang, 'index.json');
  if (!existsSync(indexFile)) {
    console.log(`${lang}: noch keine Aufnahmen – zuerst node scripts/audio-aufbereiten.mjs ${lang}`);
    continue;
  }
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const seen = new Set();
  const missing = [];
  let total = 0;
  for (const id of COURSES[lang]) {
    const course = JSON.parse(readFileSync(join(ROOT, 'data/courses', `${id}.json`), 'utf8'));
    for (const level of course.levels) {
      for (const unit of level.units) {
        for (const w of unit.words ?? []) {
          const key = recordingKey(w.target[0]);
          if (seen.has(key)) continue;
          seen.add(key);
          total++;
          if (!w.target.some((t) => findRecording(index, t))) missing.push(w.target[0]);
        }
      }
    }
  }
  const out = join('docs', `aufnahmen-fehlend-${lang}.txt`);
  writeFileSync(join(ROOT, out), missing.join('\n') + '\n');
  console.log(`${lang}: ${missing.length} von ${total} Wörtern ohne Aufnahme → ${out}`);
}
