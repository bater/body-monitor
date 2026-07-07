import { api, ApiError, type Exercise, type WorkoutEntry } from "../api";
import { h, toast, todayStr, fmt } from "../ui";
import { lineChart } from "../chart";

export function renderWorkout(page: HTMLElement) {
  let date = todayStr();
  let exercises: Exercise[] = [];

  const dateInput = h("input", {
    type: "date",
    value: date,
    onchange: () => {
      date = dateInput.value;
      void refreshList();
    },
  });

  const exSelect = h("select", {});
  const progSelect = h("select", { onchange: () => void refreshProgression() });
  const weightInput = h("input", { type: "number", step: "0.5", min: "0", placeholder: "60" });
  const repsInput = h("input", { type: "number", step: "1", min: "1", placeholder: "8" });
  const setsInput = h("input", { type: "number", step: "1", min: "1", placeholder: "3" });
  const noteInput = h("input", { type: "text", placeholder: "備註（可空白）" });

  function fillSelects() {
    const groups = new Map<string, Exercise[]>();
    for (const ex of exercises) {
      const g = ex.muscle_group ?? "其他";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(ex);
    }
    for (const sel of [exSelect, progSelect]) {
      const prev = sel.value;
      sel.replaceChildren(
        ...[...groups.entries()].map(([g, list]) =>
          h(
            "optgroup",
            { label: g },
            ...list.map((ex) => h("option", { value: ex.id }, ex.name))
          ) as unknown as HTMLElement
        )
      );
      if (prev && exercises.some((e) => String(e.id) === prev)) sel.value = prev;
    }
  }

  async function loadExercises() {
    exercises = await api.get<Exercise[]>("/api/workouts/exercises");
    fillSelects();
  }

  async function addExercise() {
    const name = prompt("新動作名稱（例：啞鈴肩推）")?.trim();
    if (!name) return;
    const group = prompt("肌群（例：胸／背／腿／肩／手臂，可空白）")?.trim();
    try {
      const res = await api.post<{ id: number }>("/api/workouts/exercises", {
        name,
        muscle_group: group || null,
      });
      await loadExercises();
      exSelect.value = String(res.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "新增失敗");
    }
  }

  async function saveEntry() {
    const weight_kg = Number(weightInput.value);
    const reps = Number(repsInput.value);
    const sets = Number(setsInput.value);
    if (!exSelect.value || !(weight_kg >= 0) || !reps || !sets) return toast("請填動作、重量、次數、組數");
    try {
      await api.post("/api/workouts", {
        date,
        exercise_id: Number(exSelect.value),
        weight_kg,
        reps,
        sets,
        note: noteInput.value.trim() || null,
      });
      toast("已記錄");
      weightInput.value = "";
      repsInput.value = "";
      setsInput.value = "";
      noteInput.value = "";
      void refreshList();
      void refreshProgression();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "儲存失敗");
    }
  }

  const listBox = h("div", { class: "card" });
  async function refreshList() {
    listBox.replaceChildren(h("div", { class: "eyebrow" }, "當日訓練"), h("div", { class: "empty" }, "載入中…"));
    const entries = await api.get<WorkoutEntry[]>(`/api/workouts?from=${date}`);
    listBox.replaceChildren(
      h("div", { class: "eyebrow" }, "當日訓練"),
      entries.length === 0
        ? h("div", { class: "empty" }, "這天還沒有訓練紀錄")
        : h(
            "div",
            {},
            ...entries.map((w) =>
              h(
                "div",
                { class: "entry" },
                h(
                  "div",
                  { class: "row" },
                  h("span", { class: "grow" }, w.exercise_name, w.note ? h("span", { class: "muted small" }, `　${w.note}`) : null),
                  h("span", { class: "num", style: "font-weight:600" }, `${fmt(w.weight_kg)}kg × ${w.reps} × ${w.sets}`),
                  h(
                    "button",
                    {
                      class: "icon-btn",
                      "aria-label": "刪除",
                      onclick: async () => {
                        if (!confirm(`刪除 ${w.exercise_name} 這筆紀錄？`)) return;
                        await api.del(`/api/workouts/${w.id}`);
                        void refreshList();
                        void refreshProgression();
                      },
                    },
                    "✕"
                  )
                )
              )
            )
          )
    );
  }

  const progChart = h("div");
  async function refreshProgression() {
    if (!progSelect.value) return;
    const rows = await api.get<{ date: string; weight_kg: number }[]>(
      `/api/workouts/progression/${progSelect.value}`
    );
    progChart.replaceChildren(
      lineChart(
        rows.map((r) => ({ x: r.date, y: r.weight_kg })),
        { unit: "kg" }
      )
    );
  }

  page.replaceChildren(
    h("div", { class: "card" }, h("div", { class: "eyebrow" }, "日期"), dateInput),
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, "記錄訓練"),
      h(
        "div",
        { class: "btn-row", style: "margin-bottom:10px" },
        h("span", { class: "grow" }, exSelect),
        h("button", { class: "btn", onclick: () => void addExercise() }, "＋動作")
      ),
      h(
        "div",
        { class: "field-grid", style: "grid-template-columns:1fr 1fr 1fr" },
        h("label", { class: "field" }, h("span", {}, "重量 kg"), weightInput),
        h("label", { class: "field" }, h("span", {}, "次數"), repsInput),
        h("label", { class: "field" }, h("span", {}, "組數"), setsInput)
      ),
      h("label", { class: "field" }, h("span", {}, "備註"), noteInput),
      h("button", { class: "btn primary", style: "width:100%", onclick: () => void saveEntry() }, "新增紀錄")
    ),
    listBox,
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, "動作進步曲線（單日最重 KG）"),
      progSelect,
      h("div", { style: "margin-top:10px" }, progChart)
    )
  );

  void (async () => {
    await loadExercises();
    await Promise.all([refreshList(), refreshProgression()]);
  })().catch((e) => toast(e instanceof ApiError ? e.message : "載入失敗"));
}
