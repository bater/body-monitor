import { Hono } from "hono";
import type { AppContext } from "../env";
import { provisionUser } from "../auth";

const invite = new Hono<AppContext>();

// Redeem is reachable by authenticated-but-not-yet-member visitors (see auth.ts)
invite.post("/redeem", async (c) => {
  if (c.get("userId")) return c.json({ ok: true, existing: true });
  const { token } = await c.req.json<{ token?: string }>();
  if (!token) return c.json({ error: "缺少邀請代碼" }, 400);

  // atomically claim the token: single-use, unexpired
  const claim = await c.env.DB.prepare(
    "UPDATE invites SET used_at = datetime('now') WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')"
  )
    .bind(token)
    .run();
  if (claim.meta.changes !== 1) return c.json({ error: "邀請連結無效或已過期" }, 400);

  const user = await provisionUser(c.env, c.get("userEmail"));
  await c.env.DB.prepare("UPDATE invites SET used_by = ? WHERE token = ?")
    .bind(user.id, token)
    .run();
  return c.json({ ok: true });
});

// ---- admin-only management ----

function requireAdmin(c: { get: (k: "isAdmin") => boolean }) {
  return c.get("isAdmin");
}

invite.post("/", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員可建立邀請" }, 403);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await c.env.DB.prepare(
    "INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, datetime('now', '+7 days'))"
  )
    .bind(token, c.get("userId"))
    .run();
  const origin = new URL(c.req.url).origin;
  return c.json({ link: `${origin}/?invite=${token}` }, 201);
});

invite.get("/", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.created_at, i.expires_at, i.used_at, u.email AS used_by_email,
            CASE WHEN i.used_at IS NOT NULL THEN 'used'
                 WHEN i.expires_at <= datetime('now') THEN 'expired'
                 ELSE 'active' END AS status
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.id DESC`
  ).all();
  return c.json(results);
});

invite.delete("/:id", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const res = await c.env.DB.prepare("DELETE FROM invites WHERE id = ? AND used_at IS NULL")
    .bind(c.req.param("id"))
    .run();
  if (res.meta.changes !== 1) return c.json({ error: "已使用的邀請無法撤銷" }, 400);
  return c.json({ ok: true });
});

export default invite;
