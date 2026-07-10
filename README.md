# Body Buddy

Personal health tracker for family & friends (invite-only): daily 蛋白質/food
intake, workout records (weight × reps × sets), and InBody body-composition
trends. 繁體中文 mobile-first PWA, runs entirely on the Cloudflare free tier.

- **Stack**: Cloudflare Worker (Hono + TypeScript) serving a vanilla-TS Vite frontend, D1 (SQLite), R2 for InBody report photos
- **AI**: free-text food parsing and InBody photo OCR via an OpenAI-compatible client — Mistral free tier (`mistral-small-latest`) or OpenRouter (any vision model). Everything degrades to manual entry when no key is set.
- **Auth**: none in-app — put Cloudflare Access (Zero Trust) in front of the deployed domain.

## Local development

```sh
npm install
npm run db:migrate:local
cp .dev.vars.example .dev.vars   # optional: add MISTRAL_API_KEY or OPENROUTER_API_KEY
npm run dev                       # http://localhost:8787
```

## First deploy

```sh
npx wrangler login
npx wrangler d1 create body-monitor-db     # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create body-monitor-photos
npx wrangler secret put MISTRAL_API_KEY    # or OPENROUTER_API_KEY
npm run db:migrate:remote
npm run deploy
```

Then in [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) create an Access
application for the `workers.dev` domain with a policy allowing only your email.

## CI deploys

Pushes to `main` deploy via `.github/workflows/deploy.yml`. Repository secrets required:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with the **Edit Cloudflare Workers** template + D1 edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

Worker secrets (`MISTRAL_API_KEY` / `OPENROUTER_API_KEY`) are set once via
`wrangler secret put` and survive deploys.
