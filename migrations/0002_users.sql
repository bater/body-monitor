-- Multi-user support: users table, per-user scoping, per-user settings.
-- Existing rows keep user_id NULL ("orphan") until the owner's first login
-- claims them (see src/auth.ts).
--
-- NOTE: remote D1 runs each statement in its own transaction, so no statement
-- may leave FK constraints violated. The exercises rebuild (UNIQUE(name) →
-- UNIQUE(user_id, name)) therefore detaches workout_entries into an FK-free
-- backup first, rebuilds the parent, then restores the child.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,          -- lowercased Cloudflare Access email
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE food_logs ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE inbody_records ADD COLUMN user_id INTEGER REFERENCES users(id);

-- 1. detach workout_entries (FK-free backup), so the parent can be rebuilt
CREATE TABLE workout_entries_backup (
  id INTEGER,
  date TEXT NOT NULL,
  exercise_id INTEGER NOT NULL,
  weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL,
  sets INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO workout_entries_backup (id, date, exercise_id, weight_kg, reps, sets, note, created_at)
  SELECT id, date, exercise_id, weight_kg, reps, sets, note, created_at FROM workout_entries;
DROP TABLE workout_entries;

-- 2. rebuild exercises with per-user uniqueness, preserving ids
CREATE TABLE exercises_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  muscle_group TEXT,
  UNIQUE(user_id, name)
);
INSERT INTO exercises_new (id, user_id, name, muscle_group)
  SELECT id, NULL, name, muscle_group FROM exercises;
DROP TABLE exercises;
ALTER TABLE exercises_new RENAME TO exercises;

-- 3. restore workout_entries with FK + user_id
CREATE TABLE workout_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL,
  sets INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id)
);
INSERT INTO workout_entries (id, date, exercise_id, weight_kg, reps, sets, note, created_at)
  SELECT id, date, exercise_id, weight_kg, reps, sets, note, created_at FROM workout_entries_backup;
DROP TABLE workout_entries_backup;

CREATE TABLE user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX idx_food_logs_user_date ON food_logs(user_id, date);
CREATE INDEX idx_workout_entries_date ON workout_entries(date);
CREATE INDEX idx_workout_entries_user_date ON workout_entries(user_id, date);
CREATE INDEX idx_workout_entries_user_ex ON workout_entries(user_id, exercise_id, date);
CREATE INDEX idx_inbody_records_user_date ON inbody_records(user_id, date);
CREATE INDEX idx_exercises_user ON exercises(user_id);
