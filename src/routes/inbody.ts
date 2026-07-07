import { Hono } from "hono";
import type { AppContext } from "../env";
import { extractInBody, GeminiError } from "../ai/gemini";

const inbody = new Hono<AppContext>();

const FIELDS = [
  "weight_kg",
  "skeletal_muscle_mass_kg",
  "body_fat_percent",
  "body_fat_mass_kg",
  "bmi",
  "visceral_fat_level",
  "bmr_kcal",
] as const;

inbody.post("/ocr", async (c) => {
  const body = await c.req.parseBody();
  const file = body["photo"];
  if (!file || typeof file === "string") return c.json({ error: "缺少照片檔案" }, 400);
  if (file.size > 8 * 1024 * 1024) return c.json({ error: "照片超過 8MB" }, 400);

  const buf = await file.arrayBuffer();
  const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const photoKey = `inbody/${crypto.randomUUID()}.${ext}`;
  await c.env.PHOTOS.put(photoKey, buf, { httpMetadata: { contentType: file.type } });

  // base64-encode in chunks to avoid call-stack limits on large photos
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const base64 = btoa(binary);

  try {
    const extraction = await extractInBody(c.env, base64, file.type || "image/jpeg");
    return c.json({ photo_key: photoKey, extraction });
  } catch (e) {
    if (e instanceof GeminiError) {
      // keep the stored photo so the record can still reference it after manual entry
      return c.json({ error: e.message, photo_key: photoKey }, e.status as 429 | 502 | 503);
    }
    throw e;
  }
});

inbody.get("/", async (c) => {
  const limit = Number(c.req.query("limit") ?? 100);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM inbody_records ORDER BY date DESC, id DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  return c.json(results);
});

inbody.post("/", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  if (!b.date || b.weight_kg == null) return c.json({ error: "缺少 date 或 weight_kg" }, 400);
  const source = ["photo", "manual", "import"].includes(b.source as string)
    ? (b.source as string)
    : "manual";
  const res = await c.env.DB.prepare(
    `INSERT INTO inbody_records
       (date, weight_kg, skeletal_muscle_mass_kg, body_fat_percent, body_fat_mass_kg,
        bmi, visceral_fat_level, bmr_kcal, source, photo_key, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      b.date,
      b.weight_kg,
      b.skeletal_muscle_mass_kg ?? null,
      b.body_fat_percent ?? null,
      b.body_fat_mass_kg ?? null,
      b.bmi ?? null,
      b.visceral_fat_level ?? null,
      b.bmr_kcal ?? null,
      source,
      b.photo_key ?? null,
      b.raw_json ? JSON.stringify(b.raw_json) : null
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

inbody.put("/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  if (!b.date || b.weight_kg == null) return c.json({ error: "缺少 date 或 weight_kg" }, 400);
  const sets = FIELDS.map((f) => `${f} = ?`).join(", ");
  await c.env.DB.prepare(`UPDATE inbody_records SET date = ?, ${sets} WHERE id = ?`)
    .bind(b.date, ...FIELDS.map((f) => b[f] ?? null), c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

inbody.delete("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT photo_key FROM inbody_records WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ photo_key: string | null }>();
  if (row?.photo_key) await c.env.PHOTOS.delete(row.photo_key);
  await c.env.DB.prepare("DELETE FROM inbody_records WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

inbody.get("/photo/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT photo_key FROM inbody_records WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ photo_key: string | null }>();
  if (!row?.photo_key) return c.json({ error: "無照片" }, 404);
  const obj = await c.env.PHOTOS.get(row.photo_key);
  if (!obj) return c.json({ error: "照片不存在" }, 404);
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg" },
  });
});

export default inbody;
