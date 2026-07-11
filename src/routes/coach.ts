import { Hono } from "hono";
import type { AppContext } from "../env";
import { resolveProvider } from "../ai/llm";
import {
  DAILY_AI_CAP,
  foodContext,
  generateAiCoach,
  inbodyContext,
  normalizeTone,
  runCoach,
  workoutContext,
  type CoachCtx,
  type CoachKind,
} from "../coach";

const coach = new Hono<AppContext>();

// Tier-1 (LLM) coach feedback for a just-saved record. The coach is
// decorative: every non-happy path answers 200 {message:null} so the
// frontend silently keeps the tier-0 message — never an error toast.
coach.post("/", async (c) => {
  const none = () => c.json({ message: null });
  const b = await c.req.json<{ kind?: string; record_id?: number; today?: string }>();
  const kind = b.kind as CoachKind;
  if (!["food", "workout", "inbody"].includes(kind) || !b.record_id) return none();

  const db = c.env.DB;
  const uid = c.get("userId");

  const { results } = await db
    .prepare("SELECT key, value FROM user_settings WHERE user_id = ? AND key IN ('coach_enabled','coach_tone')")
    .bind(uid)
    .all<{ key: string; value: string }>();
  const settings = Object.fromEntries(results.map((r) => [r.key, r.value]));
  if (settings.coach_enabled === "0") return none();
  const tone = normalizeTone(settings.coach_tone);

  const memo = await db
    .prepare("SELECT message FROM coach_feedback WHERE user_id = ? AND kind = ? AND record_id = ?")
    .bind(uid, kind, b.record_id)
    .first<{ message: string }>();
  if (memo) return c.json({ message: memo.message });

  // rebuild context from the record itself — never trust a client-sent event
  let ctx: CoachCtx;
  if (kind === "food") {
    const rec = await db
      .prepare("SELECT id, date, protein_g FROM food_logs WHERE id = ? AND user_id = ?")
      .bind(b.record_id, uid)
      .first<{ id: number; date: string; protein_g: number }>();
    if (!rec) return none();
    ctx = await foodContext(db, uid, rec, b.today ?? rec.date);
  } else if (kind === "workout") {
    const rec = await db
      .prepare(
        `SELECT w.id, w.date, w.exercise_id, w.weight_kg, w.reps, w.sets, e.name AS exercise_name
         FROM workout_entries w JOIN exercises e ON e.id = w.exercise_id
         WHERE w.id = ? AND w.user_id = ?`
      )
      .bind(b.record_id, uid)
      .first<{
        id: number;
        date: string;
        exercise_id: number;
        weight_kg: number;
        reps: number;
        sets: number;
        exercise_name: string;
      }>();
    if (!rec) return none();
    ctx = await workoutContext(db, uid, rec, b.today ?? rec.date);
  } else {
    const rec = await db
      .prepare(
        `SELECT id, date, weight_kg, skeletal_muscle_mass_kg, body_fat_percent, source
         FROM inbody_records WHERE id = ? AND user_id = ?`
      )
      .bind(b.record_id, uid)
      .first<{
        id: number;
        date: string;
        weight_kg: number;
        skeletal_muscle_mass_kg: number | null;
        body_fat_percent: number | null;
        source: string;
      }>();
    if (!rec || rec.source === "import") return none();
    ctx = await inbodyContext(db, uid, rec);
  }

  const tier0 = runCoach(ctx);
  if (!tier0.notable || !tier0.event) return none();

  const capDate = b.today && /^\d{4}-\d{2}-\d{2}$/.test(b.today) ? b.today : ctx.date;
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM coach_feedback WHERE user_id = ? AND date = ?")
    .bind(uid, capDate)
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= DAILY_AI_CAP) return none();

  if (!resolveProvider(c.env)) return none();

  try {
    const message = await generateAiCoach(c.env, ctx, tier0.event, tone);
    await db
      .prepare(
        `INSERT OR IGNORE INTO coach_feedback (user_id, kind, record_id, date, tier, event, message)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(uid, kind, b.record_id, capDate, tier0.event, message)
      .run();
    return c.json({ message });
  } catch (e) {
    console.error("coach llm", e);
    return none();
  }
});

export default coach;
