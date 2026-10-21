# Wortweg – Produktverhalten & Evidenz-Audit

Stand: **20.10.2026**. Zweck: festhalten, welche allgemeinen Produktmuster von Duolingo öffentlich belegt sind, wie
sicher das ist und was Wortweg daraus macht. Wortweg übernimmt **nur Muster** (Verhalten), keine Inhalte, Texte,
Namen, Grafiken, Audios, Maskottchen oder Optik.

## Methode

- **Heute (20.10.2026):** normale Seitenaufrufe per WebFetch und Websuche (WebSearch) auf öffentliche Quellen:
  offizieller Duolingo-Blog, SEC-Einreichungen (Aktionärsbriefe), ein wissenschaftliches Paper (ACL 2016), ein
  Konferenzbeitrag (ERI-GO 2025), Fachpresse. Das PDF des ACL-Papers wurde öffentlich abgerufen und nur lokal
  (Notizordner) zu Text umgewandelt, um Formel und Zahlen zu prüfen.
- **Frühere Beobachtungen (16.10.2026):** übernommen aus `~/lingua-path/research/observations.md`,
  `api-observations.md`, `limitations.md`, `feature-inventory.md`. Sie sind in der Tabelle als **frühere Beobachtung**
  markiert und wurden heute **nicht** wiederholt.
- Datumsangaben bei Blogposts sind das **Veröffentlichungsdatum laut Seite**. Manche Posts wurden offenbar später
  überarbeitet (z. B. erwähnt der Max-Post vom 14.03.2023 schon „unlimited energy“), deshalb gilt der heutige Abruf
  als Stand.
- Zusammenfassungen der Seiten kamen aus dem Abruf-Werkzeug; Zitate sind auf wenige Wörter begrenzt.
- Suchergebnis-Auszüge (Snippets) ohne erfolgreichen Seitenabruf zählen **nicht** als Beleg; sie stehen höchstens unter
  „Unbekannt“.

## Was bewusst nicht gemacht wurde

- **Kein Reverse Engineering von Duolingo.** Auf diesem Rechner liegt **kein autorisiertes Duolingo-App-Artefakt**
  (keine App, kein Bundle, keine Installation). Deshalb wurde REA **nicht** auf Duolingo angewendet. Die REA-Berichte
  unter `~/sprachlern-app/docs/rea/` betreffen nur eigene Projekte.
- Kein Login, kein Konto, kein Abo, kein Scraping, keine privaten/internen APIs, keine Browser-Daten, keine Analyse
  von App-Code oder Netzwerkverkehr (heute). Die API-Muster vom 16.10.2026 stammen aus der früheren Sitzung und werden
  von Wortweg **nicht** genutzt.
- Keine Lektionstexte, Audios oder Bilder kopiert. Die Duolingo-AGB (frühere Beobachtung, `limitations.md` §1) verbieten
  Reverse Engineering und Scraping; das Hilfe-Center wurde nur einmal normal aufgerufen.

## Abgerufene Quellen (20.10.2026)

| Kürzel | URL | Datum laut Seite | Abruf |
|---|---|---|---|
| Q1 | https://blog.duolingo.com/duolingo-101-how-to-learn-a-language-on-duolingo | 02.12.2024 | ok |
| Q2 | https://blog.duolingo.com/how-to-review-lessons-on-duolingo | 01.10.2026 | ok |
| Q3 | https://blog.duolingo.com/learning-with-hearing-aids/ | 20.01.2026 | ok |
| Q4 | https://blog.duolingo.com/ways-to-practice-in-duolingo | 16.12.2025 | ok |
| Q5 | https://blog.duolingo.com/guide-to-duolingo-practice-hub/ | 18.02.2026 | ok |
| Q6 | https://blog.duolingo.com/how-duolingo-works-with-learners/ | 04.04.2022 | ok |
| Q7 | https://blog.duolingo.com/new-duolingo-home-screen-design | 06.05.2022 (Start für alle: 01.11.2022) | ok |
| Q8 | https://blog.duolingo.com/how-duolingo-experts-work-with-ai | 14.09.2022 | ok |
| Q9 | https://blog.duolingo.com/how-user-reports-improve-course-content | 29.03.2022 | ok |
| Q10 | https://blog.duolingo.com/partial-credit-improvements-to-duolingos-placement-test/ | 14.09.2018 | ok |
| Q11 | https://blog.duolingo.com/how-we-learn-how-you-learn | 14.12.2016 | ok |
| Q12 | https://aclanthology.org/P16-1174/ und https://aclanthology.org/P16-1174.pdf | ACL 2016 | ok (PDF lokal zu Text) |
| Q13 | https://blog.duolingo.com/duolingo-energy/ | 03.07.2025 | ok |
| Q14 | https://www.sec.gov/Archives/edgar/data/1562088/000156208825000165/q2fy25duolingo6-30x25share.htm | Q2 2025 (ca. 06.08.2025) | ok |
| Q15 | https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm | 05.08.2026 | ok |
| Q16 | https://blog.duolingo.com/how-duolingo-streak-builds-habit | 31.01.2022 | ok |
| Q17 | https://blog.duolingo.com/improving-the-streak | 19.11.2020 | ok |
| Q18 | https://blog.duolingo.com/duolingo-leagues-leaderboards/ | 03.05.2023 | ok |
| Q19 | https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain | 07.10.2020 | ok |
| Q20 | https://blog.duolingo.com/covering-all-the-bases-duolingos-approach-to-listening-skills/ | 05.05.2026 | ok |
| Q21 | https://blog.duolingo.com/whats-the-best-way-to-learn-with-duolingo | 02.12.2025 | ok |
| Q22 | https://blog.duolingo.com/duolingo-max/ | 14.03.2023 (Inhalt später überarbeitet) | ok |
| Q23 | https://blog.duolingo.com/ending-honoring-our-volunteer-contributor-program-2/ | 10.03.2021 | ok |
| Q24 | https://www.maginative.com/article/duolingo-introduces-148-new-language-courses-built-with-ai/ | 30.04.2025 | ok (Fachpresse) |
| Q25 | https://sol.sbc.org.br/index.php/erigo/article/view/39529 | 04.12.2025 (ERI-GO 2025) | ok (nur Abstract) |
| Q26 | https://lingoly.io/duolingo-jump-here/ | 29.07.2026 | ok (Drittanbieter-Ratgeber, keine Primärquelle) |

**Fehlgeschlagene Abrufe (20.10.2026):**

| URL | Ergebnis |
|---|---|
| https://www.androidauthority.com/duolingo-undo-skip-speaking-button-3696590/ (auch ohne `www`) | HTTP 403 |
| https://investors.duolingo.com/news-releases/news-release-details/duolingo-launches-148-new-language-courses | HTTP 403 (ersatzweise Q24) |
| https://applevis.com/comment/150456 | HTTP 403 |
| https://support.duolingo.com/hc/en-us | 301 → https://www.duolingo.com/help; dort nur das Wort „Duolingo“ (Seite wird per JavaScript aufgebaut), **kein Hilfe-Center-Inhalt lesbar** |
| https://blog.duolingo.com/how-were-improving-learning-with-anonymized-speech-data (mit und ohne `/`) | HTTP 404 |

Frühere Quellen (16.10.2026, nicht heute abgerufen, nur aus `observations.md` O-09 übernommen):
`https://www.androidauthority.com/quitting-duolingo-energy-system-3599842/`,
`https://uxdesign.cc/duolingos-small-ui-switch-that-changes-everything-fae257203633`,
`https://github.com/duolingo/halflife-regression`, `https://proceedings.mlr.press/v339/ilidio26a.html`,
`https://www.duolingo.com/terms`.

## Evidenztabelle

Art: **direkt** = heute in öffentlicher Quelle gelesen · **früher** = frühere Beobachtung (16.10.2026,
lingua-path/research/…) · **Schluss** = Schlussfolgerung · **unbekannt**.
Konsequenz: **übernommen** (als allgemeines Muster) · **anders** (bewusst anders) · **eigen** (eigene Entscheidung).

### 1. Navigation / Lernpfad

| ID | Befund (eigene Worte) | Quelle | Datum | Art | Sicherheit | Konsequenz für Wortweg |
|---|---|---|---|---|---|---|
| E-01 | Seit Ende 2022 ersetzt ein **linearer Pfad** den früheren Fähigkeiten-Baum; Lektionen sind zu **Einheiten** gruppiert, Konzepte werden gemischt, Wiederholung ist in den Pfad eingebaut. Lernende kritisierten damals, nicht mehr frei wählen zu können (laut Fachpresse, nicht abgerufen). | Q7 | 06.05.2022 / abgerufen 20.10.2026 | direkt | hoch | **übernommen**: linearer Pfad Abschnitt → Einheit → Lektion. **eigen**: Option `unlockAll` gegen die Einschränkung der Wahlfreiheit. |
| E-02 | Kurse sind in **Abschnitte** gegliedert; ein Tipp auf das Einheiten-Etikett zeigt abgeschlossene, aktuelle und kommende Abschnitte; Abschnitte sind einem GER/CEFR-Niveau zugeordnet. | Q2 | 01.10.2026 | direkt | hoch | **übernommen** (Abschnitt = `level`). **eigen**: GER-Angabe nur, wenn Kursautor sie pflegt (kein Feld im Kursformat). |
| E-03 | Einheiten haben ein **Kommunikationsziel** und kurze Lektionen zu wenigen Wort-/Grammatikthemen. | Q1 | 02.12.2024 | direkt | hoch | **übernommen** (`unit.description`; Lektion = 4 Wörter). |
| E-04 | Abgeschlossene Lektionen lassen sich jederzeit **erneut** öffnen; die Kurz-Wiederholung eines abgeschlossenen Knotens bringt laut Bildunterschrift **5 XP**. | Q4, Q7, Q2 | 16.12.2025 | direkt | hoch | **übernommen**: abgeschlossene Lektionen bleiben frei und wiederholbar. **eigen**: eigene XP-Regeln (`applyLessonResult`). |
| E-05 | **Legendary**: nach einem Knoten wählbare, schwerere Variante **ohne Hinweise**, **40 XP**; danach gilt der Knoten als „gold“. Laut Q7 werden ganze Einheiten „Legendary“. | Q4, Q7 | 16.12.2025 / 06.05.2022 | direkt | hoch (Existenz), niedrig (aktuelle Bestehensregeln) | **anders**: in 0.2 nicht gebaut. Mögliche spätere eigene Variante „ohne Hilfen“ ohne Kosten. |
| E-06 | **Einstufung/Überspringen beim Start**: man wählt „von vorn“ oder einen Einstufungstest, der Einheiten überspringt; Einstufung ist **nicht rückgängig** zu machen, abgeschlossene Lektionen bleiben wiederholbar; danach sind Sprünge „eine Einheit nach der anderen“ möglich. | Q1 | 02.12.2024 | direkt | hoch | **eigen**: kein Einstufungstest in 0.2; stattdessen Checkpoint als freiwilliger Sprungtest pro Abschnitt, jederzeit wiederholbar und nichts ist endgültig. |
| E-07 | **„Jump here“ / Jump ahead**: Drittanbieter-Ratgeber beschreibt einen Test ohne Hinweise am Anfang einer Ziel-Einheit; bei Nichtbestehen beginnt man die Einheit von vorn. Keine offizielle Quelle zitiert. | Q26 | 29.07.2026 | direkt (Drittquelle) | niedrig | **eigen**: Wortweg-Checkpoint schaltet bei ≥ 80 % den ganzen Abschnitt frei; Fehlversuch kostet nichts. |
| E-08 | **Checkpoints / Abschnittstests** im heutigen Pfad: in keiner heute abgerufenen offiziellen Quelle beschrieben. | – | – | unbekannt | – | **eigen**: Checkpoint am Abschnittsende (Vertrag `buildCheckpoint`, `CHECKPOINT_PASS = 0.8`). |
| E-09 | Lektionen werden aus einem Pool möglicher Aufgaben **personalisiert** zusammengestellt (Modell „Birdbrain“ schätzt Schwierigkeit und Wissensstand; seit 03/2020, 10/2020 > 20 % der Lektionen). | Q19, Q8 | 07.10.2020 / 14.09.2022 | direkt | hoch (dass), unbekannt (wie heute) | **anders**: Wortweg baut Lektionen **deterministisch** aus Seed (Server prüft nach); keine Lernenden-Modellierung. |

### 2. Onboarding und Kurswahl

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-10 | Ablauf laut Blog: Sprache wählen → Fragen zu Zielen → Erinnerungen optional → Start von vorn oder Einstufung; ein **Profil** speichert Fortschritt geräteübergreifend. | Q1 | 02.12.2024 | direkt | hoch | **übernommen** (Kurswahl → Tagesziel → Start). **anders**: keine Erinnerungen/Push, keine Marketing-Fragen. |
| E-11 | Web-Onboarding: Startseite → Kurskacheln mit Lernendenzahlen → Begrüßung → Umfrage „How did you hear…“; beim Klick auf die Kurskachel wurde bereits serverseitig ein **Gast-Konto** angelegt. Beobachtung vor der Umfrage abgebrochen. | lingua-path/research/observations.md O-05, api-observations.md | 16.10.2026 | früher | hoch | **übernommen**: Gastkonto ohne E-Mail (`POST /api/auth/guest`), später umwandelbar. **anders**: Gast erst nach ausdrücklicher Wahl, keine Herkunftsumfrage, keine Attribution. |
| E-12 | Kurse sind **Sprachpaare** (Ausgangs- × Zielsprache) mit Reifegrad; öffentliche Kursliste mit 313 Paaren. | observations.md O-06 | 16.10.2026 | früher | hoch | **übernommen**: `nativeLang`/`targetLang`, Kursfilter nach beiden. |
| E-13 | Der Einstufungstest ist **adaptiv** (nächste Frage nach geschätztem Niveau); 2018 wurde Teilpunktvergabe nach Fehlerart erprobt. | Q10 | 14.09.2018 | direkt | hoch (2018), unbekannt (heute) | **eigen**: kein Einstufungstest in 0.2 (Roadmap). |
| E-14 | Tagesziel: 2020 als „Anzahl Lektionen pro Tag“ beschrieben. Heutige Stufen (XP oder Minuten) nur in Drittquellen, widersprüchlich. | Q17 | 19.11.2020 | direkt (2020) | mittel | **eigen**: Tagesziel in XP, optional, abschaltbar (Standard 20). |

### 3. Übungstypen

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-15 | Aufgaben u. a.: Wörter übersetzen, „antippen, was man hört“, passende Antwort sprechen; früh **Wiedererkennen**, später **Tippen**. | Q1 | 02.12.2024 | direkt | hoch | **übernommen**: Steigerung Auswahl → Satzbau → freie Eingabe. |
| E-16 | Aus Rohinhalten erzeugen Algorithmen die meisten Aufgaben: **Lückentext** (Lücke gezielt gesetzt), **Satzbau mit Wortbank** inkl. automatisch erzeugter Ablenker aus kürzlich gelernten Wörtern, **Hör-Unterscheidung** ähnlich klingender Wörter. | Q8 | 14.09.2022 | direkt | hoch | **übernommen** als Muster: Übungen werden aus Wörtern/Sätzen generiert (`exercises.js`), Ablenker aus demselben Kurs. |
| E-17 | Hörtypen: Paare per Lautsprecher zuordnen, fehlendes Wort hören und wählen oder tippen, „Tap what you hear“; **Schildkröten-Taste** für langsameres Abspielen, beliebig oft wiederholbar; Text erst sichtbar, später nur Audio. | Q20, Q3 | 05.05.2026 / 20.01.2026 | direkt | hoch | **übernommen**: `listen` mit Wiederholen. **eigen**: langsames Abspielen über TTS-Rate wäre einfach (offen, Frontend). |
| E-18 | **Paare zuordnen** existiert (Practice-Bereich „vocabulary matching“, Zeitspiel „Match Madness“ 20 XP). | Q4 | 16.12.2025 | direkt | hoch | **übernommen**: `match` ohne Zeitdruck. **anders**: keine Zeitrennen. |
| E-19 | Sprechübungen „Repeat what you hear“ mit „Reveal“ (Satz einblenden). Gesprochene Antworten wurden früher über Spracherkennung der Plattformanbieter bewertet (Snippet, Seite 404); KI bewertet u. a. gesprochene Antworten (Q8). | Q3, Q8 | 20.01.2026 / 14.09.2022 | direkt | mittel | **übernommen**: `speak` zeigt Zielsatz. **eigen**: standardmäßig **aus**, nur Opt-in (Browser-Spracherkennung kann Audio an Dritte senden). |
| E-20 | **„Can't listen now“** überspringt laut Blog alle Höraufgaben **der laufenden Lektion**; zusätzlich gibt es eine dauerhafte Einstellung „Listening exercises“. | Q3, Q20 | 20.01.2026 / 05.05.2026 | direkt | hoch | **übernommen**: „Kann gerade nicht hören/sprechen“ (`fallbackExercise`) + Einstellungen `listening`/`speaking`. Empfehlung: Wirkung für die laufende Lektion, ohne Zeitsperre. |
| E-21 | „Can't speak now“: **Dauer unbekannt**. Eine 15-Minuten-Pause und ein neuer Rückgängig-Knopf stehen nur in einem Suchergebnis-Auszug (Android Authority, 08/2026); Abruf 403. | – | – | unbekannt | niedrig | **eigen**: keine zeitgesteuerte Sperre; Lernende entscheiden je Aufgabe/Lektion. |

### 4. Feedback und Bewertung

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-22 | Ein Satz kann sehr viele **akzeptierte Übersetzungen** haben (Beispiel: 2.156); KI hilft, Varianten zu erzeugen, Redakteure ergänzen Alternativen. | Q9, Q8 | 29.03.2022 / 14.09.2022 | direkt | hoch | **übernommen**: `native[]`/`target[]` als Listen gültiger Varianten. |
| E-23 | Nach der Prüfung einer Aufgabe gibt es einen **Melden-Knopf** neben der Lösung; ca. 200.000 Meldungen/Tag, ca. 72 % „hätte akzeptiert werden sollen“; ML-Werkzeug priorisiert, ca. 15 % werden übernommen. | Q9 | 29.03.2022 | direkt | hoch | **eigen**: kein Melden in 0.2; Admin pflegt Varianten. Idee für später: lokales „Antwort vorschlagen“ an Admin ohne Tracking. |
| E-24 | Nach dem Prüfen wird die **Lösung** angezeigt (Melden-Knopf „neben der Lösung“). Sofortiges Richtig/Falsch je Aufgabe ist damit nahegelegt, aber in keiner heute abgerufenen Quelle ausdrücklich beschrieben. | Q9 | 29.03.2022 | Schluss | mittel | **übernommen**: sofortiges Feedback mit Lösung (`app.js`, `aria-live`). |
| E-25 | **Tippfehler-/Akzent-Toleranz**: in keiner heute abgerufenen offiziellen Quelle beschrieben; nur Foren/Wikis. | – | – | unbekannt | – | **eigen**: Akzente ignorierbar mit Hinweis, Tippfehler je Wort per Levenshtein, kurze Wörter exakt, Satzbau ohne Toleranz (`grading.js`). |
| E-26 | Am **Ende der Lektion** werden Fehler wiederholt („reviewing mistakes at the end of a lesson“ kostet keine Energie). | Q13 | 03.07.2025 | direkt | hoch | **übernommen**: falsche Aufgabe kommt einmal ans Ende der Warteschlange (`session.js`); XP nur für richtig im ersten Versuch. |
| E-27 | Erklärungen per KI zu Antworten („Explain My Answer“) und Rollenspiele mit Rückmeldung sind Teil des Abos Max. | Q22 | 14.03.2023 (überarbeitet) | direkt | mittel | **anders**: kein KI-Dienst; stattdessen Pflicht-`note` bei Sätzen als feste Erklärung. |

### 5. Fortschritt und Motivation

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-28 | **XP** gibt es für Lektionen, Stories, Übung, Zeitaufgaben und Boni. XP-Daten werden im Web **tageweise** abgefragt (`xp_summaries`). | Q1; observations.md O-07 | 02.12.2024; 16.10.2026 | direkt + früher | hoch | **übernommen**: `xpByDay`, XP serverseitig berechnet. **anders**: keine Boni/Zeitaufgaben. |
| E-29 | **Streak** = Folge von Tagen mit mindestens einer Lektion. Seit einem A/B-Test 2020 ist die Streak **vom Tagesziel entkoppelt** (eine Lektion reicht); Effekt u. a. +3,3 % Tag-14-Bindung. | Q1, Q17 | 02.12.2024 / 19.11.2020 | direkt | hoch | **übernommen**: Serie zählt jeden Lerntag unabhängig vom Ziel (`bumpStreak`). |
| E-30 | Die Streak nutzt bewusst **Verlustaversion**; der Blog räumt ein, dass ein Abbruch demotivieren kann. | Q16 | 31.01.2022 | direkt | hoch | **anders**: keine Verlust-Botschaften, keine Erinnerungen; Text „Pausen sind okay“. |
| E-31 | **Streak Freeze** schützt einen verpassten Tag, bis zu **zwei** gleichzeitig ausrüstbar, Kauf mit Gems (Bild: 400 Gems); Super erhält zusätzliche. | Q16, Q1 | 31.01.2022 / 02.12.2024 | direkt | hoch (2022), mittel (heute) | **anders**: kein Freeze, kein Shop. Serie ist reine Information ohne Strafe. |
| E-32 | Einmalige „Streak Revival“-Aktion im Juni 2026: längste Streak durch drei Lektionen wiederherstellbar, ca. 15,4 Mio. Nutzende. | Q15 | 05.08.2026 | direkt | hoch | **anders**: keine Aktionen; Bestwert (`streak.best`) bleibt ohnehin erhalten. |
| E-33 | **Herzen** (bis 2025): jeder Fehler kostet ein Herz, nach fünf Fehlern Übungslektion oder Gems; Abo unbegrenzt. | Q1 | 02.12.2024 | direkt | hoch | **anders**: nicht gebaut (nur dokumentiert). |
| E-34 | **Energie** ersetzt Herzen: Verbrauch pro Aufgabe unabhängig von richtig/falsch, Rückgewinn nach mehreren richtigen Antworten in Folge, Aufladen über Zeit, Werbung oder Gems; Fehlerwiederholung am Lektionsende kostet nichts. Am 03.07.2025 „kleine Gruppe“, im Q2-2025-Brief „auf iOS ausgerollt“. Heutiger Rollout-Stand **unbekannt** (Q2-2026-Brief erwähnt Energie nicht). | Q13, Q14, Q15 | 03.07.2025 / 06.08.2025 / 05.08.2026 | direkt | hoch (Mechanik), niedrig (Verbreitung 2026) | **anders**: keine Herzen/Energie, keine Lernlimits. |
| E-35 | **Ligen**: neue Woche jeden Sonntag (Ortszeit), 10 Ligen, oberste „Diamond“, Gruppen mit ähnlichen Lerngewohnheiten und Zeitzone, kursübergreifend; Turnier für Top 10; Austritt über „Profil öffentlich“ aus. Genaue Auf-/Abstiegsregeln nicht offiziell belegt. | Q18, Q1 | 03.05.2023 / 02.12.2024 | direkt | hoch | **anders**: keine Ligen, keine Ranglisten, keine öffentlichen Profile. |
| E-36 | Freie Nutzung soll laut Unternehmen ohne zusätzliche Hürden wachsen; längere Gratis-Testzeiträume; Video Call an Super gebunden. | Q15 | 05.08.2026 | direkt | hoch | **anders**: kein Abo, alles frei. |

### 6. Wiederholung

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-37 | **Half-Life Regression** (Settles & Meeder, ACL 2016): Abrufwahrscheinlichkeit p = 2^(−Δ/h), Halbwertszeit ĥ = 2^(Θ·x); Merkmale: Übungshistorie (Wurzel der Zählwerte) + Wortmerkmale; 12,9 Mio. Lernspuren aus zwei Wochen; MAE 0,128 vs. Leitner 0,235; Nutzerexperiment ~1 Mio. Lernende, 6 Wochen; Daten und Code veröffentlicht. | Q12, Q11 | 2016 | direkt | hoch | **eigen**: Wortweg nutzt bewusst das einfachere, nachvollziehbare **Leitner**-Verfahren (Intervalle 0/1/3/7/14/30 Tage, `progress.js`). HLR bräuchte Trainingsdaten, die wir nicht sammeln. |
| E-38 | Duolingo nutzte zum Start 2012 eine **Leitner-Variante**; Lernende beklagten, dass die Stärke-Anzeigen ihr Wissen nicht abbildeten. | Q12, Q11 | 2016 | direkt | hoch | **eigen**: Leitner ist für kleine eigene Kurse ausreichend; Fälligkeit wird transparent angezeigt. |
| E-39 | Jede Einheit hat **personalisierte Übungslektionen** aus fälligen Inhalten und eigenen Fehlern. | Q1 | 02.12.2024 | direkt | hoch | **übernommen**: `#/review` mit fälligen Lernobjekten, falsche Refs → Box 0. |
| E-40 | **Practice Hub/Practice-Tab**: Fehler, empfohlene Wörter, Sprechen, Hören, Stories. Zugang wechselte: 2022 Abo-Funktion (Q6), Ende 2025 für Super genannt (Q4), seit 18.02.2026 laut Blog **für alle kostenlos** auf iOS/Android. | Q5, Q4, Q6 | 18.02.2026 | direkt | hoch | **übernommen**: „Fehler üben“/Wiederholung frei für alle (`/api/stats` `hardItems`). |
| E-41 | Fehler werden im Web **pro Kurs gezählt**, filterbar nach Hör-/Sprechaufgaben (`v2/mistakes/…/count`). | api-observations.md | 16.10.2026 | früher | hoch | **übernommen** als Konzept: `review_items.wrong` je Lernobjekt. Endpunkt nicht genutzt. |

### 7. Barrierefreiheit

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-42 | Hilfen laut Blog: Audio beliebig wiederholen, langsames Abspielen, „Reveal“ bei Sprechaufgaben, DuoRadio „später“, Hören dauerhaft abschaltbar, Hören-Übung im Practice-Bereich; Schalter für Soundeffekte, Haptik, Animationen. Eine dauerhafte **Sprech**-Abschaltung beschreibt der Blog nicht. | Q3 | 20.01.2026 | direkt | hoch | **übernommen**: Hören/Sprechen abschaltbar, `reduceMotion`. **eigen**: Sprechen standardmäßig aus. |
| E-43 | Onboarding-Seite im Web: ARIA-Rollen `radiogroup`, `progressbar`, `alertdialog`; **keine `aria-live`-Region**; Viewport `user-scalable=no` (Zoom gesperrt). | observations.md O-08 | 16.10.2026 | früher | mittel | **anders**: Zoom erlaubt, `aria-live` für Feedback, Radiogruppen für Auswahl. |
| E-44 | Studie (WAVE, WCAG) zu einer Einstiegsaufgabe: vor allem **fehlende Alternativtexte** und **zu geringer Kontrast** interaktiver Elemente; Lücken bei Wahrnehmbarkeit und Robustheit. | Q25 | 04.12.2025 | direkt (nur Abstract) | mittel | **eigen**: keine bildabhängigen Aufgaben; Kontrast und Textalternativen im Frontend prüfen. |
| E-45 | Erfahrungsberichte blinder Nutzender (AppleVis, Mastodon) zu VoiceOver: weitgehend nutzbar, aber fehlende Bildbeschreibungen und Werbung, die man nicht verlassen kann. Nur über Suchergebnis-Auszüge; AppleVis-Abruf 403. | – | – | unbekannt | niedrig | **eigen**: keine Werbung; Bildschirmleser-Test mit VoiceOver als offene Aufgabe. |

### 8. Kursautorenschaft / Administration

| ID | Befund | Quelle | Datum | Art | Sicherheit | Konsequenz |
|---|---|---|---|---|---|---|
| E-46 | **Incubator**: internes Werkzeug seit 2012, ab 2013 für Freiwilligen-Teams geöffnet (über 1.000 Freiwillige, u. a. Navajo, Hawaiisch, Walisisch, Irisch). Am 10.03.2021 Ende der freiwilligen Kurserstellung angekündigt; Inhalte werden seitdem bezahlt erstellt. | Q23 | 10.03.2021 | direkt | hoch | **übernommen** als Muster: eigener Admin-Bereich für Kurse (`/api/admin/*`). **eigen**: Inhalte CC0. |
| E-47 | Kurserstellung in **vier Stufen**: Curriculum (vorwiegend Menschen, GER-orientiert) → Rohinhalte (Menschen mit KI-Hilfe) → Aufgaben (vorwiegend Algorithmen) → Personalisierung (vorwiegend KI). | Q8 | 14.09.2022 | direkt | hoch | **übernommen**: Admin pflegt Rohinhalte (Wörter/Sätze/Hinweise), Aufgaben werden automatisch erzeugt; Vorschau je Einheit (`/preview`). **anders**: keine KI, keine Personalisierung. |
| E-48 | Am 30.04.2025 **148 neue Kurse** angekündigt, mit generativer KI „erstellt und validiert“; Ansatz „shared content“ (ein Basiskurs, in viele Sprachpaare angepasst); im Januar 2024 rund 10 % der Auftragnehmer abgebaut. | Q24 (Pressemitteilung selbst: 403) | 30.04.2025 | direkt (Fachpresse) | mittel | **anders**: keine KI-Kurserzeugung. **eigen**: Import/Export als JSON und Validierung vor dem Veröffentlichen. |
| E-49 | Meldungen von Lernenden landen in einem Backend, wo Mitarbeitende Varianten ergänzen; Meldezahlen je Kurs/Abschnitt zeigen schwierige Konzepte. | Q9 | 29.03.2022 | direkt | hoch | **eigen**: `GET /api/stats` zeigt Lernenden ihre schweren Wörter; Admin-Auswertung über alle Lernenden ist nicht vorgesehen (Datensparsamkeit). |
| E-50 | Heutige interne Autorenwerkzeuge, Freigabeprozesse, Qualitätsprüfung der KI-Kurse im Detail. | – | – | unbekannt | – | **eigen**: Status `draft/published`, `validateCourse`, `audit_log`, Versionsnummer. |

## Unbekannt / nicht verifizierbar

- **Duolingo-Hilfe-Center**: nicht lesbar (Weiterleitung auf eine per JavaScript aufgebaute Seite). Alles, was nur dort
  steht, ist hier offen.
- **„Can't speak now“**: Dauer (15 Minuten?) und Rückgängig-Knopf nur aus Suchergebnis-Auszug; Seite 403 (E-21).
- **Dauer von „Can't listen now“** über die laufende Lektion hinaus: nicht beschrieben.
- **Tippfehler- und Akzent-Toleranz** und genaue Bewertungsregeln (E-25); Sprechbewertung (Schwellen, Phonem-Ebene).
- **Checkpoints/Abschnittstests** im heutigen Pfad, Regeln von „Jump here“ (Fragenanzahl, Bestehensgrenze) und
  aktuelle Legendary-Regeln (E-05, E-07, E-08).
- **Tagesziel**: heutige Stufen (XP oder Minuten), Auswahl im Onboarding (E-14).
- **Energie-Rollout 2026**: Anteil der Nutzenden, Plattformen, Wert der Energieeinheiten (E-34).
- Aufstiegs-/Abstiegszahlen der Ligen (E-35).
- Wie Birdbrain bzw. das Wiederholungsmodell **heute** arbeitet (HLR noch im Einsatz?) (E-09, E-37).
- Bildschirmleser-Unterstützung der aktuellen Apps (E-45); Inhalt des Beitrags zu anonymisierten Sprachdaten (404).
- Lektionsablauf, Aufgaben-UI und Session-Abschluss wurden auch früher **nicht direkt beobachtet**
  (`limitations.md` §2).

## Bewusste Abweichungen

| Duolingo-Muster | Wortweg | Grund |
|---|---|---|
| Herzen bzw. Energie (E-33, E-34) | gibt es nicht | keine künstlichen Lernlimits, Fehler dürfen nichts kosten |
| Abo (Super/Max), Gratis-Tests, Werbung, Gems, Shop (E-36, E-31) | gibt es nicht | freie App, keine Bezahlfunktionen |
| Ligen, Ranglisten, öffentliche Profile, Turniere (E-35) | gibt es nicht | kein sozialer Druck, Datensparsamkeit |
| Streak Freeze, Verlust-Botschaften, Push-Erinnerungen (E-30, E-31) | Serie nur als Information, keine Strafe | keine Verlustaversion als Hebel |
| Tracking, Attribution, Drittanbieter-Skripte, Cookie-Banner (frühere Beobachtung O-02, api-observations) | nichts davon; CSP `default-src 'self'` | Datenschutz |
| Herkunftsumfrage im Onboarding (E-11) | entfällt | nicht nötig zum Lernen |
| Personalisierte Lektionen per ML (E-09) | deterministische Lektionen aus Seed | Server kann prüfen, nachvollziehbar, keine Profilbildung |
| HLR-Wiederholung (E-37) | Leitner mit festen Intervallen | einfach, transparent, ohne Trainingsdaten |
| KI-Erklärungen, KI-Kurserstellung (E-27, E-48) | feste Hinweise (`note`), menschlich gepflegte CC0-Kurse | kein externer Dienst, keine Datenweitergabe |
| Einstufung endgültig (E-06), Jump-Test mit Rücksetzung (E-07) | Checkpoint jederzeit wiederholbar, Fehlversuch folgenlos | keine Strafen |
| Zoom gesperrt im Web (E-43) | Zoom erlaubt | Barrierefreiheit |
| Sprechaufgaben im Lernfluss (Standard bei Duolingo: unbekannt) | Sprechen standardmäßig aus (Opt-in) | Browser-Spracherkennung kann Audio an Dritte senden |
| Zeitrennen (Match Madness, Side Quest; E-18) | kein Zeitdruck | ruhiges Lernen, Barrierefreiheit |
