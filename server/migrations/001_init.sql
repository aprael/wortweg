-- Wortweg 0.2: Inhalte, Konten, Fortschritt, Audit. Zeiten sind Millisekunden seit 1970 (UTC).

CREATE TABLE languages (
  code        TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 12),
  name        TEXT NOT NULL,
  native_name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE courses (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  subtitle    TEXT NOT NULL DEFAULT '',
  native_lang TEXT NOT NULL REFERENCES languages(code),
  target_lang TEXT NOT NULL REFERENCES languages(code),
  tts_lang    TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  demo        INTEGER NOT NULL DEFAULT 0,
  license     TEXT NOT NULL DEFAULT '',
  provenance  TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Abschnitt = "level" im Kursformat. slug ist unveränderlich (Checkpoint-Fortschritt hängt daran).
CREATE TABLE sections (
  pk        INTEGER PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  slug      TEXT NOT NULL,
  title     TEXT NOT NULL,
  position  INTEGER NOT NULL,
  UNIQUE (course_id, slug)
);

-- Einheit = "unit". slug ist unveränderlich (Lektions-IDs und Wiederholungen hängen daran).
CREATE TABLE units (
  pk          INTEGER PRIMARY KEY,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_pk  INTEGER NOT NULL REFERENCES sections(pk) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  UNIQUE (course_id, slug)
);
CREATE INDEX units_section ON units (section_pk, position);

-- Lernobjekt (Wort oder Satz). position ist je (unit_pk, kind) lückenlos 0..n-1 = Index im Kursformat.
CREATE TABLE items (
  pk       INTEGER PRIMARY KEY,
  unit_pk  INTEGER NOT NULL REFERENCES units(pk) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('w', 's')),
  position INTEGER NOT NULL,
  native   TEXT NOT NULL,
  target   TEXT NOT NULL,
  note     TEXT
);
CREATE INDEX items_unit ON items (unit_pk, kind, position);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner', 'admin')),
  is_guest      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Nur der SHA-256-Hash des Sitzungstokens wird gespeichert.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE learner_state (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_course_id TEXT,
  daily_goal       INTEGER NOT NULL DEFAULT 20,
  settings         TEXT NOT NULL DEFAULT '{}',
  xp_total         INTEGER NOT NULL DEFAULT 0,
  streak_current   INTEGER NOT NULL DEFAULT 0,
  streak_best      INTEGER NOT NULL DEFAULT 0,
  streak_last_day  TEXT,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE xp_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  xp      INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- course_id bewusst ohne Fremdschlüssel: Fortschritt bleibt erhalten, wenn ein Kurs neu importiert wird.
CREATE TABLE lesson_progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   TEXT NOT NULL,
  lesson_id   TEXT NOT NULL,
  completions INTEGER NOT NULL,
  best_score  REAL NOT NULL,
  last_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id, lesson_id)
);

CREATE TABLE checkpoint_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  TEXT NOT NULL,
  level_id   TEXT NOT NULL,
  passed     INTEGER NOT NULL,
  best_score REAL NOT NULL,
  attempts   INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id, level_id)
);

CREATE TABLE review_items (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  kind      TEXT NOT NULL,
  unit_id   TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  box       INTEGER NOT NULL,
  due       INTEGER,
  wrong     INTEGER NOT NULL,
  seen      INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id, kind, unit_id, idx)
);
CREATE INDEX review_items_unit ON review_items (course_id, unit_id, kind);

CREATE TABLE attempts (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id         TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('lesson', 'review', 'checkpoint')),
  target            TEXT NOT NULL,
  total             INTEGER NOT NULL,
  first_try_correct INTEGER NOT NULL,
  xp                INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE INDEX attempts_user ON attempts (user_id, created_at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
