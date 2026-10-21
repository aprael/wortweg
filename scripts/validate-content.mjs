// Prüft alle mitgelieferten Kurse strukturell und auf erzeugbare Übungen (Lektionen und Checkpoints,
// mit/ohne Hören und Sprechen). Jede Musterlösung muss von gradeExercise als richtig gewertet werden.
// Aufruf: node scripts/validate-content.mjs            → alle Kurse aus data/courses/index.json
//         node scripts/validate-content.mjs a.json …   → nur diese Dateien (z. B. zum Testen großer Kurse)
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCourse, listLessons } from '../src/content.js';
import { buildLesson, buildCheckpoint, fallbackExercise } from '../src/exercises.js';
import { gradeExercise, gradeMatchAttempt, solutionResponse, normalize } from '../src/grading.js';

const OPTION_SETS = [false, true].flatMap((listening) => [false, true].map((speaking) => ({ listening, speaking })));

/** Prüft eine erzeugte Übung; Probleme werden an die Liste angehängt. */
function checkExercise(ex, course, problems) {
  const p = (msg) => problems.push(`${ex.id} (${ex.type}): ${msg}`);
  if ((ex.type === 'choice' || ex.type === 'fill') && ex.choices.length < 2) p('zu wenige Auswahlmöglichkeiten');
  if ((ex.type === 'choice' || ex.type === 'fill') && new Set(ex.choices).size !== ex.choices.length) p('doppelte Auswahl');
  if (ex.type === 'match') {
    if (ex.pairs.length < 4) p(`nur ${ex.pairs.length} eindeutige Paare`);
    for (const [side, lang] of [['left', course.nativeLang], ['right', course.targetLang]]) {
      if (new Set(ex[side].map((x) => normalize(x.text, lang))).size !== ex[side].length) p(`doppelte Texte (${side})`);
    }
    for (const [l, r] of ex.pairs) if (!gradeMatchAttempt(ex, l, r)) p(`Paar ${l}/${r} wird nicht erkannt`);
  }
  if (!ex.explanation) p('keine Erklärung');
  if (!gradeExercise(ex, solutionResponse(ex)).correct) p(`Musterlösung „${ex.solution}“ gilt als falsch`);
  if (Array.isArray(ex.accepted) && ex.type !== 'choice' && ex.type !== 'fill' && ex.type !== 'order') {
    for (const a of ex.accepted) if (!gradeExercise(ex, a).correct) p(`akzeptierte Lösung „${a}“ gilt als falsch`);
  }
  if (ex.type === 'listen' || ex.type === 'speak') {
    const fb = fallbackExercise(ex, course);
    if (fb.type !== 'translate') p('kein Fallback möglich');
    else for (const a of fb.accepted) if (!gradeExercise(fb, a).correct) p(`Fallback: „${a}“ gilt als falsch`);
  }
}

function checkList(list, course, problems, where) {
  const ids = list.map((ex) => ex.id);
  if (new Set(ids).size !== ids.length) problems.push(`${where}: doppelte Übungs-IDs`);
  for (const ex of list) checkExercise(ex, course, problems);
}

const dir = new URL('../data/courses/', import.meta.url);
const args = process.argv.slice(2);
const files = args.length
  ? args.map((f) => ({ name: f, url: pathToFileURL(resolve(f)) }))
  : JSON.parse(await readFile(new URL('index.json', dir), 'utf8')).courses.map((f) => ({ name: f, url: new URL(f, dir) }));
const MAX_LISTED = 40;
let failed = false;
const started = performance.now();
for (const { name: file, url } of files) {
  const t0 = performance.now();
  let course;
  try {
    course = JSON.parse(await readFile(url, 'utf8'));
  } catch (e) {
    failed = true;
    console.error(`✗ ${file}: nicht lesbar (${e.message})`);
    continue;
  }
  const v = validateCourse(course);
  const problems = [...v.errors];
  let exercises = 0;
  if (v.ok) {
    for (const opts of OPTION_SETS) {
      for (const l of listLessons(course)) {
        const list = buildLesson(course, l.unit, l.index, opts);
        if (list.length < 10) problems.push(`${l.id}: nur ${list.length} Übungen`);
        checkList(list, course, problems, l.id);
        exercises += list.length;
      }
      for (const level of course.levels) {
        const list = buildCheckpoint(course, level, opts);
        if (list.length < 10 || list.length > 12) problems.push(`Checkpoint ${level.id}: ${list.length} Übungen`);
        checkList(list, course, problems, `Checkpoint ${level.id}`);
        exercises += list.length;
      }
    }
  }
  const lessons = v.ok ? listLessons(course).length : 0;
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (problems.length) {
    failed = true;
    const uniq = [...new Set(problems)];
    const more = uniq.length > MAX_LISTED ? `\n  … und ${uniq.length - MAX_LISTED} weitere` : '';
    console.error(`✗ ${file} (${secs} s, ${uniq.length} Probleme):\n  - ${uniq.slice(0, MAX_LISTED).join('\n  - ')}${more}`);
  } else {
    console.log(`✓ ${file}: ${course.levels.length} Stufen, ${lessons} Lektionen, ${course.levels.length} Checkpoints, ${exercises} Übungen geprüft (${secs} s)`);
  }
  for (const w of v.warnings ?? []) console.log(`  ! ${w}`);
}
console.log(`Gesamtzeit: ${((performance.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
