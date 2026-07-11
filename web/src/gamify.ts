import type { Gamify } from "./api";
import { h, fmt } from "./ui";

// level-band titles, Duolingo-style; last entry ≤ level wins
const LEVEL_TITLES: [number, string][] = [
  [1, "初心者"],
  [3, "蛋白質小子"],
  [5, "蛋白質學徒"],
  [8, "增肌行者"],
  [12, "健體老手"],
  [16, "鋼鐵廚神"],
  [20, "傳說體魄"],
];

export function levelTitle(level: number): string {
  return LEVEL_TITLES.filter(([lv]) => level >= lv).pop()![1];
}

/** Compact streak + level card shared by the dashboard and food pages. */
export function gamifyCard(g: Gamify): HTMLElement {
  const status = !g.today.logged
    ? "今天還沒記錄飲食"
    : !g.today.min_met
      ? `再 ${fmt(g.today.min_g - g.today.protein_g)} g 保住連勝`
      : !g.today.target_met
        ? `連勝保住 ✓ 再 ${fmt(g.today.target_g - g.today.protein_g)} g 達標`
        : "今日全達成 ✓";
  const title = levelTitle(g.level);
  const xpPct = Math.min(1, (g.xp - g.level_start_xp) / (g.next_level_xp - g.level_start_xp));
  return h(
    "div",
    { class: "card gamify" },
    h(
      "div",
      { class: "gamify-streak" },
      h("div", { class: "streak-num" }, "🔥 ", h("b", { class: "num" }, String(g.streak_days)), " 天"),
      h("div", { class: "muted small" }, status)
    ),
    h(
      "div",
      { class: "gamify-level" },
      h(
        "div",
        { class: "level-line" },
        h("span", { class: "level-badge num" }, `Lv ${g.level}`),
        h("span", { class: "muted small" }, title)
      ),
      h("div", { class: "xp-bar" }, h("i", { style: `transform:scaleX(${xpPct.toFixed(3)})` })),
      h("div", { class: "muted small num" }, `${g.xp} / ${g.next_level_xp} XP`)
    )
  );
}
