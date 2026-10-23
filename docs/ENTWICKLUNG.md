# Wortweg – Entwicklungsdokumentation

Stand: 21.10.2026 (Version 0.4.0) · Node 24 (nvm). Abschnitt 0 beschreibt den aktuellen Stand; ab Abschnitt 1 folgt die
ursprüngliche MVP-Dokumentation vom 17.10.2026 (Version 0.1, damals nur Browser + localStorage).

## 0. Aktueller Stand

### 0.1 Verlauf

| Version | Datum | Inhalt |
|---|---|---|
| 0.1 | 17.10. | MVP: statische Web-App, Demo-Kurs Deutsch → Englisch, Fortschritt im Browser |
| 0.2 | 20.10. | Node-Server mit SQLite, Konten und Gäste, Admin-Bereich mit Kurs-Editor, Server bewertet Abgaben nach, Paare- und Sprechübungen |
| 0.3 | 20.10. abends | Datenkurse Chinesisch (HSK 1–3) und Spanisch aus offenen Quellen, Pinyin, App-Version (PWA, offline, iPhone), mitgelieferte Kurse aktualisieren sich automatisch, gzip, GitHub-Workflows. Zwei parallele Arbeitssitzungen, am 21.10. zusammengeführt. |
| 0.4 | 21.10. | Spanisch und Chinesisch: Lehrplan von leicht nach schwer mit Themen und Regel-Einheiten (Regelkarten), alle Sätze und Beispielsätze von Hand geprüft. Oberfläche: Spiel-Design (Blau/Gold, 3D-Knöpfe, Lilita One), Wortkarten mit Beispielsatz, Regelkarten, Vorlese-Knopf bei jeder Aufgabe, Aussprache beim Antippen, ausgerichtete Paare, Konfetti und Töne, Kronen, Stufen, Tagestruhe, neue Startseite, einklappbarer Lernpfad, Zwischenstand einer Lektion auf dem Gerät. Server/Admin: `unit.intro`, `word.examples`. |
| 0.5 (Zweig `design-c-spielbrett`) | 22.10. | Designsystem „Spielbrett“ (`DESIGN.md`, nach Design-Audit und Wahl aus drei Richtungen): Lernpfad und Startseite als Spielbrett mit Figur, Regeln als Ereigniskarte im Dialog, flache Flächen in fünf Kernfarben ohne Verläufe, Atkinson Hyperlegible Next für Text und Lerninhalte, Spielsteine statt Werte-Kacheln, eine Hauptaktion pro Ansicht, „Optionen“ statt „Einstellungen“. Prototyp: `prototypes/start.html`. Inhalte (Zweig `inhalte-beispiele`): eigene Beispielsätze mit automatischer Prüfung im Kursbau, Spanisch zu allen Wörtern, Chinesisch 2.238/2.243, Fehlbestand 0; Spanisch-Erkennung für hay, es, vale, fuera und „por la mañana“ korrigiert. |

### 0.2 Prüfprotokoll 21.10.2026

- `npm run check`: Lint ok (84 Dateien), alle 6 Kurse gültig (zusammen rund 59.000 erzeugte Übungen geprüft), **133/133 Tests grün**
  (neu: `tests/ui-extras.test.mjs` mit 8 Tests für Vorlesen, Stufen, Kronen, Regeltext, Wortsuche, Wortkarten und Zwischenstand;
  `tests/server-admin.test.mjs` mit einem Test für `intro`/`examples` über Import, Lesen, Export und Bearbeiten).
- `npm run e2e`: 25 Schritte grün. `npm run build:app`: 6 Kurse, 3,5 MB.
- Kursbau Spanisch und Chinesisch: je 0 ungeprüfte Sätze, zweimal gebaut → identische Datei (deterministisch).
  Chinesisch neu: 18 Abschnitte, 156 Einheiten, 577 Lektionen, 1.882 Sätze, 1.344 Beispiele; der laufende Server hat den
  neuen Stand beim Start automatisch übernommen („Kurse aktualisiert: de-zh“).
- Browser (Chrome, Server-Modus, frische Wegwerf-DB): Gast → Spanisch-Wortschatz → Tagesziel → vier Wortkarten
  (Beispielsatz, Hervorhebung, Enter blättert) → Auswahl mit Konfetti → Paare mit Fehlversuch (gleich hohe, ausgerichtete Felder)
  → Satzbau → **Neuladen mitten in der Lektion: weiter bei Übung 5 von 11** → Lückentext, Übersetzen, Ersatzübung für Hören →
  Auswertung mit 3 Kronen, +14 XP vom Server angenommen. Startseite (Stufe, Kacheln, „Als Nächstes“, Abschnitte), Lernpfad
  (Ein-/Ausklappen, Regeltext), Über-Seite.
- Headless Brave 375 × 812 (Hell- und Dunkelmodus; Server- und App-Version; Spanisch und Chinesisch mit Pinyin):
  komplette Lektion, Startseite, Lernpfad, Statistik, Einstellungen – nirgends horizontales Scrollen, keine Konsolenfehler.
- Hinweis: Auf dem Entwicklungs-Mac ist „Bewegung reduzieren“ aktiv; Konfetti wurde deshalb mit simulierter
  Systemeinstellung geprüft. Tatsächliche Tonausgabe (Vorlesen, Effekttöne) wurde nicht gehört.

### 0.3 Sicherheits-Review 21.10.2026

Geprüft: Anmeldung und Sitzungen (scrypt, zufällige Tokens nur als Hash in der DB, Cookie `HttpOnly; SameSite=Strict`,
`Secure` über `COOKIE_SECURE=1`), CSRF (SameSite=Strict + Origin-Prüfung + nur `application/json`, sonst 415), Rate-Limits
für Anmelden/Registrieren, Größenlimits für Bodys, Eingabeprüfung der neuen Admin-Felder (`intro` ≤ 2000, `examples` ≤ 3,
nur Text, Quelle nur aus dem Bestand), Escaping aller neuen Ausgaben (Regeltext, Beispielsätze, Wortkarten, Lautsprecher-Knöpfe
in `data-text`, Links nur `https:`), statische Auslieferung (Positivliste, keine Punktdateien, kein `..`), Service Worker
(nur gleiche Herkunft, nur GET), `serve-dist` (nur 127.0.0.1, nur `dist/`), CSP (kein Inline-Skript).
Ergebnis: **keine kritischen Befunde.** Hinweise für einen öffentlichen Server-Betrieb:
1. Hinter einem Reverse-Proxy sieht der Server nur die Proxy-Adresse – das Registrierungs-Limit (30/Stunde) gälte dann für alle
   zusammen. Vor einem Proxy-Betrieb die echte Client-Adresse (z. B. `X-Forwarded-For` vom eigenen Proxy) auswerten.
2. Über HTTPS unbedingt `COOKIE_SECURE=1` setzen.

### 0.4 Offene Punkte

1. ~~Beispielsätze fehlen bzw. enthalten unbekannte Wörter~~ – erledigt am 22./23.10.2026: Spanisch hat zu allen 2.959 Wörtern
   ein Beispiel (260 eigene, u. a. für die ersten 13 Einheiten), Chinesisch zu 2.238 von 2.243 (894 eigene). Ohne Beispiel
   bleiben 老 (Anrede) und vier Wörter der Ausschlussliste. Eigene Sätze: geschrieben von Claude, von einer zweiten
   Claude-Instanz gegengelesen, vom Kursbau automatisch geprüft (`eigene-beispiele.tsv`, Quelle „Wortweg“).
2. ~~Chinesisch: Fehlbestand 5~~ – erledigt mit 5 eigenen Übungssätzen (`data/build/zh/eigene-saetze.tsv`).
3. Inhalte sind nicht muttersprachlich geprüft – das gilt ausdrücklich auch für die eigenen Sätze.
5. 564 spanische Tatoeba-Beispiele enthalten noch Wörter, die erst später gelernt werden – fast alle ab Einheit 14, 4 in den
   ersten 13 Einheiten (dort war kein besserer Satz möglich).
   Der Bericht `node scripts/build-course-es.mjs --nur-pruefen --bericht datei.json` listet sie (`unbekannteWoerter`).
4. Weitere Veröffentlichungen (Releases über Versions-Tags) nur nach ausdrücklicher Bestätigung.
6. **Echte Aufnahmen (in Arbeit, Stand 23.10.2026):** Code ist fertig und in CI grün (`src/recordings.js`, `src/speech.js`,
   Option „Computerstimme als Ersatz“, Standard aus; Seite `#/recordings`; siehe `docs/ARCHITEKTUR.md` §11). Es fehlen noch
   die Audiodateien: `node scripts/audio-sammeln.mjs es zh` lädt nach `.cache/audio/` (setzt nach Abbruch fort; Wikimedia
   erlaubt etwa eine Datei pro Sekunde, insgesamt ~6.800 Commons- und ~1.800 Tatoeba-Dateien), danach
   `node scripts/audio-aufbereiten.mjs es zh` → `assets/audio/<sprache>/`, im Browser prüfen, committen. **Erst dann** auf
   `main` bringen – vorher wäre die Live-App stumm. Danach `PROVENIENZ.md` (Abschnitt Aufnahmen mit Zahlen) und
   `DESIGN-PRAEFERENZEN.md` („heute nutzt die App noch die Systemstimmen“) aktualisieren. Lücken: Chinesisch hat für Sätze
   fast keine freien Aufnahmen (10 von 2.295), für Wörter ~67 %; Spanisch Wörter ~91 %, Sätze ~48 %. Nächster Schritt dafür:
   Liste fehlender Wörter für Lingua Libre (Aufnahme durch Muttersprachler).
7. **Installierbar auf Windows, Mac, iPhone, Android (23.10.2026, Zweig `inhalte-beispiele`):** Seite `#/app` mit
   Installieren-Knopf (Chrome/Edge) bzw. Anleitung je Gerät, „Aufnahmen laden“ für offline, Hinweise auf Willkommensseite,
   in den Optionen und in der Fußzeile. Dabei gefunden und behoben: Seit dem Aufnahmen-Commit war das erzeugte `sw.js`
   ungültig (`\/` im Template wurde zu `/`, die Zeile begann mit `//`) – die App wäre nach dem nächsten Deploy nicht mehr
   offline gegangen. Der Build prüft `sw.js` jetzt selbst. Kursdateien werden beim Installieren vorab gespeichert.
   Geprüft (Headless-Chromium, 390 × 844 und 1440 × 900, hell/dunkel): Service Worker aktiv, 6 Kurse und 173 Aufnahmen im
   Cache, danach Server aus → App startet, Chinesisch und Spanisch öffnen, Lektion läuft, Aufnahme spielt; iPhone-Ansicht
   (Safari-Kennung) zeigt die Home-Bildschirm-Anleitung; kein horizontales Scrollen, keine Konsolenfehler; `npm run check`
   134/134, `npm run e2e` 25/25. Nicht geprüft: echtes Installieren auf Windows, Mac und iPhone (nur im Browser simuliert).

### 0.5 Veröffentlichung 21.10.2026

- Repository: <https://github.com/aprael/wortweg> (öffentlich), Branch `main`, ein Commit für Stand 0.4.0.
- App-Version über GitHub Pages (Quelle „GitHub Actions“, Workflow `pages.yml`): <https://aprael.github.io/wortweg/>.
- Erste Läufe grün: CI (Check, E2E, App-Build) und Pages-Deploy. Live-Seite in Headless-Brave 375 × 812 geprüft: Startseite lädt,
  keine Konsolenfehler, kein horizontales Scrollen.
- Hinweis der Läufe: `actions/checkout@v4`, `setup-node@v4` und `upload-artifact@v4` liefen noch auf Node 20. Am 22.10.2026
  angehoben auf `checkout@v7`, `setup-node@v7`, `upload-pages-artifact@v5`, `deploy-pages@v5` (Release-Hinweise geprüft:
  keine Änderung, die dieses Projekt betrifft).

## 1. Ausgangslage (vorher)

- Der Ordner `~/sprachlern-app` wurde neu angelegt und war **leer**: kein Git, kein Code, keine AGENTS.md, CLAUDE.md oder README, kein Stack und keine Skripte.
- Nutzerangaben: „komplette Applikation mit allen Sprachen, Daten und Lernstufen, lokal speicherbar“, „Demo Deutsch–Englisch, fertiges Produkt mit allem, was Duolingo hat“. Ein konkreter Ordnername wurde nicht genannt, deshalb habe ich `~/sprachlern-app` gewählt.
- Gewählter Stack: statische Web-App aus Vanilla JS mit ES-Modulen, `node:test` für Tests, ein kleiner Node-Server. Es gibt **keine npm-Abhängigkeiten** und keinen Build-Schritt.

## 2. REA-Analyse (Methode, Befunde, Grenzen)

Werkzeug: `rea-agents@6.5.0`, CLI `npx -y rea-agents@6.5.0 analyze-javascript-application <pfad> --json`. Der MCP-Server „rea“ war in dieser Sitzung nicht verbunden (`npx` fehlte im PATH des MCP-Prozesses), deshalb habe ich die CLI nach `source ~/.nvm/nvm.sh` verwendet. Die Ausgabe ging in Dateien und wurde als **nicht vertrauenswürdige Daten** behandelt und nur zusammengefasst. Analysiert wurde **ausschließlich das eigene Projekt**.

| # | Zeitpunkt | Ziel | Ergebnis | Rohdaten |
|---|---|---|---|---|
| 1 | 2026-10-17 00:25 | leerer Projektordner | Exit 0. Ein Knoten („artifact root“), **0 Quelldateien**. Bestätigt den leeren Ausgangszustand. | `docs/rea/01-leerer-ordner.json` |
| 2 | 2026-10-17 00:39 | fertiges Projekt | Exit 1 `execution_failure` beim Parsen von `scripts/lint.mjs`. | `docs/rea/02-gesamtprojekt-fehler.json` |
| 3 | 2026-10-17 00:40 | Kopie nur des Web-Teils (`index.html`, `styles.css`, `src/`, `data/`, `package.json`) | Exit 1, gleicher Fehler bei `src/app.js`. Es liegt ein Teilergebnis vor. | `docs/rea/03-webteil-teilergebnis.json` |

**Befunde aus dem Teilergebnis (Lauf 3):**
- Inventar: 13 relevante Dateien, ca. 105 KB Text, keine ungültigen UTF-8-Dateien. Paket „wortweg“ 0.1.0 wurde erkannt.
- Die 8 JS-Module wurden als `javascript-asset` erfasst: `src/app.js`, `src/content.js`, `src/exercises.js`, `src/grading.js`, `src/progress.js`, `src/session.js`, `src/speech.js`, `src/storage.js`.
- `index.html` wurde über eine HTML-Referenz als Einstieg aufgelöst. REA ordnet die Datei als `electron-renderer` ein. Das ist eine **Heuristik und trifft nicht zu**, denn Wortweg ist keine Electron-App.
- Alle Electron- und IPC-Zähler stehen auf 0 (keine BrowserWindows, Preloads, IPC-Kanäle oder Native-Addons). Das passt zu einer reinen Browser-App, ist laut REA aber **nicht als Beweis der Abwesenheit** zu lesen.
- `parsed_javascript_files: 0`. Es gibt **keine** Aussagen über Importe, Speicherzugriffe oder Endpunkte, weil der AST-Schritt nicht lief.

**Ursache des Abbruchs (Umgebung, nicht App-Code):** REA kompiliert beim Start ein macOS-Hilfsprogramm per `xcrun`/Swift. Das schlägt fehl, weil das Command-Line-Tools-SDK `MacOSX27.0.sdk` nicht zur installierten Swift-Version 6.3.3 passt (`cannot suppress '~Copyable' …`). `rea doctor` meldet ebenfalls `healthy: false`, unter anderem wegen fehlender optionaler Engines (Ghidra, IDA, jadx), die hier nicht gebraucht werden.

**Grenzen:** REA ist auf ausgelieferte bzw. gebündelte Artefakte ausgelegt. Für einen kleinen, eigenen Quellcode-Ordner bringt es wenig zusätzlichen Nutzen. Die inhaltliche Prüfung des Codes erfolgte deshalb über Tests, die Inhaltsvalidierung und den Browser-Durchlauf (Abschnitt 6). Ergebnisse von REA wurden **nicht erfunden oder ergänzt**.

## 3. Feature-Liste

**Herkunft der Anforderungen:** [N] = Nutzer- bzw. Auftragsanforderung · [B] = in dieser Sitzung verifiziert beobachtet · [A] = Annahme bzw. eigene Entscheidung.

### MVP (umgesetzt)
- Übersicht mit Fortschritt, Serie, Tagesziel, XP und fälligen Wiederholungen [N]
- Kurs und Lernpfad (Stufen → Einheiten → Lektionen, sequentielle Freischaltung) [N]. Die Option „alle freischalten“ ist eine eigene Entscheidung [A].
- Lektion mit Multiple Choice, Übersetzen, Satzbau, Lückentext und Hören (Browser-TTS, keine Audiodateien, daher lizenzrechtlich sauber) [N]
- Sofortiges Feedback mit Lösung und Erklärung [N]. Tippfehler- und Akzent-Toleranz habe ich ergänzt [A].
- XP und Abschlussübersicht [N]
- Wiederholung falscher und fälliger Lernobjekte mit Leitner-Intervallen [N, Intervalle A]
- Optionales Tagesziel und Serie ohne Strafen [N]
- Barrierefreie, responsive Oberfläche mit Tastatur [N]
- Lokale, gekapselte Speicherung mit Zurücksetzen und Export/Import [N]
- Mehrere Kurse und Import eigener Kurse als JSON [A, als Antwort auf „alle Sprachen“]

### Nach dem MVP
- Mehr Inhalte pro Sprache und weitere Sprachkurse, ideal von Muttersprachler:innen geprüft
- Wiederaufnahme abgebrochener Lektionen
- Übungstyp „Paare zuordnen“ und Sprechübungen (Spracherkennung, aus Datenschutzgründen nur lokal)
- Offline-Modus (Service Worker, PWA)
- Statistikseite (XP-Verlauf, schwierige Wörter)

### Optional
- Geräteübergreifende Synchronisation (bräuchte einen Server und widerspricht „rein lokal“)
- Lernerinnerungen (Benachrichtigungen, nur mit Opt-in)
- Kurs-Editor in der App

Bewusst **nicht** umgesetzt: Herzen/Leben, Bestrafung bei Pausen, Ranglisten-Druck, Bezahlfunktionen, Werbung, Tracking, Konten.

## 4. Plan (kurz)

- **Betroffene Bereiche:** Neuprojekt. Inhalte (`data/`), reine Logik (`src/*.js` außer `app.js`), UI (`src/app.js`, `styles.css`), Werkzeuge (`scripts/`), Tests.
- **Datenmodell Kurs:** `course → levels[] → units[] → words[]/sentences[]`. Jedes Element hat `native[]`, `target[]` (erster Eintrag = Musterlösung) und `note`. Pro 4 Wörter entsteht eine Lektion.
- **Datenmodell Fortschritt** (`wortweg:state:v1`): `xpTotal`, `xpByDay{YYYY-MM-DD}`, `dailyGoal`, `streak{current,best,lastDay}`, `courses{id:{completed{lessonId:{completions,bestScore,lastAt}}}}`, `review{key:{courseId,kind,unitId,index,box,due,wrong,seen}}` und `settings`.
- **Navigation:** `#/` Start → `#/learn` Lernpfad → `#/lesson/:id` Lektion → Auswertung → nächste Lektion, Lernpfad oder `#/review`. Dazu `#/settings` und `#/about`.
- **Zustand und Speicher:** Reine Funktionen (Zustand rein, Zustand raus) mit `commit()` → `store.saveState()` nach jeder Änderung. Geladene Daten laufen durch `sanitizeState`.
- **Akzeptanzkriterien:** vollständiger Lernkreislauf. Musterlösungen aller erzeugten Übungen werden als richtig gewertet. Der Fortschritt übersteht einen Reload. Volle Tastaturbedienung, kein horizontales Scrollen bei 375 px.
- **Risiken:** Zu strenge oder zu lockere Bewertung (abgefangen durch Wort-für-Wort-Tippfehlerbudget und Tests). Inhaltsqualität (Demo, ungeprüft). TTS-Verfügbarkeit (Feature-Erkennung mit Fallback).

## 5. Umsetzung und Dateien

| Thema | Ort |
|---|---|
| Normalisierung (Kurzformen, Umlaute, Satzzeichen) | `src/grading.js:19` |
| Tippfehler-Toleranz pro Wort, inkl. Vertauschung | `src/grading.js:43`, `src/grading.js:66` |
| Bewertung Text / Satzbau | `src/grading.js:84`, `src/grading.js:116` |
| Kursvalidierung, Lernpfad | `src/content.js:15`, `src/content.js:79` |
| Übungsgenerator (deterministisch, Seed) | `src/exercises.js:221` |
| Wiederholungsübungen nach Box | `src/exercises.js:254` |
| XP-Formel | `src/progress.js:74` |
| Lektionsergebnis → XP, Serie, Wiederholung | `src/progress.js:103` |
| Leitner-Intervalle, fällige Objekte, Antwort | `src/progress.js:9`, `src/progress.js:136`, `src/progress.js:145` |
| Serie (keine Strafen) | `src/progress.js:46`, `src/progress.js:56` |
| Freischaltung | `src/progress.js:166` |
| Datenbereinigung beim Laden/Import | `src/progress.js:199` |
| Lektionsablauf mit einmaliger Wiederholung | `src/session.js:3`, `src/session.js:24` |
| Speicher, Backup kaputter Daten, Export/Import | `src/storage.js:20`, `src/storage.js:88`, `src/storage.js:93` |
| Übungsansicht, Prüfen, Abschluss, Auswertung | `src/app.js:255`, `src/app.js:333`, `src/app.js:359`, `src/app.js:380` |
| Tastatursteuerung, Fokusführung | `src/app.js:613`, `src/app.js:96` |
| Einstellungen (Ziel, Hören, Freischalten, Daten, Kurse) | `src/app.js:410` |

Inhalte: `data/courses/de-en.json` (12 Einheiten, 144 Wörter, 108 Sätze, 36 Lektionen) und `data/courses/de-es.json` (16 Wörter, 12 Sätze, 4 Lektionen). Alle sind eigene Inhalte, als `"demo": true` markiert und haben zu jedem Satz eine Erklärung.

## 6. Tatsächlich ausgeführte Prüfungen

**Automatisiert** (`npm run check`, zuletzt am 17.10.2026 grün):
- `npm run lint`: Syntax aller JS-Dateien, JSON-gültig, keine Leerzeichen am Zeilenende, kein `console.log` in `src`. Ergebnis: ok.
- `npm run validate`: Beide Kurse sind gültig. Alle Übungen aller 40 Lektionen wurden mit und ohne Hören erzeugt. Keine doppelten oder zu wenigen Auswahlmöglichkeiten, jede Übung hat eine Erklärung.
- `npm test`: **32/32 bestanden.** Abgedeckt sind:
  - Bewertung je Übungstyp: Auswahl, Übersetzen (Alternativen, Kurzformen, Tippfehler, Akzente, Umlaute), Satzbau und Hören. Über alle Lektionen hinweg gilt: Musterlösung und Alternativen werden als richtig gewertet.
  - Lückentext-Rekonstruktion, Determinismus, Wiederholungsübungen
  - Freischaltung, XP, Tagesziel, Bestwert, Serie über Tage (inkl. Pause ohne XP-Verlust), Leitner-Boxen bis „gemeistert“
  - Sitzung mit einmaliger Wiederholung
  - Speichern und Neuladen, leerer und kaputter Speicher (Backup), Zurücksetzen, Export/Import-Rundlauf, Ablehnung fremder Dateien, nicht schreibbarer Speicher, Filterung ungültiger eigener Kurse
- Während der Tests gefunden und behoben: Die Tippfehler-Toleranz galt anfangs für den ganzen Satz und akzeptierte deshalb „brother“ statt „mother“. Jetzt gilt sie pro Wort.

**Im Browser** (Claude-Browser-Pane, http://localhost:5179, frischer localStorage):
- Start → „Erste Lektion starten“ per Enter → Lektion „Begrüßung 1“ **komplett per Tastatur**:
  - Ziffern-Auswahl und Enter für Prüfen und Weiter
  - Absichtlich falsche Antwort mit Feedback, Lösung, Erklärung und dem Hinweis auf eine zweite Runde
  - Satzbau per Tab/Enter, Rücktaste entfernt den letzten Baustein
  - Lückentext
  - Tippfehler „my naem is tom“ → „Richtig – mit kleinem Hinweis“. Beim ersten Versuch wurde das noch abgelehnt, danach habe ich das Tippfehlerbudget für Wörter mit 4 Buchstaben in Sätzen angepasst.
  - Hörübung (Text eingegeben, Ton nicht hörbar geprüft)
  - Falsche Übersetzung, die im zweiten Versuch richtig beantwortet wurde
- Auswertung: +13 XP, 8/9 (89 %), Serie 1 Tag, 13/20 XP, Fehlerliste.
- **Reload:** Startseite zeigt 1/36 Lektionen, 13 XP, Serie 1, „Weiterlernen: Begrüßung 2“ und 1 fällige Wiederholung. Der Fortschritt blieb erhalten.
- Wiederholung: Satzbau richtig → Box 0 → 1, wieder fällig in 24 h, +3 XP. Die Bausteine wurden hier per DOM-Klick gesetzt, nicht mit Maus oder Tastatur.
- **375 × 812 (Mobil):** Lernpfad und Lektion ohne horizontales Scrollen (`scrollWidth = 375`). Antworten per Tippen bzw. Klick auf Koordinaten funktionieren. Die Navigation brach zunächst um und wurde danach angepasst; Einstellungen und Navigation stehen jetzt einzeilig.
- Gesperrte Lektion per URL zeigt einen Sperrhinweis. Das gewählte Tagesziel 30 XP wurde gespeichert. Zurücksetzen mit Abbrechen und mit Bestätigen funktioniert (XP danach 0). Der Fokus bleibt nach dem Umschalten einer Einstellung auf dem Bedienelement.
- Spanischer Kurs: Kurswechsel, „Alle Lektionen freischalten“, „Kann gerade nicht hören“ wandelt die Übung in eine Übersetzung um, Antwort „hola, yo soy anna“ wird als richtig gewertet.
- Keine Fehler in der Browser-Konsole. Danach habe ich den localStorage der Testseite geleert.
- Der statische Server liefert `/` und `/data/…` aus (200) und blockiert `/../package.json` sowie `/scripts/…` (404).

**Nicht im Browser geprüft:** Datei-Export als Download (wurde nicht ausgelöst; die Logik ist per Unit-Test geprüft), Datei-Import von Fortschritt und Kursen über den Dateidialog (Logik per Unit-Test), tatsächliche Tonausgabe, Screenreader, Hellmodus (Pane lief dunkel), Safari und Firefox.

## 7. Lizenzen

- Code: MIT (`LICENSE`). Kursinhalte: eigene Demo-Inhalte, CC0 1.0.
- Externe Assets: **keine**. Keine Bibliotheken, Fonts, Bilder, Icons oder Audios. Die Sprachausgabe kommt vom Browser bzw. Betriebssystem.
- Von anderen Lern-Apps wurden kein Code, keine API, Texte, Lektionen, Audios, Grafiken, Maskottchen, Namen oder Logos übernommen. Name „Wortweg“, Farbschema (Indigo/Amber) und Wortmarke „W“ sind eigene Entwürfe. Kein Scraping.

## 8. Offene Punkte

1. REA lässt sich auf diesem Mac erst nach einer Reparatur der Command Line Tools vollständig nutzen (SDK MacOSX27.0 passt nicht zu Swift 6.3.3). Möglich ist ein Update von Xcode bzw. den Command Line Tools oder ein Wechsel mit `xcode-select`. Das betrifft das System, deshalb habe ich es nicht selbst geändert.
2. Der MCP-Server „rea“ findet `npx` nicht, weil nvm im MCP-Prozess fehlt. Abhilfe: in `~/.claude.json` den absoluten Pfad `~/.nvm/versions/node/v24.22.0/bin/npx` eintragen.
3. Die Inhalte sind Demo-Umfang und nicht muttersprachlich geprüft. Für ein echtes Produkt braucht es deutlich mehr und geprüfte Inhalte.
4. Kein Git-Repository angelegt, nichts veröffentlicht.
5. Die Hörqualität hängt von den Systemstimmen ab. Bei fehlender englischer Stimme spricht ggf. eine Standardstimme.
