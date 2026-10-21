import { readFileSync } from 'node:fs';

export function loadCourse(file) {
  return JSON.parse(readFileSync(new URL(`../data/courses/${file}`, import.meta.url), 'utf8'));
}

export function memoryBackend() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export const DAY = 24 * 60 * 60 * 1000;
// Fester Zeitpunkt mittags, damit Tagesgrenzen eindeutig sind.
export const T0 = new Date(2026, 9, 17, 12, 0, 0).getTime();
