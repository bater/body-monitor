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

export type JourneyEntry = { date: string; level: number; xp: number };

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

/** Current 目標/最低 for a user; 最低 defaults to 75% of 目標 when unset. */
export async function proteinSettings(
  db: D1Database,
  userId: number
): Promise<{ targetG: number; minG: number }> {
  const { results } = await db
    .prepare(
      "SELECT key, value FROM user_settings WHERE user_id = ? AND key IN ('protein_target_g','protein_min_g')"
    )
    .bind(userId)
    .all<{ key: string; value: string }>();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const targetG = Number(s.protein_target_g ?? 120);
  const minG = Number(s.protein_min_g ?? Math.round(targetG * 0.75));
  return { targetG, minG };
}

type Raw = {
  foodDays: { date: string; protein: number | null }[];
  workoutDates: string[];
  inbodyDates: string[];
};

async function loadRaw(db: D1Database, userId: number): Promise<Raw> {
  const [foodDays, workoutDates, inbodyDates] = await Promise.all([
    db
      .prepare("SELECT date, SUM(protein_g) AS protein FROM food_logs WHERE user_id = ? GROUP BY date")
      .bind(userId)
      .all<{ date: string; protein: number | null }>(),
    db.prepare("SELECT DISTINCT date FROM workout_entries WHERE user_id = ?").bind(userId).all<{ date: string }>(),
    db.prepare("SELECT date FROM inbody_records WHERE user_id = ?").bind(userId).all<{ date: string }>(),
  ]);
  return {
    foodDays: foodDays.results,
    workoutDates: workoutDates.results.map((r) => r.date),
    inbodyDates: inbodyDates.results.map((r) => r.date),
  };
}

/** XP earned per date, plus the sorted qualifying (streak-keeping) dates. */
function xpByDate(raw: Raw, targetG: number, minG: number): { byDate: Map<string, number>; qualifying: string[] } {
  const byDate = new Map<string, number>();
  const add = (d: string, v: number) => byDate.set(d, (byDate.get(d) ?? 0) + v);

  const qualifying: string[] = [];
  for (const row of raw.foodDays) {
    const p = row.protein ?? 0;
    add(row.date, XP_LOG_DAY);
    if (p >= minG) {
      add(row.date, XP_MIN_DAY);
      qualifying.push(row.date);
    }
    if (p >= targetG) add(row.date, XP_TARGET_DAY);
  }
  for (const d of raw.workoutDates) add(d, XP_WORKOUT_DAY);
  for (const d of raw.inbodyDates) add(d, XP_INBODY);

  // weekly streak bonus lands on the day that completes each 7-day block
  qualifying.sort(); // ISO dates sort chronologically
  let runLen = 0;
  let prev = NaN;
  for (const d of qualifying) {
    const n = dayNum(d);
    runLen = n === prev + 1 ? runLen + 1 : 1;
    prev = n;
    if (runLen % 7 === 0) add(d, XP_STREAK_WEEK);
  }
  return { byDate, qualifying };
}

/** Length of the qualifying run reaching today — or yesterday, since an
 * unfinished today shouldn't break the chain (Duolingo behavior). */
function currentStreak(qualifying: string[], date: string): number {
  const todayN = dayNum(date);
  let streak = 0;
  let runLen = 0;
  let prev = NaN;
  for (const d of qualifying) {
    const n = dayNum(d);
    runLen = n === prev + 1 ? runLen + 1 : 1;
    prev = n;
    if (n === todayN || n === todayN - 1) streak = runLen;
  }
  return streak;
}

function buildGamify(raw: Raw, byDate: Map<string, number>, qualifying: string[], date: string, targetG: number, minG: number): Gamify {
  let xp = 0;
  for (const v of byDate.values()) xp += v;
  const todayRow = raw.foodDays.find((r) => r.date === date);
  const todayProtein = todayRow?.protein ?? 0;
  return {
    streak_days: currentStreak(qualifying, date),
    xp,
    ...levelFromXp(xp),
    today: {
      logged: Boolean(todayRow),
      protein_g: todayProtein,
      min_g: minG,
      target_g: targetG,
      min_met: Boolean(todayRow) && todayProtein >= minG,
      target_met: Boolean(todayRow) && todayProtein >= targetG,
    },
  };
}

export async function computeGamify(
  db: D1Database,
  userId: number,
  date: string, // client's local "today", YYYY-MM-DD
  targetG: number,
  minG: number
): Promise<Gamify> {
  const raw = await loadRaw(db, userId);
  const { byDate, qualifying } = xpByDate(raw, targetG, minG);
  return buildGamify(raw, byDate, qualifying, date, targetG, minG);
}

/** Replay XP chronologically to date each level-up; entry 1 is the first-ever record day. */
export async function computeJourney(
  db: D1Database,
  userId: number,
  date: string,
  targetG: number,
  minG: number
): Promise<{ current: Gamify; journey: JourneyEntry[] }> {
  const raw = await loadRaw(db, userId);
  const { byDate, qualifying } = xpByDate(raw, targetG, minG);

  const journey: JourneyEntry[] = [];
  const dates = [...byDate.keys()].sort();
  if (dates.length > 0) journey.push({ date: dates[0], level: 1, xp: 0 });
  let cum = 0;
  let level = 1;
  for (const d of dates) {
    cum += byDate.get(d)!;
    while ((100 * level * (level + 1)) / 2 <= cum) {
      level++;
      journey.push({ date: d, level, xp: cum });
    }
  }

  return { current: buildGamify(raw, byDate, qualifying, date, targetG, minG), journey };
}
