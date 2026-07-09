import type { Context, Next } from "hono";
import type { AppContext, Env } from "./env";

const DEFAULT_EXERCISES: [string, string][] = [
  ["臥推", "胸"],
  ["深蹲", "腿"],
  ["硬舉", "背"],
  ["肩推", "肩"],
  ["引體向上", "背"],
  ["划船", "背"],
  ["二頭彎舉", "手臂"],
  ["三頭下壓", "手臂"],
];

// ---------- Access JWT verification ----------

let jwksCache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getVerifyKey(env: Env, kid: string): Promise<CryptoKey | null> {
  const stale = !jwksCache || Date.now() - jwksCache.fetchedAt > 3600_000;
  if (stale || !jwksCache!.keys.has(kid)) {
    const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const map = new Map<string, CryptoKey>();
    for (const jwk of keys) {
      try {
        map.set(
          jwk.kid,
          await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
          )
        );
      } catch {
        // skip unsupported keys
      }
    }
    jwksCache = { keys: map, fetchedAt: Date.now() };
  }
  return jwksCache!.keys.get(kid) ?? null;
}

/** Verify a Cf-Access-Jwt-Assertion token; returns the authenticated email or null. */
async function verifyAccessJwt(env: Env, token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "RS256" || !header.kid) return null;
    const key = await getVerifyKey(env, header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as {
      aud?: string | string[];
      exp?: number;
      email?: string;
    };
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(env.ACCESS_AUD)) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ---------- User provisioning ----------

async function getOrCreateUser(
  env: Env,
  email: string
): Promise<{ id: number; email: string; name: string }> {
  const existing = await env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: number; email: string; name: string }>();
  if (existing) return existing;

  const name = email.split("@")[0];
  const res = await env.DB.prepare("INSERT INTO users (email, name) VALUES (?, ?)")
    .bind(email, name)
    .run();
  const id = res.meta.last_row_id as number;

  // Owner's first login adopts all pre-multi-user data (rows with user_id NULL)
  const owners = (env.OWNER_EMAILS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (owners.includes(email)) {
    await env.DB.batch([
      env.DB.prepare("UPDATE food_logs SET user_id = ? WHERE user_id IS NULL").bind(id),
      env.DB.prepare("UPDATE workout_entries SET user_id = ? WHERE user_id IS NULL").bind(id),
      env.DB.prepare("UPDATE inbody_records SET user_id = ? WHERE user_id IS NULL").bind(id),
      env.DB.prepare("UPDATE exercises SET user_id = ? WHERE user_id IS NULL").bind(id),
      env.DB.prepare(
        "INSERT OR IGNORE INTO user_settings (user_id, key, value) SELECT ?, key, value FROM settings"
      ).bind(id),
    ]);
  }

  // Every user gets a catalog and a default target (no-ops if claim provided them)
  const hasExercises = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM exercises WHERE user_id = ?"
  )
    .bind(id)
    .first<{ n: number }>();
  if (!hasExercises || hasExercises.n === 0) {
    const stmt = env.DB.prepare("INSERT INTO exercises (user_id, name, muscle_group) VALUES (?, ?, ?)");
    await env.DB.batch(DEFAULT_EXERCISES.map(([n, g]) => stmt.bind(id, n, g)));
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, 'protein_target_g', '120')"
  )
    .bind(id)
    .run();

  return { id, email, name };
}

// ---------- Middleware ----------

export async function authMiddleware(c: Context<AppContext>, next: Next) {
  const env = c.env;
  let email: string | null = null;

  if (env.DEV_USER_EMAIL) {
    // local dev only (.dev.vars) — wrangler dev has no Access in front
    email = env.DEV_USER_EMAIL.toLowerCase();
  } else if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (token) email = await verifyAccessJwt(env, token);
  } else {
    // AUD not configured yet: trust the header Access injects at the edge
    email = c.req.header("Cf-Access-Authenticated-User-Email")?.toLowerCase() ?? null;
  }

  if (!email) return c.json({ error: "未通過身分驗證，請重新登入" }, 401);

  const user = await getOrCreateUser(env, email);
  c.set("userId", user.id);
  c.set("userEmail", user.email);
  c.set("userName", user.name ?? user.email);
  await next();
}
