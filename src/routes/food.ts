import { Hono } from "hono";
import type { AppContext } from "../env";
import { parseFoodText, GeminiError, type FoodItem } from "../ai/gemini";

const food = new Hono<AppContext>();

function totals(items: FoodItem[]) {
  return {
    protein_g: Math.round(items.reduce((s, i) => s + (i.protein_g || 0), 0) * 10) / 10,
    calories: Math.round(items.reduce((s, i) => s + (i.kcal || 0), 0)),
  };
}

food.post("/parse", async (c) => {
  const { text } = await c.req.json<{ text?: string }>();
  if (!text?.trim()) return c.json({ error: "請輸入內容" }, 400);
  try {
    const { items } = await parseFoodText(c.env, text.trim());
    return c.json({ items, ...totals(items) });
  } catch (e) {
    if (e instanceof GeminiError) return c.json({ error: e.message }, e.status as 429 | 502 | 503);
    throw e;
  }
});

food.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to") ?? from;
  if (!from) return c.json({ error: "缺少 from 參數" }, 400);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM food_logs WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC"
  )
    .bind(from, to)
    .all();
  return c.json(results.map((r) => ({ ...r, items: JSON.parse(r.items_json as string) })));
});

food.post("/", async (c) => {
  const body = await c.req.json<{ date?: string; raw_text?: string; items?: FoodItem[] }>();
  if (!body.date || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: "缺少 date 或 items" }, 400);
  }
  const t = totals(body.items);
  const res = await c.env.DB.prepare(
    "INSERT INTO food_logs (date, raw_text, items_json, protein_g, calories) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(body.date, body.raw_text ?? "", JSON.stringify(body.items), t.protein_g, t.calories)
    .run();
  return c.json({ id: res.meta.last_row_id, ...t }, 201);
});

food.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ date?: string; items?: FoodItem[] }>();
  if (!body.date || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: "缺少 date 或 items" }, 400);
  }
  const t = totals(body.items);
  await c.env.DB.prepare(
    "UPDATE food_logs SET date = ?, items_json = ?, protein_g = ?, calories = ? WHERE id = ?"
  )
    .bind(body.date, JSON.stringify(body.items), t.protein_g, t.calories, id)
    .run();
  return c.json({ ok: true, ...t });
});

food.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM food_logs WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default food;
