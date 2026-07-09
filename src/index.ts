import { Hono } from "hono";
import type { AppContext } from "./env";
import { resolveProvider } from "./ai/llm";
import { authMiddleware } from "./auth";
import food from "./routes/food";
import workout from "./routes/workout";
import inbody from "./routes/inbody";
import dashboard from "./routes/dashboard";

const app = new Hono<AppContext>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "伺服器錯誤，請稍後再試" }, 500);
});

app.use("/api/*", authMiddleware);

app.route("/api/food", food);
app.route("/api/workouts", workout);
app.route("/api/inbody", inbody);
app.route("/api/dashboard", dashboard);

app.get("/api/me", (c) =>
  c.json({ email: c.get("userEmail"), name: c.get("userName") })
);

app.get("/api/settings", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM user_settings WHERE user_id = ?"
  )
    .bind(c.get("userId"))
    .all();
  return c.json(Object.fromEntries(results.map((r) => [r.key, r.value])));
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const stmt = c.env.DB.prepare(
    "INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value"
  );
  await c.env.DB.batch(
    Object.entries(body).map(([k, v]) => stmt.bind(c.get("userId"), k, String(v)))
  );
  return c.json({ ok: true });
});

app.get("/api/health", (c) => {
  const provider = resolveProvider(c.env);
  return c.json({
    ok: true,
    ai: Boolean(provider),
    ai_provider: provider ? `${provider.name} (${provider.model})` : null,
  });
});

export default app;
