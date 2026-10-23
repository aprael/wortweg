// Vorlesen: zuerst echte Aufnahmen (Menschen, assets/audio/, siehe src/recordings.js), sonst – nur wenn
// eingeschaltet – die Sprachausgabe des Geräts (Web Speech API). Spracherkennung ebenfalls über die Web Speech API.
// Hinweis: Die Spracherkennung mancher Browser (z. B. Chrome) schickt Audio an den Browserhersteller –
// deshalb sind Sprechübungen nur nach ausdrücklichem Einschalten aktiv (settings.speaking).
import { findRecording } from './recordings.js';

const recordings = new Map(); // Sprachkürzel („es“, „zh“) → Aufnahme-Verzeichnis
let deviceVoice = false; // Gerätestimme, wenn es keine Aufnahme gibt (settings.deviceVoice)
let player = null;
let playToken = 0;
const loading = new Map(); // Pfad → Promise<Objekt-URL>
const ready = new Map(); // Pfad → Objekt-URL (sofort abspielbar)

const langKey = (lang) => String(lang ?? '').slice(0, 2).toLowerCase();

/** Aufnahme-Verzeichnis einer Sprache bekannt machen (null: keine Aufnahmen). */
export function useRecordings(lang, index) {
  recordings.set(langKey(lang), index);
}

/** Gerätestimme als Ersatz erlauben (Standard: aus – nur echte Aufnahmen). */
export function allowDeviceVoice(on) {
  deviceVoice = Boolean(on);
}

export function recordingFor(text, lang) {
  return findRecording(recordings.get(langKey(lang)) ?? null, text);
}

/** Gibt es zu dieser Sprache überhaupt Aufnahmen? */
export function hasRecordings(lang) {
  return Object.keys(recordings.get(langKey(lang))?.items ?? {}).length > 0;
}

/** Kann dieser Text vorgelesen werden (Aufnahme oder erlaubte Gerätestimme)? */
export function canSay(text, lang) {
  return Boolean(recordingFor(text, lang)) || (deviceVoice && canSpeak());
}

// Aufnahmen als Blob laden: so gibt es keine Range-Anfragen (Safari, Service Worker) und das Abspielen kann
// sofort im Klick starten, wenn die Datei schon da ist (iOS erlaubt Ton nur direkt nach einer Berührung).
function fetchRecording(path) {
  if (!loading.has(path)) {
    const p = fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        ready.set(path, url);
        return url;
      });
    p.catch(() => loading.delete(path));
    loading.set(path, p);
  }
  return loading.get(path);
}

/** Aufnahmen schon vorab laden (z. B. für die nächsten Übungen). */
export function preloadRecordings(texts, lang) {
  for (const text of texts) {
    const path = recordingFor(text, lang);
    if (path) fetchRecording(path).catch(() => {});
  }
}

function playRecording(path, rate, onFail) {
  const token = ++playToken;
  player ??= new Audio();
  const start = (url) => {
    if (token !== playToken) return;
    player.src = url;
    player.defaultPlaybackRate = rate;
    player.playbackRate = rate;
    player.play().catch(() => {});
  };
  if (ready.has(path)) start(ready.get(path));
  else fetchRecording(path).then(start, () => token === playToken && onFail());
}

export function canSpeak() {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
}

/** Liest einen Text in der Zielsprache vor. false, wenn es weder Aufnahme noch (erlaubte) Gerätestimme gibt. */
export function speak(text, lang, rate = 1) {
  const path = recordingFor(text, lang);
  if (path) {
    stopSpeaking();
    // Lädt die Aufnahme nicht (z. B. offline), springt die Gerätestimme ein – nur wenn erlaubt.
    playRecording(path, rate, () => deviceVoice && speakWithDevice(text, lang, rate));
    return true;
  }
  if (!deviceVoice || !canSpeak()) return false;
  speakWithDevice(text, lang, rate);
  return true;
}

function speakWithDevice(text, lang, rate) {
  if (!canSpeak()) return;
  stopSpeaking();
  const synth = globalThis.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const prefix = String(lang).slice(0, 2).toLowerCase();
  const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking() {
  playToken++;
  if (player && !player.paused) player.pause();
  if (canSpeak()) globalThis.speechSynthesis.cancel();
}

function recognitionCtor() {
  return globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
}

/** Gibt es Spracherkennung in diesem Browser? */
export function canRecognize() {
  return typeof recognitionCtor() === 'function';
}

const RECOGNITION_ERRORS = {
  'not-allowed': 'Der Zugriff auf das Mikrofon wurde verweigert. Erlaube ihn in den Browser-Einstellungen oder tippe den Satz.',
  'service-not-allowed': 'Die Spracherkennung ist in diesem Browser gesperrt. Du kannst den Satz stattdessen tippen.',
  'audio-capture': 'Es wurde kein Mikrofon gefunden. Schließe eins an oder tippe den Satz.',
  'no-speech': 'Ich habe nichts gehört. Versuche es noch einmal – etwas lauter oder näher am Mikrofon.',
  network: 'Die Spracherkennung braucht eine Internetverbindung und hat gerade keine. Du kannst den Satz tippen.',
  'language-not-supported': 'Diese Sprache unterstützt die Spracherkennung deines Browsers nicht. Du kannst den Satz tippen.',
  aborted: 'Die Aufnahme wurde abgebrochen.',
};

/** Verständliche Meldung zu einem Fehlercode der Spracherkennung. */
export function recognitionErrorMessage(code) {
  return RECOGNITION_ERRORS[code] ?? 'Die Spracherkennung hat nicht funktioniert. Du kannst den Satz tippen.';
}

/**
 * Startet eine einmalige Spracherkennung.
 * @param {string} lang  z. B. "en-GB"
 * @param {{onResult: (text: string, final: boolean) => void, onError: (message: string, code: string) => void, onEnd: () => void}} handlers
 * @returns {{stop: () => void} | null}  null, wenn die Erkennung nicht starten konnte (onError wurde dann schon aufgerufen)
 */
export function startRecognition(lang, { onResult, onError, onEnd }) {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onError('In diesem Browser gibt es keine Spracherkennung. Du kannst den Satz tippen.', 'unsupported');
    return null;
  }
  let rec;
  try {
    rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
  } catch {
    onError(recognitionErrorMessage(''), 'init');
    return null;
  }
  rec.onresult = (event) => {
    let text = '';
    let final = false;
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0]?.transcript ?? '';
      final = event.results[i].isFinal;
    }
    onResult(text.trim(), final);
  };
  rec.onerror = (event) => onError(recognitionErrorMessage(event.error), event.error);
  rec.onend = () => onEnd();
  try {
    rec.start();
  } catch {
    onError('Die Aufnahme konnte nicht starten. Versuche es noch einmal.', 'start');
    return null;
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        // schon beendet
      }
    },
  };
}
