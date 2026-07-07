import { api, ApiError, type InBodyRecord } from "../api";
import { h, toast, fmt } from "../ui";

export function renderSettings(page: HTMLElement) {
  page.replaceChildren(h("div", { class: "empty" }, "載入中…"));

  void (async () => {
    const [settings, health, records] = await Promise.all([
      api.get<Record<string, string>>("/api/settings"),
      api.get<{ ok: boolean; ai: boolean }>("/api/health"),
      api.get<InBodyRecord[]>("/api/inbody?limit=1"),
    ]);

    const targetInput = h("input", {
      type: "number",
      step: "5",
      min: "0",
      value: settings.protein_target_g ?? "120",
    });

    const latest = records[0];
    const suggestion = latest
      ? `依最新體重 ${fmt(latest.weight_kg)} kg：維持約 ${Math.round(latest.weight_kg * 1.2)} g，增肌建議 ${Math.round(latest.weight_kg * 1.6)}–${Math.round(latest.weight_kg * 2.2)} g（1.6–2.2 g/kg）`
      : "記錄一筆 InBody 後，這裡會依體重建議每日目標";

    page.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "每日蛋白質目標"),
        h("label", { class: "field" }, h("span", {}, "目標 (g)"), targetInput),
        h("p", { class: "muted small", style: "margin-bottom:10px" }, suggestion),
        h(
          "button",
          {
            class: "btn primary",
            style: "width:100%",
            onclick: async () => {
              const v = Number(targetInput.value);
              if (!(v > 0)) return toast("請輸入有效目標");
              try {
                await api.put("/api/settings", { protein_target_g: String(v) });
                toast("已更新目標");
              } catch (e) {
                toast(e instanceof ApiError ? e.message : "儲存失敗");
              }
            },
          },
          "儲存"
        )
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "AI 功能狀態"),
        h(
          "p",
          { class: "small" },
          health.ai
            ? "✓ Gemini 已連線 — 飲食 AI 解析與 InBody 照片讀取可用"
            : "✗ 尚未設定 GEMINI_API_KEY — AI 解析停用中，仍可手動輸入。部署後執行 wrangler secret put GEMINI_API_KEY 啟用。"
        )
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "關於"),
        h("p", { class: "muted small" }, "體態日誌 v0.1 — 單人使用。資料存於 Cloudflare D1，照片存於 R2，由 Cloudflare Access 保護。")
      )
    );
  })().catch((e) => {
    page.replaceChildren(h("div", { class: "empty" }, e instanceof ApiError ? e.message : "載入失敗"));
  });
}
