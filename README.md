# Garena.mn

A Warcraft III / DotA community platform for Mongolia: a desktop app to host and
join games together over the internet, plus a Node backend that powers accounts,
rooms, chat, stats, and a browser **admin dashboard**.

The repo is a monorepo with two apps and a companion project:

| Part | What it is |
| --- | --- |
| **`client/`** | Electron desktop app — Discord login, game rooms, friends, chat, ZeroTier peer connections, auto‑update |
| **`server/`** | Express + Socket.IO backend (PostgreSQL) — auth, rooms, stats, social, admin dashboard, WarKey tracking |
| **[`LexusWarKey/`](LexusWarKey/)** | Standalone WC3 hotkey remapper (its own repo) that signs in with the same Discord accounts and reports to this backend |

Live server: **https://garenamn-production.up.railway.app**

## Highlights

- **Play together online.** Create a room; players connect over a shared
  ZeroTier network so a LAN game "just works" across the internet.
- **Discord accounts.** Sign in with Discord (QR/deeplink for the desktop app),
  add friends, DM, and chat in the lobby and rooms.
- **Stats.** Wins/losses, game history, leaderboards.
- **Admin dashboard** (`/admin`). A browser panel to monitor who's online, browse
  and manage users, and see Lexus WarKey users — gated by Discord ID.
- **Landing page** (`/`). Introduces both the platform and WarKey with live
  download links pulled from each project's latest GitHub release.

## Web endpoints (served by the backend)

| Path | Description |
| --- | --- |
| `/` | Public landing page (platform + WarKey, downloads, admin link) |
| `/admin` | Admin dashboard (Discord sign‑in, whitelisted IDs only) |
| `/health` | JSON health check |
| `/auth`, `/rooms`, `/stats`, `/social`, `/streamers`, `/warkey`, … | REST + Socket.IO APIs |

### Admin dashboard

- **Sign in** with Discord at `/admin`. Access is limited to Discord IDs listed
  in `ADMIN_DISCORD_IDS` (the bootstrap super‑admins) plus any added from the
  dashboard itself (stored in the `admin_whitelist` table).
- **Monitor:** live online users, active rooms, and all registered users with
  wins/losses and join date (search + pagination).
- **Manage:** edit a user's name and stats, or delete a user (cascades).
- **WarKey users:** who is running Lexus WarKey right now (heartbeat within
  2 min), total registered, and app version — with a delete action.
- **Admins:** add or remove admins by Discord ID live, without a redeploy.

> First‑time setup: open `/admin`, click sign in — if you're not yet an admin the
> page shows your own Discord ID so you can add it to `ADMIN_DISCORD_IDS`.

---

## For end users

Don't clone the repo — download the app:

1. Open the [landing page](https://garenamn-production.up.railway.app/)
   or the GitHub **Releases** page.
2. Download the latest Windows installer and launch it.
3. Sign in with Discord and pick your Warcraft executable the first time.

The desktop app targets the hosted production API by default, so users don't run
the backend.

## Local development

### Requirements

- Node.js 20+, npm 10+
- PostgreSQL
- Windows (to test the Electron + ZeroTier flow end‑to‑end)

### Quick start

```bash
npm run setup
copy server\.env.example server\.env
copy client\.env.example client\.env
npm start
```

This installs both apps, starts the backend on `http://127.0.0.1:3000`, and
launches the Electron app pointed at it.

### Environment

`server/.env` (minimum):

```env
PORT=3000
CLIENT_URL=*
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/warcraft
JWT_SECRET=change-this-in-production
```

Optional integrations:

- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` — Discord login
- `ADMIN_DISCORD_IDS` — comma‑separated Discord IDs allowed into `/admin`
- `ZEROTIER_API_TOKEN`, `ZEROTIER_DEFAULT_NETWORK` — peer networking
- `RZR_BOT_URL`, `WEBHOOK_SECRET`

`client/.env` (optional — production is the built‑in fallback):

```env
SERVER_URL=http://127.0.0.1:3000
```

## Root commands

- `npm run setup` — install both apps
- `npm start` — server + Electron for local dev
- `npm run server` — backend only
- `npm run client` — Electron only
- `npm run test:server` — backend tests
- `npm run build:client` — build the Windows installer

## Project structure

- `client/` — Electron desktop app
- `server/` — Express API + Socket.IO backend (`src/routes`, `src/public` for the
  landing + admin pages, `src/db/schema.sql` for the schema)
- `LexusWarKey/` — the hotkey remapper (separate app)
- `notes/` — local progress notes

## Deployment

- The backend deploys to Railway from `main` (auto‑deploy on push). It serves the
  API, the landing page, and the admin dashboard from one instance — the same
  instance clients connect to, so "who's online" reflects real socket presence.
- The desktop client is published to GitHub Releases (electron‑builder) and
  auto‑updates via `electron-updater`.

## Бот хостын ops (сервер, 2026-08-24)
- `OPS_DISCORD_WEBHOOK` — Discord сувгийн webhook URL. Бот offline/online болох, ажил failed/cancelled болох бүрт мэдэгдэнэ (B4). Админ самбар → 🤖 Бот хост хэсэгт ботууд, ажлууд (Цуцлах / Дахин хост), үйл явдлын лог (C2); "Discord тест" товчоор шалгана.

## TierSystem ↔ Garena.mn автомат sync (D3, 2026-08-24)
- TierSystem Railway: `RANKING_API_KEY=<санамсаргүй 32+ тэмдэгт>` → `GET /api/export/ranking` (X-API-Key).
- Garena.mn Railway: `TIERBOT_STATS_URL=https://tiersystem-production.up.railway.app/api/export/ranking`, `TIERBOT_API_KEY=<ижил утга>`, `TIERBOT_SYNC_MINUTES=10` (0 = унтраах).
- Зөвхөн Discord ID-аар таарсан хэрэглэгчдийн tier/MMR/wins/losses шинэчилнэ; админ: `GET /stats/tierbot/auto`, `POST /stats/tierbot/auto/run`.
