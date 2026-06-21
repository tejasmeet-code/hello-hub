# Hello Hub — Discord Bot (Relosta Bot)

A Discord bot with staff management, moderation, fun commands, and more. Hosted as an Express API server that starts the Discord.js bot in the same process.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build + run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `bash scripts/push-to-github.sh` — push current branch to GitHub (requires `GIT_TOKEN` secret)
- Required secrets: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` — without these the bot won't connect to Discord

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Bot: discord.js 14
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Build: esbuild (ESM bundle via `build.mjs`)
- Data persistence: JSON files in `artifacts/api-server/.data/`

## Where things live

- `artifacts/api-server/src/discord/` — all bot code
  - `client.ts` — Discord client, event handlers, startup
  - `commands/` — slash command implementations
  - `storage/` — JSON persistence helpers (config, staff, quota, etc.)
  - `utils/` — shared helpers (embeds, webhooks, permissions)
  - `registry.ts` — command registry
- `artifacts/api-server/src/lib/` — server utilities (logger, paths)
- `artifacts/api-server/.data/` — runtime JSON data files
- `lib/api-spec/openapi.yaml` — OpenAPI contract
- `scripts/push-to-github.sh` — push to GitHub using `GIT_TOKEN`

## Architecture decisions

- Bot and HTTP server run in the same Node.js process; HTTP is just a health check surface.
- All guild data is stored as JSON in `.data/` (no database required for bot features).
- Commands are registered per-guild on startup (instant) rather than globally (1h delay, 100-cmd limit).
- Slash commands use a whitelist-based permission system (see `storage/whitelist.ts`).
- The `DATA_DIR` env var overrides where `.data/` lives (useful for Railway volume mounts).

## Product

- **Staff management** — promote/demote, infractions, quotas, LOA, appeals, staff reports
- **Moderation** — ban, kick, mute, timeout, warn, jail, purge, lock, slowmode, anti-nuke
- **Fun & games** — trivia, hangman, connect4, tictactoe, slots, roulette, and more
- **Utilities** — polls, giveaways, server backup, tickets, verification, partnerships
- **Cross-server** — connect staff servers, global backup, channel/role scramble

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The bot won't start without `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` secrets — add them in Replit Secrets.
- Per-guild command registration runs on every startup; new guilds are handled via `GuildCreate`.
- Run `bash scripts/push-to-github.sh` to push changes to GitHub (uses `GIT_TOKEN` secret).
- `GIT_TOKEN` secret is already configured for GitHub pushes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
