# Herkunft der Kursinhalte

In diesem Ordner liegen zwei Arten von Kursen. Keiner wurde aus Duolingo, Lehrbüchern oder anderen Apps übernommen, und keiner ist muttersprachlich geprüft.

| Kurs | Art | Lizenz |
|---|---|---|
| `de-zh.json` – Chinesisch (HSK 1–3) | aus offenen Quellen zusammengestellt (`generated: true`) | CC BY-SA 4.0 |
| `de-es-wortschatz.json` – Spanisch – Wortschatz | aus offenen Quellen zusammengestellt (`generated: true`) | CC BY-SA 4.0 |
| `de-en.json`, `de-es.json`, `de-fr.json`, `de-it.json` | eigene, kurze Demo-Inhalte (`demo: true`) | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/deed.de) |

Die Datenkurse werden mit `scripts/build-course-zh.mjs` bzw. `scripts/build-course-es.mjs` aus den Quelldateien und den kuratierten Listen in `data/build/zh/` bzw. `data/build/es/` gebaut. Die Quelldateien selbst liegen nicht im Repository (`.cache/sources/`, siehe die Tabellen unten). Jede Quelle steht mit Lizenz auch im Kurs selbst (`attribution`), jeder Beispielsatz verlinkt seine Tatoeba-Seite (`source`).

Begriffe: Abschnitt = `level`, Einheit = `unit`, Lektion = je 4 Wörter einer Einheit.

## de-zh.json – Chinesisch (HSK 1–3)

- **Herkunft:** Automatisch zusammengestellt aus offenen Quellen mit `scripts/build-course-zh.mjs` (deterministisch: gleiche Eingaben ergeben dieselbe Datei). Die deutschen Bedeutungen aller Wörter hat eine KI-Assistenz im Auftrag des Projekts am 20.10.2026 von Hand geprüft und bereinigt (`data/build/zh/glossen.tsv`).
- **Lizenz des Kurses:** CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/deed.de). Grund: Die Bedeutungs-Kandidaten stammen teils aus HanDeDict (CC BY-SA 3.0) und Wiktionary (CC BY-SA 4.0). CC BY-SA 3.0 erlaubt die Weitergabe von Bearbeitungen unter einer späteren Version derselben Lizenz. Die Tatoeba-Sätze (CC BY 2.0 FR) und die MIT-Daten dürfen in ein CC-BY-SA-Werk übernommen werden.
- **Quellen:**

  | Quelle | URL | Lizenz | Verwendung |
  |---|---|---|---|
  | HSK 3.0 Wortliste (Pleco Inc., elkmovie/hsk30) | https://github.com/elkmovie/hsk30 | MIT | Wortschatz und Stufen HSK 3.0, Stufe 1–3 |
  | complete-hsk-vocabulary (drkameleon) | https://github.com/drkameleon/complete-hsk-vocabulary | MIT | Pinyin, Häufigkeitsrang, Stufe im alten HSK 2.0. Die englischen Bedeutungen (aus CC-CEDICT) werden **nicht** verwendet. |
  | HanDeDict (Zydeo) | https://handedict.zydeo.net/ | CC BY-SA 3.0 | Kandidaten für deutsche Bedeutungen |
  | Wiktionary (deutsch), via kaikki.org/Wiktextract | https://kaikki.org/dewiktionary/Chinesisch/ | CC BY-SA 4.0 | weitere Bedeutungs-Kandidaten |
  | Tatoeba | https://tatoeba.org/ | CC BY 2.0 FR | Beispielsätze Chinesisch–Deutsch, Pinyin-Umschriften zur Wahl der Lesung |

- **Verarbeitung:**
  - Wörter: alle Einträge der HSK-3.0-Liste, Stufe 1–3. Formvarianten aus der Liste („爸爸｜爸“, „有（一）些“) stehen als Alternativen in `target`. Zwei doppelte Listeneinträge (gleiches Wort, gleiche Bedeutung) sind zusammengeführt. Wörter mit gleicher Schrift, aber anderer Lesung oder Bedeutung (只 zhǐ „nur“ / zhī Zählwort, 还 hái / huán) bleiben getrennte Wörter.
  - Pinyin mit Tonzeichen aus der kuratierten Liste. Abgleich mit complete-hsk-vocabulary; zwei Abweichungen bei neutralen Tönen sind bewusst so belassen (不一会儿 bùyīhuìr, 这时候 zhèshíhou).
  - Lehrplan von leicht nach schwer (21.10.2026, `data/build/zh/lehrplan.json`; Thema je Wort in `data/build/zh/themen.tsv`, alle 2.243 Zuordnungen aus einer automatischen Vorsortierung von Hand korrigiert): je HSK-Stufe zuerst Themen-Einheiten (Erste Schritte, Kennenlernen, Alltag, Schule und unterwegs, Freizeit …, darin die häufigsten Wörter zuerst), dann Regel-Einheiten mit Erklärtext (`intro`): Zählwörter, Fragen, 会/能, 呢/吧, Vergleiche mit 比, 了/着/过/正在, 得, Bindewörter, Orte und Richtungen, 把 und 被. Zuletzt der übrige Wortschatz der Stufe. Ein Satz erscheint erst in der Einheit, in der sein letztes Wort gelernt wird – Sätze mit 了, 把 oder 被 also erst ab der passenden Regel. In einer Einheit haben keine zwei Wörter dieselbe Schrift oder dieselbe deutsche Hauptbedeutung.
  - Sätze: Tatoeba-Sätze Chinesisch–Deutsch in vereinfachter Schrift. Zerlegt werden sie per dynamischer Programmierung über den HSK-1–3-Wortschatz (wenige, häufige Wörter bevorzugt). Ein Satz kommt nur dann in eine Lektion, wenn alle seine Wörter bis dahin gelernt sind (i+1). Er hat 2–12 Wörter und höchstens 24 Zeichen. Weitere Tatoeba-Übersetzungen desselben deutschen Satzes werden als richtige Alternativen akzeptiert.
  - Lesung der Sätze: aus den Wort-Lesungen zusammengesetzt. Bei Zeichen mit mehreren Lesungen gelten zuerst feste Kontextregeln (只, 得, 了, 过), sonst die Tatoeba-Umschrift. Gleich gelesene Wörter mit verschiedener Bedeutung (会 „können“ / „Versammlung“) werden über die deutsche Übersetzung unterschieden.
  - Filter: Sätze mit Prüf-Markierungen (`@change`, `@check`, `@needs native check` …) und Tags wie `ambiguous` sowie Zitate von Politikern werden verworfen. Ebenso Sätze mit Gewalt, Tod, Sexualität, Beleidigungen, Drogen, Politik oder Religion (Wortliste in `data/build/zh/ausschluss.tsv`), mit traditionellen Zeichen, lateinischen Buchstaben oder Ziffern sowie Übersetzungen mit fremden Vornamen. Doppelte Sätze werden zusammengeführt.
  - Erklärungen (`note`): automatisch aus den Wörtern des Satzes („Wörter: 我 wǒ = ich · …“). Neue Wörter der Einheit haben Vorrang. Bei neuen Grammatikwörtern kommt ein kurzer Hinweis dazu.
- **Handprüfung der Sätze** (20./21.10.2026, KI-Assistenz im Auftrag des Projekts): Jeder Satz im Kurs und jeder Beispielsatz wurde gelesen (`data/build/zh/saetze-geprueft.txt`, 2.589 IDs). Ausgeschlossen wurden unter anderem Unsinn, falsche oder schiefe Übersetzungen, falsche Lesungen (z. B. 得 als „de“ statt „děi“), falsch zerlegte Redewendungen und unpassende Inhalte (279 IDs in `ausschluss.tsv`). Der Kursbau meldet ungeprüfte Sätze (`--ungeprueft`); im aktuellen Stand sind es 0.
- **Beispielsätze (`examples`):** zu 2.238 von 2.243 Wörtern ein Satz mit Pinyin. 1.344 davon sind handgeprüfte Tatoeba-Sätze mit Link zur Tatoeba-Seite. 894 sind **eigene Sätze (Quelle „Wortweg“)** für Wörter, zu denen Tatoeba keinen passenden Satz hat (`data/build/zh/eigene-beispiele.tsv`): am 22.10.2026 von Claude geschrieben, von einer zweiten Claude-Instanz gegengelesen und vom Kursbau automatisch geprüft (das Wort kommt in der gemeinten Bedeutung vor; alle Wörter sind bis zum Ende der nächsten Einheit gelernt). Sie stehen unter der Lizenz des Kurses und sind **nicht muttersprachlich geprüft**. Ohne Beispiel bleiben 老 (Anrede vor Familiennamen, nur mit Eigennamen sinnvoll) und vier Wörter auf der Ausschlussliste (死, 血, 武器, 去世).
- **Eigene Übungssätze:** 5 Sätze in `data/build/zh/eigene-saetze.tsv` für Lektionen ohne passenden Tatoeba-Satz (erste Lektion, Zahlen-Lektionen 3 und 4), ebenfalls nicht muttersprachlich geprüft.
- **Umfang:** 18 Abschnitte (je HSK-Stufe Themen, Regeln, Wortschatz), 156 Einheiten, 577 Lektionen, 2.243 Wörter (HSK 1/2/3: 500/771/972), 1.887 Sätze (1.882 aus Tatoeba, 5 eigene), dazu 228 zusätzliche chinesische Alternativen. 1.489 der Wörter kommen in mindestens einem Satz vor. Dateigröße etwa 1,5 MB.
- **Herkunft der Bedeutungen:** Von 2.243 Hauptbedeutungen stimmen 931 wörtlich mit HanDeDict und 20 mit Wiktionary überein. Die übrigen 1.292 sind eigene Formulierungen (kürzer, lernfreundlicher oder zusammengefasst).
- **Bekannte Unsicherheiten:**
  - Die HSK-3.0-Liste ist per OCR erfasst und laut Herausgeber nicht vollständig korrekturgelesen.
  - Die deutschen Bedeutungen sind kurz und decken nicht jede Verwendung ab. Bei Funktionswörtern (的, 了, 把 …) beschreiben sie die Funktion statt einer Übersetzung.
  - Die Lesungen folgen dem Wörterbuch ohne Tonsandhi (不是 steht als „bù shì“, gesprochen „bú shì“). Bei einzelnen Mehrfachlesungen kann die automatische Wahl danebenliegen.
  - Die Satzzerlegung ist automatisch. Seltene Wörter außerhalb von HSK 1–3 werden manchmal in bekannte Teile zerlegt (美国 → 美 + 国).
  - Tatoeba-Übersetzungen sind von Freiwilligen. Einige sind frei oder umgangssprachlich übersetzt.
  - Rund 750 Wörter (meist seltene HSK-3-Wörter) kommen in keinem geprüften Satz vor und werden nur als Wort geübt; rund 900 Wörter haben deshalb keinen Beispielsatz.
  - Nicht muttersprachlich geprüft.

## de-es-wortschatz.json – Spanisch – Wortschatz

- **Herkunft:** Automatisch zusammengestellt aus offenen Quellen mit `scripts/build-course-es.mjs` (deterministisch: gleiche Eingaben ergeben dieselbe Datei). Die deutschen Bedeutungen der häufigsten rund 1.000 Lemmata hat eine KI-Assistenz im Auftrag des Projekts am 20./21.10.2026 von Hand geprüft und korrigiert (`data/build/es/glossen.tsv`). Die übrigen Bedeutungen sind regelbasiert ausgewählt.
- **Lizenz des Kurses:** CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/deed.de). Grund: Bedeutungen und Grundformen stammen aus Wiktionary (CC BY-SA 4.0) und WikDict (CC BY-SA 3.0, Weitergabe unter späterer Version erlaubt), die Häufigkeiten aus FrequencyWords (CC BY-SA 4.0). Die Tatoeba-Sätze (CC BY 2.0 FR) dürfen in ein CC-BY-SA-Werk übernommen werden. Der Autor jedes Satzes steht in `source.author`.
- **Quellen:**

  | Quelle | URL | Lizenz | Verwendung |
  |---|---|---|---|
  | FrequencyWords (Hermit Dave), aus OpenSubtitles | https://github.com/hermitdave/FrequencyWords | CC BY-SA 4.0 | Häufigkeit spanischer Wortformen (Reihenfolge) |
  | Wiktionary (englisch), via kaikki.org/Wiktextract | https://kaikki.org/dictionary/Spanish/ | CC BY-SA 4.0 | Wortform → Grundform, Wortart, Genus, Kennzeichnung vulgärer Wörter |
  | Wiktionary (deutsch), via kaikki.org/Wiktextract | https://kaikki.org/dewiktionary/Spanisch/ | CC BY-SA 4.0 | Kandidaten für deutsche Bedeutungen, Genus deutscher Nomen |
  | WikDict (aus Wiktionary/DBnary) | https://www.wikdict.com/ | CC BY-SA 3.0 | Kandidaten für deutsche Bedeutungen (mit Gewichten) |
  | Tatoeba | https://tatoeba.org/ | CC BY 2.0 FR | Beispielsätze Spanisch–Deutsch, Muttersprach-Angaben der Mitwirkenden |

- **Verarbeitung:**
  - Wörter: Die Häufigkeiten der Wortformen werden auf Grundformen (Lemmata) summiert. Mehrdeutige Formen werden nach Kontext und deutscher Übersetzung zugeordnet („fue“: war → ser, ging → ir). Für Sonderfälle gibt es eine feste Liste (`data/build/es/formen.tsv`). Eigennamen, vulgäre und abwertende Wörter (laut Wiktionary oder Liste) sind ausgeschlossen.
  - Ein Lemma kommt nur in den Kurs, wenn es eine brauchbare deutsche Bedeutung hat und in mindestens einem Satz vorkommt, der nur aus Kurswörtern besteht.
  - Nomen stehen einheitlich mit Artikel als Musterlösung und ohne Artikel als Alternative („la casa“ / „casa“, „das Haus“ / „Haus“). Monate stehen ohne Artikel.
  - Lehrplan von leicht nach schwer (`data/build/es/lehrplan.json`, Themen je Wort in `data/build/es/themen.tsv`, 3.247 Zuordnungen von Hand korrigiert): erst die wichtigsten kleinen Wörter, dann Themen (Kennenlernen, Alltag, Schule und Arbeit, Unterwegs, Freizeit und Gesundheit, Natur und Gefühle). Danach Regel-Abschnitte mit Erklärtext (`intro`): Präpositionen und Bindewörter, Vergangenheit (Perfekt, Indefinido regelmäßig/unregelmäßig, Imperfecto), Zukunft und Möglichkeitsform (Futur, Konditional, Subjuntivo). Zuletzt „Wortschatz erweitern“ nach Häufigkeit. Sätze mit einer Zeitform erscheinen erst ab der Regel-Einheit zu dieser Zeitform. In einer Einheit haben keine zwei Wörter dieselbe Form oder dieselbe deutsche Hauptbedeutung. Gleiche Hauptbedeutung in verschiedenen Einheiten (marido/esposo = Ehemann) wird beim Übersetzen gegenseitig akzeptiert.
  - Sätze: Tatoeba-Sätze Spanisch–Deutsch mit 2–12 Wörtern. Ein Satz kommt nur dann in eine Lektion, wenn alle seine Wörter bis dahin gelernt sind (i+1). Sätze von Mitwirkenden mit spanischer bzw. deutscher Muttersprache werden bevorzugt. Weitere spanische Übersetzungen desselben deutschen Satzes gelten als richtige Alternativen. Kein Satz kommt doppelt vor.
  - Filter: Satz-Tags wie `@change`, `@check`, `@needs native check`, vulgär, beleidigend, Gewalt, Drogen, Religion, Politik, Dialekt und veraltet. Außerdem eine Liste heikler Wörter in beiden Sprachen (Gewalt, Waffen, Blut, Krieg, Sexualität, Drogen, Beleidigungen, Religion; `data/build/es/heikel.tsv`) sowie unsaubere Zeichensetzung.
  - Erklärungen (`note`): automatisch aus den Wörtern des Satzes („tengo → tener = haben · hambre = der Hunger“). Neue Wörter der Einheit haben Vorrang. Für Artikel und Pronomen gibt es feste Texte (`data/build/es/formhinweise.tsv`).
  - Handprüfung der Sätze (20./21.10.2026, KI-Assistenz im Auftrag des Projekts): Jeder Satz im Kurs wurde gelesen. Behalten wurden nur verständliche, natürliche, lernenswerte und richtig übersetzte Sätze (`data/build/es/saetze-geprueft.txt`, 3.934 IDs). Unsinn, gestelzte oder falsche Übersetzungen, Du/Sie-Mischungen und Krimi-Sätze sind ausgeschlossen (`data/build/es/satz-ausschluss.txt`, 3.274 IDs). Der Kursbau meldet neue, noch ungeprüfte Sätze (`--ungeprueft`); im aktuellen Stand sind es 0.
  - Beispielsätze (`examples`): Zu jedem Wort zeigt die Wortkarte einen Satz, der das Wort im Zusammenhang zeigt. Tatoeba-Beispiele stammen nur aus den handgeprüften Sätzen, mit Link zur Tatoeba-Seite und Autor. 260 Beispiele sind **eigene Sätze (Quelle „Wortweg“)** aus `data/build/es/eigene-beispiele.tsv`: für Wörter ohne freien geprüften Tatoeba-Satz und als Ersatz in den ersten 13 Einheiten, wo das Tatoeba-Beispiel unbekannte Wörter, eine andere Bedeutung oder eine Redewendung zeigte. Am 22.10.2026 von Claude geschrieben, von einer zweiten Claude-Instanz gegengelesen und vom Kursbau automatisch geprüft (Wort in der gemeinten Bedeutung, Wortschatz und Zeitform bis zum Ende der nächsten Einheit bekannt); unter der Lizenz des Kurses, **nicht muttersprachlich geprüft**.
- **Umfang:** 16 Abschnitte, 197 Einheiten, 749 Lektionen, 2.851 Wörter (davon 963 mit von Hand geprüfter Bedeutung) plus 108 feste Regel-Wörter (Zeitformen, Präpositionen), 2.444 Sätze (alle aus Tatoeba, alle von Hand geprüft) und 2.959 Beispielsätze (2.699 aus Tatoeba, 260 eigene). 2.461 der Wörter kommen in mindestens einem Satz vor. Dateigröße etwa 1,9 MB.
- **Ausgelassen:** 76 Lemmata per Liste oder als vulgär, rund 12.900 ohne sichere deutsche Bedeutung, 634 Nomen ohne bekanntes Genus, 822 ohne passenden Satz; außerdem Wörter, deren Sätze fast nur Krimi, Kampf, Alkohol oder Religion zeigten (`heikel.tsv`).
- **Bekannte Unsicherheiten:**
  - Die Häufigkeit stammt aus Filmuntertiteln. Umgangssprache und Wörter aus Krimis sind daher häufiger als in Lehrbüchern.
  - Ab etwa Rang 1.000 sind die deutschen Bedeutungen automatisch gewählt. Sie können ungenau sein oder eine seltene Bedeutung zeigen.
  - Die Zuordnung mehrdeutiger Wortformen zu Grundformen ist automatisch und kann in einzelnen Sätzen danebenliegen.
  - Varietät gemischt: Tatoeba enthält Spanisch aus Spanien und Lateinamerika. Die Sprachausgabe nutzt `es-ES`.
  - Tatoeba-Übersetzungen sind von Freiwilligen. Einige sind frei oder umgangssprachlich übersetzt.
  - Nicht muttersprachlich geprüft.

# Eigene Demo-Kurse (CC0)

| | |
|---|---|
| Lizenz | CC0 1.0 (gemeinfrei) |
| Niveau | Einstieg (A1–B1) |
| Prüfstatus | **nicht muttersprachlich geprüft** |

## de-en.json – Englisch

- **Herkunft:** Erste Projektversion (17.10.2026), selbst verfasst durch KI-Assistenz im Auftrag des Projekts.
- **Umfang:** 3 Abschnitte (A1 · Einstieg, A2 · Aufbau, B1 · Selbstständig), 12 Einheiten, 36 Lektionen, 144 Wörter, 108 Sätze.

## de-es.json – Spanisch (Demo)

- **Herkunft:** Die Einheiten „Begrüßung“ und „Essen & Trinken“ stammen aus der ersten Projektversion. Am 20.10.2026 hat eine KI-Assistenz im Auftrag des Projekts den Kurs erweitert. Neu sind die Einheiten „Ich & du“, „Zahlen & Zeit“, „Familie“ und „Stadt & Wege“ sowie je ein zusätzlicher Satz am Ende der beiden alten Einheiten. Alles ist selbst verfasst.
- **Fortschritt bleibt gültig:** IDs und Reihenfolge der bisherigen Wörter und Sätze sind unverändert. Neue Einträge wurden nur angehängt. Der Untertitel lautet jetzt „(Demo)“ statt „(Mini-Demo)“.
- **Umfang:** 2 Abschnitte, 6 Einheiten, 12 Lektionen, 48 Wörter, 44 Sätze.
- **Varietät:** Spanisch aus Spanien (`es-ES`). Ein Beispiel ist die Aussprachehilfe zu „z“ in „diez“.
- **Bekannte Unsicherheiten:**
  - Für Wegbeschreibungen gibt es regionale Varianten. Hinterlegt sind „todo recto“, „recto“, „gira“ und „dobla“. „derecho“ (Lateinamerika) für „geradeaus“ ist nicht hinterlegt.
  - „Aprendo“ und „Estudio“ werden beide für „Ich lerne“ akzeptiert. Die Bedeutungen unterscheiden sich leicht (etwas lernen bzw. studieren/üben).
  - „Somos una gran familia“ und „Somos una familia grande“ unterscheiden sich leicht in der Nuance. Beide werden akzeptiert.
  - Die Aussprachehinweise sind grobe deutsche Umschreibungen und keine Lautschrift.

## de-fr.json – Französisch

- **Herkunft:** Am 20.10.2026 selbst verfasst durch KI-Assistenz im Auftrag des Projekts.
- **Umfang:** 2 Abschnitte, 6 Einheiten, 12 Lektionen, 48 Wörter, 46 Sätze.
- **Bekannte Unsicherheiten:**
  - Vor „?“ und „!“ steht nach französischer Typografie ein normales Leerzeichen und kein schmales geschütztes. Die Bewertung ignoriert Satzzeichen, das ist dort also egal.
  - Umgangssprachliche Alternativen wie „D'où tu viens ?“, „Tu es d'où ?“ und „Il est quelle heure ?“ werden akzeptiert. In formellen Texten wären sie unüblich.
  - „La gare n'est pas loin.“ (nicht weit) ist für „Der Bahnhof ist in der Nähe“ eine freie, aber gängige Alternative.
  - „soeur“ ohne Ligatur wird zusätzlich zu „sœur“ akzeptiert, weil „œ“ auf vielen Tastaturen fehlt.
  - „tu“ oder „vous“ ist nur dort beides hinterlegt, wo der deutsche Satz es offenlässt („bitte“, „Ja, bitte.“, „Einen Kaffee, bitte.“).
  - Die Aussprachehinweise (z. B. „mössjöh“, „fiss“, „wil“) sind grobe Umschreibungen.

## de-it.json – Italienisch

- **Herkunft:** Am 20.10.2026 selbst verfasst durch KI-Assistenz im Auftrag des Projekts.
- **Umfang:** 2 Abschnitte, 6 Einheiten, 12 Lektionen, 48 Wörter, 46 Sätze.
- **Bekannte Unsicherheiten:**
  - „La stazione è vicino.“ (adverbial) ist umgangssprachlich verbreitet. Die Musterlösung ist „è vicina“.
  - Folgende Alternativen sind akzeptiert, aber weniger üblich: „Parlo un po' italiano“ ohne „di“, „Sei uno studente?“ und „Va' dritto“ (Apostroph-Imperativ). Bei „dritto“ und „diritto“ schwankt der Gebrauch regional.
  - „Bevo acqua.“ und „Bevo dell'acqua.“ werden beide akzeptiert. Mit Teilungsartikel klingt es etwas natürlicher.
  - Der Hinweis „kein Artikel vor Familienmitgliedern im Singular“ gilt nicht bei Verkleinerungsformen, Plural oder „loro“. Das wird in der Notiz nicht erwähnt.
  - Die Aussprachehinweise (z. B. „djetschi“, „od-dschi“) sind grobe Umschreibungen.

## Allgemein (Demo-Kurse)

- Die Listen der Alternativen sind nicht vollständig. Richtige Übersetzungen, die nicht hinterlegt sind, werden als falsch bewertet (siehe README, „Umfang und Grenzen“).
- Die Abschnitts-IDs `a1` und `a1-alltag` sind nur innerhalb eines Kurses eindeutig. Wie bei de-es tragen sie kein Sprachpräfix. Die Einheits-IDs tragen das Sprachpräfix (`es-`, `fr-`, `it-`).
- Innerhalb jeder Einheit wurde per Skript geprüft, dass keine zwei Wörter dieselbe Zielform oder dieselbe deutsche Bedeutung haben (verglichen ohne Akzente).
- Vor einer Veröffentlichung als Lernmaterial sollten Muttersprachler die Inhalte prüfen.
