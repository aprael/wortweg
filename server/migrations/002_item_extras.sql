-- §9: Zusatzfelder für große Datenkurse und Chinesisch.
-- items.extra: JSON-Objekt mit optionalem reading, tokens, tags, source (siehe docs/ARCHITEKTUR.md §9.1).
-- courses.attribution: JSON-Liste der Quellen ({ name, url?, license, usage? }), courses.generated: 0/1.
ALTER TABLE items ADD COLUMN extra TEXT;
ALTER TABLE courses ADD COLUMN attribution TEXT;
ALTER TABLE courses ADD COLUMN generated INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO languages (code, name, native_name) VALUES ('zh', 'Chinesisch', '中文');

-- Mitgelieferte Kurse (data/courses): Inhalts-Hash und Kursversion nach dem Einspielen.
-- Ist die Version noch gleich, hat kein Admin den Kurs verändert und ein neuer Stand darf ihn ersetzen.
-- Ein Eintrag ohne Kurs heißt: von einem Admin gelöscht – nicht erneut einspielen.
CREATE TABLE bundled_courses (
  course_id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  seeded_at INTEGER NOT NULL
);
