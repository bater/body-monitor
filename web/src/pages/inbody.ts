import { api, ApiError, type CoachFeedback, type InBodyRecord } from "../api";
import { h, toast, todayStr, fmt } from "../ui";
import { lineChart } from "../chart";
import { showCoach } from "../coach";

type Extraction = Partial<Record<string, number | string | null>>;

const FORM_FIELDS: { key: string; label: string; step: string }[] = [
  { key: "weight_kg", label: "體重 kg", step: "0.1" },
  { key: "skeletal_muscle_mass_kg", label: "骨骼肌重 kg", step: "0.1" },
  { key: "body_fat_percent", label: "體脂率 %", step: "0.1" },
  { key: "body_fat_mass_kg", label: "體脂肪重 kg", step: "0.1" },
  { key: "bmi", label: "BMI", step: "0.1" },
  { key: "visceral_fat_level", label: "內臟脂肪等級", step: "1" },
  { key: "bmr_kcal", label: "基礎代謝 kcal", step: "1" },
];

export function renderInBody(page: HTMLElement) {
  const trendBox = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const formBox = h("div");
  const coachBox = h("div");
  const tableBox = h("div", { class: "card" });
  let historyOpen = false;

  const fileInput = h("input", {
    type: "file",
    accept: "image/*",
    style: "display:none",
    onchange: () => void doOcr(),
  });
  const photoBtn = h(
    "button",
    { class: "btn primary grow", onclick: () => fileInput.click() },
    "拍照／上傳報告"
  );
  const manualBtn = h(
    "button",
    { class: "btn grow", onclick: () => renderForm({}, null, "manual") },
    "手動輸入"
  );

  async function doOcr() {
    const file = fileInput.files?.[0];
    if (!file) return;
    photoBtn.disabled = true;
    photoBtn.replaceChildren(h("span", { class: "spin" }), " 讀取中…");
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await api.upload<{ photo_key: string; extraction: Extraction }>(
        "/api/inbody/ocr",
        form
      );
      toast("已讀取，請確認數值");
      renderForm(res.extraction, res.photo_key, "photo");
    } catch (e) {
      toast(e instanceof ApiError ? `${e.message}，請改用手動輸入` : "讀取失敗，請改用手動輸入");
      renderForm({}, null, "manual");
    } finally {
      photoBtn.disabled = false;
      photoBtn.replaceChildren("拍照／上傳報告");
      fileInput.value = "";
    }
  }

  function renderForm(extraction: Extraction, photoKey: string | null, source: "photo" | "manual") {
    const dateInput = h("input", {
      type: "date",
      value: typeof extraction.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extraction.date)
        ? extraction.date
        : todayStr(),
    });
    const inputs = new Map<string, HTMLInputElement>();
    const fields = FORM_FIELDS.map((f) => {
      const input = h("input", {
        type: "number",
        step: f.step,
        value: extraction[f.key] != null ? String(extraction[f.key]) : "",
      });
      inputs.set(f.key, input);
      return h("label", { class: "field" }, h("span", {}, f.label), input);
    });

    formBox.replaceChildren(
      h(
        "div",
        { class: "card" },
        h("div", { class: "eyebrow" }, source === "photo" ? "確認 InBody 數值" : "手動輸入 InBody"),
        h("label", { class: "field" }, h("span", {}, "檢測日期"), dateInput),
        h("div", { class: "field-grid" }, ...fields),
        h(
          "div",
          { class: "btn-row" },
          h(
            "button",
            {
              class: "btn primary grow",
              onclick: async () => {
                const val = (k: string) => {
                  const v = inputs.get(k)!.value;
                  return v === "" ? null : Number(v);
                };
                if (val("weight_kg") == null) return toast("體重為必填");
                try {
                  const res = await api.post<{ id: number; coach: CoachFeedback }>(`/api/inbody?today=${todayStr()}`, {
                    date: dateInput.value,
                    weight_kg: val("weight_kg"),
                    skeletal_muscle_mass_kg: val("skeletal_muscle_mass_kg"),
                    body_fat_percent: val("body_fat_percent"),
                    body_fat_mass_kg: val("body_fat_mass_kg"),
                    bmi: val("bmi"),
                    visceral_fat_level: val("visceral_fat_level"),
                    bmr_kcal: val("bmr_kcal"),
                    source,
                    photo_key: photoKey,
                    raw_json: source === "photo" ? extraction : null,
                  });
                  toast("已儲存");
                  showCoach(coachBox, res.coach, "inbody", res.id);
                  formBox.replaceChildren();
                  void refresh();
                } catch (e) {
                  toast(e instanceof ApiError ? e.message : "儲存失敗");
                }
              },
            },
            "儲存"
          ),
          h("button", { class: "btn", onclick: () => formBox.replaceChildren() }, "取消")
        )
      )
    );
    formBox.scrollIntoView({ behavior: "smooth" });
  }

  async function refresh() {
    const records = await api.get<InBodyRecord[]>("/api/inbody?limit=200");
    const asc = [...records].reverse();

    const trends: { label: string; key: keyof InBodyRecord; unit: string }[] = [
      { label: "體重 (KG)", key: "weight_kg", unit: "kg" },
      { label: "骨骼肌重 (KG)", key: "skeletal_muscle_mass_kg", unit: "kg" },
      { label: "體脂率 (%)", key: "body_fat_percent", unit: "%" },
    ];
    trendBox.replaceChildren(
      ...trends.map((t) =>
        h(
          "div",
          { class: "card" },
          h("div", { class: "eyebrow" }, t.label),
          lineChart(
            asc
              .filter((r) => r[t.key] != null)
              .map((r) => ({ x: r.date, y: Number(r[t.key]) })),
            { unit: t.unit, height: 120 }
          )
        )
      )
    );

    const srcLabel = { photo: "照片", manual: "手動", import: "匯入" } as const;
    const listWrap = h(
      "div",
      { style: historyOpen ? "" : "display:none" },
      records.length === 0
        ? h("div", { class: "empty" }, "還沒有 InBody 紀錄")
        : h(
            "div",
            { class: "table-scroll" },
            h(
            "table",
            { class: "records" },
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                h("th", {}, "日期"),
                h("th", { class: "num" }, "體重"),
                h("th", { class: "num" }, "骨骼肌"),
                h("th", { class: "num" }, "體脂%"),
                h("th", {}, "來源"),
                h("th", {})
              )
            ),
            h(
              "tbody",
              {},
              ...records.map((r) =>
                h(
                  "tr",
                  {},
                  h("td", { class: "num" }, r.date),
                  h("td", { class: "num" }, fmt(r.weight_kg)),
                  h("td", { class: "num" }, fmt(r.skeletal_muscle_mass_kg)),
                  h("td", { class: "num" }, fmt(r.body_fat_percent)),
                  h(
                    "td",
                    {},
                    r.photo_key
                      ? h("a", { href: `/api/inbody/photo/${r.id}`, target: "_blank", style: "color:var(--accent)" }, srcLabel[r.source])
                      : srcLabel[r.source]
                  ),
                  h(
                    "td",
                    {},
                    h(
                      "button",
                      {
                        class: "icon-btn",
                        "aria-label": "刪除",
                        onclick: async () => {
                          if (!confirm(`刪除 ${r.date} 的 InBody 紀錄？`)) return;
                          await api.del(`/api/inbody/${r.id}`);
                          void refresh();
                        },
                      },
                      "✕"
                    )
                  )
                )
              )
            )
          )
          )
    );
    const arrow = h("span", { style: "font-size:11px" }, historyOpen ? "▲" : "▼");
    tableBox.replaceChildren(
      h(
        "div",
        {
          class: "eyebrow",
          style: "cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none",
          role: "button",
          "aria-expanded": String(historyOpen),
          onclick: (e: Event) => {
            historyOpen = !historyOpen;
            listWrap.style.display = historyOpen ? "" : "none";
            arrow.textContent = historyOpen ? "▲" : "▼";
            (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(historyOpen));
          },
        },
        h("span", {}, `歷史紀錄（${records.length}）`),
        arrow
      ),
      listWrap
    );
  }

  page.replaceChildren(
    trendBox,
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, "新增紀錄"),
      h("div", { class: "btn-row" }, photoBtn, manualBtn),
      fileInput
    ),
    formBox,
    coachBox,
    tableBox
  );

  void refresh().catch((e) => toast(e instanceof ApiError ? e.message : "載入失敗"));
}
