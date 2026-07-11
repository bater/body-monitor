// Duolingo-style score/level/streak, derived on read from existing tables —
// no event log, so edits and deletes self-heal the score. History is
// evaluated against the CURRENT target/min values (accepted simplification).

export type Gamify = {
  streak_days: number;
  xp: number;
  level: number;
  level_start_xp: number;
  next_level_xp: number;
  today: {
    logged: boolean;
    protein_g: number;
    min_g: number;
    target_g: number;
    min_met: boolean;
    target_met: boolean;
  };
};

const XP_LOG_DAY = 10; // day with ≥1 food log
const XP_MIN_DAY = 10; // day protein ≥ 最低 (keeps the streak)
const XP_TARGET_DAY = 20; // day protein ≥ 目標 (on top of the min award)
const XP_WORKOUT_DAY = 15; // bonus — workouts are never required
const XP_INBODY = 20; // per InBody record
const XP_STREAK_WEEK = 50; // every full 7 days inside a qualifying run

/** Days since epoch; date strings are plain YYYY-MM-DD local days, so UTC math is gap-safe. */
function dayNum(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Advancing from level L costs 100×L XP, so level L starts at 100×L×(L−1)/2 cumulative. */
function levelFromXp(xp: number): { level: number; level_start_xp: number; next_level_xp: number } {
  let level = 1;
  while ((100 * level * (level + 1)) / 2 <= xp) level++;
  return {
    level,
    level_start_xp: (100 * level * (level - 1)) / 2,
    next_level_xp: (100 * level * (level + 1)) / 2,
  };
}

export async function computeGamify(
  db: D1Database,
  userId: number,
  date: string, // client's local "today", YYYY-MM-DD
  targetG: number,
  minG: number
): Promise<Gamify> {
  const [foodDays, workoutDays, inbody] = await Promise.all([
    db
      .prepare("SELECT date, SUM(protein_g) AS protein FROM food_logs WHERE user_id = ? GROUP BY date")
      .bind(userId)
      .all<{ date: string; protein: number | null }>(),
    db
      .prepare("SELECT COUNT(DISTINCT date) AS n FROM workout_entries WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM inbody_records WHERE user_id = ?").bind(userId).first<{ n: number }>(),
  ]);

  let xp = (workoutDays?.n ?? 0) * XP_WORKOUT_DAY + (inbody?.n ?? 0) * XP_INBODY;

  const qualifying: number[] = [];
  let todayProtein = 0;
  let todayLogged = false;
  for (const row of foodDays.results) {
    const p = row.protein ?? 0;
    xp += XP_LOG_DAY;
    if (p >= minG) {
      xp += XP_MIN_DAY;
      qualifying.push(dayNum(row.date));
    }
    if (p >= targetG) xp += XP_TARGET_DAY;
    if (row.date === date) {
      todayLogged = true;
      todayProtein = p;
    }
  }

  // Walk qualifying days in order, tracking consecutive runs. The current
  // streak is the run reaching today — or yesterday, since an unfinished
  // today shouldn't break the chain (Duolingo behavior).
  qualifying.sort((a, b) => a - b);
  const todayN = dayNum(date);
  let streak = 0;
  let runLen = 0;
  for (let i = 0; i < qualifying.length; i++) {
    runLen = i > 0 && qualifying[i] === qualifying[i - 1] + 1 ? runLen + 1 : 1;
    if (runLen % 7 === 0) xp += XP_STREAK_WEEK;
    if (qualifying[i] === todayN || qualifying[i] === todayN - 1) streak = runLen;
  }

  return {
    streak_days: streak,
    xp,
    ...levelFromXp(xp),
    today: {
      logged: todayLogged,
      protein_g: todayProtein,
      min_g: minG,
      target_g: targetG,
      min_met: todayLogged && todayProtein >= minG,
      target_met: todayLogged && todayProtein >= targetG,
    },
  };
}
