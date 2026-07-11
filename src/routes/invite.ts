import { Hono } from "hono";
import type { AppContext, Env } from "../env";
import { provisionUser } from "../auth";
import { sendInviteEmail, sendMail } from "../email";

const invite = new Hono<AppContext>();

// Create a single-use, 7-day invite; returns the token + its shareable link.
async function createInvite(
  env: Env,
  adminId: number,
  origin: string
): Promise<{ id: number; token: string; link: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await env.DB.prepare(
    "INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, datetime('now', '+7 days'))"
  )
    .bind(token, adminId)
    .run();
  return { id: res.meta.last_row_id as number, token, link: `${origin}/?invite=${token}` };
}

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
  const { link } = await createInvite(c.env, c.get("userId"), new URL(c.req.url).origin);
  return c.json({ link }, 201);
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

// ---- waiting list (admin) ----

// Deliverability check: emails the admin's own address. Never throws — returns
// the error text for the UI.
invite.post("/test-email", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const to = c.get("userEmail");
  try {
    await sendMail(c.env, {
      to,
      subject: "Body Buddy 測試信",
      text: "這是一封來自 Body Buddy 的測試信。\n若你收到它，代表邀請信設定成功 🎉",
    });
    return c.json({ ok: true, to });
  } catch (e) {
    return c.json({ ok: false, to, error: e instanceof Error ? e.message : "寄信失敗" });
  }
});

invite.get("/waitlist", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.email, w.note, w.created_at, w.status, w.invited_at,
            EXISTS(SELECT 1 FROM users u WHERE u.email = w.email) AS is_member
     FROM waitlist w ORDER BY w.status = 'invited', w.id DESC`
  ).all();
  return c.json(results);
});

invite.post("/waitlist/:id/invite", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const entry = await c.env.DB.prepare("SELECT id, email FROM waitlist WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: number; email: string }>();
  if (!entry) return c.json({ error: "找不到這筆候補" }, 404);

  const { id: inviteId, link } = await createInvite(
    c.env,
    c.get("userId"),
    new URL(c.req.url).origin
  );

  // Email is best-effort: a send failure (or unconfigured SMTP) still records the
  // invite so the admin can copy the link manually.
  let emailed = false;
  let emailError: string | null = null;
  try {
    emailed = await sendInviteEmail(c.env, entry.email, link);
  } catch (e) {
    emailError = e instanceof Error ? e.message : "寄信失敗";
    console.error("invite email", e);
  }

  await c.env.DB.prepare(
    "UPDATE waitlist SET status = 'invited', invited_at = datetime('now'), invite_id = ? WHERE id = ?"
  )
    .bind(inviteId, entry.id)
    .run();

  return c.json({ ok: true, link, emailed, email_error: emailError });
});

invite.delete("/waitlist/:id", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  await c.env.DB.prepare("DELETE FROM waitlist WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default invite;
