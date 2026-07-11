import { api, ApiError, type Gamify, type InBodyRecord, type JourneyEntry } from "../api";
import { h, toast, fmt, fmtDateShort, todayStr } from "../ui";
import { levelTitle } from "../gamify";

type Invite = {
  id: number;
  created_at: string;
  expires_at: string;
  used_by_email: string | null;
  status: "active" | "used" | "expired";
};

function inviteCard(): HTMLElement {
  const linkBox = h("div");
  const listBox = h("div");

  async function refresh() {
    const invites = await api.get<Invite[]>("/api/invite");
    const label = { active: "未使用", used: "已使用", expired: "已過期" } as const;
    listBox.replaceChildren(
      ...invites.map((inv) =>
        h(
          "div",
          { class: "entry" },
          h(
            "div",
            { class: "row" },
            h(
              "span",
              { class: "grow small" },
              `建立 ${fmtDateShort(inv.created_at.slice(0, 10))} ・ 效期至 ${inv.expires_at.slice(0, 10)}`
            ),
            h(
              "span",
              { class: "small", style: inv.status === "active" ? "color:var(--good)" : "color:var(--ink-3)" },
              label[inv.status],
              inv.used_by_email ? `：${inv.used_by_email}` : ""
            ),
            inv.status === "active"
              ? h(
                  "button",
                  {
                    class: "icon-btn",
                    "aria-label": "撤銷",
                    onclick: async () => {
                      if (!confirm("撤銷這個邀請連結？")) return;
                      await api.del(`/api/invite/${inv.id}`);
                      void refresh();
                    },
                  },
                  "✕"
                )
              : null
          )
        )
      )
    );
  }

  const card = h(
    "div",
    { class: "card" },
    h("div", { class: "eyebrow" }, "邀請管理"),
    h(
      "button",
      {
        class: "btn primary",
        style: "width:100%;margin-bottom:8px",
        onclick: async (e: Event) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.disabled = true;
          try {
            const { link } = await api.post<{ link: string }>("/api/invite", {});
            const input = h("input", { type: "text", value: link, readonly: "true" });
            linkBox.replaceChildren(
              h(
                "div",
                { class: "btn-row", style: "margin-bottom:8px" },
                h("span", { class: "grow" }, input),
                h(
                  "button",
                  {
                    class: "btn",
                    onclick: async () => {
                      await navigator.clipboard.writeText(link);
                      toast("已複製邀請連結");
                    },
                  },
                  "複製"
                )
              )
            );
            void refresh();
          } catch (err) {
            toast(err instanceof ApiError ? err.message : "建立失敗");
          } finally {
            btn.disabled = false;
          }
        },
      },
      "建立邀請連結（7 天內有效，限用一次）"
    ),
    linkBox,
    listBox
  );
  void refresh().catch(() => toast("邀請清單載入失敗"));
  return card;
}

export function renderSettings(page: HTMLElement) {
  page.replaceChildren(h("div", { class: "empty" }, "載入中…"));

  void (async () => {
    const [settings, health, records, me, growth] = await Promise.all([
      api.get<Record<string, string>>("/api/settings"),
      api.get<{ ok: boolean; ai: boolean; ai_provider: string | null }>("/api/health"),
      api.get<InBodyRecord[]>("/api/inbody?limit=1"),
      api.get<{ email: string; name: string; is_admin: boolean; logout_url: string | null }>("/api/me"),
      api.get<{ current: Gamify; journey: JourneyEntry[] }>(`/api/gamify/journey?date=${todayStr()}`),
    ]);

    const targetInput = h("input", {
      type: "number",
      step: "5",
      min: "0",
      value: settings.protein_target_g ?? "120",
    });
    const minInput = h("input", {
      type: "number",
      step: "5",
      min: "0",
      value:
        settings.protein_min_g ??
        String(Math.round(Number(settings.protein_target_g ?? "120") * 0.75)),
    });

    const latest = records[0];
    const suggestion = latest
      ? `依最新體重 ${fmt(latest.weight_kg)} kg：維持約 ${Math.round(latest.weight_kg * 1.2)} g，增肌建議 ${Math.round(latest.weight_kg * 1.6)}–${Math.round(latest.weight_kg * 2.2)} g（1.6–2.2 g/kg）`
      : "記錄一筆 InBody 後，這裡會依體重建議每日目標";

    page.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "登入身分"),
        h(
          "div",
          { class: "row", style: "display:flex;align-items:baseline;gap:8px" },
          h("span", { class: "grow", style: "flex:1" }, me.email),
          me.logout_url
            ? h(
                "a",
                { href: me.logout_url, class: "btn small", style: "text-decoration:none" },
                "登出"
              )
            : null
        )
      ),
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "每日蛋白質目標"),
        h("label", { class: "field" }, h("span", {}, "目標 (g)"), targetInput),
        h("label", { class: "field" }, h("span", {}, "最低 (g)"), minInput),
        h(
          "p",
          { class: "muted small" },
          "達到「最低」保住 🔥 連勝；達到「目標」拿滿當日 XP。"
        ),
        h("p", { class: "muted small", style: "margin-bottom:10px" }, suggestion),
        h(
          "button",
          {
            class: "btn primary",
            style: "width:100%",
            onclick: async () => {
              const v = Number(targetInput.value);
              const m = Number(minInput.value);
              if (!(v > 0)) return toast("請輸入有效目標");
              if (!(m > 0) || m > v) return toast("最低需大於 0 且不高於目標");
              try {
                await api.put("/api/settings", {
                  protein_target_g: String(v),
                  protein_min_g: String(m),
                });
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
        h("div", { class: "eyebrow" }, "成長日誌 JOURNEY"),
        h(
          "div",
          { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px" },
          h("span", { class: "level-badge num" }, `Lv ${growth.current.level}`),
          h("span", {}, levelTitle(growth.current.level)),
          h(
            "span",
            { class: "muted small num", style: "flex:1;text-align:right" },
            `🔥 ${growth.current.streak_days} 天 ・ 累積 ${growth.current.xp} XP`
          )
        ),
        growth.journey.length === 0
          ? h("div", { class: "empty" }, "開始記錄飲食後，這裡會寫下你的成長軌跡")
          : h(
              "div",
              {},
              ...[...growth.journey].reverse().map((e) =>
                h(
                  "div",
                  { class: "entry", style: "display:flex;gap:10px;align-items:baseline" },
                  h("span", { class: "num muted small", style: "min-width:40px" }, fmtDateShort(e.date)),
                  h(
                    "span",
                    { style: "flex:1" },
                    e.level === 1 ? "🌱 開始記錄，旅程展開" : `⬆️ 升上 Lv ${e.level}・${levelTitle(e.level)}`
                  ),
                  e.level === 1 ? "" : h("span", { class: "muted small num" }, `${e.xp} XP`)
                )
              )
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
            ? `✓ AI 已連線（${health.ai_provider}）— 飲食解析與 InBody 照片讀取可用`
            : "✗ 尚未設定 AI key — AI 解析停用中，仍可手動輸入。以 wrangler secret put 設定 MISTRAL_API_KEY 或 OPENROUTER_API_KEY 啟用。"
        )
      ),
      ...(me.is_admin ? [inviteCard()] : []),
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "關於"),
        h("p", { class: "muted small" }, "Body Buddy — 資料存於 Cloudflare D1，照片存於 R2，由 Cloudflare Access 保護。")
      )
    );
  })().catch((e) => {
    page.replaceChildren(h("div", { class: "empty" }, e instanceof ApiError ? e.message : "載入失敗"));
  });
}
