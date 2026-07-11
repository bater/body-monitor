import { api, ApiError, type Gamify, type InBodyRecord, type JourneyEntry } from "../api";
import { h, toast, fmt, fmtDateShort, todayStr } from "../ui";
import { levelTitle } from "../gamify";

const MEAL_TOGGLES: { key: string; label: string; time: string }[] = [
  { key: "reminder_breakfast", label: "早餐", time: "09:30" },
  { key: "reminder_lunch", label: "午餐", time: "13:30" },
  { key: "reminder_dinner", label: "晚餐", time: "19:30" },
];

function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function reminderCard(settings: Record<string, string>): HTMLElement {
  const body = h("div");
  const card = h(
    "div",
    { class: "card" },
    h("div", { class: "eyebrow" }, "用餐提醒"),
    body
  );

  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  const renderOff = () => {
    body.replaceChildren(
      h(
        "p",
        { class: "muted small", style: "margin-bottom:10px" },
        "用餐時間沒記錄就推播提醒（早餐 09:30・午餐 13:30・晚餐 19:30），當天達到最低蛋白質後自動安靜。"
      ),
      supported
        ? h(
            "button",
            {
              class: "btn primary",
              style: "width:100%",
              onclick: async (e: Event) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                try {
                  const perm = await Notification.requestPermission();
                  if (perm !== "granted") return toast("未授權通知，無法啟用");
                  const { key } = await api.get<{ key: string | null }>("/api/push/pubkey");
                  if (!key) return toast("伺服器尚未設定推播金鑰");
                  const reg =
                    (await navigator.serviceWorker.getRegistration()) ??
                    (await navigator.serviceWorker.register("/sw.js"));
                  await navigator.serviceWorker.ready;
                  const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlB64ToUint8Array(key).buffer as ArrayBuffer,
                  });
                  const json = sub.toJSON();
                  await api.post("/api/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
                  toast("已啟用用餐提醒");
                  renderOn(sub);
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : "啟用失敗");
                } finally {
                  btn.disabled = false;
                }
              },
            },
            "啟用提醒"
          )
        : h(
            "p",
            { class: "small" },
            "此瀏覽器不支援推播。iPhone 需 iOS 16.4+，先把 App「加入主畫面」，再從主畫面開啟後啟用。"
          )
    );
  };

  const renderOn = (sub: PushSubscription) => {
    body.replaceChildren(
      h(
        "div",
        { style: "display:flex;gap:14px;margin-bottom:10px" },
        ...MEAL_TOGGLES.map((m) => {
          const box = h("input", {
            type: "checkbox",
            onchange: async () => {
              try {
                await api.put("/api/settings", { [m.key]: box.checked ? "1" : "0" });
                toast(`${m.label}提醒${box.checked ? "已開啟" : "已關閉"}`);
              } catch {
                toast("儲存失敗");
                box.checked = !box.checked;
              }
            },
          });
          box.checked = settings[m.key] !== "0";
          return h("label", { class: "small", style: "display:flex;align-items:center;gap:5px" }, box, `${m.label} ${m.time}`);
        })
      ),
      h(
        "div",
        { class: "btn-row" },
        h(
          "button",
          {
            class: "btn small grow",
            onclick: async () => {
              try {
                const res = await api.post<{ sent: number; devices: number }>("/api/push/test", {});
                toast(`已送出測試通知（${res.sent}/${res.devices} 裝置）`);
              } catch (err) {
                toast(err instanceof ApiError ? err.message : "測試失敗");
              }
            },
          },
          "發送測試通知"
        ),
        h(
          "button",
          {
            class: "btn small",
            onclick: async () => {
              try {
                await sub.unsubscribe();
                await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
                toast("此裝置已停用提醒");
                renderOff();
              } catch {
                toast("停用失敗");
              }
            },
          },
          "停用"
        )
      )
    );
  };

  if (!supported) {
    renderOff();
  } else {
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => (sub ? renderOn(sub) : renderOff()))
      .catch(renderOff);
  }
  return card;
}

export function renderSettings(page: HTMLElement) {
  page.replaceChildren(h("div", { class: "empty" }, "載入中…"));

  void (async () => {
    const [settings, records, me, growth] = await Promise.all([
      api.get<Record<string, string>>("/api/settings"),
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
      reminderCard(settings),
      (() => {
        const box = h("input", {
          type: "checkbox",
          onchange: async () => {
            try {
              await api.put("/api/settings", { coach_enabled: box.checked ? "1" : "0" });
              toast(`AI 教練${box.checked ? "已開啟" : "已關閉"}`);
            } catch {
              toast("儲存失敗");
              box.checked = !box.checked;
            }
          },
        });
        box.checked = settings.coach_enabled !== "0";

        const TONES: { value: string; label: string; hint: string }[] = [
          { value: "friendly", label: "友善", hint: "朋友般鼓勵" },
          { value: "strict", label: "嚴格", hint: "魔鬼教練" },
          { value: "professional", label: "專業", hint: "數據導向" },
        ];
        const current = TONES.some((t) => t.value === settings.coach_tone) ? settings.coach_tone : "friendly";
        const radios = TONES.map((t) => {
          const radio = h("input", {
            type: "radio",
            name: "coach_tone",
            value: t.value,
            onchange: async () => {
              try {
                await api.put("/api/settings", { coach_tone: t.value });
                toast(`教練風格：${t.label}`);
              } catch {
                toast("儲存失敗");
              }
            },
          });
          radio.checked = t.value === current;
          return h(
            "label",
            { class: "small", style: "display:flex;align-items:center;gap:5px" },
            radio,
            `${t.label}（${t.hint}）`
          );
        });

        return h(
          "div",
          { class: "card" },
          h("div", { class: "eyebrow" }, "AI 教練"),
          h(
            "label",
            { class: "small", style: "display:flex;align-items:center;gap:8px;margin-bottom:10px" },
            box,
            "新增紀錄後給回饋（達標、破紀錄等重要時刻才呼叫 AI）"
          ),
          h("div", { style: "display:flex;flex-wrap:wrap;gap:6px 14px" }, ...radios),
          h("p", { class: "muted small", style: "margin-top:8px" }, "教練風格同時套用於回饋訊息與用餐提醒通知。")
        );
      })(),
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
      ...(me.is_admin
        ? [
            h(
              "a",
              {
                href: "#/admin",
                class: "card",
                style: "display:block;text-decoration:none;color:var(--accent);font-weight:600",
              },
              "🔧 管理後台 →"
            ),
          ]
        : [])
    );
  })().catch((e) => {
    page.replaceChildren(h("div", { class: "empty" }, e instanceof ApiError ? e.message : "載入失敗"));
  });
}
