# Changelog

App versions follow `v0.0.x` — one bump per shipped milestone (not per commit).
When shipping a main feature: add an entry here, bump `version` in
`package.json`, and mirror a short 繁中 summary in `web/src/version.ts`
(`APP_VERSION` + `VERSION_HISTORY`), which drives the in-app 關於 page.

## v0.0.8 — 2026-07-11

- Public landing page at `/welcome` (no login) with a waiting-list signup —
  strangers leave their email; served self-contained by the Worker so it needs
  no Access-protected assets
- Admin 候補名單 in `#/admin`: review signups, send an invite with one tap,
  or remove an entry
- Invite emails via personal Gmail SMTP (smtp.gmail.com:465 over Cloudflare
  TCP sockets, App Password auth) — degrades to a copyable invite link when
  `GMAIL_APP_PASSWORD` is unset or a send fails
- **Requires** a Cloudflare Access **Bypass** policy for `/welcome` and
  `POST /api/waitlist` so logged-out visitors can reach them (see README)

## v0.0.7 — 2026-07-11

- AI coach (教練回饋): feedback on notable saves — targets hit, personal
  records, streak milestones — with three tone modes 友善 / 嚴格 / 專業,
  applied to both feedback and reminder copy
- Exercise detail page: tap an exercise in 動作庫 to see every training date
  with its sets and weights, plus the progression chart
- InBody history list collapsed by default

## v0.0.6 — 2026-07-11

- Web Push meal reminders (iOS Home-Screen PWA): 09:30 / 13:30 / 19:30 Taipei
  via cron, streak-aware copy, silent once the day already qualifies,
  per-device enable and per-meal toggles in 設定

## v0.0.5 — 2026-07-11

- Gamification: Duolingo-style XP and levels, 🔥 protein streak, level titles,
  and the 成長日誌 journey replay in 設定 — all derived on read so edits
  self-heal the score
- Hidden `#/admin` area for admins

## v0.0.4 — 2026-07-10

- Dashboard redesign: protein / skeletal-muscle / body-fat trend charts
- Food page: daily protein & calorie trend charts
- Topbar: Google avatar + name replaces the gear icon

## v0.0.3 — 2026-07-10

- Multi-user: Cloudflare Access authenticates at the edge, the app authorizes
  via invite-gated onboarding — single-use 7-day invite links minted from
  邀請管理
- Rebrand: 體態日誌 → **Body Buddy**, new app icon (bowl + barbell chopsticks
  + heartbeat steam)

## v0.0.2 — 2026-07-07

- 動作庫 exercise library: CRUD with muscle-group grouping and group rename
- Workout form: per-exercise progression chart inline, last-session prefill
- Mobile fixes: pinned tab bar, no horizontal scroll, iOS date input

## v0.0.1 — 2026-07-07

- Initial release: 繁體中文 mobile-first PWA on Cloudflare (Worker + D1 + R2)
- AI food logging: free-text meals parsed into items, protein and calories
  (Mistral / OpenRouter, degrades to manual entry)
- Workout records: weight × reps × sets
- InBody records: photo OCR or manual entry, body-composition trends
- CI deploys on push to `main`
