import type { Env } from "../env";
import { lookupFood } from "../data/food-db";

export class AiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Provider = { name: "mistral" | "openrouter"; baseUrl: string; apiKey: string; model: string };

export function resolveProvider(env: Env): Provider | null {
  if (env.MISTRAL_API_KEY) {
    return {
      name: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: env.MISTRAL_API_KEY,
      model: env.MISTRAL_MODEL ?? "mistral-small-latest",
    };
  }
  if (env.OPENROUTER_API_KEY) {
    return {
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
    };
  }
  return null;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function chatJson<T>(
  env: Env,
  content: ContentPart[],
  opts?: { system?: string; maxTokens?: number; temperature?: number }
): Promise<T> {
  const provider = resolveProvider(env);
  if (!provider) {
    throw new AiError("未設定 AI API key（MISTRAL_API_KEY 或 OPENROUTER_API_KEY），請改用手動輸入", 503);
  }
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
      ...(provider.name === "openrouter" ? { "x-title": "Body Buddy" } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        ...(opts?.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const status = res.status === 429 ? 429 : 502;
    throw new AiError(`AI API 錯誤 (${provider.name} ${res.status}): ${body.slice(0, 300)}`, status);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AiError("AI 回應為空", 502);
  // some models wrap JSON in a markdown fence despite json_object mode
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AiError("AI 回應無法解析為 JSON", 502);
  }
}

// ---------- Food parsing ----------

// `source` marks whether protein_g/kcal came from the official Taiwan food DB
// ("db", grounded) or the model's own estimate ("ai"). `grams`/`db_name` are kept
// for transparency and to let edits re-ground later.
export type FoodItem = {
  name: string;
  qty: string;
  protein_g: number;
  kcal: number;
  grams?: number;
  source?: "db" | "ai";
  db_name?: string;
};

// Raw per-item shape the model returns (before DB grounding).
type RawFoodItem = {
  name?: unknown;
  qty?: unknown;
  grams?: unknown;
  db_key?: unknown;
  protein_g?: unknown;
  kcal?: unknown;
};

export async function parseFoodText(env: Env, text: string): Promise<{ items: FoodItem[] }> {
  const prompt = `你是營養師。使用者記錄了他吃的東西，請拆解成個別食物項目。
對每一項，估計：
- grams：這一份「可食部分」的總重量（公克，數字）。份量未寫明時用台灣常見一般份量估計（例如 1 碗白飯≈150g、1 顆雞蛋≈50g、1 杯豆漿≈250g）。
- db_key：這項食物最通用的台灣食材名稱，用來查營養資料庫。要用單純的食材詞、繁體中文、不含形容詞/品牌/烹調法（例如「雞胸肉」「白飯」「豆漿」「鮭魚」；沒有對應時給空字串）。
- protein_g、kcal：整份的蛋白質(g)與熱量(kcal)估計，作為查不到資料庫時的備援。估計要務實，不要高估。
- name：顯示名稱，用繁體中文，保留使用者原本的叫法。

只回傳 JSON，格式如下，不要有其他文字：
{"items":[{"name":"顯示名稱","qty":"份量描述，例如 200g、2顆、1碗","grams":數字,"db_key":"食材名稱","protein_g":數字,"kcal":數字}]}

使用者輸入：
${text}`;
  const result = await chatJson<{ items?: RawFoodItem[] }>(env, [{ type: "text", text: prompt }]);
  if (!Array.isArray(result.items)) throw new AiError("AI 回應缺少 items", 502);
  return { items: result.items.map(groundItem) };
}

// Ground one model item against the Taiwan food DB: on a confident name match,
// recompute protein/kcal from the official per-100g value × estimated grams;
// otherwise fall back to the model's own numbers.
function groundItem(raw: RawFoodItem): FoodItem {
  const name = String(raw.name ?? "");
  const qty = String(raw.qty ?? "");
  const grams = Number(raw.grams);
  const aiProtein = Number(raw.protein_g) || 0;
  const aiKcal = Number(raw.kcal) || 0;
  const dbKey = String(raw.db_key ?? "").trim();

  const match = Number.isFinite(grams) && grams > 0 ? lookupFood(dbKey || name) : null;
  if (match) {
    return {
      name,
      qty,
      grams,
      protein_g: Math.round(((match.protein100 * grams) / 100) * 10) / 10,
      kcal: Math.round((match.kcal100 * grams) / 100),
      source: "db",
      db_name: match.name,
    };
  }
  return {
    name,
    qty,
    grams: Number.isFinite(grams) && grams > 0 ? grams : undefined,
    protein_g: aiProtein,
    kcal: aiKcal,
    source: "ai",
  };
}

// ---------- InBody photo extraction ----------

export type InBodyExtraction = {
  date: string | null;
  weight_kg: number | null;
  skeletal_muscle_mass_kg: number | null;
  body_fat_percent: number | null;
  body_fat_mass_kg: number | null;
  bmi: number | null;
  visceral_fat_level: number | null;
  bmr_kcal: number | null;
};

const INBODY_KEYS: (keyof InBodyExtraction)[] = [
  "weight_kg",
  "skeletal_muscle_mass_kg",
  "body_fat_percent",
  "body_fat_mass_kg",
  "bmi",
  "visceral_fat_level",
  "bmr_kcal",
];

export async function extractInBody(
  env: Env,
  imageBase64: string,
  mimeType: string
): Promise<InBodyExtraction> {
  const prompt = `這是一張 InBody 身體組成分析結果表的照片。請讀出以下數值：檢測日期、體重(Weight)、骨骼肌重(SMM/Skeletal Muscle Mass)、體脂率(PBF/Percent Body Fat)、體脂肪重(Body Fat Mass)、BMI、內臟脂肪等級(Visceral Fat Level)、基礎代謝率(BMR)。

只回傳 JSON，讀不到的欄位填 null，日期格式 YYYY-MM-DD，不要有其他文字：
{"date":"YYYY-MM-DD 或 null","weight_kg":數字或null,"skeletal_muscle_mass_kg":數字或null,"body_fat_percent":數字或null,"body_fat_mass_kg":數字或null,"bmi":數字或null,"visceral_fat_level":數字或null,"bmr_kcal":數字或null}`;
  const raw = await chatJson<Record<string, unknown>>(env, [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
  ]);
  const out = {
    date: typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null,
  } as InBodyExtraction;
  for (const k of INBODY_KEYS) {
    const v = raw[k];
    out[k] = (v == null || v === "" ? null : Number(v)) as never;
    if (out[k] != null && Number.isNaN(out[k])) out[k] = null as never;
  }
  return out;
}
