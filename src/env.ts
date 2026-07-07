export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
};

export type AppContext = { Bindings: Env };
