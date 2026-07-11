import { Hono } from "hono";
import type { AppContext } from "../env";
import { runCoach, workoutContext, type Coach } from "../coach";

const workout = new Hono<AppContext>();

workout.get("/exercises", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(w.id) AS entry_count
     FROM exercises e LEFT JOIN workout_entries w ON w.exercise_id = e.id
     WHERE e.user_id = ?
     GROUP BY e.id ORDER BY e.muscle_group, e.name`
  )
    .bind(c.get("userId"))
    .all();
  return c.json(results);
});

workout.post("/exercises", async (c) => {
  const { name, muscle_group } = await c.req.json<{ name?: string; muscle_group?: string }>();
  if (!name?.trim()) return c.json({ error: "缺少動作名稱" }, 400);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM exercises WHERE user_id = ? AND name = ?"
  )
    .bind(c.get("userId"), name.trim())
    .first();
  if (existing) return c.json({ id: existing.id, existed: true });
  const res = await c.env.DB.prepare(
    "INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)"
  )
    .bind(c.get("userId"), name.trim(), muscle_group ?? null)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

workout.put("/exercises/:id", async (c) => {
  const { name, muscle_group } = await c.req.json<{ name?: string; muscle_group?: string | null }>();
  if (!name?.trim()) return c.json({ error: "缺少動作名稱" }, 400);
  const dup = await c.env.DB.prepare(
    "SELECT id FROM exercises WHERE user_id = ? AND name = ? AND id != ?"
  )
    .bind(c.get("userId"), name.trim(), c.req.param("id"))
    .first();
  if (dup) return c.json({ error: "已有同名動作" }, 409);
  await c.env.DB.prepare(
    "UPDATE exercises SET name = ?, muscle_group = ? WHERE id = ? AND user_id = ?"
  )
    .bind(name.trim(), muscle_group?.trim() || null, c.req.param("id"), c.get("userId"))
    .run();
  return c.json({ ok: true });
});

workout.delete("/exercises/:id", async (c) => {
  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM workout_entries WHERE exercise_id = ? AND user_id = ?"
  )
    .bind(c.req.param("id"), c.get("userId"))
    .first<{ n: number }>();
  if (used && used.n > 0) {
    return c.json({ error: `此動作已有 ${used.n} 筆訓練紀錄，無法刪除` }, 409);
  }
  await c.env.DB.prepare("DELETE FROM exercises WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("userId"))
    .run();
  return c.json({ ok: true });
});

// Most recent entry for an exercise — used to prefill the logging form
workout.get("/last/:exerciseId", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT weight_kg, reps, sets FROM workout_entries WHERE exercise_id = ? AND user_id = ? ORDER BY date DESC, id DESC LIMIT 1"
  )
    .bind(c.req.param("exerciseId"), c.get("userId"))
    .first();
  return c.json(row ?? null);
});

// Full per-exercise history for the exercise detail page
workout.get("/history/:exerciseId", async (c) => {
  const exercise = await c.env.DB.prepare(
    "SELECT id, name, muscle_group FROM exercises WHERE id = ? AND user_id = ?"
  )
    .bind(c.req.param("exerciseId"), c.get("userId"))
    .first();
  if (!exercise) return c.json({ error: "動作不存在" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id, date, weight_kg, reps, sets, note FROM workout_entries WHERE exercise_id = ? AND user_id = ? ORDER BY date DESC, id DESC"
  )
    .bind(c.req.param("exerciseId"), c.get("userId"))
    .all();
  return c.json({ exercise, entries: results });
});

// Per-exercise history for the progression chart: best (heaviest) set per day
workout.get("/progression/:exerciseId", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT date, MAX(weight_kg) AS weight_kg,
            SUM(weight_kg * reps * sets) AS volume
     FROM workout_entries WHERE exercise_id = ? AND user_id = ?
     GROUP BY date ORDER BY date`
  )
    .bind(c.req.param("exerciseId"), c.get("userId"))
    .all();
  return c.json(results);
});

// Most recent training day across all exercises — drives the "days since last
// workout" nudge on the workout page. Returns null when nothing is logged yet.
workout.get("/latest", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT MAX(date) AS date FROM workout_entries WHERE user_id = ?"
  )
    .bind(c.get("userId"))
    .first<{ date: string | null }>();
  return c.json({ date: row?.date ?? null });
});

workout.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to") ?? from;
  if (!from) return c.json({ error: "缺少 from 參數" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, e.name AS exercise_name, e.muscle_group
     FROM workout_entries w JOIN exercises e ON e.id = w.exercise_id
     WHERE w.user_id = ? AND w.date BETWEEN ? AND ? ORDER BY w.date DESC, w.id DESC`
  )
    .bind(c.get("userId"), from, to)
    .all();
  return c.json(results);
});

workout.post("/", async (c) => {
  const b = await c.req.json<{
    date?: string;
    exercise_id?: number;
    weight_kg?: number;
    reps?: number;
    sets?: number;
    note?: string;
  }>();
  if (!b.date || !b.exercise_id || b.weight_kg == null || !b.reps || !b.sets) {
    return c.json({ error: "缺少必要欄位（date, exercise_id, weight_kg, reps, sets）" }, 400);
  }
  const owns = await c.env.DB.prepare("SELECT id, name FROM exercises WHERE id = ? AND user_id = ?")
    .bind(b.exercise_id, c.get("userId"))
    .first<{ id: number; name: string }>();
  if (!owns) return c.json({ error: "動作不存在" }, 400);
  const res = await c.env.DB.prepare(
    "INSERT INTO workout_entries (user_id, date, exercise_id, weight_kg, reps, sets, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(c.get("userId"), b.date, b.exercise_id, b.weight_kg, b.reps, b.sets, b.note ?? null)
    .run();
  // tier-0 coach feedback; ?today= is the client's local day (absent for curl
  // → treat the record date as today). A coach failure never fails the save.
  let coach: Coach | null = null;
  try {
    const today = c.req.query("today") ?? b.date;
    coach = runCoach(
      await workoutContext(
        c.env.DB,
        c.get("userId"),
        {
          id: Number(res.meta.last_row_id),
          date: b.date,
          exercise_id: b.exercise_id,
          weight_kg: b.weight_kg,
          reps: b.reps,
          sets: b.sets,
          exercise_name: owns.name,
        },
        today
      )
    );
  } catch (e) {
    console.error("workout coach", e);
  }
  return c.json({ id: res.meta.last_row_id, coach }, 201);
});

workout.put("/:id", async (c) => {
  const b = await c.req.json<{
    date?: string;
    exercise_id?: number;
    weight_kg?: number;
    reps?: number;
    sets?: number;
    note?: string;
  }>();
  if (!b.date || !b.exercise_id || b.weight_kg == null || !b.reps || !b.sets) {
    return c.json({ error: "缺少必要欄位" }, 400);
  }
  await c.env.DB.prepare(
    "UPDATE workout_entries SET date = ?, exercise_id = ?, weight_kg = ?, reps = ?, sets = ?, note = ? WHERE id = ? AND user_id = ?"
  )
    .bind(b.date, b.exercise_id, b.weight_kg, b.reps, b.sets, b.note ?? null, c.req.param("id"), c.get("userId"))
    .run();
  return c.json({ ok: true });
});

workout.delete("/:id", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM workout_entries WHERE id = ? AND user_id = ?").bind(
      c.req.param("id"),
      c.get("userId")
    ),
    c.env.DB.prepare("DELETE FROM coach_feedback WHERE user_id = ? AND kind = 'workout' AND record_id = ?").bind(
      c.get("userId"),
      c.req.param("id")
    ),
  ]);
  return c.json({ ok: true });
});

export default workout;
