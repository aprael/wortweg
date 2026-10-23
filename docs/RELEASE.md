## Wortweg 0.5.0

Freie Sprachlern-App – ohne Werbung, ohne Bezahlschranke, ohne Tracking.

### Herunterladen

- **Windows:** `Wortweg-Windows.exe` herunterladen und starten. Windows warnt beim ersten Mal („Der Computer wurde durch
  Windows geschützt“), weil Wortweg kein gekauftes Zertifikat hat: **„Weitere Informationen“ → „Trotzdem ausführen“**.
  Die Installation braucht keine Adminrechte.
- **Mac (Apple-Chip und Intel):** `Wortweg-Mac.dmg` öffnen und Wortweg in den Ordner „Programme“ ziehen. Beim ersten
  Start meldet der Mac, dass Apple Wortweg nicht prüfen konnte: „Fertig“ klicken, dann **Systemeinstellungen →
  Datenschutz & Sicherheit → „Dennoch öffnen“**.
- **iPhone, iPad, Android:** <https://aprael.github.io/wortweg/> im Browser öffnen → „Zum Home-Bildschirm“ (Safari) bzw.
  „App installieren“ (Chrome). Die Seite „Als App installieren“ in der App erklärt jeden Schritt.
- **App-Version als ZIP** (`wortweg-app-v0.5.0.zip`): dieselbe Offline-App zum Selbst-Hosten über einen Webserver.
- **Server-Version:** Quellcode herunterladen, Node.js 24 installieren, `npm start`.

### Neu in 0.5

- **Echte Aussprache:** Wörter und Sätze werden mit Aufnahmen echter Menschen vorgelesen (Wikimedia Commons, Lingua
  Libre, Tatoeba) statt mit einer Computerstimme. Die Seite „Aufnahmen“ nennt alle Sprecherinnen und Sprecher. Wo
  es noch keine Aufnahme gibt, bleibt die App still – die Computerstimme lässt sich in den Optionen als Ersatz einschalten.
- **Als eigenes Programm** für Windows und Mac, ohne Browser und auch offline, mit allen Kursen und Aufnahmen.
- **Installierbar** auf iPhone, iPad und Android; „Aufnahmen laden“ speichert die Aussprache für unterwegs.
- **Neues Design „Spielbrett“:** Lernpfad und Startseite als Spielbrett mit Figur, Regeln als Ereigniskarte, ruhige
  Farben, gut lesbare Schrift (Atkinson Hyperlegible Next), eine Hauptaktion pro Ansicht.
- **Beispielsätze zu fast allen Wörtern:** Spanisch zu allen 2.959 Wörtern, Chinesisch zu 2.238 von 2.243.
- Spanisch erkennt „hay“, „es“, „vale“, „fuera“ und „por la mañana“ jetzt richtig.

### Hinweise

- Die Kursinhalte sind aus offenen Quellen zusammengestellt bzw. selbst geschrieben und **nicht muttersprachlich
  geprüft** – das gilt auch für die neuen eigenen Beispielsätze. Quellen und Lizenzen: `data/courses/PROVENIENZ.md`.
- Nicht jedes Wort hat schon eine Aufnahme, vor allem bei chinesischen Sätzen gibt es kaum freie Aufnahmen.
- Code: MIT. Datenkurse: CC BY-SA 4.0. Demo-Kurse: CC0. Aufnahmen: jeweils eigene freie Lizenz (siehe Seite
  „Aufnahmen“). Schriften Lilita One und Atkinson Hyperlegible Next: SIL OFL 1.1.
