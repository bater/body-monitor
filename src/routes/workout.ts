import { Hono } from "hono";
import type { AppContext } from "../env";

const workout = new Hono<AppContext>();

workout.get("/exercises", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM exercises ORDER BY muscle_group, name"
  ).all();
  return c.json(results);
});

workout.post("/exercises", async (c) => {
  const { name, muscle_group } = await c.req.json<{ name?: string; muscle_group?: string }>();
  if (!name?.trim()) return c.json({ error: "缺少動作名稱" }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM exercises WHERE name = ?")
    .bind(name.trim())
    .first();
  if (existing) return c.json({ id: existing.id, existed: true });
  const res = await c.env.DB.prepare(
    "INSERT INTO exercises (name, muscle_group) VALUES (?, ?)"
  )
    .bind(name.trim(), muscle_group ?? null)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

workout.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to") ?? from;
  if (!from) return c.json({ error: "缺少 from 參數" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, e.name AS exercise_name, e.muscle_group
     FROM workout_entries w JOIN exercises e ON e.id = w.exercise_id
     WHERE w.date BETWEEN ? AND ? ORDER BY w.date DESC, w.id DESC`
  )
    .bind(from, to)
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
  const res = await c.env.DB.prepare(
    "INSERT INTO workout_entries (date, exercise_id, weight_kg, reps, sets, note) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(b.date, b.exercise_id, b.weight_kg, b.reps, b.sets, b.note ?? null)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
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
    "UPDATE workout_entries SET date = ?, exercise_id = ?, weight_kg = ?, reps = ?, sets = ?, note = ? WHERE id = ?"
  )
    .bind(b.date, b.exercise_id, b.weight_kg, b.reps, b.sets, b.note ?? null, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

workout.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM workout_entries WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// Per-exercise history for the progression chart: best (heaviest) set per day
workout.get("/progression/:exerciseId", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT date, MAX(weight_kg) AS weight_kg,
            SUM(weight_kg * reps * sets) AS volume
     FROM workout_entries WHERE exercise_id = ?
     GROUP BY date ORDER BY date`
  )
    .bind(c.req.param("exerciseId"))
    .all();
  return c.json(results);
});

export default workout;
