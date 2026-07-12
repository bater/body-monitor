// In-memory lookup over the bundled Taiwan food nutrition table (tw-food.ts).
// Parsed once at module load; matching is a linear scan (≤1793 foods, a handful
// of lookups per parse → negligible). Numbers are official 每100克 values from the
// 衛福部食藥署 TFND dataset; the AI supplies the portion, we supply the per-100g.

import { TW_FOOD_RAW } from "./tw-food";

export type TwFood = { name: string; protein100: number; kcal100: number };
type Entry = TwFood & { keys: string[] };

// normalize: drop whitespace + common punctuation, lowercase latin. Chinese is
// left as-is (already single-width from the source).
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s,，、。.．\-_/（）()「」【】]/g, "")
    .trim();
}

const ENTRIES: Entry[] = TW_FOOD_RAW.trim()
  .split("\n")
  .map((line) => {
    const [name, alias, protein, kcal] = line.split("\t");
    const keys = [name, ...(alias ? alias.split(",") : [])]
      .map(norm)
      .filter((k) => k.length > 0);
    return { name, protein100: Number(protein), kcal100: Number(kcal), keys };
  })
  .filter((e) => e.keys.length > 0);

export type FoodMatch = TwFood & { score: number };

// Longest contiguous substring shared by a and b (≥2 chars to count). Strings are
// short (food names), so the grow-from-each-start scan is cheap.
function longestCommon(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let len = best + 1; i + len <= a.length; len++) {
      if (b.includes(a.slice(i, i + len))) best = len;
      else break; // extending this start can only fail further
    }
  }
  return best;
}

// Best food whose name or an alias shares a substring with `query`, scored by how
// much of the QUERY that shared run covers. This tolerates DB qualifier prefixes
// (大西洋鮭魚 for 鮭魚, 土雞蛋 for 雞蛋) that strict containment would miss. Ties
// break toward the shorter, more generic food name. Returns null below MIN_SCORE.
const MIN_SCORE = 0.5;

export function lookupFood(query: string): FoodMatch | null {
  const q = norm(query);
  if (q.length < 2) return null;
  let best: Entry | null = null;
  let bestScore = 0;
  for (const e of ENTRIES) {
    let s = 0;
    for (const k of e.keys) {
      const common = longestCommon(q, k);
      if (common >= 2) s = Math.max(s, common / q.length);
    }
    if (s > bestScore || (s === bestScore && best && e.name.length < best.name.length)) {
      best = e;
      bestScore = s;
    }
  }
  if (!best || bestScore < MIN_SCORE) return null;
  return { name: best.name, protein100: best.protein100, kcal100: best.kcal100, score: bestScore };
}

export const FOOD_DB_SIZE = ENTRIES.length;
