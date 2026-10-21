# Wortweg – freie Sprachlern-App

Wortweg ist eine kostenlose App zum Sprachenlernen – ohne Werbung, ohne Bezahlschranke, ohne Herzen oder Energie, ohne Tracking. Es gibt sie in zwei Formen:

**Direkt ausprobieren:** <https://aprael.github.io/wortweg/> (App-Version, läuft im Browser und offline)

- **App-Version** (statisch, offline, ohne Konto): läuft z. B. über GitHub Pages und lässt sich auf dem iPhone über Safari → Teilen → „Zum Home-Bildschirm“ wie eine App installieren. Der Fortschritt bleibt auf dem Gerät.
- **Server-Version** (`npm start`): mit Konten (auch als Gast), Fortschritt auf dem eigenen Server und einem Admin-Bereich, in dem man Kurse anlegt und bearbeitet.

> **Inhalte:** Die großen Kurse (Chinesisch HSK 1–3, Spanisch-Wortschatz) sind aus offenen Quellen zusammengestellt und von Hand geprüft, aber **nicht muttersprachlich** geprüft. Dazu kommen kleine, selbst geschriebene Demo-Kurse. Details: [`data/courses/PROVENIENZ.md`](data/courses/PROVENIENZ.md).

## Was die App kann

- **Kurse:** Chinesisch (HSK 1–3, 2.243 Wörter mit Pinyin, 1.882 Sätze), Spanisch-Wortschatz (rund 2.950 Wörter, 2.440 Sätze), Demo-Kurse Englisch, Spanisch, Französisch, Italienisch.
- **Lernpfad von leicht nach schwer:** erst einfache Wörter, dann Themen wie Kennenlernen, Schule und Arbeit; Regeln (Präpositionen, Zeitformen, Ausnahmen) kommen später in eigenen Einheiten mit Regelkarte. Am Ende jedes Abschnitts wartet ein Checkpoint; wer schon etwas kann, überspringt einen Abschnitt per Test.
- **Neue Wörter auf Karten:** Vor einer Lektion zeigt eine Karte jedes neue Wort mit Übersetzung, Formen und einem Beispielsatz, der zeigt, wann man das Wort benutzt.
- **Übungen:** Auswahl in beide Richtungen, Paare finden, Sätze bauen, Lückentext, Übersetzen, Hören und (wenn eingeschaltet) Sprechen.
- **Vorlesen:** Jede Aufgabe hat einen Lautsprecher-Knopf (normal und langsam) für den Satz in der Zielsprache. Antippen eines Worts, Bausteins oder einer Paar-Karte spricht es aus; nach dem Prüfen wird die Lösung vorgelesen. Die Stimme kommt vom Gerät, es gibt keine Audiodateien.
- **Feedback:** sofort, mit Lösung, Erklärung und Beispielsatz. Tippfehler, Kurzformen, Satzzeichen und fehlende Akzente werden fair behandelt; Chinesisch auch als Pinyin (mit oder ohne Töne).
- **Spiel-Gefühl:** eigenes Blau-Gold-Design mit 3D-Knöpfen, Konfetti bei richtigen Antworten, kurze Töne (abschaltbar), Kronen am Ende einer Lektion, Stufen nach XP, Serie und Tagestruhe. Keine Strafen – XP gehen nie verloren.
- **Zwischenstand:** Wer eine Lektion unterbricht (App schließen, Handy sperren, „Pause“), macht später genau bei derselben Übung weiter.
- **Wiederholung (Leitner):** Fehler sind sofort fällig, Gelerntes nach 1, 3, 7, 14 und 30 Tagen.
- **Barrierefreiheit:** komplett per Tastatur bedienbar (Ziffern wählen, Enter prüft und geht weiter, Esc verlässt), Screenreader-Ansagen, Hell- und Dunkelmodus, „Animationen reduzieren“ (folgt auch der Systemeinstellung), ab 320 px Breite, am Handy mit Tab-Leiste unten.

## Starten

Nötig ist nur **Node.js 24** – keine npm-Abhängigkeiten, kein Build-Schritt für die Entwicklung.

```bash
npm start              # Server-Version auf http://localhost:5173 (Datenbank data/wortweg.db wird angelegt)
npm run admin -- --email du@example.org   # Admin-Konto anlegen
npm run build:app      # App-Version nach dist/ bauen
npm run preview:app    # dist/ lokal ansehen (http://localhost:5174)
```

Prüfen (beides muss grün sein):

```bash
npm run check   # Lint, Prüfung aller Kurse und aller erzeugten Übungen, Unit-Tests
npm run e2e     # Ende-zu-Ende-Test gegen einen echten Server (25 Schritte)
```

Die Datenkurse werden aus offenen Quellen gebaut: `npm run sources` lädt die Quelldateien nach `.cache/sources/`, `npm run build:courses` baut `data/courses/de-zh.json` und `de-es-wortschatz.json` neu (deterministisch).

## Projektstruktur

| Pfad | Inhalt |
|---|---|
| `index.html`, `styles.css` | Einstieg und Design („Arena“: Blau/Gold, Schrift Lilita One) |
| `src/app.js` | Oberfläche: Routen, Ansichten, Lektionsablauf, Tastatur |
| `src/admin.js` | Admin-Bereich (nur Server-Version) |
| `src/content.js`, `exercises.js`, `grading.js`, `session.js`, `progress.js` | Lern-Logik ohne DOM – Browser und Server nutzen dieselben Module |
| `src/api.js` / `src/local-api.js` | Server-API bzw. Ersatz für die App-Version (localStorage) |
| `src/speech.js`, `src/fx.js`, `src/run-store.js`, `src/pwa.js` | Sprachausgabe, Effekte, Zwischenstand, Service Worker |
| `server/` | Node-Server (`node:http`, `node:sqlite`), Migrationen in `server/migrations/` |
| `data/courses/` | Kurse (JSON) und `PROVENIENZ.md` |
| `data/build/` | Kuratierte Listen für den Kursbau (Bedeutungen, Themen, Lehrplan, geprüfte Sätze) |
| `scripts/` | Kursbau, App-Build, Icons, Lint, Kursprüfung, E2E |
| `tests/` | Unit- und Server-Tests (`node:test`) |
| `docs/` | `ARCHITEKTUR.md` (Formate, API, Sicherheit), `ENTWICKLUNG.md` (Verlauf, Prüfprotokoll, offene Punkte) |

## Kursformat (Kurzfassung)

```json
{
  "id": "de-fr", "title": "Französisch", "nativeLang": "de", "targetLang": "fr", "ttsLang": "fr-FR", "license": "CC0-1.0",
  "levels": [{ "id": "a1", "title": "A1", "units": [{
    "id": "fr-a1-hallo", "title": "Begrüßung", "intro": "optional: Regeltext für die Regelkarte",
    "words": [{ "native": ["Hallo"], "target": ["bonjour", "salut"], "note": "optional",
                "examples": [{ "target": "Bonjour, Marie !", "native": "Hallo, Marie!" }] }],
    "sentences": [{ "native": ["Ich bin Anna."], "target": ["Je suis Anna."], "note": "Pflicht: kurze Erklärung" }]
  }]}]
}
```

Jede Einheit braucht mindestens 4 Wörter und 4 Sätze; je 4 Wörter ergeben eine Lektion. Der erste Eintrag in `target` ist die Musterlösung, weitere sind akzeptierte Alternativen. Alle Felder, auch `reading` (Pinyin), `tokens`, `tags`, `source` und `attribution`, beschreibt [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md).

## Grenzen

- Die Bewertung ist regelbasiert: Richtige Übersetzungen, die nicht hinterlegt sind, gelten als falsch.
- Wie gut das Vorlesen klingt, hängt von den Stimmen des Geräts ab.
- Die App-Version synchronisiert nicht zwischen Geräten (dafür gibt es Export/Import oder die Server-Version).
- Ist am Gerät „Bewegung reduzieren“ eingestellt, zeigt Wortweg kein Konfetti und keine Animationen.

## Lizenzen

- **Code:** MIT (`LICENSE`).
- **Kursinhalte:** Datenkurse CC BY-SA 4.0 (Quellen und Autoren im Kurs und in `PROVENIENZ.md`), Demo-Kurse CC0 1.0.
- **Schrift:** Lilita One von Juan Montoreano, SIL Open Font License 1.1 (`assets/fonts/OFL-LilitaOne.txt`).
- **Grafiken:** Logo, Illustrationen und Symbole sind eigene SVG-Zeichnungen (CC0). Konfetti und Töne erzeugt der Browser.
- Wortweg ist ein unabhängiges Projekt und übernimmt keine Inhalte, Namen, Logos oder Grafiken anderer Lern-Apps oder Spiele.
