import { api, ApiError, type Dashboard } from "../api";
import { h, toast, todayStr, fmt } from "../ui";
import { lineChart } from "../chart";

const PLATE_G = 20; // one「槓片」segment of the protein track = 20 g

// level-band titles, Duolingo-style; last entry ≤ level wins
const LEVEL_TITLES: [number, string][] = [
  [1, "初心者"],
  [3, "便當戰士"],
  [5, "蛋白質學徒"],
  [8, "增肌行者"],
  [12, "健體老手"],
  [16, "鋼鐵廚神"],
  [20, "傳說體魄"],
];

export function renderDashboard(page: HTMLElement) {
  page.replaceChildren(h("div", { class: "empty" }, "載入中…"));

  void (async () => {
    let d: Dashboard;
    try {
      d = await api.get<Dashboard>(`/api/dashboard?date=${todayStr()}`);
    } catch (e) {
      page.replaceChildren(h("div", { class: "empty" }, e instanceof ApiError ? e.message : "載入失敗"));
      return;
    }

    const g = d.gamify;
    const status = !g.today.logged
      ? "今天還沒記錄飲食"
      : !g.today.min_met
        ? `再 ${fmt(g.today.min_g - g.today.protein_g)} g 保住連勝`
        : !g.today.target_met
          ? `連勝保住 ✓ 再 ${fmt(g.today.target_g - g.today.protein_g)} g 達標`
          : "今日全達成 ✓";
    const title = LEVEL_TITLES.filter(([lv]) => g.level >= lv).pop()![1];
    const xpPct = Math.min(1, (g.xp - g.level_start_xp) / (g.next_level_xp - g.level_start_xp));
    const gamifyCard = h(
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

    const met = d.protein_g >= d.protein_target_g;
    const plateCount = Math.max(1, Math.ceil(d.protein_target_g / PLATE_G));
    const track = h("div", { class: `plate-track${met ? " met" : ""}`, role: "img", "aria-label": `蛋白質進度 ${fmt(d.protein_g)} / ${d.protein_target_g} g` });
    for (let i = 0; i < plateCount; i++) {
      const plateStart = i * PLATE_G;
      const filled = Math.max(0, Math.min(1, (d.protein_g - plateStart) / PLATE_G));
      const fill = h("i", { style: `transform: scaleX(${filled.toFixed(3)})` });
      track.append(h("div", { class: "plate" }, fill));
    }

    const quickInput = h("input", { type: "text", placeholder: "剛吃了什麼？例：雞胸肉200g" });
    const goParse = () => {
      if (!quickInput.value.trim()) return toast("請先輸入內容");
      sessionStorage.setItem("quickFoodText", quickInput.value.trim());
      location.hash = "#/food";
    };
    quickInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") goParse();
    });

    const hero = h(
      "div",
      { class: "card protein-hero" },
      h("div", { class: "eyebrow" }, "今日蛋白質 PROTEIN"),
      h(
        "div",
        { class: "readout" },
        h("span", { class: `value num${met ? " met" : ""}` }, fmt(d.protein_g)),
        h("span", { class: "unit num" }, `/ ${d.protein_target_g} g`)
      ),
      track,
      h(
        "div",
        { class: "muted small num" },
        met ? "已達標 ✓" : `還差 ${fmt(d.protein_target_g - d.protein_g)} g`,
        d.calories ? ` ・ ${fmt(d.calories, 0)} kcal` : "",
        ` ・ ${d.food_entries} 筆`
      ),
      h(
        "div",
        { class: "btn-row", style: "margin-top:12px" },
        h("span", { class: "grow" }, quickInput),
        h("button", { class: "btn primary", onclick: goParse }, "記錄")
      )
    );

    const chartCard = (label: string, points: { x: string; y: number }[], unit: string, link?: HTMLElement) =>
      h("div", { class: "card" }, h("div", { class: "eyebrow" }, label), lineChart(points, { unit, height: 120 }), link);

    const proteinCard = chartCard(
      "每日蛋白質 (G)",
      d.food_daily.map((f) => ({ x: f.date, y: f.protein_g })),
      "g"
    );
    const muscleCard = chartCard(
      "肌肉重 (KG)",
      d.inbody_trend
        .filter((r) => r.skeletal_muscle_mass_kg != null)
        .map((r) => ({ x: r.date, y: Number(r.skeletal_muscle_mass_kg) })),
      "kg"
    );
    const fatCard = chartCard(
      "體脂率 (%)",
      d.inbody_trend.filter((r) => r.body_fat_percent != null).map((r) => ({ x: r.date, y: Number(r.body_fat_percent) })),
      "%",
      h("a", { href: "#/inbody", class: "muted small", style: "display:block;margin-top:8px;color:var(--accent);text-decoration:none" }, "InBody 詳細 →")
    );

    page.replaceChildren(gamifyCard, hero, proteinCard, muscleCard, fatCard);
  })();
}
