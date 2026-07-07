import { api, ApiError, type Exercise } from "../api";
import { h, toast } from "../ui";

type ExerciseRow = Exercise & { entry_count: number };

export function renderExercises(page: HTMLElement) {
  let list: ExerciseRow[] = [];
  let editingId: number | null = null;

  const groupsBox = h("div", { style: "display:flex;flex-direction:column;gap:12px" });

  function groupNames(): string[] {
    return [...new Set(list.map((e) => e.muscle_group ?? "其他"))];
  }

  function groupDatalist(): HTMLElement {
    return h(
      "datalist",
      { id: "muscle-groups" },
      ...groupNames().map((g) => h("option", { value: g }))
    );
  }

  // ---- create form ----
  const nameInput = h("input", { type: "text", placeholder: "動作名稱，例：啞鈴肩推" });
  const groupInput = h("input", { type: "text", list: "muscle-groups", placeholder: "肌群，例：肩" });

  async function create() {
    if (!nameInput.value.trim()) return toast("請輸入動作名稱");
    try {
      const res = await api.post<{ id: number; existed?: boolean }>("/api/workouts/exercises", {
        name: nameInput.value.trim(),
        muscle_group: groupInput.value.trim() || null,
      });
      if (res.existed) return toast("已有同名動作");
      toast("已新增");
      nameInput.value = "";
      void refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "新增失敗");
    }
  }

  // ---- per-exercise row ----
  function exerciseRow(ex: ExerciseRow): HTMLElement {
    if (editingId === ex.id) {
      const editName = h("input", { type: "text", value: ex.name });
      const editGroup = h("input", {
        type: "text",
        list: "muscle-groups",
        value: ex.muscle_group ?? "",
        placeholder: "肌群",
      });
      return h(
        "div",
        { class: "entry" },
        h(
          "div",
          { style: "display:grid;grid-template-columns:1.2fr 0.8fr;gap:6px;margin-bottom:8px" },
          editName,
          editGroup
        ),
        h(
          "div",
          { class: "btn-row" },
          h(
            "button",
            {
              class: "btn primary small grow",
              onclick: async () => {
                try {
                  await api.put(`/api/workouts/exercises/${ex.id}`, {
                    name: editName.value,
                    muscle_group: editGroup.value,
                  });
                  toast("已更新");
                  editingId = null;
                  void refresh();
                } catch (e) {
                  toast(e instanceof ApiError ? e.message : "更新失敗");
                }
              },
            },
            "儲存"
          ),
          h(
            "button",
            {
              class: "btn small",
              onclick: () => {
                editingId = null;
                render();
              },
            },
            "取消"
          )
        )
      );
    }
    return h(
      "div",
      { class: "entry" },
      h(
        "div",
        { class: "row" },
        h("span", { class: "grow" }, ex.name),
        h("span", { class: "muted small num" }, ex.entry_count > 0 ? `${ex.entry_count} 筆` : ""),
        h(
          "button",
          {
            class: "icon-btn",
            "aria-label": "編輯",
            onclick: () => {
              editingId = ex.id;
              render();
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
              if (ex.entry_count > 0) {
                return toast(`此動作已有 ${ex.entry_count} 筆訓練紀錄，無法刪除`);
              }
              if (!confirm(`刪除動作「${ex.name}」？`)) return;
              try {
                await api.del(`/api/workouts/exercises/${ex.id}`);
                toast("已刪除");
                void refresh();
              } catch (e) {
                toast(e instanceof ApiError ? e.message : "刪除失敗");
              }
            },
          },
          "✕"
        )
      )
    );
  }

  // ---- group card with rename ----
  function groupCard(group: string, items: ExerciseRow[]): HTMLElement {
    return h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row", style: "display:flex;align-items:baseline" },
        h("div", { class: "eyebrow grow", style: "margin-bottom:0;flex:1" }, group),
        h(
          "button",
          {
            class: "icon-btn",
            "aria-label": `重新命名群組 ${group}`,
            onclick: async () => {
              const newName = prompt(`群組「${group}」改名為：`, group)?.trim();
              if (!newName || newName === group) return;
              try {
                for (const ex of items) {
                  await api.put(`/api/workouts/exercises/${ex.id}`, {
                    name: ex.name,
                    muscle_group: newName,
                  });
                }
                toast(`已將 ${items.length} 個動作移至「${newName}」`);
                void refresh();
              } catch (e) {
                toast(e instanceof ApiError ? e.message : "改名失敗");
              }
            },
          },
          "✎"
        )
      ),
      ...items.map(exerciseRow)
    );
  }

  function render() {
    const groups = new Map<string, ExerciseRow[]>();
    for (const ex of list) {
      const g = ex.muscle_group ?? "其他";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(ex);
    }
    groupsBox.replaceChildren(
      groupDatalist(),
      ...[...groups.entries()].map(([g, items]) => groupCard(g, items))
    );
  }

  async function refresh() {
    list = await api.get<ExerciseRow[]>("/api/workouts/exercises");
    render();
  }

  page.replaceChildren(
    h(
      "div",
      { class: "card" },
      h("div", { class: "eyebrow" }, "新增動作"),
      h(
        "div",
        { style: "display:grid;grid-template-columns:1.2fr 0.8fr;gap:6px;margin-bottom:10px" },
        nameInput,
        groupInput
      ),
      h("button", { class: "btn primary", style: "width:100%", onclick: () => void create() }, "新增")
    ),
    groupsBox,
    h(
      "a",
      { href: "#/workout", class: "muted small", style: "color:var(--accent);text-decoration:none;padding:4px" },
      "← 返回訓練"
    )
  );

  void refresh().catch((e) => toast(e instanceof ApiError ? e.message : "載入失敗"));
}
