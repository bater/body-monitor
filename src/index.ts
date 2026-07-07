import { Hono } from "hono";
import type { AppContext } from "./env";
import food from "./routes/food";
import workout from "./routes/workout";
import inbody from "./routes/inbody";
import dashboard from "./routes/dashboard";

const app = new Hono<AppContext>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "伺服器錯誤，請稍後再試" }, 500);
});

app.route("/api/food", food);
app.route("/api/workouts", workout);
app.route("/api/inbody", inbody);
app.route("/api/dashboard", dashboard);

app.get("/api/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings").all();
  return c.json(Object.fromEntries(results.map((r) => [r.key, r.value])));
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const stmt = c.env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await c.env.DB.batch(Object.entries(body).map(([k, v]) => stmt.bind(k, String(v))));
  return c.json({ ok: true });
});

app.get("/api/health", (c) => c.json({ ok: true, ai: Boolean(c.env.GEMINI_API_KEY) }));

export default app;
