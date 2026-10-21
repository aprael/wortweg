// Sprachausgabe und Spracherkennung über die im Browser eingebaute Web Speech API (keine Audiodateien).
// Hinweis: Die Spracherkennung mancher Browser (z. B. Chrome) schickt Audio an den Browserhersteller –
// deshalb sind Sprechübungen nur nach ausdrücklichem Einschalten aktiv (settings.speaking).

export function canSpeak() {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text, lang, rate = 1) {
  if (!canSpeak()) return false;
  const synth = globalThis.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const prefix = String(lang).slice(0, 2).toLowerCase();
  const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (voice) u.voice = voice;
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
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
