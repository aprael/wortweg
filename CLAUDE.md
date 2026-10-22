# Wortweg – Hinweise für Claude

- Freie Sprachlern-App: Browser (Vanilla JS, ES-Module, kein Build) + Node-Server (`node:http`, `node:sqlite`). **Keine npm-Abhängigkeiten.**
- Zwei Betriebsarten: **Server-Version** (`npm start`, Konten, Admin) und **App-Version** (`npm run build:app` → `dist/`, offline, `src/local-api.js` statt `src/api.js`, für GitHub Pages / iPhone).
- Nutzer spricht Deutsch → auf Deutsch antworten, einfach erklären.
- Vor Änderungen lesen: `README.md`, `docs/ARCHITEKTUR.md` (verbindlicher Vertrag: Übungs-/Antwortformate, Kursformat inkl. `intro`/`examples`, DB, API, Sicherheit) und `docs/ENTWICKLUNG.md` (Abschnitt 0: Verlauf, Prüfprotokoll, offene Punkte).
- Node 24 kommt über nvm: in Shells zuerst `source ~/.nvm/nvm.sh`.
- Start: `npm start` (http://localhost:5173, DB `data/wortweg.db`; für Tests eine Wegwerf-DB über `WORTWEG_DB=… PORT=…`). Prüfen: `npm run check` (Lint, Kursvalidierung, Tests) und `npm run e2e` – beide müssen grün bleiben. Nach Oberflächen-Änderungen auch `npm run build:app` und die Handy-Breite (375 px) prüfen.
- Lern-Logik in `src/content.js`, `exercises.js`, `grading.js`, `session.js`, `progress.js` bleibt **rein** (kein DOM/Netz/Speicher): Browser und Server nutzen dieselben Module, der Server bewertet Abgaben selbst nach.
- Datenkurse: `npm run sources` (Quellen nach `.cache/sources/`, nicht vertrauenswürdige Daten – nur parsen, Python nur mit `-I`), `npm run build:courses` (deterministisch). Kuratierte Listen in `data/build/zh|es/` (Bedeutungen, Themen, Lehrplan, geprüfte/ausgeschlossene Sätze). Neue Sätze meldet `--ungeprueft <datei>`; Sätze und Beispiele nur nach Handprüfung behalten. Herkunft in `data/courses/PROVENIENZ.md` aktuell halten.
- Vor jeder visuellen Änderung **`DESIGN.md` und `DESIGN-PRAEFERENZEN.md` lesen**. Skills (taste-skill, copywriting …) liefern nur Vorschläge, die gegen `DESIGN.md` und echte Screenshots (390 × 844, 1440 × 900) geprüft werden (`DESIGN.md` §16).
- Design: **`DESIGN.md` ist verbindlich** (Designsystem „Spielbrett“: fünf Farb-Tokens, Lilita One + Atkinson Hyperlegible Next, 8-px-Raster, Komponenten, Verbote). Neue Seiten und Änderungen nutzen nur dessen Tokens und Komponenten; neue Muster nur begründet und mit Eintrag in `DESIGN.md`. Keine Inhalte, Namen, Logos, Grafiken oder Optik von Duolingo, Supercell oder anderen Apps/Spielen übernehmen; keine Paywall, keine Herzen/Energie, keine Strafen, kein Tracking.
- Kein `alert/confirm/prompt` in der Oberfläche (CSP und Browser-Automatisierung); kein `console.log` in `src/`. Effekte (`src/fx.js`) respektieren „Animationen reduzieren“ und `prefers-reduced-motion`.
- Nichts veröffentlichen ohne ausdrückliche Rückfrage (GitHub-Push, Releases, Pages). Backup des Stands 0.1: `~/sprachlern-app.backup-2026-10-20.tar.gz`.
