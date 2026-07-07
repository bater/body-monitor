-- Body Monitor initial schema

CREATE TABLE food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                -- YYYY-MM-DD (local day the food was eaten)
  raw_text TEXT NOT NULL DEFAULT '', -- what the user typed, '' for manual entries
  items_json TEXT NOT NULL,          -- [{name, qty, protein_g, kcal}]
  protein_g REAL NOT NULL,
  calories REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_food_logs_date ON food_logs(date);

CREATE TABLE exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,         -- e.g. 臥推
  muscle_group TEXT                  -- e.g. 胸
);

CREATE TABLE workout_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                -- YYYY-MM-DD
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  weight_kg REAL NOT NULL,
  reps INTEGER NOT NULL,
  sets INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workout_entries_date ON workout_entries(date);
CREATE INDEX idx_workout_entries_exercise ON workout_entries(exercise_id, date);

CREATE TABLE inbody_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                -- YYYY-MM-DD of the scan
  weight_kg REAL NOT NULL,
  skeletal_muscle_mass_kg REAL,
  body_fat_percent REAL,
  body_fat_mass_kg REAL,
  bmi REAL,
  visceral_fat_level REAL,
  bmr_kcal REAL,
  source TEXT NOT NULL CHECK(source IN ('photo','manual','import')),
  photo_key TEXT,                    -- R2 object key of the original report photo
  raw_json TEXT,                     -- full AI extraction / import payload
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inbody_records_date ON inbody_records(date);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('protein_target_g', '120');

-- Starter exercise catalog (user can add more in-app)
INSERT INTO exercises (name, muscle_group) VALUES
  ('臥推', '胸'),
  ('深蹲', '腿'),
  ('硬舉', '背'),
  ('肩推', '肩'),
  ('引體向上', '背'),
  ('划船', '背'),
  ('二頭彎舉', '手臂'),
  ('三頭下壓', '手臂');
