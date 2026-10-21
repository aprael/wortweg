# Wortweg 0.4 – Architektur und Schnittstellen-Vertrag

Stand: 21.10.2026 (Grundlage 0.2 vom 20.10., Ergänzungen in §9 und §10). Dieses Dokument ist der **verbindliche Vertrag** zwischen den Arbeitspaketen (Lern-Engine,
Server, Oberfläche). Wer eine Signatur oder ein Datenformat ändern will, ändert zuerst dieses Dokument.

## 1. Ziel und Leitplanken

- Aus der lokalen Demo (0.1, nur localStorage) wird eine Web-App mit **Konten, Server-Datenbank und Admin-Bereich**.
- **Keine npm-Abhängigkeiten**, kein Build. Server: `node:http`, `node:sqlite` (`DatabaseSync`), `node:crypto` (scrypt).
  Node ≥ 24 (getestet 24.22.0).
- Die **Lern-Logik bleibt rein** (`src/content.js`, `src/exercises.js`, `src/grading.js`, `src/session.js`,
  `src/progress.js`): keine DOM-, Netz- oder Speicherzugriffe. Browser **und** Server importieren dieselben Module.
- Der Server ist die Autorität für Fortschritt: Der Browser bewertet sofort (für Feedback), schickt am Ende aber nur die
  **Rohantworten**. Der Server baut die Übungen deterministisch nach (gleicher Seed), bewertet selbst und berechnet XP.
  Der Browser sendet nie XP-Werte.
- Keine Bezahlfunktionen, keine Herzen/Energie, keine Strafen, kein Tracking, keine Drittanbieter-Skripte.
- Inhalte: nur eigene Inhalte (CC0). Keine Inhalte, Namen, Logos, Maskottchen oder Optik von Duolingo.

## 2. Ordner und Zuständigkeit

| Pfad | Inhalt | Zuständig |
|---|---|---|
| `src/content.js`, `src/exercises.js`, `src/grading.js`, `src/session.js`, `src/progress.js` | reine Lern-Logik | Engine |
| `tests/content.test.mjs`, `tests/grading.test.mjs`, `tests/progress.test.mjs`, `tests/engine.test.mjs` | Tests der Logik | Engine |
| `scripts/validate-content.mjs` | Kursprüfung | Engine |
| `server/**`, `scripts/db-setup.mjs`, `scripts/create-admin.mjs`, `tests/server-*.test.mjs` | Server, DB, API | Server |
| `src/app.js`, `src/api.js`, `src/admin.js`, `src/speech.js`, `src/storage.js`, `index.html`, `styles.css`, `assets/` | Oberfläche | Frontend |
| `package.json`, `README.md`, `CLAUDE.md`, `docs/**` | Integration | Leitung |

`data/courses/*.json` bleiben das Seed-Format (CC0) und das Import-/Exportformat des Admin-Bereichs.

## 3. Kursformat (unverändert + Ergänzungen)

```
course  { id, title, subtitle?, nativeLang, targetLang, ttsLang?, demo?, license?, version?, status?,
          levels: [ level { id, title, units: [ unit { id, title, description?, words[], sentences[] } ] } ] }
word / sentence  { native: string[], target: string[], note?: string }   // Sätze: note Pflicht
```

- `version` (Ganzzahl, vom Server gesetzt): steigt bei jeder Inhaltsänderung. Abgaben mit veralteter Version → 409.
- Begriffe in der Oberfläche: **Abschnitt** = `level`, **Einheit** = `unit`, **Lektion** = je 4 Wörter einer Einheit,
  **Checkpoint** = Test am Ende eines Abschnitts, **Wiederholung** = fällige Lernobjekte (Leitner).
- Lektions-ID: `${unitId}:${index}`. Lernobjekt-Referenz `ref = { kind: 'w'|'s', unitId, index }`,
  Schlüssel `itemKey(courseId, ref) = "courseId|kind|unitId|index"`.

## 4. Lern-Engine (Vertrag)

### 4.1 Übungsobjekt

Gemeinsame Felder: `id, type, instruction, question, questionLang, answerLang, solution, explanation, ref`
(bei `match`: `refs` statt `ref`). Typen:

| type | zusätzliche Felder | Antwortformat `response` |
|---|---|---|
| `choice` | `choices[]`, `answer`, `accepted` | gewählter Text (string) |
| `fill` | `parts{before,after}`, `choices[]`, `answer`, `accepted` | gewählter Text (string) |
| `translate` | `accepted[]` | eingegebener Text (string) |
| `order` | `bank[{id,text}]`, `accepted[]` | Baustein-**Texte** in Reihenfolge (string[]) |
| `listen` | `speak`, `speakLang`, `accepted[]` | eingegebener Text (string) |
| `match` **neu** | `left[{id,text,lang}]`, `right[{id,text,lang}]`, `pairs[[leftId,rightId]]`, `refs[]` | alle Zuordnungsversuche in Reihenfolge (`[leftId,rightId][]`) |
| `speak` **neu** | `speak`, `speakLang`, `accepted[]` | Transkript der Spracherkennung (string) |

- `match`: 4 Wortpaare (native ↔ target). Richtig im ersten Versuch ⇔ **jeder** Versuch war ein korrektes Paar und alle
  Paare wurden gefunden. `refs` sind die Wort-Refs. Bei falschem Ergebnis kommen alle Refs in `wrongRefs`.
- `speak`: zeigt den Zielsatz (`question` = Zielsatz, `questionLang = targetLang`), Lernende lesen ihn vor.
  Bewertung wie `translate` (Tippfehler erlaubt) gegen `accepted`.
- **Fallbacks** (Barrierefreiheit): `fallbackExercise(ex, course)` macht aus `listen` und `speak` eine
  `translate`-Übung desselben Satzes (Muttersprache → Zielsprache, `accepted` = alle Zielvarianten). Die Oberfläche
  bietet dafür „Kann gerade nicht hören“ bzw. „Kann gerade nicht sprechen“.

### 4.2 Funktionen (Signaturen sind verbindlich)

```js
// exercises.js
buildLesson(course, unit, lessonIndex, { seed = '', listening = false, speaking = false } = {}) → Exercise[]
buildCheckpoint(course, level, { seed = '', listening = false, speaking = false } = {}) → Exercise[]   // ids "cp:<levelId>:<n>", 10–12 Übungen aus allen Einheiten des Abschnitts
buildReviewExercise(course, ref, { seed = '', box = 0 } = {}) → Exercise | null                      // id "review:<itemKey>"
lessonItems(unit, lessonIndex) → ref[]
fallbackExercise(ex, course) → Exercise                                                               // nur für listen/speak, sonst ex unverändert

// grading.js
gradeExercise(ex, response) → { correct, exact, hint, matched }      // für ALLE Typen; ungültige Antwortform → correct:false
gradeMatchAttempt(ex, leftId, rightId) → boolean                      // für die Oberfläche (sofortiges Feedback je Paar)

// session.js
gradeSubmission(exercises, responses, course) → { total, firstTryCorrect, accuracy, wrongRefs, results }
//   responses: { [exerciseId]: { answers: [first, retry?], fallback?: true } }
//   fallback:true → vor dem Bewerten fallbackExercise() anwenden. Fehlende Antwort auf eine Übung → gilt als falsch.
//   wrongRefs: Refs der im ersten Versuch falschen Übungen (match → alle refs), ohne Duplikate.

// progress.js  (Zustand v2)
STATE_VERSION = 2
CHECKPOINT_PASS = 0.8
applyLessonResult(state, { courseId, lessonId, total, firstTryCorrect, items, wrongRefs, now }) → { state, xp }   // wie bisher
applyCheckpointResult(state, { courseId, levelId, total, firstTryCorrect, wrongRefs, now }) → { state, xp, passed }
applyReviewAnswer(state, key, correct, now) → state                                                          // wie bisher
finishReview(state, firstTryCorrect, now) → { state, xp }                                                    // wie bisher
isLessonUnlocked(state, course, lessonId) → boolean
isCheckpointUnlocked(state, course, levelId) → boolean
isCheckpointPassed(state, courseId, levelId) → boolean
sanitizeState(raw) → state          // akzeptiert v1 und v2
```

**Freischaltung (Checkpoints):** `unlockAll` → alles frei. Sonst: erste Lektion des Kurses frei; Lektion frei, wenn die
vorherige Lektion **im selben Abschnitt** abgeschlossen ist; erste Lektion eines Abschnitts frei, wenn der Checkpoint des
vorherigen Abschnitts bestanden ist; **alle** Lektionen eines Abschnitts frei, wenn dessen Checkpoint bestanden ist.
Checkpoint frei, sobald die erste Lektion seines Abschnitts frei ist (dann auch zum „Überspringen“ nutzbar).
Bestehen ab 80 % im ersten Versuch; Fehlversuche kosten nichts und dürfen beliebig wiederholt werden.

**XP Checkpoint:** 1 je richtig im ersten Versuch, +10 beim Bestehen. Falsche Refs → Wiederholungs-Box 0.

**Zustand v2** (gleiches Format im Browser, beim Export und im Server-Mapping):

```
{ version: 2, activeCourseId, xpTotal, xpByDay{YYYY-MM-DD: xp}, dailyGoal, streak{current,best,lastDay},
  courses{ [courseId]: { completed{ [lessonId]: {completions,bestScore,lastAt} },
                         checkpoints{ [levelId]: {passed,bestScore,attempts,lastAt} } } },
  review{ [itemKey]: {courseId,kind,unitId,index,box,due,wrong,seen} },
  settings{ listening, speaking, unlockAll, reduceMotion } }
```

`settings.speaking` ist standardmäßig **false** (Spracherkennung in Chrome überträgt Audio an Google; nur nach Opt-in).

## 5. Datenbank (SQLite, `data/wortweg.db`, Migrationen in `server/migrations/NNN_name.sql`)

```
schema_migrations(version PK, name, applied_at)
languages(code PK, name, native_name)
courses(id PK, title, subtitle, native_lang→languages, target_lang→languages, tts_lang, status draft|published|archived,
        demo, license, provenance, version, position, created_at, updated_at)
sections(pk PK, course_id→courses ON DELETE CASCADE, slug, title, position, UNIQUE(course_id, slug))
units(pk PK, course_id→courses CASCADE, section_pk→sections CASCADE, slug, title, description, position,
      status draft|published, UNIQUE(course_id, slug))
items(pk PK, unit_pk→units CASCADE, kind w|s, position, native JSON, target JSON, note)
users(id PK, email UNIQUE NULL, display_name, password_hash NULL, role learner|admin, is_guest, created_at, last_login_at)
sessions(token_hash PK, user_id→users CASCADE, created_at, expires_at)
learner_state(user_id PK→users CASCADE, active_course_id, daily_goal, settings JSON, xp_total,
              streak_current, streak_best, streak_last_day, updated_at)
xp_days(user_id, day, xp, PK(user_id, day))
lesson_progress(user_id, course_id, lesson_id, completions, best_score, last_at, PK(user_id, course_id, lesson_id))
checkpoint_progress(user_id, course_id, level_id, passed, best_score, attempts, last_at, PK(...))
review_items(user_id, course_id, kind, unit_id, idx, box, due, wrong, seen, PK(user_id, course_id, kind, unit_id, idx))
attempts(id PK, user_id, course_id, kind lesson|review|checkpoint, target, total, first_try_correct, xp, created_at)
audit_log(id PK, user_id, action, target, detail, created_at)
```

- Nur Einheiten mit `status='published'` in Kursen mit `status='published'` sind für Lernende sichtbar.
- Positionswechsel/Löschen eines Lernobjekts verschiebt `review_items.idx` in derselben Transaktion (Refs bleiben gültig).

## 6. HTTP-API (JSON, Präfix `/api`, Cookie `ww_session`)

Allgemein: Antworten `{ ok: true, ...daten }` bzw. Fehler `{ ok: false, error: { code, message } }` mit passendem
Status (400 Validierung, 401 nicht angemeldet, 403 keine Rechte, 404, 409 Konflikt, 413 zu groß, 429 zu viele Versuche).
Schreibende Anfragen: nur `Content-Type: application/json`, `Origin` muss zum Host passen (CSRF-Schutz zusätzlich zu
`SameSite=Strict`). Body-Limit 256 KB (Kursimport 2 MB).

| Methode & Pfad | Body | Antwort |
|---|---|---|
| `GET /api/me` | – | `{ user: User|null }` |
| `POST /api/auth/guest` | – | `{ user }` – Gastkonto ohne E-Mail |
| `POST /api/auth/register` | `{ email, password, displayName }` | `{ user }` – angemeldeter Gast wird **umgewandelt** (Fortschritt bleibt) |
| `POST /api/auth/login` | `{ email, password }` | `{ user }` (429 nach 10 Fehlversuchen / 15 min je E-Mail+IP) |
| `POST /api/auth/logout` | – | `{}` |
| `POST /api/account/delete` | `{ password? }` | `{}` – löscht Konto und Fortschritt (Gast ohne Passwort) |
| `PATCH /api/account` | `{ displayName }` | `{ user }` |
| `GET /api/languages` | – | `{ languages: [{code,name,nativeName}] }` |
| `GET /api/courses` | – | `{ courses: [{id,title,subtitle,nativeLang,targetLang,demo,license,stats:{levels,units,lessons,words,sentences}}] }` |
| `GET /api/courses/:id` | – | `{ course }` (Kursformat inkl. `version`; Admin mit `?preview=1` auch Entwürfe) |
| `GET /api/progress` | – | `{ state }` (Zustand v2) – 401 ohne Anmeldung |
| `PATCH /api/progress/settings` | `{ dailyGoal?, activeCourseId?, settings?: {listening,speaking,unlockAll,reduceMotion} }` | `{ state }` |
| `POST /api/progress/lesson` | `{ courseId, lessonId, version, seed, options:{listening,speaking}, responses }` | `{ state, result }` |
| `POST /api/progress/checkpoint` | `{ courseId, levelId, version, seed, options, responses }` | `{ state, result }` (`result.passed`) |
| `POST /api/progress/review` | `{ courseId, version, responses }` (Schlüssel = `review:<itemKey>`) | `{ state, result }` |
| `GET /api/progress/export` | – | Export-Datei `{ app:'wortweg', version:2, exportedAt, state }` |
| `POST /api/progress/import` | `{ data }` (Exportobjekt v1/v2, z. B. alter localStorage-Stand) | `{ state }` – ersetzt den Fortschritt |
| `POST /api/progress/reset` | – | `{ state }` |
| `GET /api/stats` | – | `{ stats: { days:[{day,xp}], attempts:{lesson,review,checkpoint}, accuracy, hardItems:[{courseId,kind,unitId,index,native,target,wrong}] } }` |

`result = { xp, total, firstTryCorrect, accuracy, wrongRefs, goalJustReached, passed? }`.
`seed` = Ganzzahl ≥ 0 (der Browser nimmt `completions` bzw. `attempts`). `options` müssen zu den Einstellungen passen
können (der Server akzeptiert die übermittelten Werte, weil sie nur die Übungsauswahl, nicht die Bewertung ändern).

**User** = `{ id, displayName, email|null, role: 'learner'|'admin', isGuest }`.

### Admin (`role = 'admin'`, sonst 403; jede Änderung → `audit_log`, Kurs `version + 1`)

| Methode & Pfad | Zweck |
|---|---|
| `GET /api/admin/overview` | Kurse (alle Status), Sprachen, Zähler, letzte Audit-Einträge |
| `POST /api/admin/languages` · `PATCH/DELETE /api/admin/languages/:code` | Sprachen (Löschen nur, wenn unbenutzt) |
| `POST /api/admin/courses` · `PATCH/DELETE /api/admin/courses/:id` | Kurs anlegen/ändern (inkl. `status`)/löschen |
| `GET /api/admin/courses/:id` | Kurs inkl. Entwürfe und DB-Schlüsseln (`pk`) für Abschnitte/Einheiten/Lernobjekte |
| `POST /api/admin/courses/:id/sections` · `PATCH/DELETE /api/admin/sections/:pk` | Abschnitte |
| `POST /api/admin/sections/:pk/units` · `PATCH/DELETE /api/admin/units/:pk` | Einheiten (inkl. `status`, Verschieben `position`) |
| `POST /api/admin/units/:pk/items` · `PATCH/DELETE /api/admin/items/:pk` | Wörter/Sätze (`kind`, `native[]`, `target[]`, `note`) |
| `POST /api/admin/items/:pk/move` | `{ direction: 'up'|'down' }` – innerhalb der Einheit/Art |
| `GET /api/admin/units/:pk/preview` | erzeugte Lektionen dieser Einheit (alle Übungen) zur Kontrolle |
| `POST /api/admin/courses/:id/validate` | `validateCourse` + Übungsprüfung, `{ ok, errors, warnings }` |
| `POST /api/admin/import` | `{ course }` (Kursformat) → neuer **Entwurf** (Konflikt bei vorhandener id → 409) |
| `GET /api/admin/courses/:id/export` | Kursformat-JSON |

Veröffentlichen (`status: 'published'`) eines Kurses ist nur möglich, wenn `validateCourse` auf dem veröffentlichten Teil
ok ist; sonst 400 mit Fehlerliste.

## 7. Sicherheit

- Passwörter: `scrypt` (N=16384, r=8, p=1, 64 Byte, 16 Byte Salt), Vergleich mit `timingSafeEqual`. Mindestens 10 Zeichen.
- Sitzung: 32 zufällige Bytes, im Cookie `ww_session` (HttpOnly, SameSite=Strict, Path=/, Secure bei HTTPS), in der DB
  nur als SHA-256-Hash. Laufzeit 30 Tage, Gast 365 Tage. Logout löscht die Sitzung.
- Header: CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), geolocation=()`.
- Logging: nur Methode, Pfad (ohne Query), Status, Dauer. Nie Bodys, Passwörter, Cookies oder E-Mail-Adressen.
- Statische Dateien: nur Positivliste (`index.html`, `styles.css`, `src/`, `assets/`), keine Datenbank, keine `server/`.
- **Demo-Abkürzungen (dokumentiert):** keine E-Mail-Bestätigung und kein Passwort-Reset per Mail (es gibt keinen
  Mailversand); Admin wird per CLI angelegt (`npm run admin -- --email …`), Rate-Limit nur im Speicher.

## 8. Oberfläche (Routen)

`#/welcome` (Einstieg: Gast oder Konto) · `#/login` · `#/register` · `#/` Start · `#/courses` Kurswahl mit Filter nach
Ausgangs- und Zielsprache · `#/learn` Lernpfad mit Checkpoints · `#/lesson/:id` · `#/checkpoint/:levelId` ·
`#/review` · `#/stats` · `#/settings` (inkl. Konto, Daten, alten lokalen Fortschritt übernehmen) · `#/admin/...`
(nur Admin; `src/admin.js` wird per dynamischem `import()` geladen) · `#/about`.

## 9. Ergänzung 20.10.2026 (Abend): Große Datenkurse, Chinesisch, App fürs Handy

### 9.1 Kursformat-Erweiterungen (alle Felder optional, rückwärtskompatibel)

```
course   { ..., license: string, attribution?: [{ name, url, license, usage }], generated?: true }
unit     { ..., intro?: string }                                    // Regeltext, max. 2000 Zeichen
word     { native[], target[], note?, reading?: string, tags?: string[],
           examples?: [{ target, native, reading?, source? }] }     // max. 3 Beispielsätze
sentence { native[], target[], note, reading?: string, tokens?: string[], source?: { name, id, url, author? } }
```

- `reading`: Aussprachehilfe zu `target[0]` (Chinesisch: Pinyin mit Tonzeichen, Silben eines Wortes zusammen,
  Wörter durch Leerzeichen getrennt, z. B. „wǒ shì xuésheng“). Die Oberfläche zeigt sie (abschaltbar) unter dem Text.
- `tokens`: Wortsegmentierung von `target[0]` **ohne Satzzeichen**, für Sprachen ohne Leerzeichen (Chinesisch).
  `tokens.join('')` = `target[0]` ohne Satzzeichen und Leerraum. Satzbau-Bausteine kommen dann aus `tokens`.
- `tags`: z. B. `["hsk3-1", "hsk2-1"]` (HSK 3.0 Stufe 1, auch im alten HSK 2.0 Stufe 1) oder `["rank-123"]`.
- `source`: Herkunft eines Satzes (z. B. `{ name: "Tatoeba", id: "12345", url: "https://tatoeba.org/de/sentences/show/12345" }`).
- `attribution`: Liste aller verwendeten Quellen mit Lizenz (Pflicht für nicht-eigene Inhalte).
- `generated: true`: automatisch aus offenen Quellen zusammengestellt (Oberfläche zeigt einen Hinweis).
- `unit.intro` (Ergänzung 21.10.): Regeltext einer Einheit. Zeilen mit „•“ oder „-“ werden zur Liste, sonst Absätze.
  Die Oberfläche zeigt ihn als Regelkarte vor der ersten Lektion der Einheit (solange sie nicht abgeschlossen ist)
  und jederzeit im Lernpfad („Regel“). DB: `units.intro` (Migration `003_unit_intro.sql`).
- `word.examples` (Ergänzung 21.10.): Beispielsätze, die zeigen, wann man das Wort benutzt. Erscheinen auf der
  Wortkarte vor der Lektion und nach dem Prüfen einer Wortübung. DB: in `items.extra` wie `reading`/`tokens`.
  Admin: `PATCH /api/admin/items/:pk` mit `examples` (nur Wörter; `[]` entfernt; `source` bleibt beim gleichen Satz).

### 9.2 Chinesisch in der Engine (`targetLang` bzw. `answerLang` = `zh`)

- Normalisierung: Leerraum komplett entfernen, chinesische und westliche Satzzeichen entfernen (，。！？、；：“”‘’《》（）…— usw.),
  Vollbreitenzeichen → Halbbreite. **Keine Tippfehler-Toleranz auf Hanzi.**
- Freie Eingabe auf Chinesisch akzeptiert zusätzlich **Pinyin** (aus `reading`): mit Tonzeichen, mit Tonziffern
  (`ni3 hao3`) oder ohne Töne; Leerzeichen/Apostrophe egal, `ü` = `v` = `u:`. Ohne Töne → richtig mit Hinweis.
- Satzbau und Lückentext nutzen `tokens`; `gradeOrder` fügt bei `zh` ohne Leerzeichen zusammen.
- Übungsobjekte geben `reading` (bzw. `choiceReadings`, `rightReadings`) mit, damit die Oberfläche Pinyin anzeigen kann.

### 9.3 Zwei Betriebsarten

- **Server-Modus** (`npm start`): wie §5–§8 (Konten, Sync, Admin).
- **App-Modus / PWA** (statisch, z. B. GitHub Pages): `npm run build:app` erzeugt `dist/` mit `index.html` (Manifest,
  iPhone-Angaben, CSP als Meta-Tag), `src/`, `assets/`, `courses/<id>.<hash>.json` (Inhalts-Hash im Namen),
  `courses/index.json` (Kennzahlen, Sprachen), `manifest.webmanifest` und `sw.js`. Der Build ersetzt in `dist/src/app.js`
  genau einen Import (`./api.js` → `./local-api.js`); es gibt kein `config.json`. `src/local-api.js` hat dieselben
  Funktionen wie `src/api.js` (`MODE = 'local'`), Fortschritt in `localStorage` (`wortweg:app:v2`), Bewertung mit
  denselben Engine-Funktionen. Kein Konto nötig, offline nutzbar, Export/Import der Daten. Der Service Worker cacht die
  App-Hülle versioniert und die Kursdateien beim ersten Öffnen; nach einem Update zeigt `src/pwa.js` einen Hinweis.
  Admin-Bereich gibt es nur im Server-Modus.
- **Mitgelieferte Kurse im Server-Modus:** `server/seed.mjs` läuft bei jedem Start. Neue Kursdateien werden eingespielt;
  eine geänderte Datei (Hash) ersetzt den Kurs nur, wenn kein Admin ihn seit dem Einspielen bearbeitet hat
  (Tabelle `bundled_courses`). Von Admins gelöschte Kurse kommen nicht wieder.
- iPhone: Safari → Teilen → „Zum Home-Bildschirm“ (Manifest, `apple-touch-icon` PNG 180 px, `display: standalone`).

## 10. Ergänzung 21.10.2026: Lernerlebnis (Oberfläche, ohne Änderung der Bewertung)

- **Wortkarten und Regelkarte:** Eine Lektion beginnt mit `run.phase = 'intro'`: Regelkarte (`unit.intro`, nur erste
  Lektion einer Einheit, solange nicht abgeschlossen) und je eine Karte für jedes Wort der Lektion ohne
  Wiederholungs-Eintrag (`newWordRefs`). Die Karten ändern weder Übungen noch Antworten; „Karten überspringen“ ist jederzeit möglich.
- **Vorlesen:** `speechFor(ex, course)` liefert den zielsprachlichen Text einer Übung (Frage in der Zielsprache, sonst die
  Musterlösung → Knopf „Lösung anhören“). Antippen zielsprachlicher Auswahl, Bausteine und Paar-Karten spricht sie aus;
  nach dem Prüfen wird gesprochen, wenn `settings.listening` an ist. Sprache: `ttsLang || targetLang`.
- **Zwischenstand** (`src/run-store.js`, `localStorage` `wortweg:run:v1`): nach jeder Antwort gespeichert (nur Lektion und
  Checkpoint): Sitzung, Antworten, Ersatzübungen, Optionen. Fortgesetzt wird nur, wenn Nutzer-ID, Kurs-ID, Kursversion,
  Lektion und Seed übereinstimmen und die Runde nicht fertig ist (max. 7 Tage). Abgabe an den Server wie gehabt am Ende –
  der Server baut die Übungen aus Seed und Optionen nach und bewertet selbst.
- **Einstellung `settings.sounds`** (Standard an): kurze Effekttöne über die Web Audio API (`src/fx.js`). Konfetti zeichnet ein
  Canvas; beides ist dekorativ (`aria-hidden`) und entfällt bei „Animationen reduzieren“ bzw. `prefers-reduced-motion`.
- **Anzeige:** Stufe aus Gesamt-XP (`playerLevel`, rein kosmetisch), Kronen 0–3 je Runde (`crownsFor`), Tagestruhe = Tagesziel.
  Große Kurse: im Lernpfad ist nur der Abschnitt mit dem nächsten Schritt aufgeklappt.
- **Paare:** ein gemeinsames Raster für beide Spalten (CSS `subgrid`), alle Zeilen gleich hoch.
- **Schrift:** Lilita One (SIL OFL 1.1) liegt unter `assets/fonts/`; `font-src` fällt unter `default-src 'self'`.
