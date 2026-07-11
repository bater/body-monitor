import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import type { Env } from "./env";
import { computeGamify, proteinSettings } from "./gamify";
import { normalizeTone, type CoachTone } from "./coach";

export type SubRow = { id: number; user_id: number; endpoint: string; p256dh: string; auth: string };

export type PushData = { title: string; body: string; url?: string; tag?: string };

/** Send one notification; prunes the subscription if the push service says it's gone. */
export async function sendPush(env: Env, sub: SubRow, data: PushData): Promise<boolean> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { auth: sub.auth, p256dh: sub.p256dh },
  };
  const payload = await buildPushPayload(
    { data, options: { ttl: 3 * 3600, urgency: "normal" } },
    subscription,
    {
      subject: env.VAPID_SUBJECT ?? "mailto:admin@example.com",
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    }
  );
  const res = await fetch(sub.endpoint, payload);
  if (res.status === 404 || res.status === 410) {
    // device unsubscribed / expired — self-clean
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
    return false;
  }
  return res.ok;
}

// Meal windows in Asia/Taipei (UTC+8), checked by the cron "30 1,5,11 * * *".
// sinceUtcTime bounds the "did they log anything for this meal" lookup on
// food_logs.created_at (stored as UTC datetime('now')); breakfast instead
// asks "any log at all today".
export type MealId = "breakfast" | "lunch" | "dinner";

const MEALS: Record<
  number, // UTC hour the cron fires
  { id: MealId; key: string; sinceUtcTime: string | null }
> = {
  1: { id: "breakfast", key: "reminder_breakfast", sinceUtcTime: null },
  5: { id: "lunch", key: "reminder_lunch", sinceUtcTime: "02:30:00" }, // 10:30 Taipei
  11: { id: "dinner", key: "reminder_dinner", sinceUtcTime: "08:30:00" }, // 16:30 Taipei
};

// Reminder copy per coach tone (same setting as the AI coach; strict and
// professional drop the emoji). Templates only — the cron never calls the LLM.
const PUSH_COPY: Record<
  CoachTone,
  {
    meals: Record<MealId, { title: string; fallback: string }>;
    streak: (needG: number, days: number) => string;
    remaining: (needG: number) => string;
  }
> = {
  friendly: {
    meals: {
      breakfast: { title: "早餐吃了嗎？", fallback: "記下今天第一餐，開啟今天的進度 🌅" },
      lunch: { title: "午餐記錄時間 🍱", fallback: "午餐吃了什麼？順手記一下" },
      dinner: { title: "晚餐別忘了記 🌙", fallback: "今天最後衝刺，記下晚餐" },
    },
    streak: (need, days) => `再 ${need} g 蛋白質保住 🔥 ${days} 天連勝`,
    remaining: (need) => `今天還差 ${need} g 蛋白質達最低`,
  },
  strict: {
    meals: {
      breakfast: { title: "早餐還沒記錄", fallback: "別拖，第一餐現在就記" },
      lunch: { title: "午餐還沒記錄", fallback: "午餐吃了什麼？現在補上" },
      dinner: { title: "晚餐紀錄，最後機會", fallback: "今天還沒完成，立刻記錄晚餐" },
    },
    streak: (need, days) => `還差 ${need} g 蛋白質，${days} 天連勝別在今天斷掉`,
    remaining: (need) => `距離最低還差 ${need} g，去補蛋白質`,
  },
  professional: {
    meals: {
      breakfast: { title: "早餐記錄提醒", fallback: "尚無今日進食紀錄，建議記錄第一餐" },
      lunch: { title: "午餐記錄提醒", fallback: "尚未記錄午餐，維持今日數據完整" },
      dinner: { title: "晚餐記錄提醒", fallback: "今日紀錄尚未完成，請記錄晚餐" },
    },
    streak: (need, days) => `距最低標準尚差 ${need} g 蛋白質；目前連續達標 ${days} 天`,
    remaining: (need) => `今日蛋白質距最低標準尚差 ${need} g`,
  },
};

/** Pick the reminder title/body for a meal under a coach tone (pure, unit-tested). */
export function reminderContent(
  tone: CoachTone,
  mealId: MealId,
  s: { streakDays: number; logged: boolean; needG: number }
): { title: string; body: string } {
  const copy = PUSH_COPY[tone];
  const body =
    s.streakDays > 0
      ? copy.streak(s.needG, s.streakDays)
      : s.logged
        ? copy.remaining(s.needG)
        : copy.meals[mealId].fallback;
  return { title: copy.meals[mealId].title, body };
}

export async function runMealReminders(env: Env, scheduledTime: number): Promise<void> {
  const meal = MEALS[new Date(scheduledTime).getUTCHours()];
  if (!meal) return;
  const taipeiToday = new Date(scheduledTime + 8 * 3600_000).toISOString().slice(0, 10);
  const utcDate = new Date(scheduledTime).toISOString().slice(0, 10);

  const { results: subs } = await env.DB.prepare("SELECT * FROM push_subscriptions").all<SubRow>();
  const byUser = new Map<number, SubRow[]>();
  for (const s of subs) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  for (const [userId, userSubs] of byUser) {
    const { results } = await env.DB.prepare(
      "SELECT key, value FROM user_settings WHERE user_id = ? AND key IN (?, 'coach_tone')"
    )
      .bind(userId, meal.key)
      .all<{ key: string; value: string }>();
    const prefs = Object.fromEntries(results.map((r) => [r.key, r.value]));
    if (prefs[meal.key] === "0") continue; // toggled off (default on)
    const tone = normalizeTone(prefs.coach_tone);

    const { targetG, minG } = await proteinSettings(env.DB, userId);
    const g = await computeGamify(env.DB, userId, taipeiToday, targetG, minG);
    if (g.today.min_met) continue; // quiet rule: today's streak is already safe

    let hasMealLog: boolean;
    if (meal.sinceUtcTime === null) {
      hasMealLog = g.today.logged;
    } else {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ? AND date = ? AND created_at >= ?"
      )
        .bind(userId, taipeiToday, `${utcDate} ${meal.sinceUtcTime}`)
        .first<{ n: number }>();
      hasMealLog = (row?.n ?? 0) > 0;
    }
    if (hasMealLog) continue;

    const need = Math.max(1, Math.ceil(minG - g.today.protein_g));
    const { title, body } = reminderContent(tone, meal.id, {
      streakDays: g.streak_days,
      logged: g.today.logged,
      needG: need,
    });

    for (const sub of userSubs) {
      await sendPush(env, sub, { title, body, url: "/#/food", tag: `meal-${meal.id}` });
    }
  }
}
