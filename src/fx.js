// Effekte der Oberfläche: Konfetti, kurze Töne und Klick-Wellen. Keine Bild- oder Audiodateien:
// Konfetti zeichnet ein Canvas, Töne erzeugt die Web Audio API. Alles ist dekorativ (aria-hidden)
// und abschaltbar – Bewegung über „Animationen reduzieren“ bzw. die Systemeinstellung, Töne über settings.sounds.

const COLORS = ['#ffc83d', '#ffe27a', '#3d8bff', '#7cc4ff', '#ffffff', '#ff6b5c', '#4fd1a5', '#b48cff'];

/** Darf sich gerade etwas bewegen? */
export function motionOk() {
  const doc = globalThis.document;
  if (!doc || doc.documentElement.classList.contains('reduce-motion')) return false;
  return !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

let canvas = null;
let particles = [];
let frame = 0;

function ensureCanvas() {
  if (canvas?.isConnected) return canvas;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  return canvas;
}

function step() {
  const c = canvas;
  if (!c) return;
  const dpr = globalThis.devicePixelRatio || 1;
  const w = globalThis.innerWidth;
  const h = globalThis.innerHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  particles = particles.filter((p) => p.life > 0 && p.y < h + 40);
  for (const p of particles) {
    p.vy += 0.32;
    p.vx *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;
    p.life -= 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 25);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Streifen, der sich beim Fallen „dreht“ (Breite pulsiert)
      ctx.fillRect(-p.size / 2, -p.size / 4 * Math.abs(Math.cos(p.rot * 2)), p.size, p.size / 2);
    }
    ctx.restore();
  }
  if (particles.length) {
    frame = requestAnimationFrame(step);
  } else {
    frame = 0;
    c.remove();
    canvas = null;
  }
}

/**
 * Konfetti ab einem Punkt (Standard: Bildschirmmitte unten) nach oben.
 * @param {{x?: number, y?: number, count?: number, power?: number}} [opts]
 */
export function confetti({ x, y, count = 70, power = 1 } = {}) {
  if (!globalThis.document || !motionOk()) return;
  ensureCanvas();
  const cx = x ?? innerWidth / 2;
  const cy = y ?? innerHeight * 0.75;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const speed = (7 + Math.random() * 9) * power;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.35,
      size: 7 + Math.random() * 7, color: COLORS[i % COLORS.length], round: Math.random() < 0.25,
      life: 70 + Math.random() * 40,
    });
  }
  if (!frame) frame = requestAnimationFrame(step);
}

/** Konfetti ab einem Element (z. B. der Rückmeldung). */
export function confettiFrom(el, opts = {}) {
  if (!el) return confetti(opts);
  const r = el.getBoundingClientRect();
  return confetti({ x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 60), ...opts });
}

// ---------- Töne ----------

let audio = null;

function ctx() {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try {
    audio ??= new Ctor();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function note(ac, freq, start, dur, { type = 'sine', gain = 0.12 } = {}) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

const TONES = {
  tap: [[880, 0, 0.05, { type: 'triangle', gain: 0.05 }]],
  pick: [[660, 0, 0.06, { type: 'triangle', gain: 0.06 }], [990, 0.03, 0.06, { type: 'triangle', gain: 0.04 }]],
  good: [[784, 0, 0.12], [988, 0.08, 0.12], [1319, 0.16, 0.22]],
  bad: [[330, 0, 0.16, { type: 'triangle', gain: 0.1 }], [247, 0.12, 0.26, { type: 'triangle', gain: 0.1 }]],
  pair: [[880, 0, 0.08, { type: 'triangle', gain: 0.07 }], [1175, 0.06, 0.12, { type: 'triangle', gain: 0.07 }]],
  win: [[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.4, { gain: 0.14 }], [784, 0.36, 0.4, { gain: 0.06 }]],
};

/** Kurzer Effektton: 'tap' | 'pick' | 'good' | 'bad' | 'pair' | 'win'. Muss aus einer Nutzeraktion heraus starten (iOS). */
export function tone(kind) {
  const seq = TONES[kind];
  const ac = seq && ctx();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  for (const [freq, at, dur, opt] of seq) note(ac, freq, t + at, dur, opt);
}

// ---------- Klick-Ring ----------

/**
 * Leuchtender Ring an der Tippstelle (Ereignis-Delegation). Er liegt fest über der Seite statt im Knopf,
 * weil ein Klick die Ansicht meist neu zeichnet – so bleibt er trotzdem sichtbar.
 */
export function attachTapRings(root) {
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.btn, .choice, .tile, .match-btn, .node, .say-btn, .icon-btn, .nav-link');
    if (!el || el.disabled || !motionOk() || e.button > 0) return;
    const ring = document.createElement('span');
    ring.className = 'tap-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    document.body.append(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
    setTimeout(() => ring.remove(), 800);
  });
}
