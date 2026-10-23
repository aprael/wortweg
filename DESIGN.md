# Wortweg – Designsystem „Spielbrett“

Verbindliche Designquelle für alle Seiten, Komponenten und Sitzungen. Gewählt am 22.10.2026 (Richtung C aus dem
Design-Audit). Stand: umgesetzt auf dem Zweig `design-c-spielbrett` (22.10.2026); Abschnitt 14 hält fest, was dabei
geändert wurde und was noch offen ist. Persönliche Vorlieben und Ablehnungen des Nutzers: `DESIGN-PRAEFERENZEN.md`.

## 0. Verbindlichkeit

1. Jede neue Seite und jede Änderung an der Oberfläche verwendet die Tokens und Komponenten aus diesem Dokument.
   Farben, Schriften, Schriftgrößen, Abstände, Radien, Rahmenstärken, Schatten, Symbolgrößen und Zeiten stehen nur
   im Token-Block von `styles.css` (`:root`, inkl. Rückfall ohne `color-mix`) und werden in Komponenten nur über
   Tokens benutzt – auch in JavaScript (z. B. liest der Figur-Hüpfer `--dur-3` und `--ease-hop`). Als Literale
   erlaubt: Komponentenmaße im 8-px-Raster aus §4 (z. B. 48, 56, 64 px), die Breakpoints aus §9, 1-px-Linien in
   echten Tabellen, die 4-px-Halbversätze der Weglinien auf dem Brett, `0`, `100%`, `auto`, `fr` und `em`-Faktoren.
2. Ein neues visuelles Muster (neue Komponente, neue Variante, neuer Effekt) wird nur eingeführt, wenn
   - ein konkreter Bedarf besteht, den keine vorhandene Komponente abdeckt, und das schriftlich begründet ist,
   - es diesem Dokument nicht widerspricht (sonst wird zuerst dieses Dokument bewusst geändert),
   - es im selben Commit hier beschrieben und im Änderungsprotokoll (Abschnitt 17) eingetragen wird.
3. Rangfolge bei Konflikten: ausdrückliche Wünsche des Nutzers → dieses Dokument → `docs/ARCHITEKTUR.md`
   (Funktion, Barrierefreiheit, Sicherheit) → persönlicher Geschmack. Barrierefreiheit (WCAG 2.1 AA) geht jeder
   Gestaltungsregel vor.
4. Nach jeder Oberflächen-Änderung: `npm run check`, `npm run e2e`, `npm run build:app`, Sichtprüfung bei 390 px und
   1440 px, hell und dunkel (siehe `CLAUDE.md`).

## 1. Philosophie und Identität

**Idee:** Wortweg ist ein Brettspiel. Der Lernpfad eines Kurses ist ein Spielbrett; jede Lektion ist ein Feld, die
eigene Figur steht auf dem nächsten Feld, Regeln sind Ereignisfelder, am Ende eines Abschnitts wartet das
Checkpoint-Feld mit der Truhe. Nach einer Lektion rückt die Figur ein Feld weiter.

**Wirkung:** Spielfreude und Mut, ein kleines Ziel pro Tag. Erwachsen im Ton, spielerisch in der Form.
**Zielgruppe:** Jugendliche, Studierende und Erwachsene, die gern spielen, aber ernsthaft eine Sprache lernen wollen
(Spanisch, Chinesisch bis HSK 3, Demo-Kurse).

**Leitsätze**
1. *Spielteile statt Effekte.* Das Spielgefühl kommt von greifbaren Teilen (Felder, Figur, Spielsteine, Karten), die
   man drücken kann, nicht von Glanz, Verläufen oder Leuchten.
2. *Flach und farbig.* Volle, flache Flächen in wenigen Farben. Tiefe zeigt nur, was man drücken kann (die „Kante“).
3. *Das Wort ist der Star.* Lerninhalte (Wörter, Sätze, Antworten) sind immer das größte und lesbarste Element.
4. *Eine Sache zählt.* Pro Ansicht höchstens eine Hauptaktion in Gold.
5. *Ehrlich und frei.* Keine Herzen, keine Energie, keine Strafen, keine Ranglisten, kein Tracking, keine Paywall.
   Pausen kosten nichts – das sagt die Oberfläche auch.
6. *Eigenständig.* Keine Inhalte, Namen, Logos, Grafiken oder Anmutung anderer Apps und Spiele (insbesondere Duolingo
   und Supercell/Clash Royale).

## 2. Farben

### 2.1 Fünf Kern-Tokens

Es gibt genau fünf Kernfarben. Jede andere Farbe wird aus ihnen abgeleitet; Weiß (`#fff`) und Schwarz (`#000`) gelten
nicht als Farben, sondern nur als Mischpartner.

| Token | Rolle | Hell | Dunkel |
|---|---|---|---|
| `--board` | Hintergrund (das Brett) | `#E9EFFC` | `#0E1736` |
| `--ink` | Text und Spielfigur | `#14204A` | `#EEF2FF` |
| `--field` | Marke, Felder, Links, Auswahl | `#2457D6` | `#3462E8` |
| `--gold` | Akzent: Hauptaktion, aktuelles Feld, Kronen, Belohnung, „richtig“ | `#FFC21A` | `#FFC21A` |
| `--event` | Ereignisse: Regel-Felder, Fehler, „falsch“, Zähler | `#FF5D4F` | `#FF6B5E` |

### 2.2 Abgeleitete Tokens

Abgeleitet mit `color-mix(in srgb, …)` (Safari ab 16.2, Chrome ab 111 – wird im Projekt bereits benutzt). Die
Hex-Werte sind gerundete Ergebnisse zur Orientierung.

| Token | Formel | Hell | Dunkel | Einsatz |
|---|---|---|---|---|
| `--surface` | `board` + Weiß (hell 75 %, dunkel 7 % Weiß) | `#FAFBFE` | `#1F2744` | Karten, Antwortfelder, Eingaben |
| `--muted` | `ink` 70 % + `board` | `#545E7F` | `#ABB0C3` | Nebentext, Hinweise, Quellen |
| `--line` | `ink` 18 % + `board` | `#C3CADC` | `#363E5A` | Rahmen ruhender Flächen, Pfadlinie, Balken-Spur |
| `--line-strong` | `ink` 45 % + `board` | `#8992AC` | `#737A90` | Rahmen von Formularfeldern (3:1) |
| `--table` | `field` 35 % + Schwarz | `#0D1E4B` | `#122251` | „Spieltisch“: Kopf- und Tab-Leiste, Brett-Rahmen |
| `--on-field` | Weiß | `#FFFFFF` | `#FFFFFF` | Text/Symbole auf `field` und `table` |
| `--on-accent` | `gold` 20 % + Schwarz | `#332705` | `#332705` | Text/Symbole auf `gold` und `event` |
| `--field-text` | hell `field`, dunkel `field` 55 % + Weiß | `#2457D6` | `#8FA9F2` | Links und farbiger Text |
| `--event-text` | hell `event` 70 % + Schwarz, dunkel `event` | `#B34137` | `#FF6B5E` | Fehlertext, Überschrift „Noch nicht ganz.“ |
| `--gold-soft` | `gold` 20 % + `surface` | `#FBF0D0` | `#4C463C` | Rückmeldung „richtig“, Checkpoint-Karte |
| `--field-soft` | `field` 14 % + `surface` | `#DCE4F8` | `#222F5B` | Auswahl, Beispielsatz, Info |
| `--event-soft` | `event` 16 % + `surface` | `#FBE2E2` | `#433248` | Rückmeldung „falsch“, Regelkarte, Bestätigung |
| `--gold-edge` | `gold` 70 % + Schwarz | `#B38812` | `#B38812` | Kante goldener Knöpfe |
| `--field-edge` | `field` 70 % + Schwarz | `#193D96` | `#2445A2` | Kante blauer Knöpfe und Felder |
| `--event-edge` | `event` 70 % + Schwarz | `#B34137` | `#B34B42` | Kante der Regel-Felder |
| `--flame` | `event` 55 % + `gold` | `#FF8A37` | `#FF923F` | nur das Serien-Symbol |
| `--table-muted` | Weiß 72 % + `table` | `#BBC0CD` | `#BDC1CE` | Nebentext auf dem Brett (8,8:1) |
| `--table-locked` | Weiß 12 % + `table` | `#2A3961` | `#2E3D66` | gesperrte Felder, noch nicht gegangener Weg |
| `--field-bright` | `field` 80 % + Weiß | `#5079DE` | `#5D81ED` | Felder auf dem Brett (4,0:1 gegen `table`; `field` hätte nur 2,6:1) |

### 2.3 Farbregeln

- Grund ist immer `--board`, flach. Karten und Eingaben liegen auf `--surface`; Flächen trennen sich durch diesen
  Tonschritt, nicht durch Linien oder Schatten.
- `--gold` als Vollfläche nur für: den Primärknopf (höchstens einer pro Ansicht), das aktuelle Feld, das erreichbare
  Checkpoint-Feld, Kronen, das Häkchen-Symbol „richtig“ und Fortschrittsfüllungen (Balken, Tagesziel-Ring).
  Gold ist nie Textfarbe auf hellem Grund.
- Zustände: **richtig** = `--gold-soft` + Häkchen auf Gold; **falsch** = `--event-soft` + Kreuz auf `--event`.
  Zustände werden nie nur durch Farbe gezeigt: Es gibt immer Symbol und Text („Richtig!“, „Noch nicht ganz.“).
  (Bewusst kein Grün: Gold ist in Wortweg schon die Farbe für „geschafft“ – Kronen, Checkpoint, Truhe.)
- Auf `--event-soft` steht Fließtext in `--ink`; `--event-text` nur für Überschriften ab `--fs-4` und Symbole.
- Text auf `--event` und `--gold` immer in `--on-accent`, nie in Weiß (Weiß auf Koralle hat nur 3:1).
- Geprüfte Kontraste (WCAG): `ink`/`board` 13,6:1 (dunkel 15,7) · `ink`/`surface` 15,2 (13,1) · `muted`/`surface`
  6,2 (6,8) · `on-field`/`field` 6,2 (5,2) · `on-accent`/`gold` 9,1 · `on-accent`/`event` 4,8 (5,2) ·
  `event-text`/`surface` 5,4 (5,3) · `field-text`/`surface` 6,0 (6,8) · `gold`/`table` 10,0 (8,9) ·
  `line-strong`/`surface` 3,0 (3,4). Jede neue Farbkombination für Text braucht ≥ 4,5:1 (ab 24 px oder 19 px fett:
  3:1), Bedienelement-Grenzen ≥ 3:1.
- Kompatibilität: Die alten Namen (`--bg`, `--text`, `--primary`, `--blue`, `--accent` …) bleiben als Aliase auf die
  neuen Tokens, bis Admin-Bereich und `pwa.js` umgestellt sind. Aliase bekommen nie eigene Werte.

## 3. Schrift

### 3.1 Schriften

| Token | Schrift | Schnitte | Einsatz |
|---|---|---|---|
| `--font-display` | **Lilita One** (SIL OFL 1.1, `assets/fonts/`) | 400 | Seitentitel (h1, h2), Knopfbeschriftungen, Zahlen auf Feldern und Spielsteinen, Wortmarke |
| `--font-text` | **Atkinson Hyperlegible Next** (SIL OFL 1.1, Braille Institute) | 400, 700 | Fließtext, h3, alle Lerninhalte, Formulare, Tab-Leiste |
| `--font-cjk` | Systemschrift: `"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif` | – | chinesische Zeichen (im Code als Rückfall in `--font-text` enthalten) |
| `--font-reading` | Systemschrift: `system-ui, -apple-system, "Segoe UI", Roboto, …` | 400 | Pinyin (`.reading`): Atkinson enthält ǎ ǐ ǒ ǔ ǚ nicht, die ganze Zeile nutzt deshalb die Systemschrift |

- Schriften liegen lokal (CSP, offline). Atkinson Hyperlegible Next als WOFF2 in den Teilmengen latin und latin-ext
  (Spanisch, Deutsch). Gemessen am 22.10.2026: ā é ě ü ñ sind enthalten, ǎ ǐ ǒ ǔ ǚ nicht – darum steht Pinyin
  vollständig in `--font-reading`, statt einzelne Zeichen aus einer anderen Schrift zu mischen. Lizenzdatei `OFL-AtkinsonHyperlegibleNext.txt` dazulegen.
- `font-synthesis: none` – Lilita One hat nur einen Schnitt, er wird nie künstlich fett oder kursiv.
- **Lerninhalte nie in Lilita One:** Wörter, Sätze, Antworten, Pinyin und Beispielsätze stehen immer in
  `--font-text` (bzw. `--font-cjk`), weil Atkinson die Buchstaben eindeutig unterscheidet (I/l/1, O/0).
- Höchstens diese zwei Schriftfamilien plus Systemschrift für Chinesisch und Pinyin.

### 3.2 Größen (sechs Stufen)

| Token | Wert | px |
|---|---|---|
| `--fs-1` | `0.8125rem` | 13 |
| `--fs-2` | `1rem` | 16 |
| `--fs-3` | `1.25rem` | 20 |
| `--fs-4` | `1.5rem` | 24 |
| `--fs-5` | `2rem` | 32 |
| `--fs-6` | `clamp(2rem, 1.2rem + 3.5vw, 3rem)` | 32–48 |

Keine weiteren Größen. 13 px ist das Minimum für alles, was gelesen wird (auch Pinyin: `max(var(--fs-1), 0.8em)`).
Eingabefelder mindestens `--fs-2` (sonst zoomt iOS).

### 3.3 Hierarchie

| Rolle | Schrift | Größe | Zeilenhöhe | Farbe |
|---|---|---|---|---|
| h1 Start und Willkommen | Lilita One | `--fs-6` | 1.1 | `--ink` |
| h1 übrige Seiten | Lilita One | `--fs-5` | 1.1 | `--ink` |
| h2 | Lilita One | `--fs-4` | 1.15 | `--ink` |
| h3 | Atkinson 700 | `--fs-3` | 1.3 | `--ink` |
| Fließtext | Atkinson 400 | `--fs-2` | 1.5 | `--ink` |
| Hinweis, Quelle, Fußzeile | Atkinson 400 | `--fs-1` | 1.4 | `--muted` |
| Wort auf der Wortkarte | Atkinson 700 | `--fs-6` | 1.1 | `--field-text` |
| Frage, Antwortfeld, Satzbau-Kachel | Atkinson 700 | `--fs-3` | 1.3 | `--ink` |
| Knopf normal / groß | Lilita One | `--fs-2` / `--fs-3` | 1.2 | je Variante |
| Knopf-Unterzeile | Atkinson 700 | `--fs-1` | 1.3 | je Variante |
| Zahl auf Feld oder Spielstein | Lilita One | `--fs-4` | 1 | je Feld |
| Tab-Beschriftung | Atkinson 700 | `--fs-1` | 1.2 | `--on-field` / aktiv `--gold` |

- Laufweite: Lilita One `0.01em`, Atkinson `0`. Keine Großbuchstaben-Sperrsatz-Etiketten.
- Linksbündig; zentriert nur Rückmeldung in der Auswertung (Kronen) und Leerzustände.
- Zeilenlänge für Fließtext höchstens 65 Zeichen (`--measure: 65ch`). Ziffern in Spalten: `tabular-nums`.

## 4. Abstände – 8-px-Raster

| Token | Wert | Einsatz |
|---|---|---|
| `--sp-half` | 4px | **Ausnahme:** Abstand Symbol↔Text, Innenabstand von Zählern und Tags, Pinyin unter dem Zeichen |
| `--sp-1` | 8px | eng: Knöpfe in einer Reihe, Antwortfelder untereinander (Handy) |
| `--sp-2` | 16px | Standard: Seitenrand Handy, Abstand zwischen Komponenten, Kartenpadding Handy |
| `--sp-3` | 24px | Kartenpadding ab Tablet, Seitenrand Tablet, Abstand Überschrift↔Inhalt |
| `--sp-4` | 32px | Abstand zwischen Abschnitten (Handy), Seitenrand Desktop |
| `--sp-6` | 48px | Abstand zwischen Abschnitten (ab Tablet) |
| `--sp-8` | 64px | Abstand vor der Fußzeile, große Leerzustände |

Begründete Ausnahmen (keine Abstände, deshalb nicht im Raster): Rahmenstärken 2/3 px, die Kante 4 px (= halber
Rasterschritt), Schriftgrößen und Zeilenhöhen, die Safe-Area-Ränder des iPhones (`env(safe-area-inset-*)`).
Komponentenmaße liegen ebenfalls im Raster: Knopfhöhe 48/56, Kopfleiste 56, Tab-Leiste 64, Feld 56 (48),
Spielstein 64. Abstände zwischen Geschwistern immer per `gap` in Flex/Grid, nicht per Einzel-Margins.

## 5. Radius

- **Primärer Radius `--radius: 12px`** für alles mit Fläche: Karten, Knöpfe, Felder, Eingaben, Antwortfelder,
  Hinweise, Dialoge, Brett.
- Ausnahmen, und nur diese:
  1. `--radius-s: 8px` für Elemente unter 32 px Höhe (Tags, Tastenhinweise, Fortschrittsbalken, Zähler mit Text).
  2. `--radius-round: 50%` nur für runde Spielteile: Spielsteine, Figur, Kronen-Plakette, Symbol in der Rückmeldung.
     Zähler mit Zahl (Tab, Badge) sind Rechtecke mit `--radius-s`, damit zweistellige Zahlen nicht zur Pille werden.
  3. `0` für Leisten über die volle Breite (Kopf- und Tab-Leiste) und Kanten, die am Bildschirmrand anliegen.
- Keine Pillen (`999px`) für Knöpfe, Navigation oder Etiketten.

## 6. Rahmen, Kanten, Schatten, Verläufe, Texturen, Hintergründe

- **Rahmen:** Karten haben keinen Rahmen. `--border: 2px solid var(--line)` nur für drückbare Flächen in Ruhe
  (Antwortfelder, Satzbau-Kacheln, Sekundärknöpfe). Formularfelder `2px solid var(--line-strong)`.
  `--border-strong: 3px` nur für Fokusring, Auswahl (immer `--field`) und Spielsteine (`--table`).
  Gestrichelt nur für leere Ablageflächen (Antwortzeile beim Satzbau).
- **Kante (das einzige Tiefenmittel):** `--edge: 0 4px 0 <Kantenfarbe>` – harte Unterkante ohne Unschärfe, nur auf
  drückbaren Elementen (Knöpfe, Antwortfelder, Kacheln, offene Felder). Beim Drücken: `translateY(4px)` und Kante 0.
  Kantenfarben: `--gold-edge`, `--field-edge`, `--line`.
- **Schwebe-Schatten:** `--float: 0 8px 24px color-mix(in srgb, var(--table) 30%, transparent)` nur für wirklich
  schwebende Elemente: Update-Hinweis, Dialog. Nie auf ruhenden Karten. Kein Element hat Kante und Schwebe-Schatten
  zugleich.
- **Verläufe:** keine – weder Hintergrund noch Knopf, Balken oder Text. Einzige Ausnahme: der Tagesziel-Ring als
  Datenanzeige (`conic-gradient` mit harter Grenze, kein Farbübergang).
- **Texturen und Muster:** keine (keine Streifen, Punkte, Rauschen, Blobs, dekorative Formen).
- **Hintergründe:** `body` flach `--board`, Kopf- und Tab-Leiste flach `--table`. Keine fixierten Hintergrundbilder.
- **Text-Schatten und Konturen:** keine, auch nicht auf Überschriften oder der Wortmarke.
- **Seitliche Akzentbalken** (dicker farbiger Rand links an Karten oder Hinweisen): keine.

## 7. Bilder, Illustrationen, Icons

- **Fotos:** keine. Es gibt keine eigenen, und Stockfotos passen nicht zur Spielbrett-Welt.
- **Illustrationen:** eigene SVGs in flacher Grafiksprache aus Spielteilen (Brett, Felder, Figur, Truhe, Krone,
  Karten). Nur Token-Farben, keine Verläufe, keine Konturen, keine Schatten. Formate: Bühnen-Illustration 4:3, kleine
  Illustration 1:1 (96 oder 128 px). Liegen in `assets/` und nutzen `currentColor` oder CSS-Variablen, damit der
  Dunkelmodus greift.
- **Bildausschnitt:** Das Brett wird immer als Ausschnitt um die eigene Figur gezeigt (aktuelle Einheit plus
  Nachbarn), nie als winziges Gesamtbrett mit Hunderten Feldern.
- **Icons:** ein eigenes Set (`icon()` in `src/app.js`): `viewBox 0 0 24 24`, gefüllt, `fill: currentColor`, Größen nur
  über `--icon-s` (20 px), `--icon-m` (24 px) und `--icon-l` (32 px; Felder, Figur, Kronen). Jedes Icon steht neben Text oder hat ein `aria-label`; dekorative Icons `aria-hidden`. Keine Emoji,
  keine Icons als Schmuck vor jeder Überschrift. Gestrichen werden Symbole mit fremder Spiel-Anmutung (Schild als
  Rang, Schwert).
- **Dateiformate:** SVG für alle Grafiken, PNG nur für App-Icons (180, 192, 512, maskable), WOFF2/TTF für Schriften.
  Jedes `<img>` mit `width`/`height`, `alt` (leer, wenn dekorativ).

## 8. Komponenten

### 8.1 Knöpfe

| Variante | Fläche | Text | Rahmen | Kante | Einsatz |
|---|---|---|---|---|---|
| Primär | `--gold` | `--on-accent` | – | `--gold-edge` | die eine Hauptaktion: „Lektion starten“, „Prüfen“, „Weiter“ |
| Feld | `--field` | `--on-field` | – | `--field-edge` | zweitwichtigste Aktion, z. B. „Wiederholen“, Vorlesen |
| Sekundär | `--surface` | `--ink` | `--border` | `--line` | weitere Aktionen |
| Leise | keine | `--muted` → `--ink` beim Zeigen | – | – | „Überspringen“, „Später“, „Abbrechen“ |
| Gefahr | `--surface` | `--event-text` | 2px `--event` | – | Löschen/Zurücksetzen, immer mit Bestätigungsfeld |
| Symbolknopf | wie Feld oder Sekundär | Symbol 24 px | wie Variante | wie Variante | Schließen, Vorlesen; 48×48, `aria-label` Pflicht |

- Größen: **normal 48 px** (Lilita `--fs-2`), **groß 56 px** (Lilita `--fs-3`, Startseite und Lektion).
  Kompakt 40 px nur bei `@media (pointer: fine)` (Maus), sonst automatisch 48 px.
- Unterzeile (Kontext, z. B. „Ich, du und die ersten Wörter · Lektion 1“) in Atkinson 700 `--fs-1`.
- Zustände: Zeigen = Fläche 8 % heller (`color-mix` mit Weiß), Drücken = `translateY(4px)` ohne Kante,
  Fokus = `outline: 3px solid var(--ink)` mit 3 px Abstand (auf `--table`: `--gold`),
  Deaktiviert = Fläche `--line`, Text `--muted`, keine Kante, `cursor: not-allowed`, nie halbtransparentes Gold.
  Lädt = Text „Wird gespeichert …“ und `aria-busy`.
- Am Handy (unter 600 px) sind Primärknöpfe in Lektion und Startbereich volle Breite.

### 8.2 Formulare

- Textfeld/Auswahl: Höhe ≥ 48 px, `--surface`, Rahmen 2 px `--line-strong`, `--radius`, Text `--fs-2`. Fokus: Rahmen
  `--field` + Fokusring. Antwortfeld in der Lektion: Text `--fs-3`.
- Beschriftung über dem Feld (Atkinson 700 `--fs-2`), Hinweis darunter (`--fs-1`, `--muted`), Fehler darunter
  (`--fs-1`, 700, `--event-text`, mit Symbol) und Feld-Rahmen `--event`.
- Auswahl aus wenigen Optionen (Tagesziel): Wahlfelder 48 px, `--radius`, Sekundär-Optik; gewählt wie jede Auswahl
  (8.9): `--field-soft`, Rahmen 3 px `--field`, Kante `--field-edge`. Native Radio/Checkbox bleiben sichtbar (`accent-color: var(--field)`).
- Formularfehler oben als Hinweis „falsch“ (8.4), Fokus springt zum ersten Fehler.

### 8.3 Dialoge und Bestätigungen

- Keine Browser-Dialoge (`alert/confirm/prompt` sind verboten, CSP und Automatisierung).
- **Bestätigungsfeld (Standard):** erscheint direkt unter dem auslösenden Knopf, `--event-soft`, `--radius`, Padding
  `--sp-2`, Text in `--ink`, Aktionen Gefahr + Leise. Fokus springt ins Feld.
- **Dialog** (nur wenn ein Bestätigungsfeld nicht reicht): natives `<dialog>`, `--surface`, `--radius`, `--float`,
  höchstens 480 px breit, Titel h2, Fokus hinein und beim Schließen zurück, Esc schließt.
- **Update-Hinweis:** schwebende Leiste unten (über der Tab-Leiste), `--surface`, `--float`.
- **Aufklapp-Anleitung** (Seite „Wortweg als App“, Abschnitt „Andere Geräte“): `<details>` in einer Karte, Zusammenfassung
  48 px hoch in Atkinson 700 mit Chevron rechts (dreht sich beim Öffnen wie bei den Abschnitten im Lernpfad), darin eine
  nummerierte Liste. Begründung: Vier Geräte-Anleitungen untereinander wären am Handy mehrere Bildschirme lang; die
  Anleitung für das eigene Gerät steht offen darüber.

### 8.4 Karten und Flächen

| Variante | Fläche | Besonderheit |
|---|---|---|
| Karte | `--surface` | `--radius`, Padding `--sp-2` (Handy) / `--sp-3`, kein Rahmen, kein Schatten |
| Wortkarte | `--surface` | Wort in `--fs-6`, Bedeutung `--fs-4`, Beispielsatz in einem `--field-soft`-Block, Vorlese-Symbolknöpfe rechts |
| Regel-/Ereigniskarte | `--event-soft` | Titel „Regel“ mit Glühbirnen-Symbol auf `--event`, Text in `--ink` |
| Checkpoint-Karte | `--gold-soft` | Truhe (gesperrt: Schloss), Text, eine Aktion |
| Rückmeldung | `--gold-soft` (richtig) / `--event-soft` (falsch) | Symbol im Kreis + Lilita-Titel, Lösung, Erklärung, Beispiel, Primärknopf „Weiter“ |
| Hinweis | `--field-soft` (Info), `--gold-soft` (Erfolg), `--event-soft` (Problem) | Symbol + Text, kein Seitenbalken |
| Leerzustand | `--surface` | kleine Illustration 1:1, ein Satz, eine Aktion, zentriert |

### 8.5 Spielbrett (Lernpfad und Startseite)

- Eine **Reihe = eine Einheit**: Titel der Einheit (h3) und ihre Wörter (`--fs-1`, `--muted`) über der Reihe; die
  Reihen laufen abwechselnd von links nach rechts und zurück (Schlangenweg). Ein Abschnitt endet mit dem
  Checkpoint-Feld.
- Das Brett liegt auf `--table` (Spieltisch), Titel in `--on-field`, Wörter in `--table-muted`.
- Feld: `--field-size` 48 px unter 600 px, 56 px ab 600 px; Abstand `--field-gap` 8 px bzw. 16 px; Rand des Bretts
  `--board-gutter` 16 px (unter 360 px 8 px, ab 600 px 24 px). So passen fünf Felder (Regel + vier Lektionen) ab
  320 px in eine Reihe. Pfadlinie hinter den Feldern 8 px: zurückgelegter Weg `--gold`, offener Weg `--table-locked`.
- Feldzustände (jedes drückbare Feld trägt die Kante seiner Farbe, gesperrte keine):
  - *aktuell:* `--gold`, Kante `--gold-edge`, darauf die Figur (`--ink`); Link zur Lektion, Fokus beim Öffnen.
  - *geschafft:* `--field-bright` mit Krone in `--on-field`, Kante `--field-edge` (Lektion wiederholen).
  - *offen:* `--field-bright` mit Nummer in `--on-field`, Kante `--field-edge`.
  - *gesperrt:* `--table-locked` mit Nummer in `--table-muted`, keine Kante, nicht drückbar.
  - *Regel:* `--event` mit Glühbirne in `--on-accent`, Kante `--event-edge`; öffnet die Regelkarte der Einheit.
  - *Checkpoint:* doppelt so breit; erreichbar `--gold` mit Truhe und Kante `--gold-edge`, gesperrt wie
    „gesperrt“, bestanden `--field-bright` mit Krone und Kante `--field-edge`.
- Regeln öffnen sich als Ereigniskarte in einem Dialog (8.3), damit der Weg auf dem Brett nicht unterbrochen wird.
- Jedes Feld hat ein vollständiges `aria-label` („Einheit X, Lektion 2: gesperrt. Grund …“), das aktuelle Feld
  zusätzlich `aria-current="step"` und im Lernpfad den Fokus beim Öffnen.
- Mehr Felder, als in eine Reihe passen (Einheiten mit über 16 bzw. 20 Wörtern, z. B. aus dem Admin-Bereich): Die
  Reihe bricht um, kein Feld wird abgeschnitten. Die Weglinie zeigt dann nur die erste Zeile – bewusst in Kauf
  genommen, weil die mitgelieferten Kurse höchstens fünf Felder je Reihe haben.
- Startseite: der Primärknopf „Lektion starten“ bzw. „Weiterlernen“ steht direkt unter der Begrüßung (am Handy im
  ersten Bildschirm), darunter der Brett-Ausschnitt (vorige, aktuelle und nächste Einheit). „Wiederholungen fällig“
  (Knopf Variante Feld) steht bei den Spielsteinen.

### 8.6 Spielsteine (Werte)

Runde Steine 64 px (`--radius-round`), `--surface`, Rahmen 3 px `--ink` (`--table` wäre im Dunkelmodus unsichtbar), Zahl in Lilita `--fs-4`, Beschriftung
darunter (`--fs-1`, Atkinson 700). Höchstens vier nebeneinander: Serie (Flamme in `--flame`), XP heute
(Tagesziel-Ring), Stufe, Wörter. Ersetzen die Werte-Kacheln.

### 8.7 Fortschritt

- Balken: Höhe 16 px, `--radius-s`, Spur `--line`, Füllung `--gold` (Kurs, Abschnitt, Lektion), flach, ohne Rahmen
  und Streifen. Immer mit Text daneben („0 von 749 Lektionen“); bei 0 % ist nur die Spur sichtbar.
- Lektionszähler „3/10“ in Lilita `--fs-3`.

### 8.8 Navigation

- **Kopfleiste:** `--table`, Höhe 56 px, gleiche Innenbreite und gleicher Seitenrand wie der Inhalt, Wortmarke (Logo 32 px +
  „Wortweg“ in Lilita `--fs-4`, `--on-field`). Ab 600 px rechts die Textlinks (Atkinson 700 `--fs-2`, `--on-field`);
  aktiv: Text `--gold` und 4 px Goldbalken unten. Keine Pillen.
- **Tab-Leiste (unter 600 px):** fest unten, `--table`, Höhe 64 px plus Safe-Area, fünf gleich breite Tabs, Symbol
  24 px + Beschriftung `--fs-1` einzeilig ohne Trennstrich (bei Platzmangel ein kürzeres Wort, z. B. „Optionen“
  statt „Einstellungen“ – sichtbarer Text und zugänglicher Name bleiben gleich). Aktiv: Symbol und Text `--gold`,
  `aria-current="page"`. Unter 360 px heißt der Tab „Wiederholen“ kurz „Üben“ (76 px Wort in 64 px Tab).
  Zähler: `--event` mit Zahl in `--on-accent`, `--radius-s`. Höchstens fünf Tabs: der Admin-Link
  steht am Handy nicht in der Tab-Leiste, sondern oben auf der Seite „Optionen“.
- **In der Lektion:** keine Navigation; oben Schließen-Symbolknopf (Sekundär), Fortschrittsbalken, Zähler.
- **Fußzeile:** `--fs-1`, `--muted`, Links in `--field-text`; Inhalt: „Wortweg · freie Lern-App“, „Über, Datenschutz
  & Lizenzen“. Am Handy oberhalb der Tab-Leiste.
- Sprunglink „Zum Inhalt springen“ bleibt erstes Element.

### 8.9 Lektionsbausteine

- **Antwortfeld (Auswahl, Paare):** `--surface`, Rahmen 2 px `--line`, Kante `--line`, `--radius`, Höhe ≥ 56 px,
  Text Atkinson 700 `--fs-3`. Zustände: *ausgewählt* `--field-soft`, Rahmen 3 px `--field`, Kante `--field-edge`;
  *richtig* `--gold-soft`, Rahmen 2 px `--gold-edge`, Häkchen; *falsch* `--event-soft`, Rahmen 2 px `--event`, Kreuz;
  *zugeordnet* (Paare) wie richtig, nicht mehr drückbar. Tastenhinweis (1–4) nur bei `pointer: fine`, `--radius-s`.
- **Satzbau-Kachel:** wie Antwortfeld, Höhe 48 px, Breite nach Inhalt. In der Antwortzeile mit Rahmen `--field`.
  Antwortzeile: gestrichelter Rahmen 2 px `--line` (leere Ablagefläche), Mindesthöhe 80 px.
- **Lücke im Lückentext:** Unterstrich 4 px `--field`, Text `--field-text`.
- **Vorlesen:** Symbolknopf Variante Feld (48 × 48), mit Text „Anhören“ als großer Knopf; langsam = zweiter
  Symbolknopf. Vorlesen ist eine Hilfe, keine Hauptaktion: nie Gold.

## 9. Layout, Breakpoints, Touch

| Bereich | Breite | Seitenrand | Navigation | Inhalt |
|---|---|---|---|---|
| kompakt | < 360 px | `--sp-2` | Tab-Leiste | Feld 48 px, eine Spalte |
| Handy | 360–599 px | `--sp-2` | Tab-Leiste | eine Spalte |
| Tablet | 600–1023 px | `--sp-3` | Kopfleiste mit Links | `--content-max: 720px` |
| Desktop | ≥ 1024 px | `--sp-4` | Kopfleiste mit Links | `--content-max: 960px`; Startseite zweispaltig (Brett links, Spielsteine/„Als Nächstes“ rechts) |

- Media-Queries nutzen genau diese Werte (`360px`, `600px`, `1024px`); CSS-Variablen gehen in Media-Queries nicht.
- Kopfleiste und Inhalt nutzen beide `--content-max` und denselben Seitenrand, liegen also auf einer Kante.
- Lektion immer einspaltig, `--lesson-max: 720px`.
- Kein horizontales Scrollen ab 320 px. Höhen mit `100dvh`, nie `100vh`. Safe-Area über `env(safe-area-inset-*)`.
- **Touch:** jedes Bedienelement im Lernbereich mindestens 48 × 48 px, mindestens `--sp-1` Abstand zwischen
  Zielen, Hauptaktionen in der unteren Bildschirmhälfte erreichbar, nichts nur per Hover erreichbar,
  `touch-action: manipulation`, eigener `:active`-Zustand statt Tipp-Hervorhebung des Browsers.
- Tastatur: alle Aktionen per Tab erreichbar; Kurzbefehle (1–4, Enter) bleiben; Tastenhinweise nur bei
  `pointer: fine`.

## 10. Bewegung

| Token | Wert | Einsatz |
|---|---|---|
| `--dur-1` | 120ms | Drücken, Zeigen, Farbwechsel |
| `--dur-2` | 240ms | Erscheinen von Rückmeldung, Karte, Bestätigungsfeld; Richtig-Puls, Falsch-Wackeln |
| `--dur-3` | 480ms | Signatur: Figur hüpft ein Feld weiter; Karte dreht sich um; Kronen erscheinen |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | alles außer Hüpfen |
| `--ease-hop` | `cubic-bezier(.34, 1.56, .64, 1)` | nur Figur-Hüpfer und Kronen |

- Nur `transform` und `opacity` werden animiert. Seitenwechsel ohne Animation.
- **Die Signatur:** Nach einer abgeschlossenen Lektion hüpft die Figur auf dem Brett ins nächste Feld, und der Weg
  dahinter färbt sich gold. Daneben gibt es nur Konfetti als Belohnung (siehe unten).
- Falsch-Wackeln höchstens ±6 px.
- Konfetti (ausdrücklicher Wunsch des Nutzers: „Konfetti und Effekte“): ein kleiner Ausbruch bei einer richtigen
  Antwort, ein größerer bei der Auswertung mit Kronen, beim bestandenen Checkpoint und am Kursende; höchstens 1,2 s,
  nur in den Kernfarben (`--gold`, `--field`, `--event`, Weiß). Der Tipp-Ring bleibt, ohne Leuchten.
- Keine Endlos-Animationen (kein Pulsieren, Wackeln, Schweben); erlaubt sind nur Ladekreisel und der
  Aufnahme-Punkt beim Sprechen (Statusanzeigen).
- **Bewegung reduzieren:** Bei `prefers-reduced-motion: reduce` oder der Einstellung „Animationen reduzieren“
  (Klasse `.reduce-motion`) entfallen alle Animationen und Übergänge, auch Konfetti und Hüpfer; Zustände wechseln
  sofort und bleiben vollständig sichtbar. Töne sind eine eigene Einstellung und davon unabhängig.

## 11. Texte, Überschriften, CTAs

- Deutsch, Du-Form, kurze aktive Sätze. Sachlich-freundlich, kein Hype („revolutionär“, „Entfessle …“, „nahtlos“).
- **Überschriften:** höchstens zwei Zeilen bei 390 px – h1 höchstens 32 Zeichen, h2 höchstens 40. Sie sagen, was
  hier ist („Lernpfad · Spanisch“, „Noch keine Statistik“), keine Etiketten mit Doppelpunkt davor, kein farbiges
  oder kursives Einzelwort.
- **CTAs:** Verb (+ Objekt), höchstens drei Wörter, nennen, was passiert: „Lektion starten“, „Weiterlernen“,
  „Checkpoint machen“, „Prüfen“, „Weiter“, „Kurs wählen“. Kontext gehört in die Unterzeile, nicht in den Knopftext.
  Kein „Hier klicken“, kein „Jetzt loslegen!“.
- **Spielwörter nur für Spielteile:** Brett, Feld, Figur, Krone, Truhe, Spielstein. Handlungen heißen klar
  („Lektion starten“, nicht „Zug machen“).
- Begriffe einheitlich: Kurs → Abschnitt → Einheit → Lektion; Checkpoint; Wiederholen; Stufe; XP; Serie.
- Rückmeldung: „Richtig!“ / „Noch nicht ganz.“, dann Lösung und Erklärung. Fehlermeldungen sagen, was passiert ist
  und was man tun kann, ohne Entschuldigung. Nie Strafe, Verlust oder Druck („Du verlierst …“).
- Ausrufezeichen nur bei „Richtig!“, Begrüßung und geschafften Zielen. Keine Emoji.
- Zahlen als Ziffern mit Tausenderpunkt („2.959 Wörter“). Einheiten ausgeschrieben; Ausnahmen sind „Min“ und „XP“
  auf Feldern, Spielsteinen und Knopf-Unterzeilen.
- Quellenangaben (Tatoeba, Lizenzen) bleiben sichtbar, klein (`--fs-1`).

## 12. Verbote

Nicht erlaubt, weil generisch, austauschbar oder gegen diese Richtung:

1. Farbverläufe jeder Art (lila-blaue Heros, Glanzknöpfe, Verlaufstext) – Ausnahme nur der Tagesziel-Ring (6).
2. Glas-Effekte, Hintergrund-Unschärfe, schwebende Pillen-Navigation.
3. Weiche Schlagschatten auf ruhenden Karten, Leuchten (Glow), Text-Schatten, Glanzkanten (`inset` Weiß).
4. Kleine gesperrte Großbuchstaben-Etiketten und „Kicker“/Pillen-Abzeichen über Überschriften.
5. Drei (oder mehr) gleiche Karten mit Symbol oben; Reihen identischer Kennzahl-Kacheln.
6. Emoji als Symbole oder Abschnittsmarken; Monospace-Schrift außerhalb von Code.
7. Deko-Nummerierung (01/02/03). Nummern nur, wo sie Information sind (Feldnummer, Abschnitt, Fach).
8. Seitliche farbige Akzentbalken an Karten und Hinweisen.
9. Streifen-, Punkt- und Rauschmuster, Blobs, Deko-Formen, fixierte Hintergründe.
10. Pillenförmige Knöpfe, Pillen-Navigation, `999px`-Radien.
11. Endlos-Animationen zur Dekoration.
12. Austauschbare SaaS-Texte und Hype-Wörter.
13. Fremde Spiel- und App-Anmutung: Schilde mit Schwertern, Arena-Embleme, Liga- und Ranglisten, Maskottchen,
    Herzen/Energie, Truhen-Countdowns, Druck-Benachrichtigungen.
14. Mehr als eine goldene Hauptaktion pro Ansicht.

## 13. Referenz

**Brilliant** – <https://brilliant.org/>. Als Inspiration dienen genau diese Eigenschaften:

1. Das Spielgefühl entsteht aus **anfassbaren, direkt bedienbaren Aufgaben**, nicht aus Effekten.
   → Bei uns: Felder, Figur, Karten zum Umdrehen, die Kante beim Drücken.
2. Eine **einheitliche, flache Illustrationssprache** über alle Kurse.
   → Bei uns: Spielteile in den fünf Farben, eine Formensprache für alle Kurse.
3. Der Fortschritt ist ein **sichtbarer Weg aus einzelnen Stationen**.
   → Bei uns: das Brett mit Feldern und der Figur.
4. Ein **erwachsener, ruhiger Ton** trotz kräftiger Farben.
   → Bei uns: sachliche Texte, keine Kinder-Optik, keine Druck-Mechaniken.

Nicht übernommen werden Farben, Illustrationen, Layouts, Namen oder Texte von Brilliant, ebenso wenig Abo-Modell,
Bezahlschranken und Serien-Druck. Die Eigenschaften beruhen auf der allgemein bekannten Gestaltung von Brilliant
und wurden am 22.10.2026 nicht neu auf der Website nachgeprüft.

## 14. Umstellung: Abweichungen im früheren Code

Diese Punkte widersprachen dem System. Punkte 1–9 sind am 22.10.2026 umgesetzt (Prototyp `prototypes/start.html`,
danach App), Punkt 10 nur teilweise (der Admin-Bereich nutzt die neuen Tokens und Komponenten, wurde aber nicht im
Browser geprüft):

1. **Tokens und Schrift:** fünf Kern-Tokens und Ableitungen in `styles.css`, alte Namen als Aliase;
   Atkinson Hyperlegible Next lokal einbinden; Lerninhalte von Lilita/System auf Atkinson.
2. **Flächen:** alle Verläufe (Kopfleiste, Arena, Willkommen, Knöpfe, Balken, Abschnittsköpfe, Checkpoint,
   Regel- und Wortkarte, Diagramm), Streifenhintergrund, Text-Schatten, weiche Schatten, Glanzkanten und die
   Pillen-Abzeichen über Überschriften („Als Nächstes“, „Neues Wort 1 von 4“ → normaler Text) entfernen;
   Radien 13/14/16/18/20/24/999 px auf 12/8/50 % vereinheitlichen; Seitenbalken an Hinweisen und Beispielen entfernen.
3. **Knöpfe und Zustände:** Varianten nach 8.1; Deaktiviert ohne trübes Gold; leere Balken nach 8.7.
4. **Startseite:** „Arena“-Kasten → Brett-Ausschnitt + ein Primärknopf; „Weitermachen“-Karte und Starten-Knopf zu
   einer Aktion zusammenlegen; Werte-Kacheln → Spielsteine; Rang-Schild → Spielstein „Stufe“.
5. **Lernpfad:** Pillen-Raster und Abschnittsbalken → Spielbrett (8.5).
6. **Willkommensseite:** Etikett „FREIE SPRACHLERN-APP“ und drei Symbol-Karten entfernen; Brett mit Figur auf
   „Start“; Überschrift höchstens zwei Zeilen.
7. **Lektion:** Rückmeldung „richtig“ von Grün auf Gold-zart; Großbuchstaben-Etiketten („BEISPIEL“, „SO BENUTZT MAN
   ES“, Paare-Spaltenköpfe) in Satzschreibung; Endlos-Animationen (Puls, Wackeln, Schweben) entfernen.
8. **Navigation:** Kopfleiste und Inhalt gleich breit; Tab-Beschriftungen einzeilig; aktiver Tab ohne Pille.
9. **Kleinkram:** `100vh` → `100dvh`; Schwert- und Schild-Symbol ersetzen; Kurswahl mit nur einem Primärknopf
   (aktiver bzw. empfohlener Kurs), die anderen Sekundär.
10. **Admin-Bereich** folgt zuletzt (gleiche Komponenten, kompakte Knöpfe bei Maus erlaubt).

## 15. Widerspruchsprüfung

Geprüft am 22.10.2026; jeder scheinbare Konflikt hat genau eine Auflösung:

| Regel A | Regel B | Auflösung |
|---|---|---|
| Keine Schatten (6) | Kante auf Knöpfen (6) | Die Kante ist eine harte Unterkante ohne Unschärfe und nur für drückbare Elemente; der Schwebe-Schatten nur für Schwebendes. Kein Element hat beides. |
| Keine Pillen (5, 12) | runde Spielsteine und Zähler (5) | Kreise (50 %) nur für runde Spielteile; Pillen (`999px`) gibt es nicht. |
| Höchstens eine goldene Hauptaktion (2.3, 12) | Gold für aktuelles Feld, Kronen, „richtig“ (2.3) | Die Regel gilt für Knöpfe. Felder und Kronen sind Spielteile, „richtig“ nutzt `--gold-soft`, keine Vollfläche. |
| 8-px-Raster (4) | 2/3-px-Rahmen, 4-px-Kante, 13-px-Schrift | Rahmen, Kanten und Schrift sind keine Abstände; einzige Abstands-Ausnahme ist `--sp-half` (4 px). |
| Touch mindestens 48 px (9) | kompakte 40-px-Knöpfe (8.1) | Kompakt nur bei `pointer: fine`; bei Touch automatisch 48 px. |
| Mindestens 13 px (3.2) | Pinyin 0,8 em | Pinyin `max(var(--fs-1), 0.8em)`. |
| Genau fünf Farben (2.1) | Zustands- und Hilfsfarben | Alle abgeleitet (2.2); Weiß und Schwarz nur Mischpartner. Bewusst kein eigenes Grün. |
| Keine Verläufe (6, 12) | Tagesziel-Ring | Datenanzeige mit harter Grenze, einzige Ausnahme, ausdrücklich genannt. |
| `--ink` wird im Dunkelmodus hell | dunkle Schrift auf Gold | Text auf Gold/Koralle ist `--on-accent`, in beiden Modi dunkel. |
| Lilita für Titel (3.1) | lange Titel, Lerninhalte | Lerninhalte nie in Lilita; Titel höchstens 32/40 Zeichen (11). |
| Signatur-Bewegung (10) | Bewegung reduzieren (10) | Die Figur steht ohne Animation sofort auf dem neuen Feld. |
| Keine Endlos-Animation (10, 12) | Ladekreisel, Aufnahme-Punkt | Statusanzeigen sind erlaubt, Dekoration nicht. |
| Keine Einzelwerte (0) | alte Farbnamen im Admin | Aliase zeigen auf Tokens und bekommen keine eigenen Werte (2.3). |
| Gestrichelt (6) | „keine Deko-Linien“ | Gestrichelt nur für leere Ablageflächen mit Funktion. |
| Auswahl in `--field` (6, 8.2, 8.9) | „richtig“ in Gold (2.3) | Auswahl heißt „angetippt, noch nicht geprüft“ und ist immer blau; Gold kommt erst mit der Prüfung. |
| Gleiche Breite Kopf/Inhalt (9) | Lektion 720 px (9) | In der Lektion gibt es keine Kopfleiste, nur die Lektionsleiste in derselben Breite wie die Lektion. |
| Design-Prüfskripte ohne Kanten/Kreise | dieses Dokument | Dieses Dokument geht vor; Prüfwerkzeuge liefern Messwerte, keine Regeln. |

Ergebnis: keine offenen Widersprüche.

## 16. Hilfswerkzeuge (Skills)

Skills liefern **Vorschläge und Messwerte, keine Regeln**. Jeder Vorschlag wird gegen dieses Dokument, das Projekt und
echte Bildschirmfotos (390 × 844 und 1440 × 900, hell und dunkel) geprüft; bei Widerspruch gilt dieses Dokument.

| Aufgabe | Werkzeug | Nutzen | Nicht übernehmen |
|---|---|---|---|
| Visuelles Design, generische Muster erkennen | `design-taste-frontend` (taste-skill, installiert) | `scripts/inspect.mjs` misst Zeilenumbrüche von Überschriften, Schriftgrößen, Kontrast, Überlauf, Ränder; `scripts/lint.mjs` findet Verläufe, Eyebrows, Monospace | Hausregeln „keine Schatten“, „Knöpfe eckig oder ganz rund“, „mindestens vier Fotos“, „mindestens acht bewegte Elemente“ – widersprechen §5, §6, §7, §10. Arbeitsdateien nur im Scratchpad, nie `.taste-skill/` im Projekt |
| Texte, Nutzenversprechen | `copywriting`, `copy-editing` (marketingskills, installiert) | Klarheit vor Witz, Nutzen statt Funktionen, belegbare Aussagen, keine KI-Floskeln – passt zu §11 | Konversions- und Druckmittel (Knappheit, Dringlichkeit, Paywalls, Tracking, Pop-ups) – widersprechen §1.5 |
| Designkritik, Qualitätssicherung | eigene Prüfskripte (CDP-Screenshots, Lektion durchspielen), `design:design-critique`, `design:accessibility-review` | Kritik an echten Screenshots, Barrierefreiheit | – |
| (nicht installiert) | `impeccable` | Detektor mit 61 Regeln, `critique`/`audit` | nur nach Zustimmung des Nutzers; `bounce easing`-Regel widerspricht `--ease-hop` (§10), `/impeccable document` würde `DESIGN.md` neu erzeugen – nie überschreiben lassen |

Nicht verwenden: `high-end-visual-design` (weicher Kontrast, „Apple/Linear“-Anmutung, Feder-Animationen –
widerspricht dem Spielbrett) und die übrigen Marketing-Skills für Werbung, Tracking, Preise und Paywalls.

## 17. Änderungsprotokoll

| Datum | Änderung |
|---|---|
| 22.10.2026 | Erste Fassung: Richtung C „Spielbrett“ beschlossen; Design-Audit und die drei Richtungen siehe Gesprächsverlauf vom 22.10.2026. |
| 22.10.2026 | Nach Code-Review: Literal-Regel (0.1) präzisiert, Symbolgrößen als Tokens (7), Zähler mit `--radius-s` (5), Spielstein-Rand `--ink` (8.6), Reihen brechen um statt abzuschneiden, Fokus/`aria-current` am aktuellen Feld (8.5), „Üben“ unter 360 px (8.8), `color-mix`-Rückfall für ältere Browser. |
| 22.10.2026 | Navigation (8.8): höchstens fünf Tabs; Admin-Link am Handy in „Optionen“ (mit sechs Tabs liefen die Beschriftungen ineinander, gesehen im Screenshot 390 px). |
| 22.10.2026 | Hilfswerkzeuge (16): welche Skills wofür, was davon nicht gilt. |
| 22.10.2026 | Schrift (3.1): Pinyin in der Systemschrift (`--font-reading`), weil Atkinson Hyperlegible Next die Tonzeichen ǎ ǐ ǒ ǔ ǚ nicht enthält (im Browser gemessen). |
| 22.10.2026 | Bewegung (10): Konfetti wieder bei richtigen Antworten und am Lektionsende erlaubt – der Nutzer hatte sich ausdrücklich Konfetti und Effekte gewünscht; die erste Fassung hatte das zu streng begrenzt. |
| 22.10.2026 | Startseite (8.5): Primärknopf über dem Brett statt darunter – im Prototyp lag er bei 390 × 844 unter dem ersten Bildschirm. |
| 23.10.2026 | Dialoge (8.3): Aufklapp-Anleitung für die Seite „Wortweg als App“ (Installieren auf Windows, Mac, iPhone, Android; Aufnahmen offline laden). Sonst nur vorhandene Komponenten (Karte, Primärknopf nur, wenn der Browser direkt installieren kann; „Aufnahmen laden“ als Feld-Knopf, Fortschrittsbalken). |
| 22.10.2026 | Brett (8.5): drei abgeleitete Tokens `--field-bright`, `--table-muted`, `--table-locked`, weil `--field` auf `--table` nur 2,6:1 erreicht; Feldgröße 48 px unter 600 px (statt unter 360 px), damit Regel-Einheiten mit fünf Feldern ab 320 px passen; Regeln als Dialog statt aufklappbar im Brett. |
