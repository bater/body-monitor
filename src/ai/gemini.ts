import type { Env } from "../env";

const MODEL = "gemini-2.5-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

async function generateJson<T>(env: Env, parts: Part[], responseSchema: object): Promise<T> {
  if (!env.GEMINI_API_KEY) {
    throw new GeminiError("GEMINI_API_KEY 未設定，請改用手動輸入", 503);
  }
  const res = await fetch(`${BASE}/${MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.2,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const status = res.status === 429 ? 429 : 502;
    throw new GeminiError(`Gemini API 錯誤 (${res.status}): ${body.slice(0, 300)}`, status);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new GeminiError("Gemini 回應為空", 502);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError("Gemini 回應無法解析為 JSON", 502);
  }
}

// ---------- Food parsing ----------

export type FoodItem = { name: string; qty: string; protein_g: number; kcal: number };

const FOOD_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "食物名稱（繁體中文）" },
          qty: { type: "STRING", description: "份量描述，例如 200g、2顆、1碗" },
          protein_g: { type: "NUMBER", description: "蛋白質公克數估計" },
          kcal: { type: "NUMBER", description: "熱量大卡估計" },
        },
        required: ["name", "qty", "protein_g", "kcal"],
      },
    },
  },
  required: ["items"],
};

export async function parseFoodText(env: Env, text: string): Promise<{ items: FoodItem[] }> {
  const prompt = `你是營養師。使用者記錄了他吃的東西，請拆解成個別食物項目，並估計每項的蛋白質(g)與熱量(kcal)。
- 份量未寫明時，用台灣常見的一般份量估計。
- 名稱用繁體中文，保留使用者原本的叫法。
- 估計要務實，不要高估。

使用者輸入：
${text}`;
  return generateJson<{ items: FoodItem[] }>(env, [{ text: prompt }], FOOD_SCHEMA);
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

const INBODY_SCHEMA = {
  type: "OBJECT",
  properties: {
    date: { type: "STRING", description: "檢測日期 YYYY-MM-DD，找不到時為 null", nullable: true },
    weight_kg: { type: "NUMBER", description: "體重 kg", nullable: true },
    skeletal_muscle_mass_kg: { type: "NUMBER", description: "骨骼肌重 SMM kg", nullable: true },
    body_fat_percent: { type: "NUMBER", description: "體脂率 PBF %", nullable: true },
    body_fat_mass_kg: { type: "NUMBER", description: "體脂肪重 kg", nullable: true },
    bmi: { type: "NUMBER", nullable: true },
    visceral_fat_level: { type: "NUMBER", description: "內臟脂肪等級", nullable: true },
    bmr_kcal: { type: "NUMBER", description: "基礎代謝率 kcal", nullable: true },
  },
};

export async function extractInBody(
  env: Env,
  imageBase64: string,
  mimeType: string
): Promise<InBodyExtraction> {
  const prompt = `這是一張 InBody 身體組成分析結果表的照片。請讀出以下數值：檢測日期、體重(Weight)、骨骼肌重(SMM/Skeletal Muscle Mass)、體脂率(PBF/Percent Body Fat)、體脂肪重(Body Fat Mass)、BMI、內臟脂肪等級(Visceral Fat Level)、基礎代謝率(BMR)。讀不到的欄位回傳 null。日期格式 YYYY-MM-DD。`;
  return generateJson<InBodyExtraction>(
    env,
    [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }],
    INBODY_SCHEMA
  );
}
