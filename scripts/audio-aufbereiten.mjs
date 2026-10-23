// Macht aus den gesammelten Rohaufnahmen (.cache/audio/<sprache>/, siehe scripts/audio-sammeln.mjs) die Dateien
// für die App: wählt je Wort/Satz die beste Aufnahme (Rauschabstand, Übersteuerung, Länge), schneidet Stille ab,
// gleicht die Lautstärke an und speichert AAC (.m4a, 64 kbit/s, mono). Tatoeba-Aufnahmen gehen unverändert als MP3
// durch (die meisten sind „ND“: keine Bearbeitung erlaubt).
// Ergebnis: assets/audio/<sprache>/index.json (Schlüssel → Datei) und quellen.json (Namensnennung je Datei).
// Braucht macOS (afconvert ist eingebaut, nichts zu installieren). Aufruf: node scripts/audio-aufbereiten.mjs [es|zh]
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE = join(ROOT, '.cache/audio/');
const RATE = 44100;
const FRAME = RATE / 100; // 10 ms
const TARGET_RMS = 0.1; // ≈ −20 dBFS Sprechpegel
const PEAK_LIMIT = 0.89; // ≈ −1 dBFS
const MIN_SNR = 12; // darunter ist die Aufnahme zu verrauscht

const langs = process.argv.slice(2).filter((a) => ['es', 'zh'].includes(a));

/** Liest eine 16-Bit-PCM-WAV-Datei (afconvert schreibt zusätzliche Blöcke wie „FLLR“, deshalb Blöcke durchgehen). */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('kein WAV');
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'data') {
      const data = buf.subarray(pos + 8, pos + 8 + size);
      return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1)));
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error('WAV ohne Daten');
}

function writeWav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

/** Kennzahlen einer Aufnahme: Rauschabstand, Übersteuerung, Sprechbereich (für Zuschnitt und Lautstärke). */
function analyze(pcm) {
  const frames = Math.floor(pcm.length / FRAME);
  if (frames < 10) return null;
  const rms = new Float64Array(frames);
  let clipped = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
      const x = pcm[i] / 32768;
      sum += x * x;
      if (Math.abs(pcm[i]) >= 32700) clipped++;
    }
    rms[f] = Math.sqrt(sum / FRAME);
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = Math.max(sorted[Math.floor(frames * 0.05)], 1e-5);
  const loud = sorted[Math.floor(frames * 0.95)];
  const threshold = Math.max(noise * 4, loud * 0.06);
  // Anfang/Ende: erste/letzte Stelle mit mindestens 30 ms über der Schwelle (einzelne Knackser zählen nicht).
  const voiced = (f) => rms[f] > threshold && rms[f + 1] > threshold && rms[f + 2] > threshold;
  let first = 0;
  while (first < frames - 3 && !voiced(first)) first++;
  let last = frames - 3;
  while (last > first && !voiced(last)) last--;
  last += 2;
  let speechSum = 0;
  let speechFrames = 0;
  let peak = 0;
  for (let f = first; f <= last; f++) {
    if (rms[f] > threshold) {
      speechSum += rms[f] * rms[f];
      speechFrames++;
    }
  }
  for (let i = first * FRAME; i < (last + 1) * FRAME; i++) peak = Math.max(peak, Math.abs(pcm[i]) / 32768);
  const speech = Math.sqrt(speechSum / Math.max(speechFrames, 1));
  return {
    snr: 20 * Math.log10(speech / noise),
    clip: clipped / pcm.length,
    voiced: (last - first + 1) / 100,
    speech,
    peak,
    first,
    last,
    frames,
  };
}

/** Zuschnitt (120 ms vor, 200 ms nach der Sprache), Lautstärke angleichen, weiche Ein- und Ausblendung. */
function polish(pcm, a) {
  const start = Math.max(0, (a.first - 12) * FRAME);
  const end = Math.min(pcm.length, (a.last + 21) * FRAME);
  const gain = Math.min(TARGET_RMS / a.speech, PEAK_LIMIT / a.peak, 8);
  const out = new Int16Array(end - start);
  const fadeIn = RATE * 0.015;
  const fadeOut = RATE * 0.04;
  for (let i = 0; i < out.length; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (out.length - i < fadeOut) g *= (out.length - i) / fadeOut;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[start + i] * g)));
  }
  return { samples: out, gain };
}

function score(c, a) {
  let s = Math.min(a.snr, 45);
  if (a.clip > 0.0005) s -= 20;
  else if (a.clip > 0.0001) s -= 8;
  if (a.speech < 0.004) s -= 10; // sehr leise: Verstärken hebt auch das Rauschen
  if (c.how === 'genau') s += 4;
  if (c.how === 'ohne-artikel') s -= 6;
  return s;
}

/** Lingua Libre schreibt „Speaker: X Recorder: Y“; daraus „X“ bzw. „X (aufgenommen von Y)“. */
function speakerName(artist) {
  const m = String(artist ?? '').match(/^Speaker:\s*(.+?)\s*Recorder:\s*(.+)$/);
  if (!m) return String(artist ?? '').trim();
  return m[1] === m[2] ? m[1] : `${m[1]} (aufgenommen von ${m[2]})`;
}

async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

for (const lang of langs.length ? langs : ['es', 'zh']) {
  const dir = join(CACHE, lang);
  const candidates = JSON.parse(readFileSync(join(dir, 'kandidaten.json'), 'utf8'));
  const tmp = join(dir, 'wav');
  mkdirSync(tmp, { recursive: true });
  const analysis = new Map();
  const files = [...new Set(candidates.map((c) => c.file))].filter((f) => existsSync(join(dir, 'roh', f)));
  let failed = 0;
  await pool(files, 6, async (file, i) => {
    const wav = join(tmp, `${file}.wav`);
    try {
      if (!existsSync(wav)) await run('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', join(dir, 'roh', file), wav]);
      const pcm = readWav(readFileSync(wav));
      const a = analyze(pcm);
      if (a) analysis.set(file, a);
    } catch {
      failed++;
    }
    if (i % 1000 === 0) process.stdout.write(`  ${lang}: ${i}/${files.length} geprüft\n`);
  });

  // Beste Aufnahme je Schlüssel
  const best = new Map();
  let rejected = 0;
  for (const c of candidates) {
    const a = analysis.get(c.file);
    if (!a) continue;
    const isSentence = c.source === 'tatoeba';
    const ok = a.snr >= MIN_SNR && a.clip < 0.002 && a.voiced >= 0.15 && a.voiced <= (isSentence ? 20 : 4);
    if (!ok) {
      rejected++;
      continue;
    }
    const s = score(c, a);
    if (!best.has(c.key) || best.get(c.key).s < s) best.set(c.key, { c, a, s });
  }

  const outDir = join(ROOT, 'assets/audio', lang);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const items = {};
  const credits = new Map();
  const outputs = new Map(); // Rohdatei → Promise<Dateiname>; dieselbe Aufnahme für mehrere Schlüssel nur einmal
  const contentName = (buf, ext) => `${createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;
  const produce = async (c, a) => {
    if (c.source === 'tatoeba') {
      const raw = readFileSync(join(dir, 'roh', c.file));
      const name = contentName(raw, 'mp3');
      writeFileSync(join(outDir, name), raw);
      return name;
    }
    const pcm = readWav(readFileSync(join(tmp, `${c.file}.wav`)));
    const wav = join(tmp, `${c.file}.fertig.wav`);
    const m4a = join(tmp, `${c.file}.fertig.m4a`);
    writeFileSync(wav, writeWav(polish(pcm, a).samples));
    await run('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', '-c', '1', wav, m4a]);
    const buf = readFileSync(m4a);
    const name = contentName(buf, 'm4a');
    writeFileSync(join(outDir, name), buf);
    rmSync(wav);
    rmSync(m4a);
    return name;
  };
  await pool([...best.entries()], 6, async ([key, { c, a }]) => {
    if (!outputs.has(c.file)) outputs.set(c.file, produce(c, a));
    const name = await outputs.get(c.file);
    items[key] = name;
    credits.set(name, {
      f: name,
      text: c.source === 'tatoeba' ? c.text : c.title.replace(/^File:/, ''),
      quelle: c.source === 'tatoeba' ? 'Tatoeba' : /^File:LL-/.test(c.title) ? 'Lingua Libre (Wikimedia Commons)' : 'Wikimedia Commons',
      sprecher: speakerName(c.artist),
      lizenz: c.license,
      lizenzUrl: c.licenseUrl ?? '',
      seite: c.page,
      bearbeitet: c.source !== 'tatoeba',
    });
  });
  const sortedItems = Object.fromEntries(Object.entries(items).sort(([x], [y]) => x.localeCompare(y)));
  // bytes: Gesamtgröße aller Dateien – die App nennt sie, bevor man alle Aufnahmen für offline lädt.
  const bytes = [...new Set(Object.values(items))].reduce((n, f) => n + statSync(join(outDir, f)).size, 0);
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ lang, bytes, items: sortedItems }));
  writeFileSync(join(outDir, 'quellen.json'), JSON.stringify([...credits.values()].sort((x, y) => x.f.localeCompare(y.f)), null, 1));
  const speakers = new Map();
  for (const cr of credits.values()) speakers.set(cr.sprecher, (speakers.get(cr.sprecher) ?? 0) + 1);
  console.log(`${lang}: ${Object.keys(items).length} Schlüssel, ${credits.size} Dateien; ${rejected} Aufnahmen aussortiert, ${failed} nicht lesbar`);
  console.log(`  Sprecher: ${[...speakers].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
}
