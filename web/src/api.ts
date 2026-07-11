export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// installed by main.ts — shows the invite-gate screen when the account isn't a member
let inviteRequiredHandler: ((logoutUrl: string | null) => void) | null = null;
export function onInviteRequired(fn: (logoutUrl: string | null) => void) {
  inviteRequiredHandler = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = body as { error?: string; code?: string; logout_url?: string | null } | null;
    if (res.status === 403 && err?.code === "invite_required") {
      inviteRequiredHandler?.(err.logout_url ?? null);
    }
    throw new ApiError(err?.error ?? `請求失敗 (${res.status})`, res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
  put: <T>(path: string, data: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

export type FoodItem = { name: string; qty: string; protein_g: number; kcal: number };
export type FoodLog = {
  id: number;
  date: string;
  raw_text: string;
  items: FoodItem[];
  protein_g: number;
  calories: number | null;
};
export type FoodDaily = { date: string; protein_g: number; calories: number | null };
export type Exercise = { id: number; name: string; muscle_group: string | null };
export type WorkoutEntry = {
  id: number;
  date: string;
  exercise_id: number;
  exercise_name: string;
  muscle_group: string | null;
  weight_kg: number;
  reps: number;
  sets: number;
  note: string | null;
};
export type InBodyRecord = {
  id: number;
  date: string;
  weight_kg: number;
  skeletal_muscle_mass_kg: number | null;
  body_fat_percent: number | null;
  body_fat_mass_kg: number | null;
  bmi: number | null;
  visceral_fat_level: number | null;
  bmr_kcal: number | null;
  source: "photo" | "manual" | "import";
  photo_key: string | null;
};
export type Gamify = {
  streak_days: number;
  xp: number;
  level: number;
  level_start_xp: number;
  next_level_xp: number;
  today: {
    logged: boolean;
    protein_g: number;
    min_g: number;
    target_g: number;
    min_met: boolean;
    target_met: boolean;
  };
};
export type Dashboard = {
  date: string;
  protein_g: number;
  calories: number;
  food_entries: number;
  protein_target_g: number;
  gamify: Gamify;
  food_daily: FoodDaily[];
  inbody_trend: Pick<
    InBodyRecord,
    "date" | "weight_kg" | "skeletal_muscle_mass_kg" | "body_fat_percent"
  >[];
};
