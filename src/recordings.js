// Echte Aufnahmen (Menschen, keine Computerstimmen): Schlüssel und Nachschlagen im Aufnahme-Verzeichnis.
// Rein (kein DOM/Netz): scripts/audio-*.mjs legen die Dateien unter denselben Schlüsseln ab, unter denen
// die App sie sucht.

const CJK = '㐀-鿿豈-﫿';
const SPACE_BETWEEN_CJK = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`, 'g');

/** Text → Schlüssel: Unicode-normalisiert, klein, ohne Satzzeichen am Rand, Leerzeichen zwischen Schriftzeichen weg. */
export function recordingKey(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(SPACE_BETWEEN_CJK, '')
    .replace(/^[\s¡¿"“„«‚'(]+|[\s.,;:!?。！？，、…"”»‘’')]+$/g, '');
}

/**
 * Sucht die Aufnahme zu einem Text.
 * @param {{lang: string, items: Record<string, string>} | null} index  aus assets/audio/<sprache>/index.json
 * @returns {string | null}  Pfad der Datei (relativ zur App) oder null
 */
export function findRecording(index, text) {
  const file = index?.items?.[recordingKey(text)];
  return file ? `assets/audio/${index.lang}/${file}` : null;
}
