import { api, ApiError, type CoachFeedback, type FoodDaily, type FoodItem, type FoodLog } from "../api";
import { h, toast, todayStr, fmt } from "../ui";
import { lineChart } from "../chart";
import { showCoach } from "../coach";

const TREND_DAYS = 30;

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

type EditorState = { items: FoodItem[]; rawText: string; editingId: number | null };

export function renderFood(page: HTMLElement) {
  let date = todayStr();
  let editor: EditorState | null = null;

  const dateInput = h("input", {
    type: "date",
    value: date,
    onchange: () => {
      date = dateInput.value;
      void refreshList();
    },
  });

  const textarea = h("textarea", {
    placeholder: "例：雞胸肉200g、茶葉蛋2顆、無糖豆漿一杯",
  });
  const parseBtn = h(
    "button",
    { class: "btn primary grow", onclick: () => void doParse() },
    "AI 解析"
  );
  const manualBtn = h(
    "button",
    {
      class: "btn",
      onclick: () => {
        editor = {
          items: [{ name: "", qty: "", protein_g: 0, kcal: 0 }],
          rawText: "",
          editingId: null,
        };
        renderEditor();
      },
    },
    "手動新增"
  );

  const editorBox = h("div");
  const coachBox = h("div");
  const listBox = h("div", { class: "card" });
  const trendBox = h("div", { style: "display:flex;flex-direction:column;gap:12px" });

  // recording input (date + textarea + AI/manual), hidden until "新增飲食紀錄" is tapped
  const recordBox = h(
    "div",
    { class: "card", style: "display:none" },
    h("div", { class: "eyebrow" }, "日期"),
    dateInput,
    h("div", { class: "eyebrow", style: "margin-top:12px" }, "記錄飲食"),
    textarea,
    h("div", { class: "btn-row", style: "margin-top:10px" }, parseBtn, manualBtn)
  );
  const showRecord = () => {
    recordBox.style.display = "";
    recordBox.scrollIntoView({ behavior: "smooth" });
  };

  const addBtn = h(
    "button",
    { class: "btn primary grow", onclick: showRecord },
    "＋ 新增飲食紀錄"
  );

  async function refreshTrend() {
    try {
      const daily = await api.get<FoodDaily[]>(
        `/api/food/daily?from=${daysAgoStr(TREND_DAYS - 1)}&to=${todayStr()}`
      );
      const trends: { label: string; unit: string; points: { x: string; y: number }[] }[] = [
        {
          label: `每日蛋白質 (G，近${TREND_DAYS}天)`,
          unit: "g",
          points: daily.map((d) => ({ x: d.date, y: d.protein_g })),
        },
        {
          label: `每日熱量 (KCAL，近${TREND_DAYS}天)`,
          unit: "kcal",
          points: daily
            .filter((d) => d.calories != null)
            .map((d) => ({ x: d.date, y: Number(d.calories) })),
        },
      ];
      trendBox.replaceChildren(
        ...trends.map((t) =>
          h(
            "div",
            { class: "card" },
            h("div", { class: "eyebrow" }, t.label),
            lineChart(t.points, { unit: t.unit, height: 120 })
          )
        )
      );
    } catch {
      trendBox.replaceChildren();
    }
  }

  async function doParse() {
    const text = textarea.value.trim();
    if (!text) return toast("請先輸入吃了什麼");
    parseBtn.disabled = true;
    parseBtn.replaceChildren(h("span", { class: "spin" }), " 解析中…");
    try {
      const res = await api.post<{ items: FoodItem[] }>("/api/food/parse", { text });
      editor = { items: res.items, rawText: text, editingId: null };
      renderEditor();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "解析失敗");
      editor = {
        items: [{ name: text, qty: "", protein_g: 0, kcal: 0 }],
        rawText: text,
        editingId: null,
      };
      renderEditor();
    } finally {
      parseBtn.disabled = false;
      parseBtn.replaceChildren("AI 解析");
    }
  }

  function renderEditor() {
    if (!editor) {
      editorBox.replaceChildren();
      return;
    }
    const st = editor;
    const totalLine = h("div", { class: "muted num" });
    const updateTotal = () => {
      const p = st.items.reduce((s, i) => s + (Number(i.protein_g) || 0), 0);
      const k = st.items.reduce((s, i) => s + (Number(i.kcal) || 0), 0);
      totalLine.textContent = `合計 蛋白質 ${fmt(p)} g ・ ${fmt(k, 0)} kcal`;
    };

    const rows = h("div");
    const renderRows = () => {
      rows.replaceChildren(
        h(
          "div",
          { class: "item-head" },
          h("span", {}, "食物"),
          h("span", {}, "份量"),
          h("span", {}, "蛋白g"),
          h("span", {}, "kcal"),
          h("span", {})
        ),
        ...st.items.map((item, idx) => {
          const bind = (key: keyof FoodItem, input: HTMLInputElement, numeric = false) => {
            input.addEventListener("input", () => {
              (item as Record<string, unknown>)[key] = numeric
                ? Number(input.value) || 0
                : input.value;
              updateTotal();
            });
            return input;
          };
          const badge = item.source
            ? h(
                "span",
                {
                  class: `src-badge ${item.source}`,
                  title:
                    item.source === "db"
                      ? `營養來自食品營養成分資料庫${item.db_name ? `：${item.db_name}` : ""}`
                      : "AI 估計值，資料庫查無此項",
                },
                item.source === "db" ? "資料庫" : "AI 估"
              )
            : null;
          return h(
            "div",
            { class: "item-row" },
            h(
              "div",
              { class: "name-cell" },
              bind("name", h("input", { type: "text", value: item.name })),
              badge
            ),
            bind("qty", h("input", { type: "text", value: item.qty })),
            bind("protein_g", h("input", { type: "number", step: "0.1", value: item.protein_g }), true),
            bind("kcal", h("input", { type: "number", step: "1", value: item.kcal }), true),
            h(
              "button",
              {
                class: "icon-btn",
                "aria-label": "刪除此列",
                onclick: () => {
                  st.items.splice(idx, 1);
                  renderRows();
                  updateTotal();
                },
              },
              "✕"
            )
          );
        })
      );
    };
    renderRows();
    updateTotal();

    editorBox.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, st.editingId ? "編輯紀錄" : "確認項目"),
        rows,
        h(
          "button",
          {
            class: "btn small",
            onclick: () => {
              st.items.push({ name: "", qty: "", protein_g: 0, kcal: 0 });
              renderRows();
            },
          },
          "＋ 新增一列"
        ),
        h("div", { style: "margin:10px 0" }, totalLine),
        h(
          "div",
          { class: "btn-row" },
          h(
            "button",
            {
              class: "btn primary grow",
              onclick: async () => {
                const items = st.items.filter((i) => i.name.trim());
                if (items.length === 0) return toast("沒有可儲存的項目");
                try {
                  if (st.editingId) {
                    await api.put(`/api/food/${st.editingId}`, { date, items });
                  } else {
                    const res = await api.post<{ id: number; coach: CoachFeedback }>(
                      `/api/food?today=${todayStr()}`,
                      { date, raw_text: st.rawText, items }
                    );
                    showCoach(coachBox, res.coach, "food", res.id);
                  }
                  toast("已儲存");
                  editor = null;
                  textarea.value = "";
                  recordBox.style.display = "none";
                  renderEditor();
                  void refreshList();
                  void refreshTrend();
                } catch (e) {
                  toast(e instanceof ApiError ? e.message : "儲存失敗");
                }
              },
            },
            "儲存"
          ),
          h(
            "button",
            {
              class: "btn",
              onclick: () => {
                editor = null;
                renderEditor();
              },
            },
            "取消"
          )
        )
      )
    );
  }

  async function refreshList() {
    listBox.replaceChildren(h("div", { class: "eyebrow" }, "當日紀錄"), h("div", { class: "empty" }, "載入中…"));
    try {
      const logs = await api.get<FoodLog[]>(`/api/food?from=${date}`);
      const total = logs.reduce((s, l) => s + l.protein_g, 0);
      listBox.replaceChildren(
        h("div", { class: "eyebrow" }, "當日紀錄"),
        h("div", { class: "muted num", style: "margin-bottom:6px" }, `蛋白質合計 ${fmt(total)} g`),
        logs.length === 0
          ? h("div", { class: "empty" }, "這天還沒有紀錄")
          : h(
              "div",
              {},
              ...logs.map((log) =>
                h(
                  "div",
                  { class: "entry" },
                  h(
                    "div",
                    { class: "row" },
                    h(
                      "span",
                      { class: "grow" },
                      log.items.map((i) => `${i.name}${i.qty ? ` ${i.qty}` : ""}`).join("、")
                    ),
                    h("span", { class: "num", style: "font-weight:600" }, `${fmt(log.protein_g)}g`),
                    h(
                      "button",
                      {
                        class: "icon-btn",
                        "aria-label": "編輯",
                        onclick: () => {
                          editor = { items: structuredClone(log.items), rawText: log.raw_text, editingId: log.id };
                          renderEditor();
                          editorBox.scrollIntoView({ behavior: "smooth" });
                        },
                      },
                      "✎"
                    ),
                    h(
                      "button",
                      {
                        class: "icon-btn",
                        "aria-label": "刪除",
                        onclick: async () => {
                          if (!confirm("刪除這筆飲食紀錄？")) return;
                          await api.del(`/api/food/${log.id}`);
                          void refreshList();
                          void refreshTrend();
                        },
                      },
                      "✕"
                    )
                  )
                )
              )
            )
      );
    } catch (e) {
      listBox.replaceChildren(h("div", { class: "empty" }, e instanceof ApiError ? e.message : "載入失敗"));
    }
  }

  page.replaceChildren(
    trendBox,
    listBox,
    h("div", { class: "btn-row" }, addBtn),
    recordBox,
    editorBox,
    coachBox
  );

  // quick-add handoff from dashboard
  const quick = sessionStorage.getItem("quickFoodText");
  if (quick) {
    sessionStorage.removeItem("quickFoodText");
    textarea.value = quick;
    showRecord();
    void doParse();
  }
  void refreshList();
  void refreshTrend();
}
