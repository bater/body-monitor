import { Hono } from "hono";
import type { AppContext } from "../env";

// Public (Access-bypassed) waiting-list signup. No auth: reachable by logged-out
// visitors from the /welcome landing page. authMiddleware whitelists this path.
const waitlist = new Hono<AppContext>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

waitlist.post("/", async (c) => {
  const body = await c.req
    .json<{ email?: string; note?: string }>()
    .catch(() => ({}) as { email?: string; note?: string });
  const { email, note } = body;
  const clean = email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(clean)) return c.json({ error: "請輸入有效的 Email" }, 400);
  const trimmedNote = note?.trim().slice(0, 140) || null;

  // Already a member? Don't leak that fact — treat it like a normal signup.
  const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(clean)
    .first();

  const res = await c.env.DB.prepare(
    "INSERT INTO waitlist (email, note) VALUES (?, ?) ON CONFLICT(email) DO NOTHING"
  )
    .bind(clean, trimmedNote)
    .run();

  const already = res.meta.changes === 0 || Boolean(existingUser);
  return c.json({ ok: true, already }, 201);
});

export default waitlist;
