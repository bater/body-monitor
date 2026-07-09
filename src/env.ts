export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  // AI provider: set ONE of these (Mistral wins if both are set)
  MISTRAL_API_KEY?: string;
  MISTRAL_MODEL?: string; // default: mistral-small-latest (text + vision)
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string; // default: google/gemini-2.5-flash
  // Auth (Cloudflare Access in front of the app)
  ACCESS_TEAM_DOMAIN?: string; // e.g. rough-sea-d78c.cloudflareaccess.com
  ACCESS_AUD?: string; // Access application Audience tag; enables JWT verification
  OWNER_EMAILS?: string; // comma-separated; first login among these claims pre-multi-user data
  DEV_USER_EMAIL?: string; // .dev.vars only — local identity without Access
};

export type AppContext = {
  Bindings: Env;
  Variables: { userId: number; userEmail: string; userName: string };
};
