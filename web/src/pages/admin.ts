import { api, ApiError } from "../api";
import { h, toast, fmtDateShort } from "../ui";

type Invite = {
  id: number;
  created_at: string;
  expires_at: string;
  used_by_email: string | null;
  status: "active" | "used" | "expired";
};

type Person = {
  email: string;
  name: string | null;
  note: string | null;
  status: "waiting" | "invited" | "active";
  created_at: string;
  invited_at: string | null;
  waitlist_id: number | null;
  user_id: number | null;
  is_admin: number;
};

// Status badge shown next to each person's email.
function statusBadge(p: Person): HTMLElement {
  if (p.status === "active") {
    return h(
      "span",
      { class: "small", style: "color:var(--good)" },
      "已加入",
      p.is_admin ? h("span", { class: "muted" }, "・管理員") : ""
    );
  }
  if (p.status === "invited") {
    return h("span", { class: "small muted" }, `已邀請 ${p.invited_at?.slice(0, 10) ?? ""}`);
  }
  return h("span", { class: "small", style: "color:var(--warn,var(--ink-3))" }, "候補中");
}

function peopleCard(): HTMLElement {
  const listBox = h("div");
  const linkBox = h("div");

  async function refresh() {
    const rows = await api.get<Person[]>("/api/invite/people");
    listBox.replaceChildren(
      rows.length === 0
        ? h("div", { class: "empty" }, "目前沒有使用者")
        : h(
            "div",
            {},
            ...rows.map((p) => {
              const actions: (HTMLElement | null)[] = [];
              if (p.status === "waiting") {
                actions.push(
                  h(
                    "button",
                    {
                      class: "btn small primary",
                      onclick: async (e: Event) => {
                        const btn = e.currentTarget as HTMLButtonElement;
                        btn.disabled = true;
                        btn.textContent = "寄送中…";
                        try {
                          const res = await api.post<{
                            link: string;
                            emailed: boolean;
                            email_error: string | null;
                          }>(`/api/invite/waitlist/${p.waitlist_id}/invite`, {});
                          if (res.emailed) {
                            toast(`已寄邀請給 ${p.email}`);
                          } else {
                            toast(res.email_error ? "寄信失敗，可手動複製連結" : "已建立邀請（未設定寄信，請複製連結）");
                            showLink(p.email, res.link);
                          }
                          void refresh();
                        } catch (err) {
                          toast(err instanceof ApiError ? err.message : "邀請失敗");
                          btn.disabled = false;
                          btn.textContent = "邀請";
                        }
                      },
                    },
                    "邀請"
                  ),
                  h(
                    "button",
                    {
                      class: "icon-btn",
                      "aria-label": "移除",
                      onclick: async () => {
                        if (!confirm(`從名單移除 ${p.email}？`)) return;
                        await api.del(`/api/invite/waitlist/${p.waitlist_id}`);
                        void refresh();
                      },
                    },
                    "✕"
                  )
                );
              } else if (p.status === "invited") {
                actions.push(
                  h(
                    "button",
                    {
                      class: "btn small",
                      onclick: async (e: Event) => {
                        const btn = e.currentTarget as HTMLButtonElement;
                        if (!confirm(`撤銷 ${p.email} 的邀請？將退回候補。`)) return;
                        btn.disabled = true;
                        try {
                          await api.post(`/api/invite/waitlist/${p.waitlist_id}/revoke`, {});
                          void refresh();
                        } catch (err) {
                          toast(err instanceof ApiError ? err.message : "撤銷失敗");
                          btn.disabled = false;
                        }
                      },
                    },
                    "撤銷"
                  )
                );
              }
              return h(
                "div",
                { class: "entry" },
                h(
                  "div",
                  { class: "row", style: "display:flex;align-items:baseline;gap:8px" },
                  h(
                    "span",
                    { class: "grow", style: "flex:1;min-width:0;word-break:break-all" },
                    p.email,
                    "　",
                    statusBadge(p)
                  ),
                  ...actions
                ),
                p.note ? h("div", { class: "small muted", style: "margin-top:2px" }, `「${p.note}」`) : null
              );
            })
          )
    );
  }

  function showLink(email: string, link: string) {
    const input = h("input", { type: "text", value: link, readonly: "true" });
    linkBox.replaceChildren(
      h(
        "div",
        { class: "btn-row", style: "margin-top:8px" },
        h("span", { class: "grow" }, input),
        h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              await navigator.clipboard.writeText(link);
              toast(`已複製 ${email} 的邀請連結`);
            },
          },
          "複製"
        )
      )
    );
  }

  const testBtn = h(
    "button",
    {
      class: "btn small",
      style: "margin-bottom:8px",
      onclick: async (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          const res = await api.post<{ ok: boolean; to: string; error?: string }>(
            "/api/invite/test-email",
            {}
          );
          if (res.ok) toast(`已寄測試信到 ${res.to}`);
          else toast(res.error ? `寄信失敗：${res.error}` : "寄信失敗（未設定 Gmail）");
        } catch (err) {
          toast(err instanceof ApiError ? err.message : "寄信失敗");
        } finally {
          btn.disabled = false;
        }
      },
    },
    "寄測試信到我的信箱"
  );

  const card = h(
    "div",
    { class: "card" },
    h("div", { class: "eyebrow" }, "使用者管理 USERS"),
    h("p", { class: "muted small", style: "margin:0 0 8px" }, "候補中 → 已邀請 → 已加入"),
    testBtn,
    linkBox,
    listBox
  );
  void refresh().catch(() => toast("使用者名單載入失敗"));
  return card;
}

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
    h("div", { class: "eyebrow" }, "通用邀請連結"),
    h(
      "p",
      { class: "muted small", style: "margin:0 0 8px" },
      "不綁定特定 email 的分享連結；候補者的邀請請在上方使用者管理處理。"
    ),
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

export function renderAdmin(page: HTMLElement) {
  page.replaceChildren(h("div", { class: "empty" }, "載入中…"));

  void (async () => {
    const me = await api.get<{ is_admin: boolean }>("/api/me");
    if (!me.is_admin) {
      // hidden area: non-admins get a dead end, no hint of what lives here
      page.replaceChildren(h("div", { class: "empty" }, "找不到頁面"));
      return;
    }
    const health = await api.get<{ ok: boolean; ai: boolean; ai_provider: string | null }>("/api/health");

    page.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, "管理後台 ADMIN"),
        h("p", { class: "muted small" }, "此頁僅管理員可見。")
      ),
      peopleCard(),
      inviteCard(),
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
