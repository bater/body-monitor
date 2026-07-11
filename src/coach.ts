// AI coach feedback (教練回饋), two tiers:
// - tier 0: deterministic rule messages computed at save time from derived
//   stats, returned inline in the create response and never persisted
//   (derived on read, like gamify — edits/deletes can't leave stale rows);
// - tier 1: LLM messages for notable events only, fetched via POST /api/coach,
//   memoized per record in coach_feedback and hard-capped per day.

import type { Env } from "./env";
import { AiError, chatJson } from "./ai/llm";
import { currentStreak, loadRaw, proteinSettings, xpByDate } from "./gamify";

export type CoachKind = "food" | "workout" | "inbody";
export type CoachEvent =
  | "first_food"
  | "target_crossed"
  | "streak_milestone"
  | "first_workout"
  | "pr"
  | "inbody_new";
export type Coach = { message: string; notable: boolean; event: CoachEvent | null };

const STREAK_MILESTONES = [7, 30, 100];
export const DAILY_AI_CAP = 3;

/** 1 decimal, trailing zeros dropped (74.0 → "74"). */
function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v >= 0 ? `+${v}` : String(v);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---------- Tier-0 rule engines (pure, unit-tested) ----------

export type FoodCoachInput = {
  isToday: boolean;
  date: string;
  prevTotalG: number; // day total before this log
  newTotalG: number; // day total after this log
  targetG: number;
  minG: number;
  isFirstEver: boolean;
  streakDays: number; // streak as of today, including this log
  streakJustQualified: boolean; // this log pushed today over 最低
};

export function foodCoach(i: FoodCoachInput): Coach {
  // backdated entries never make "today" claims and never trigger the LLM
  if (!i.isToday) {
    return { message: `${i.date} 累計蛋白質 ${fmt(i.newTotalG)} g，已補登完成。`, notable: false, event: null };
  }
  if (i.isFirstEver) {
    return {
      message: `第一筆飲食紀錄完成！每天記錄是最重要的一步，蛋白質目標 ${fmt(i.targetG)} g。`,
      notable: true,
      event: "first_food",
    };
  }
  if (i.streakJustQualified && STREAK_MILESTONES.includes(i.streakDays)) {
    return {
      message: `連續 ${i.streakDays} 天達標！今日蛋白質 ${fmt(i.newTotalG)} g。`,
      notable: true,
      event: "streak_milestone",
    };
  }
  if (i.prevTotalG < i.targetG && i.newTotalG >= i.targetG) {
    return {
      message: `達標！今日蛋白質 ${fmt(i.newTotalG)} g（目標 ${fmt(i.targetG)} g）✓`,
      notable: true,
      event: "target_crossed",
    };
  }
  if (i.newTotalG >= i.targetG) {
    return { message: `今日蛋白質 ${fmt(i.newTotalG)} g，持續超越目標 ${fmt(i.targetG)} g。`, notable: false, event: null };
  }
  if (i.newTotalG >= i.minG) {
    return {
      message: `已達最低 ${fmt(i.minG)} g，連勝保住 ✓ 再 ${fmt(i.targetG - i.newTotalG)} g 達標。`,
      notable: false,
      event: null,
    };
  }
  return {
    message: `今日累計 ${fmt(i.newTotalG)} g，距離最低 ${fmt(i.minG)} g 還差 ${fmt(i.minG - i.newTotalG)} g，加油。`,
    notable: false,
    event: null,
  };
}

export type WorkoutCoachInput = {
  isToday: boolean;
  exerciseName: string;
  weightKg: number;
  reps: number;
  sets: number;
  volume: number; // weight × reps × sets
  prevMaxKg: number | null; // heaviest earlier set of this exercise
  prevSessionVolume: number | null; // total volume of the previous session (earlier date)
  isFirstEver: boolean; // no workout_entries at all before this one
};

export function workoutCoach(i: WorkoutCoachInput): Coach {
  const setStr = `${fmt(i.weightKg)} kg × ${i.reps} × ${i.sets}`;
  if (i.isFirstEver) {
    return {
      message: `第一筆訓練紀錄！${i.exerciseName} ${setStr}，之後以此為基準看進步。`,
      notable: i.isToday,
      event: i.isToday ? "first_workout" : null,
    };
  }
  if (i.prevMaxKg == null) {
    return { message: `第一次記錄 ${i.exerciseName}：${setStr}，下次挑戰更進一步。`, notable: false, event: null };
  }
  if (i.weightKg > i.prevMaxKg) {
    return {
      message: `${i.exerciseName} ${fmt(i.weightKg)} kg — 破個人紀錄（之前最高 ${fmt(i.prevMaxKg)} kg）！`,
      notable: i.isToday,
      event: i.isToday ? "pr" : null,
    };
  }
  if (i.prevSessionVolume != null && i.volume > i.prevSessionVolume) {
    const pct = Math.round(((i.volume - i.prevSessionVolume) / i.prevSessionVolume) * 100);
    return {
      message: `${i.exerciseName} 總訓練量 ${fmt(i.volume)}，比上次多 ${fmt(i.volume - i.prevSessionVolume)}（+${pct}%），穩定進步中。`,
      notable: false,
      event: null,
    };
  }
  if (i.prevSessionVolume != null && i.volume < i.prevSessionVolume) {
    return {
      message: `${i.exerciseName} 總訓練量 ${fmt(i.volume)}，比上次少一點，持續出現就是勝利。`,
      notable: false,
      event: null,
    };
  }
  return { message: `${i.exerciseName} ${setStr}，已記錄。`, notable: false, event: null };
}

export type InBodyPrev = { date: string; weightKg: number; smmKg: number | null; pbf: number | null };
export type InBodyCoachInput = {
  weightKg: number;
  smmKg: number | null;
  pbf: number | null;
  prev: InBodyPrev | null; // previous non-import record; import rows never reach the coach
};

export function inbodyCoach(i: InBodyCoachInput): Coach {
  // every non-import InBody save is notable — it's rare (~monthly) and the
  // comparison is vs the previous measurement, not vs "today"
  if (!i.prev) {
    return { message: "第一筆 InBody 紀錄！之後每次量測都會自動比較變化。", notable: true, event: "inbody_new" };
  }
  const dW = i.weightKg - i.prev.weightKg;
  const dM = i.smmKg != null && i.prev.smmKg != null ? i.smmKg - i.prev.smmKg : null;
  const dF = i.pbf != null && i.prev.pbf != null ? i.pbf - i.prev.pbf : null;
  if (dM != null && dF != null && dM > 0 && dF < 0) {
    return {
      message: `與 ${i.prev.date} 相比：肌肉 ${signed(dM)} kg、體脂 ${signed(dF)}% — 增肌減脂，理想方向！`,
      notable: true,
      event: "inbody_new",
    };
  }
  const parts = [`體重 ${signed(dW)} kg`];
  if (dM != null) parts.push(`骨骼肌 ${signed(dM)} kg`);
  if (dF != null) parts.push(`體脂 ${signed(dF)}%`);
  return { message: `與 ${i.prev.date} 相比：${parts.join("、")}。`, notable: true, event: "inbody_new" };
}

// ---------- Context loaders (D1) ----------

export type FoodCtx = {
  kind: "food";
  date: string;
  input: FoodCoachInput;
  avg7G: number | null;
  targetDays7: number;
};
export type WorkoutCtx = { kind: "workout"; date: string; input: WorkoutCoachInput; sessions30d: number };
export type InBodyCtx = { kind: "inbody"; date: string; input: InBodyCoachInput };
export type CoachCtx = FoodCtx | WorkoutCtx | InBodyCtx;

export function runCoach(ctx: CoachCtx): Coach {
  if (ctx.kind === "food") return foodCoach(ctx.input);
  if (ctx.kind === "workout") return workoutCoach(ctx.input);
  return inbodyCoach(ctx.input);
}

/** Context for a just-saved food log. `record` must already be in the DB. */
export async function foodContext(
  db: D1Database,
  userId: number,
  record: { date: string; protein_g: number },
  today: string
): Promise<FoodCtx> {
  const [{ targetG, minG }, raw, count] = await Promise.all([
    proteinSettings(db, userId),
    loadRaw(db, userId),
    db.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?").bind(userId).first<{ n: number }>(),
  ]);
  const dayRow = raw.foodDays.find((r) => r.date === record.date);
  const newTotalG = dayRow?.protein ?? record.protein_g;
  const prevTotalG = Math.max(0, newTotalG - record.protein_g);
  const { qualifying } = xpByDate(raw, targetG, minG);
  const isToday = record.date === today;

  const week = raw.foodDays.filter((r) => r.date >= addDays(today, -6) && r.date <= today);
  const weekProtein = week.map((r) => r.protein ?? 0);
  return {
    kind: "food",
    date: record.date,
    input: {
      isToday,
      date: record.date,
      prevTotalG,
      newTotalG,
      targetG,
      minG,
      isFirstEver: (count?.n ?? 0) === 1,
      streakDays: currentStreak(qualifying, today),
      streakJustQualified: isToday && prevTotalG < minG && newTotalG >= minG,
    },
    avg7G: week.length ? Math.round(weekProtein.reduce((s, p) => s + p, 0) / week.length) : null,
    targetDays7: weekProtein.filter((p) => p >= targetG).length,
  };
}

/** Context for a just-saved workout entry. `record` must already be in the DB. */
export async function workoutContext(
  db: D1Database,
  userId: number,
  record: { id: number; date: string; exercise_id: number; weight_kg: number; reps: number; sets: number; exercise_name: string },
  today: string
): Promise<WorkoutCtx> {
  const [prevMax, prevSession, count, sessions] = await Promise.all([
    db
      .prepare(
        `SELECT MAX(weight_kg) AS m FROM workout_entries
         WHERE user_id = ? AND exercise_id = ? AND (date < ? OR (date = ? AND id < ?))`
      )
      .bind(userId, record.exercise_id, record.date, record.date, record.id)
      .first<{ m: number | null }>(),
    db
      .prepare(
        `SELECT SUM(weight_kg * reps * sets) AS v FROM workout_entries
         WHERE user_id = ? AND exercise_id = ?
           AND date = (SELECT MAX(date) FROM workout_entries WHERE user_id = ? AND exercise_id = ? AND date < ?)`
      )
      .bind(userId, record.exercise_id, userId, record.exercise_id, record.date)
      .first<{ v: number | null }>(),
    db.prepare("SELECT COUNT(*) AS n FROM workout_entries WHERE user_id = ?").bind(userId).first<{ n: number }>(),
    db
      .prepare(
        "SELECT COUNT(DISTINCT date) AS n FROM workout_entries WHERE user_id = ? AND exercise_id = ? AND date >= ?"
      )
      .bind(userId, record.exercise_id, addDays(today, -29))
      .first<{ n: number }>(),
  ]);
  return {
    kind: "workout",
    date: record.date,
    input: {
      isToday: record.date === today,
      exerciseName: record.exercise_name,
      weightKg: record.weight_kg,
      reps: record.reps,
      sets: record.sets,
      volume: record.weight_kg * record.reps * record.sets,
      prevMaxKg: prevMax?.m ?? null,
      prevSessionVolume: prevSession?.v ?? null,
      isFirstEver: (count?.n ?? 0) === 1,
    },
    sessions30d: sessions?.n ?? 0,
  };
}

/** Context for a just-saved (non-import) InBody record, already in the DB. */
export async function inbodyContext(
  db: D1Database,
  userId: number,
  record: {
    id: number;
    date: string;
    weight_kg: number;
    skeletal_muscle_mass_kg: number | null;
    body_fat_percent: number | null;
  }
): Promise<InBodyCtx> {
  const prev = await db
    .prepare(
      `SELECT date, weight_kg, skeletal_muscle_mass_kg, body_fat_percent FROM inbody_records
       WHERE user_id = ? AND source != 'import' AND (date < ? OR (date = ? AND id < ?))
       ORDER BY date DESC, id DESC LIMIT 1`
    )
    .bind(userId, record.date, record.date, record.id)
    .first<{ date: string; weight_kg: number; skeletal_muscle_mass_kg: number | null; body_fat_percent: number | null }>();
  return {
    kind: "inbody",
    date: record.date,
    input: {
      weightKg: record.weight_kg,
      smmKg: record.skeletal_muscle_mass_kg,
      pbf: record.body_fat_percent,
      prev: prev
        ? { date: prev.date, weightKg: prev.weight_kg, smmKg: prev.skeletal_muscle_mass_kg, pbf: prev.body_fat_percent }
        : null,
    },
  };
}

// ---------- Tier-1 LLM ----------

export const COACH_TONES = ["friendly", "strict", "professional"] as const;
export type CoachTone = (typeof COACH_TONES)[number];

export function normalizeTone(v: string | undefined | null): CoachTone {
  return (COACH_TONES as readonly string[]).includes(v ?? "") ? (v as CoachTone) : "friendly";
}

const COACH_SHARED_RULES = `使用者剛新增一筆紀錄，你會收到一個 JSON，描述這次的重要事件（event）與他的個人數據。
輸出規則：
- 只回傳 JSON：{"message":"..."}，不要其他文字。
- message 用繁體中文（台灣用語），1~2 句、最多 60 字。
- 必須引用 JSON 中的具體數字（公斤、克、天數、百分比、變化量）；只使用 JSON 中出現的數值，不要自行推算新數字（例如百分比）。
- 禁止醫療診斷或就醫建議。
欄位說明：event=事件代碼；streak_days=連續達標天數；protein.today_g/target_g/min_g=今日蛋白質與目標；
protein.avg7_g=近7天平均；protein.target_days_7=近7天達標天數；workout.prev_max_kg=該動作先前最重；
workout.prev_volume=上次總訓練量；inbody.prev=上次量測值。`;

// Frozen prompt-cache prefixes: one byte-identical constant per tone, shared
// across all users and calls. Never interpolate per-request values into these
// — all variance goes in the user message.
export const COACH_SYSTEM_PROMPTS: Record<CoachTone, string> = {
  friendly: `你是「Body Buddy」App 的健身教練，語氣像熟識的朋友：具體、簡短、鼓勵但不浮誇、不說教。最多 1 個 emoji。
數據退步時先肯定持續記錄，再給一個具體的小行動。
${COACH_SHARED_RULES}`,
  strict: `你是「Body Buddy」App 的魔鬼教練：嚴格、直接、標準高，不說客套話。不用 emoji。
達標了也要指出離下一步還差多少、提醒不要鬆懈；數據退步時直接點出問題並下一個明確指令。
${COACH_SHARED_RULES}`,
  professional: `你是「Body Buddy」App 的專業教練，具運動科學與營養學背景：客觀、冷靜、數據導向。不用 emoji。
以數據解讀為主，說明這次數字代表的趨勢，並給一個有依據的具體建議。
${COACH_SHARED_RULES}`,
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Compact variable suffix: one small JSON of pre-aggregated stats, no raw rows. */
export function buildCoachUserContent(ctx: CoachCtx, event: CoachEvent): string {
  if (ctx.kind === "food") {
    const i = ctx.input;
    return JSON.stringify({
      kind: "food",
      event,
      date: ctx.date,
      streak_days: i.streakDays,
      protein: {
        today_g: round1(i.newTotalG),
        target_g: round1(i.targetG),
        min_g: round1(i.minG),
        ...(ctx.avg7G != null ? { avg7_g: ctx.avg7G } : {}),
        target_days_7: ctx.targetDays7,
      },
    });
  }
  if (ctx.kind === "workout") {
    const i = ctx.input;
    return JSON.stringify({
      kind: "workout",
      event,
      date: ctx.date,
      workout: {
        exercise: i.exerciseName,
        weight_kg: round1(i.weightKg),
        reps: i.reps,
        sets: i.sets,
        volume: round1(i.volume),
        ...(i.prevMaxKg != null ? { prev_max_kg: round1(i.prevMaxKg) } : {}),
        ...(i.prevSessionVolume != null ? { prev_volume: round1(i.prevSessionVolume) } : {}),
        sessions_30d: ctx.sessions30d,
      },
    });
  }
  const i = ctx.input;
  return JSON.stringify({
    kind: "inbody",
    event,
    date: ctx.date,
    inbody: {
      weight_kg: round1(i.weightKg),
      ...(i.smmKg != null ? { smm_kg: round1(i.smmKg) } : {}),
      ...(i.pbf != null ? { pbf: round1(i.pbf) } : {}),
      ...(i.prev
        ? {
            prev: {
              date: i.prev.date,
              weight_kg: round1(i.prev.weightKg),
              ...(i.prev.smmKg != null ? { smm_kg: round1(i.prev.smmKg) } : {}),
              ...(i.prev.pbf != null ? { pbf: round1(i.prev.pbf) } : {}),
            },
          }
        : {}),
    },
  });
}

export async function generateAiCoach(
  env: Env,
  ctx: CoachCtx,
  event: CoachEvent,
  tone: CoachTone = "friendly"
): Promise<string> {
  const result = await chatJson<{ message?: unknown }>(
    env,
    [{ type: "text", text: buildCoachUserContent(ctx, event) }],
    { system: COACH_SYSTEM_PROMPTS[tone], maxTokens: 200, temperature: 0.6 }
  );
  if (typeof result.message !== "string" || !result.message.trim()) {
    throw new AiError("AI 回應缺少 message", 502);
  }
  return result.message.trim();
}
