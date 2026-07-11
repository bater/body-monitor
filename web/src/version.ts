// Keep in sync with package.json version and CHANGELOG.md (see CHANGELOG.md
// header for the bump-on-milestone process). This file drives the 關於 page.
export const APP_VERSION = "0.0.8";

export type VersionEntry = { version: string; date: string; highlights: string[] };

// newest first
export const VERSION_HISTORY: VersionEntry[] = [
  {
    version: "0.0.8",
    date: "2026-07-11",
    highlights: ["公開登陸頁與等候名單", "後台可審核候補並一鍵寄出邀請（Gmail）"],
  },
  {
    version: "0.0.7",
    date: "2026-07-11",
    highlights: [
      "AI 教練回饋：達標、破紀錄等重要時刻給你回饋，三種風格（友善／嚴格／專業）",
      "動作詳情頁：點動作庫的動作，看完整訓練日期與組數重量",
      "InBody 歷史列表預設收合",
    ],
  },
  {
    version: "0.0.6",
    date: "2026-07-11",
    highlights: ["用餐提醒推播（iOS 主畫面 PWA）：沒記錄才提醒，達標自動安靜"],
  },
  {
    version: "0.0.5",
    date: "2026-07-11",
    highlights: ["遊戲化：XP、等級、🔥 連勝與成長日誌"],
  },
  {
    version: "0.0.4",
    date: "2026-07-10",
    highlights: ["首頁改版：蛋白質／骨骼肌／體脂趨勢圖", "飲食頁每日蛋白質與熱量趨勢"],
  },
  {
    version: "0.0.3",
    date: "2026-07-10",
    highlights: ["多人使用：邀請連結加入家人朋友", "改名 Body Buddy，全新 App 圖示"],
  },
  {
    version: "0.0.2",
    date: "2026-07-07",
    highlights: ["動作庫：動作管理與肌群分組", "訓練頁進步曲線與上次紀錄帶入"],
  },
  {
    version: "0.0.1",
    date: "2026-07-07",
    highlights: ["首發：AI 飲食記錄、訓練記錄、InBody 拍照匯入與趨勢圖"],
  },
];
