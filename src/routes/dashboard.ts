import { Hono } from "hono";
import type { AppContext } from "../env";
import { computeGamify } from "../gamify";

const dashboard = new Hono<AppContext>();

// Client passes its local date to avoid timezone drift on the server
dashboard.get("/", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "缺少 date 參數" }, 400);
  const uid = c.get("userId");

  const { results: settingRows } = await c.env.DB.prepare(
    "SELECT key, value FROM user_settings WHERE user_id = ? AND key IN ('protein_target_g','protein_min_g')"
  )
    .bind(uid)
    .all<{ key: string; value: string }>();
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const targetG = Number(settings.protein_target_g ?? 120);
  const minG = Number(settings.protein_min_g ?? Math.round(targetG * 0.75));

  const [protein, foodDaily, inbodyTrend, gamify] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COALESCE(SUM(protein_g),0) AS protein_g, COALESCE(SUM(calories),0) AS calories, COUNT(*) AS entries FROM food_logs WHERE user_id = ? AND date = ?"
    )
      .bind(uid, date)
      .first<{ protein_g: number; calories: number; entries: number }>(),
    c.env.DB.prepare(
      `SELECT date, ROUND(SUM(protein_g), 1) AS protein_g, SUM(calories) AS calories
       FROM food_logs WHERE user_id = ? AND date BETWEEN date(?, '-29 days') AND ?
       GROUP BY date ORDER BY date`
    )
      .bind(uid, date, date)
      .all(),
    c.env.DB.prepare(
      `SELECT date, weight_kg, skeletal_muscle_mass_kg, body_fat_percent
       FROM inbody_records WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 12`
    )
      .bind(uid)
      .all(),
    computeGamify(c.env.DB, uid, date, targetG, minG),
  ]);

  return c.json({
    date,
    protein_g: protein?.protein_g ?? 0,
    calories: protein?.calories ?? 0,
    food_entries: protein?.entries ?? 0,
    protein_target_g: targetG,
    gamify,
    food_daily: foodDaily.results,
    inbody_trend: (inbodyTrend.results as Record<string, unknown>[]).reverse(),
  });
});

export default dashboard;
