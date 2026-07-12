import { api, ApiError, type CoachFeedback, type Exercise, type WorkoutEntry } from "../api";
import { h, toast, todayStr, fmt } from "../ui";
import { lineChart } from "../chart";
import { showCoach } from "../coach";

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

  const exSelect = h("select", { onchange: () => void onExerciseChange() });
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
    const prev = exSelect.value;
    exSelect.replaceChildren(
      ...[...groups.entries()].map(([g, list]) =>
        h(
          "optgroup",
          { label: g },
          ...list.map((ex) => h("option", { value: ex.id }, ex.name))
        ) as unknown as HTMLElement
      )
    );
    if (prev && exercises.some((e) => String(e.id) === prev)) exSelect.value = prev;
  }

  // On exercise change: prefill last session's numbers and show its progression inline
  async function onExerciseChange() {
    if (!exSelect.value) return;
    const [last] = await Promise.all([
      api.get<{ weight_kg: number; reps: number; sets: number } | null>(
        `/api/workouts/last/${exSelect.value}`
      ),
      refreshProgression(),
    ]);
    if (last) {
      weightInput.value = String(last.weight_kg);
      repsInput.value = String(last.reps);
      setsInput.value = String(last.sets);
    } else {
      weightInput.value = "";
      repsInput.value = "";
      setsInput.value = "";
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
      void onExerciseChange();
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
      const res = await api.post<{ id: number; coach: CoachFeedback }>(`/api/workouts?today=${todayStr()}`, {
        date,
        exercise_id: Number(exSelect.value),
        weight_kg,
        reps,
        sets,
        note: noteInput.value.trim() || null,
      });
      toast("已記錄");
      showCoach(coachBox, res.coach, "workout", res.id);
      noteInput.value = "";
      void refreshList();
      void refreshProgression();
      void refreshRest();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "儲存失敗");
    }
  }

  const coachBox = h("div");
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
                        void refreshRest();
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

  // Top-line "days since last workout" nudge. Escalating static reminders at
  // 3 / 5 / 10 idle days, written in the coach's own voice (per coach_tone).
  // Static messages — no AI call — but same look & tone as post-save coaching.
  const restBox = h("div");
  function daysBetween(a: string, b: string): number {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  }
  // [3-day, 5-day, 10-day] messages per tone; `${d}` = days since last workout.
  const NUDGES: Record<string, (d: number) => string[]> = {
    friendly: (d) => [
      `已經 ${d} 天沒練囉～身體都想動一動了！今天挑個動作暖起來，肌肉才不會偷偷溜走 💪`,
      `${d} 天沒進健身房了耶…別讓辛苦練的肌肉白費，今天回來動一下好嗎？`,
      `哇，整整 ${d} 天沒訓練了！先別自責，換上運動服做一組就好，我們重新開始 🙌`,
    ],
    strict: (d) => [
      `已經 ${d} 天沒訓練。肌肉不會等你，今天就回來練，別找藉口。`,
      `${d} 天了，休太久。狀態正在流失，立刻安排一次訓練，沒有商量。`,
      `${d} 天沒動，這不是休息是放棄。現在就回到訓練，別再拖。`,
    ],
    professional: (d) => [
      `距上次訓練已 ${d} 天。中斷超過 48 小時後肌肉合成訊號下降，建議今天安排一次訓練維持刺激。`,
      `已 ${d} 天未訓練。停練 5 天以上肌力與肌肉量開始出現可測量的衰退，建議盡快恢復規律訓練。`,
      `已 ${d} 天未訓練。長期停練會明顯流失肌肉量與神經適應，建議從較輕負荷重新啟動，再逐步回到原強度。`,
    ],
  };
  async function refreshRest() {
    const [{ date: last }, settings] = await Promise.all([
      api.get<{ date: string | null }>("/api/workouts/latest"),
      api.get<Record<string, string>>("/api/settings"),
    ]);
    if (!last) {
      restBox.replaceChildren(
        h(
          "div",
          { class: "card" },
          h("div", { class: "eyebrow" }, "上次訓練"),
          h("div", { class: "muted" }, "還沒有任何訓練紀錄，開始第一筆吧！")
        )
      );
      return;
    }
    const gap = daysBetween(last, todayStr());
    const when = gap <= 0 ? "今天已訓練 💪" : gap === 1 ? "昨天" : `${gap} 天前`;
    // Escalation level by idle days: 10+ → 2, 5–9 → 1, 3–4 → 0, <3 → none.
    const level = gap >= 10 ? 2 : gap >= 5 ? 1 : gap >= 3 ? 0 : -1;
    // One card holds the last-workout summary and — once idle ≥3 days — the
    // coach nudge, joined by a hairline. The accent left-border turns on only
    // when nudging, so the block reads calm normally and urgent when overdue.
    const nudge =
      level >= 0
        ? h(
            "div",
            { class: "rest-nudge" },
            h("span", { class: "ico" }, "💬"),
            h("span", {}, NUDGES[NUDGES[settings.coach_tone] ? settings.coach_tone : "friendly"](gap)[level])
          )
        : null;
    restBox.replaceChildren(
      h(
        "div",
        { class: nudge ? "card coach" : "card" },
        h("div", { class: "eyebrow" }, "上次訓練"),
        h(
          "div",
          { class: "rest-head" },
          h("span", { class: "rest-when" }, when),
          h("span", { class: "rest-date" }, last)
        ),
        ...(nudge ? [nudge] : [])
      )
    );
  }

  const progBox = h("div");
  async function refreshProgression() {
    if (!exSelect.value) return;
    const rows = await api.get<{ date: string; weight_kg: number }[]>(
      `/api/workouts/progression/${exSelect.value}`
    );
    if (rows.length === 0) {
      progBox.replaceChildren();
      return;
    }
    progBox.replaceChildren(
      h("div", { class: "eyebrow", style: "margin-top:14px" }, "動作進步曲線（單日最重 KG）"),
      lineChart(
        rows.map((r) => ({ x: r.date, y: r.weight_kg })),
        { unit: "kg", height: 120 }
      )
    );
  }

  page.replaceChildren(
    restBox,
    h("div", { class: "card" }, h("div", { class: "eyebrow" }, "日期"), dateInput),
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, "記錄訓練"),
      h(
        "div",
        { class: "btn-row", style: "margin-bottom:10px" },
        h("span", { class: "grow" }, exSelect),
        h("button", { class: "btn", onclick: () => void addExercise() }, "＋動作"),
        h("a", { class: "btn", href: "#/exercises", style: "text-decoration:none" }, "動作庫")
      ),
      h(
        "div",
        { class: "field-grid", style: "grid-template-columns:1fr 1fr 1fr" },
        h("label", { class: "field" }, h("span", {}, "重量 kg"), weightInput),
        h("label", { class: "field" }, h("span", {}, "次數"), repsInput),
        h("label", { class: "field" }, h("span", {}, "組數"), setsInput)
      ),
      h("label", { class: "field" }, h("span", {}, "備註"), noteInput),
      h("button", { class: "btn primary", style: "width:100%", onclick: () => void saveEntry() }, "新增紀錄"),
      progBox
    ),
    coachBox,
    listBox
  );

  void refreshRest();
  void (async () => {
    await loadExercises();
    await Promise.all([refreshList(), onExerciseChange()]);
  })().catch((e) => toast(e instanceof ApiError ? e.message : "載入失敗"));
}
