import { describe, it, expect } from "vitest";
import {
  buildCoachUserContent,
  COACH_SYSTEM_PROMPTS,
  COACH_TONES,
  foodCoach,
  inbodyCoach,
  normalizeTone,
  workoutCoach,
  type FoodCoachInput,
  type FoodCtx,
  type InBodyCoachInput,
  type WorkoutCoachInput,
} from "./coach";
import { reminderContent } from "./push";

function food(over: Partial<FoodCoachInput> = {}): FoodCoachInput {
  return {
    isToday: true,
    date: "2026-07-11",
    prevTotalG: 0,
    newTotalG: 50,
    targetG: 120,
    minG: 90,
    isFirstEver: false,
    streakDays: 3,
    streakJustQualified: false,
    ...over,
  };
}

describe("foodCoach", () => {
  it("first-ever log is notable", () => {
    const c = foodCoach(food({ isFirstEver: true }));
    expect(c).toMatchObject({ notable: true, event: "first_food" });
    expect(c.message).toContain("120");
  });

  it("below min: shows remaining grams to 最低", () => {
    const c = foodCoach(food({ newTotalG: 50 }));
    expect(c).toMatchObject({ notable: false, event: null });
    expect(c.message).toContain("40"); // 90 − 50
  });

  it("min crossed is not notable but confirms the streak", () => {
    const c = foodCoach(food({ prevTotalG: 60, newTotalG: 95, streakJustQualified: true }));
    expect(c).toMatchObject({ notable: false, event: null });
    expect(c.message).toContain("25"); // 120 − 95 to target
  });

  it("target crossed on a multi-log day is notable", () => {
    const c = foodCoach(food({ prevTotalG: 100, newTotalG: 132 }));
    expect(c).toMatchObject({ notable: true, event: "target_crossed" });
    expect(c.message).toContain("132");
  });

  it("second log already above target is not notable", () => {
    const c = foodCoach(food({ prevTotalG: 125, newTotalG: 150 }));
    expect(c).toMatchObject({ notable: false, event: null });
  });

  it("backdated log is never notable, even when it would cross the target", () => {
    const c = foodCoach(food({ isToday: false, prevTotalG: 100, newTotalG: 132, isFirstEver: true }));
    expect(c).toMatchObject({ notable: false, event: null });
    expect(c.message).toContain("2026-07-11");
  });

  it("streak milestone 7 fires only when this log qualified the day", () => {
    const hit = foodCoach(food({ prevTotalG: 60, newTotalG: 95, streakDays: 7, streakJustQualified: true }));
    expect(hit).toMatchObject({ notable: true, event: "streak_milestone" });
    expect(hit.message).toContain("7");
  });

  it("streak 8 is not a milestone", () => {
    const c = foodCoach(food({ prevTotalG: 60, newTotalG: 95, streakDays: 8, streakJustQualified: true }));
    expect(c.event).not.toBe("streak_milestone");
  });

  it("streak 7 without just-qualifying (second log of the day) does not double-fire", () => {
    const c = foodCoach(food({ prevTotalG: 95, newTotalG: 110, streakDays: 7, streakJustQualified: false }));
    expect(c.event).not.toBe("streak_milestone");
  });
});

function workout(over: Partial<WorkoutCoachInput> = {}): WorkoutCoachInput {
  return {
    isToday: true,
    exerciseName: "臥推",
    weightKg: 80,
    reps: 8,
    sets: 3,
    volume: 80 * 8 * 3,
    prevMaxKg: 77.5,
    prevSessionVolume: 1860,
    isFirstEver: false,
    ...over,
  };
}

describe("workoutCoach", () => {
  it("first-ever entry is notable", () => {
    const c = workout({ isFirstEver: true, prevMaxKg: null, prevSessionVolume: null });
    expect(workoutCoach(c)).toMatchObject({ notable: true, event: "first_workout" });
  });

  it("first time for an exercise is not notable", () => {
    const c = workoutCoach(workout({ prevMaxKg: null, prevSessionVolume: null }));
    expect(c).toMatchObject({ notable: false, event: null });
    expect(c.message).toContain("臥推");
  });

  it("strict PR is notable", () => {
    const c = workoutCoach(workout({ weightKg: 80, prevMaxKg: 77.5 }));
    expect(c).toMatchObject({ notable: true, event: "pr" });
    expect(c.message).toContain("77.5");
  });

  it("equal weight is not a PR", () => {
    const c = workoutCoach(workout({ weightKg: 77.5, prevMaxKg: 77.5, volume: 77.5 * 8 * 3 }));
    expect(c.event).not.toBe("pr");
  });

  it("volume increase reports delta and percent", () => {
    const c = workoutCoach(workout({ weightKg: 75, prevMaxKg: 80, volume: 1920, prevSessionVolume: 1860 }));
    expect(c).toMatchObject({ notable: false, event: null });
    expect(c.message).toContain("60"); // 1920 − 1860
    expect(c.message).toContain("+3%"); // round(60/1860×100)
  });

  it("backdated PR is not notable", () => {
    const c = workoutCoach(workout({ isToday: false, weightKg: 80, prevMaxKg: 77.5 }));
    expect(c).toMatchObject({ notable: false, event: null });
    expect(c.message).toContain("破個人紀錄");
  });
});

describe("inbodyCoach", () => {
  const prev = { date: "2026-06-08", weightKg: 75.0, smmKg: 32.8, pbf: 19.0 };

  it("first record (no prev) is notable", () => {
    const c = inbodyCoach({ weightKg: 74.2, smmKg: 33.1, pbf: 18.2, prev: null });
    expect(c).toMatchObject({ notable: true, event: "inbody_new" });
  });

  it("muscle up + fat down takes the 增肌減脂 branch", () => {
    const c = inbodyCoach({ weightKg: 74.2, smmKg: 33.1, pbf: 18.2, prev });
    expect(c).toMatchObject({ notable: true, event: "inbody_new" });
    expect(c.message).toContain("增肌減脂");
    expect(c.message).toContain("+0.3");
    expect(c.message).toContain("-0.8");
  });

  it("null smm is omitted without NaN", () => {
    const c = inbodyCoach({ weightKg: 74.2, smmKg: null, pbf: 20.1, prev });
    expect(c.message).not.toContain("NaN");
    expect(c.message).not.toContain("骨骼肌");
    expect(c.message).toContain("體脂 +1.1%");
  });

  it("weight delta is signed", () => {
    const c = inbodyCoach({ weightKg: 74.2, smmKg: 32.5, pbf: 19.5, prev });
    expect(c.message).toContain("體重 -0.8 kg");
    expect(c.message).toContain("骨骼肌 -0.3 kg");
  });
});

describe("reminderContent follows the coach tone", () => {
  it("streak body varies by tone and always carries the numbers", () => {
    const s = { streakDays: 12, logged: true, needG: 30 };
    const bodies = COACH_TONES.map((t) => reminderContent(t, "lunch", s).body);
    expect(new Set(bodies).size).toBe(COACH_TONES.length);
    for (const b of bodies) {
      expect(b).toContain("30");
      expect(b).toContain("12");
    }
  });

  it("no-log-yet uses the per-meal fallback; titles differ by tone", () => {
    const s = { streakDays: 0, logged: false, needG: 90 };
    expect(reminderContent("friendly", "breakfast", s).body).toContain("第一餐");
    expect(reminderContent("strict", "dinner", s).title).toContain("最後機會");
    expect(reminderContent("professional", "lunch", s).title).toBe("午餐記錄提醒");
  });

  it("logged but below min uses the remaining template", () => {
    const s = { streakDays: 0, logged: true, needG: 25 };
    for (const t of COACH_TONES) expect(reminderContent(t, "dinner", s).body).toContain("25");
  });
});

describe("coach tones", () => {
  it("every tone has a distinct prompt that keeps the shared output contract", () => {
    const prompts = COACH_TONES.map((t) => COACH_SYSTEM_PROMPTS[t]);
    expect(new Set(prompts).size).toBe(COACH_TONES.length);
    for (const p of prompts) {
      expect(p).toContain('{"message":"..."}');
      expect(p).toContain("繁體中文");
      expect(p).toContain("禁止醫療診斷");
    }
  });

  it("normalizeTone falls back to friendly on unknown values", () => {
    expect(normalizeTone("strict")).toBe("strict");
    expect(normalizeTone("professional")).toBe("professional");
    expect(normalizeTone("bogus")).toBe("friendly");
    expect(normalizeTone(undefined)).toBe("friendly");
  });
});

describe("buildCoachUserContent", () => {
  it("food content has only the protein section, rounded to 1 decimal", () => {
    const ctx: FoodCtx = {
      kind: "food",
      date: "2026-07-11",
      input: food({ newTotalG: 132.04, prevTotalG: 100 }),
      avg7G: 105,
      targetDays7: 3,
    };
    const parsed = JSON.parse(buildCoachUserContent(ctx, "target_crossed"));
    expect(parsed).toMatchObject({
      kind: "food",
      event: "target_crossed",
      protein: { today_g: 132, target_g: 120, min_g: 90, avg7_g: 105, target_days_7: 3 },
    });
    expect(parsed.workout).toBeUndefined();
    expect(parsed.inbody).toBeUndefined();
  });

  it("workout content omits null prev fields", () => {
    const parsed = JSON.parse(
      buildCoachUserContent(
        {
          kind: "workout",
          date: "2026-07-11",
          input: workout({ prevMaxKg: null, prevSessionVolume: null }),
          sessions30d: 9,
        },
        "first_workout"
      )
    );
    expect(parsed.workout.prev_max_kg).toBeUndefined();
    expect(parsed.workout.prev_volume).toBeUndefined();
    expect(parsed.workout.sessions_30d).toBe(9);
  });

  it("inbody content nests prev when present", () => {
    const input: InBodyCoachInput = {
      weightKg: 74.25,
      smmKg: 33.1,
      pbf: 18.2,
      prev: { date: "2026-06-08", weightKg: 75, smmKg: 32.8, pbf: 19 },
    };
    const parsed = JSON.parse(buildCoachUserContent({ kind: "inbody", date: "2026-07-11", input }, "inbody_new"));
    expect(parsed.inbody.weight_kg).toBe(74.3);
    expect(parsed.inbody.prev).toMatchObject({ date: "2026-06-08", weight_kg: 75 });
  });
});
