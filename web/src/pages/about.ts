import { h } from "../ui";
import { APP_VERSION, VERSION_HISTORY } from "../version";

const FEATURES: { icon: string; title: string; desc: string }[] = [
  {
    icon: "🍱",
    title: "AI 飲食記錄",
    desc: "一句話寫下吃了什麼，AI 自動解析成品項、蛋白質與熱量",
  },
  {
    icon: "🏋️",
    title: "訓練記錄",
    desc: "重量 × 次數 × 組數，動作庫肌群分組，每個動作有進步曲線與完整歷史",
  },
  {
    icon: "📷",
    title: "InBody 拍照匯入",
    desc: "報告拍一張照，自動讀取體重、骨骼肌、體脂率等數值",
  },
  {
    icon: "📈",
    title: "趨勢圖表",
    desc: "蛋白質、熱量、體重、骨骼肌、體脂率的變化一目了然",
  },
  {
    icon: "🎮",
    title: "遊戲化",
    desc: "XP、等級、🔥 連勝與成長日誌，把習慣養成變好玩",
  },
  {
    icon: "🔔",
    title: "聰明用餐提醒",
    desc: "用餐時間沒記錄才推播，當天達標就自動安靜",
  },
  {
    icon: "🤖",
    title: "AI 教練",
    desc: "達標、破紀錄的重要時刻給你回饋，友善／嚴格／專業三種風格",
  },
  {
    icon: "👨‍👩‍👧‍👦",
    title: "邀請制多人",
    desc: "邀請連結讓家人朋友加入，各自的資料完全獨立",
  },
];

export function renderAbout(page: HTMLElement) {
  page.replaceChildren(
    h(
      "div",
      { class: "card", style: "text-align:center" },
      h("div", { style: "font-size:28px;font-weight:700" }, "Body Buddy"),
      h("div", { class: "muted small num", style: "margin-top:2px" }, `v${APP_VERSION}`),
      h(
        "p",
        { style: "margin-top:10px" },
        "你的隨身健身管家：吃進多少蛋白質、練了多重、身體組成怎麼變，一個 App 全記下。"
      ),
      h(
        "p",
        { class: "muted small", style: "margin-top:6px" },
        "免安裝 PWA・無廣告・資料自有"
      )
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, `${FEATURES.length} 大功能`),
      ...FEATURES.map((f) =>
        h(
          "div",
          { class: "entry", style: "display:flex;gap:10px;align-items:baseline" },
          h("span", {}, f.icon),
          h(
            "span",
            { style: "flex:1" },
            h("span", { style: "font-weight:600" }, f.title),
            h("span", { class: "muted small" }, `　${f.desc}`)
          )
        )
      )
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, "版本紀錄"),
      ...VERSION_HISTORY.map((v) =>
        h(
          "div",
          { class: "entry" },
          h(
            "div",
            { style: "display:flex;gap:8px;align-items:baseline" },
            h("span", { class: "num", style: "font-weight:600" }, `v${v.version}`),
            h("span", { class: "muted small num" }, v.date)
          ),
          ...v.highlights.map((t) => h("div", { class: "small", style: "margin-top:3px" }, `・${t}`))
        )
      )
    ),
    h(
      "a",
      { href: "#/settings", class: "muted small", style: "color:var(--accent);text-decoration:none;padding:4px" },
      "← 返回設定"
    )
  );
}
