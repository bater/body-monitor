import { Hono } from "hono";
import type { AppContext } from "../env";

const dashboard = new Hono<AppContext>();

// Client passes its local date to avoid timezone drift on the server
dashboard.get("/", async (c) => {
  const date = c.req.query("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return c.json({ error: "缺少 date 參數" }, 400);

  const [protein, target, lastWorkoutDate, inbodyTrend] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COALESCE(SUM(protein_g),0) AS protein_g, COALESCE(SUM(calories),0) AS calories, COUNT(*) AS entries FROM food_logs WHERE date = ?"
    )
      .bind(date)
      .first<{ protein_g: number; calories: number; entries: number }>(),
    c.env.DB.prepare("SELECT value FROM settings WHERE key = 'protein_target_g'").first<{
      value: string;
    }>(),
    c.env.DB.prepare("SELECT MAX(date) AS d FROM workout_entries").first<{ d: string | null }>(),
    c.env.DB.prepare(
      `SELECT date, weight_kg, skeletal_muscle_mass_kg, body_fat_percent
       FROM inbody_records ORDER BY date DESC, id DESC LIMIT 12`
    ).all(),
  ]);

  let lastWorkout: { date: string; entries: unknown[] } | null = null;
  if (lastWorkoutDate?.d) {
    const { results } = await c.env.DB.prepare(
      `SELECT w.*, e.name AS exercise_name FROM workout_entries w
       JOIN exercises e ON e.id = w.exercise_id WHERE w.date = ? ORDER BY w.id`
    )
      .bind(lastWorkoutDate.d)
      .all();
    lastWorkout = { date: lastWorkoutDate.d, entries: results };
  }

  return c.json({
    date,
    protein_g: protein?.protein_g ?? 0,
    calories: protein?.calories ?? 0,
    food_entries: protein?.entries ?? 0,
    protein_target_g: Number(target?.value ?? 120),
    last_workout: lastWorkout,
    inbody_trend: (inbodyTrend.results as Record<string, unknown>[]).reverse(),
  });
});

export default dashboard;
