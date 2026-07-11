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

// Standalone "shareable link" invites only — invites tied to a waiting-list
// entry are represented by that person's row in /people instead, so listing
// them here too would double-count.
invite.get("/", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.created_at, i.expires_at, i.used_at, u.email AS used_by_email,
            CASE WHEN i.used_at IS NOT NULL THEN 'used'
                 WHEN i.expires_at <= datetime('now') THEN 'expired'
                 ELSE 'active' END AS status
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     WHERE i.id NOT IN (SELECT invite_id FROM waitlist WHERE invite_id IS NOT NULL)
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

// Unified people list: every email-identified person in one view, each with a
// single derived lifecycle status. Members (a row in `users`) are 'active';
// waiting-list emails not yet members are 'waiting' or 'invited'. This is the
// merge of the old "候補名單" and member views into one management surface.
invite.get("/people", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const { results } = await c.env.DB.prepare(
    // The union must be wrapped: SQLite forbids an ORDER BY *expression* over a
    // compound (UNION) select's columns, so we sort the union from the outside.
    `SELECT * FROM (
       SELECT 'active' AS status, u.email AS email, u.name AS name, NULL AS note,
              u.created_at AS created_at, NULL AS invited_at,
              NULL AS waitlist_id, u.id AS user_id, u.is_admin AS is_admin
         FROM users u
       UNION ALL
       SELECT CASE WHEN w.status = 'invited' THEN 'invited' ELSE 'waiting' END AS status,
              w.email, NULL AS name, w.note, w.created_at, w.invited_at,
              w.id AS waitlist_id, NULL AS user_id, 0 AS is_admin
         FROM waitlist w
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = w.email)
     )
     ORDER BY CASE status WHEN 'waiting' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
              created_at DESC`
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

// Undo an invite: revoke the (unused) invite link and drop the person back to
// 'waiting'. If they already redeemed it they're a member and won't show as
// 'invited', so this only ever touches still-pending invites.
invite.post("/waitlist/:id/revoke", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  const entry = await c.env.DB.prepare("SELECT id, invite_id FROM waitlist WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: number; invite_id: number | null }>();
  if (!entry) return c.json({ error: "找不到這筆候補" }, 404);
  // Clear the reference BEFORE deleting the invite — waitlist.invite_id is an FK
  // into invites(id), so deleting the parent first fails the constraint.
  await c.env.DB.prepare(
    "UPDATE waitlist SET status = 'pending', invited_at = NULL, invite_id = NULL WHERE id = ?"
  )
    .bind(entry.id)
    .run();
  if (entry.invite_id) {
    await c.env.DB.prepare("DELETE FROM invites WHERE id = ? AND used_at IS NULL")
      .bind(entry.invite_id)
      .run();
  }
  return c.json({ ok: true });
});

invite.delete("/waitlist/:id", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "僅管理員" }, 403);
  await c.env.DB.prepare("DELETE FROM waitlist WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default invite;
