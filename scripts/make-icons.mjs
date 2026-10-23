// Erzeugt die PNG-App-Icons aus der Geometrie von assets/logo.svg (ohne Abhängigkeiten, reproduzierbar).
// Aufruf: node scripts/make-icons.mjs → assets/icon-180.png (iPhone), icon-192.png, icon-512.png, icon-maskable-512.png
//        node scripts/make-icons.mjs --desktop <datei.png> → 1024 px für die Desktop-App (daraus macht `tauri icon` .icns/.ico)
// Randlose Varianten (iPhone, maskable): Hintergrund füllt das Quadrat, das Motiv ist auf 85 % verkleinert (sichere Zone).
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const INDIGO = [0x24, 0x59, 0xdc];
const AMBER = [0xff, 0xc3, 0x2b];
const WHITE = [0xff, 0xff, 0xff];
const PATH = [[12, 19], [22, 46], [32, 26], [42, 46], [52, 19]];
const STROKE = 6.5 / 2;
const DOTS = [[12, 19, 4.5], [32, 26, 3.5], [52, 19, 4.5]];

function inRoundedRect(u, v, r) {
  if (u < 0 || v < 0 || u > 64 || v > 64) return false;
  const cx = Math.min(Math.max(u, r), 64 - r);
  const cy = Math.min(Math.max(v, r), 64 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Farbe an einem Punkt (0–64-Koordinaten) oder null (transparent). */
function sample(u, v, { rounded, scale }) {
  if (!inRoundedRect(u, v, rounded ? 16 : 0)) return null;
  const cu = 32 + (u - 32) / scale;
  const cv = 32 + (v - 32) / scale;
  if (DOTS.some(([x, y, r]) => (cu - x) ** 2 + (cv - y) ** 2 <= r * r)) return WHITE;
  for (let i = 1; i < PATH.length; i++) if (segmentDistance(cu, cv, PATH[i - 1], PATH[i]) <= STROKE) return AMBER;
  return INDIGO;
}

function render(size, opts, ss = 4) {
  const pad = opts.pad ?? 0; // transparenter Rand in Logo-Einheiten (Desktop-Icon)
  const span = 64 + 2 * pad;
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // Filter „None“
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((x + (sx + 0.5) / ss) / size) * span - pad, ((y + (sy + 0.5) / ss) / size) * span - pad, opts);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (a) {
        rows[o] = Math.round(r / a);
        rows[o + 1] = Math.round(g / a);
        rows[o + 2] = Math.round(b / a);
      }
      rows[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return png(size, size, rows);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 Bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const desktopAt = process.argv.indexOf('--desktop');
if (desktopAt > 0) {
  // Mac-Raster: Motiv 824 von 1024 px, Rest transparent – sonst wirkt das Icon im Dock größer als alle anderen.
  const file = process.argv[desktopAt + 1];
  if (!file) throw new Error('Aufruf: node scripts/make-icons.mjs --desktop <datei.png>');
  writeFileSync(file, render(1024, { rounded: true, scale: 1, pad: (64 * 100) / 824 }, 2));
  console.log(`✓ ${file} (1024×1024, Desktop)`);
  process.exit(0);
}

const out = (name) => new URL(`../assets/${name}`, import.meta.url);
const icons = [
  ['icon-180.png', 180, { rounded: false, scale: 0.85 }],
  ['icon-192.png', 192, { rounded: true, scale: 1 }],
  ['icon-512.png', 512, { rounded: true, scale: 1 }],
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.85 }],
];
for (const [name, size, opts] of icons) {
  const data = render(size, opts);
  writeFileSync(out(name), data);
  console.log(`✓ assets/${name} (${size}×${size}, ${data.length} Bytes)`);
}
