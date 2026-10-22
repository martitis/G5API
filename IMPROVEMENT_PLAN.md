# Improvement plan: G5API + G5V (CS2 / MatchZy panel)

This file is shared by both repos (the frontend is `../G5V`). Tick items (`- [x]`) as they land and note the PR.
The line numbers are from the 2026-10-20 analysis and will drift, so search for the code if they no longer match.

**Decisions:**
- phased Vue 3 migration
- diverge freely from upstream
- deploy on bare Node + pm2 behind nginx/Caddy
- PUG queue is opt-in per match at creation (no global queue)
- each phase is its own branch and PR per repo

## Step 0: Context files
- [x] `G5API/CLAUDE.md`, `G5V/CLAUDE.md`, this checklist

## Phase 0: Build and tooling (branch `phase0-build-tooling` in both repos)
- [x] `yarn build` passes. Fixed the merge's TS errors (Challonge JSON typed in `teams.ts`; `req.user!` in `matches.ts` mymatches). Removed the bogus `tsc` npm package, which shadowed TypeScript's `tsc` binary so `yarn build` compiled nothing
- [x] The dev migration's duplicate `bomb_time_remaining` is fixed (test was already correct). **Not** collapsing the 3 migration folders: db-migrate stores the scope in applied migration names, so live DBs would re-run everything
- [x] ESLint 10 + typescript-eslint (type-aware) + Prettier. Existing violations are warnings with a `--max-warnings` cap (1189). No mass reformat
- [x] CI `ci.yml` in both repos (G5API: build + lint + MySQL integration tests; G5V: lint cap 34 + build). GHCR image workflows are now manual-only (they pushed to your own GHCR on every push, not upstream's). The G5API test job now runs every suite and posts failing tests as public annotations; all suites pass as of Phase 1 (they had been failing unnoticed because the old teardown hid failures)
- [x] `Utils.apiUrl()` used for every URL built from `server.apiURL`
- [x] Cross-platform scripts (`cross-env`, `scripts/test-admin.mjs`). The jest teardown no longer does `process.exit(0)`, which had hidden failing tests; `--forceExit` is used instead
- [x] Removed `package-lock.json` (it was out of sync, `npm ci` failed on master, and nothing used it); `yarn.lock` is the only lockfile
- [x] G5V: `.yarnrc` ignores the Node ≤19 engines check from Vue CLI's node-ipc (until Phase 4)
- [ ] Follow-up: `docker-compose.yml` pulls `ghcr.io/phlexplexico/g5api:latest` (upstream). Point it at your image or drop it (Phase 6)

## Phase 1: Critical security (branch `phase1-security` in both repos)
- [x] `ensureAuthenticated` + owner checks on the unauthenticated deletes (seasons, playerstats, playerstatsextra). Fixed `DELETE FROM player_stat_extras; WHERE …`. Every other `req.user && …` check sits behind `ensureAuthenticated`, so those are harmless
- [x] `ensureAuthenticated` returns 401 JSON instead of redirecting XHR calls to Steam, and passes DB errors to `next`
- [x] `getUserMatchAccessNoFinalize` checks ownership even when the match has no server
- [x] users.ts:
  - one target row, updated `WHERE id` (fixes the IDOR)
  - only super admins change roles, force passwords, or create admins
  - admins can only edit names/images of regular users
  - GET never returns the password hash; API and Challonge keys go to their owner only
  - fixed the `hashSync(undefined)` crash
- [x] Local register: no admin rights; new `user.steam_verified` column (migration `20261020120000`). Steam login verifies the account and wipes unverified local credentials; `setupAdmins` only promotes verified accounts
- [x] RCON: `safeRconArg` / SteamID64 checks in serverrcon (`RconArgumentError` becomes 412 in routes); `getSteamPID` only returns valid SteamID64s or `""`; team routes reject invalid member IDs before writing
- [x] **Backup restore bug** (user-reported). MatchZy's `listbackups` prints `<file> <timestamp> <teams> <map> <score>` (or a full path) per line, and the panel sent the whole line, `\r` included. `getBackups()` now parses this into `{file, map_number, round, info}`; restore checks the name against the server's list and quotes it. G5V shows "Map N, round R · details"
- [x] Cvars: `Utils.validateCvars` (MatchZy name/value rules; blocks rcon_password, sv_rcon_*, everyone_is_admin, any `*_url`/`*_header_*`), applied to match and season create/update; removed the `\"` escaping. *Not done:* a per-server whitelist for public servers
- [x] `checkApiKey` uses `safeCompare` (timing-safe; a missing match or key never passes)
- [x] Uploads: numeric ID headers and basename-only demo names; awaited writes; raw body only on `/v2/demo` (2gb) and `/v2/backup` (20mb); `/backups/:match_id/*` requires the match key, which `get5_loadbackup_url` now sends as a header
- [x] RCON passwords are no longer in server GETs; `GET /servers/:id/rcon` serves them to the owner or a super admin; an empty password on edit keeps the current one (G5V shows a hint)
- [x] CSRF: cancel/forfeit/restart/pause/unpause and logout are POST; session cookie `httpOnly`, `sameSite=lax`, `secure=auto`; `trust proxy`
- [x] Rate limit on `/login` and `/register` (10 per 15 min per IP); failures return 401 JSON. Legacy G5WS `/match/*` routes are **unmounted** (file deletion stays in Phase 2)
- [x] Logos: PNG signature check; SVGs with scripts, event handlers, foreignObject or external hrefs are rejected; helmet now runs before the static routes (it used to skip logos, demos and backups)
- [x] Global error handler returns a generic message for 500s; `unhandledRejection` is logged; `src/utility/asyncErrors.ts` forwards async route errors to it (Express 4 patch)
- [x] Fixed the swapped params in remote-backup server change (`UPDATE match SET server_id…`); the new server is marked in_use
- [x] `/mymatches` filter is just `user_id = ?`; both match lists use subqueries for the current map score (the JOIN + GROUP BY returned 500 on MySQL 8)
- [x] `__test__/unit.test.js` (no DB): parser, sanitizers, cvars, auth/404/upload checks. Run with `yarn test:unit`
- [ ] **Open:** enforce `private_match` / `public_team` on reads and SSE streams; per-server cvar whitelist; many routes still return `err.toString()` in their own catch blocks (cleanup in Phase 2)

## Phase 2: Backend bugs + MatchZy-native integration (branch `phase2-matchzy` in both repos)
Facts below were checked against MatchZy's source (MatchManagement.cs, ReadySystem.cs, EventHandlers.cs, ConsoleCommands.cs).
### Config builder (`src/services/matchconfig.ts`, unit tested; route `GET /matches/:id/config`)
- [x] `maplist` always an array; empty pool or a pool smaller than `num_maps` returns 422 (MatchZy would reject the whole config)
- [x] Spectators are sent (the object used to be built on an array, so it serialized as `[]`)
- [x] Coaches are listed in `players` (MatchZy has no coach list; they type `.coach`)
- [x] `min_players_to_ready` defaults to `players_per_team`. **Correction:** MatchZy counts it per team, not in total
- [x] `clinch_series` sent; `map_sides` only when complete and valid; `side_type` / `veto_first` only with allowed values
- [x] `matchzy_remote_log/backup/demo_upload` cvars (demo upload only when `server.uploadDemos`); dropped `get5_check_auths`, `get5_web_api_url` and the `<0.13.1` branch
- [x] The config needs the match key or an owner/super-admin session (it was public whenever the plugin version was "unknown")
- [x] `enforce_teams` has no MatchZy equivalent: MatchZy always kicks players who aren't on a roster. The G5V switch is removed
### RCON (`utility/serverrcon.ts`)
- [x] `matchzy_loadmatch_url`, then `get5_status` polled until `matchid` matches (failed loads are now reported)
- [x] `css_endmatch [team1|team2]` (forfeits name the winner), `css_forcepause/forceunpause`, `matchzy_addplayer/removeplayer/listbackups/loadbackup(_url)`
- [x] Add coach = add player to the team (no `get5_addcoach` in MatchZy)
- [x] Safe JSON parsing, connection closed on errors, `compare-versions` removed
- [ ] Verify the `css_*` admin commands from the RCON console on the deployed server (they accept a null player in MatchZy's source)
### Backup list/restore bug: done in Phase 1
### Event webhook (`v2/api.ts`, `services/mapflowservices.ts`, `services/seriesflowservices.ts`)
- [x] Handlers awaited, every handler catches and always responds; `going_live` no longer hangs
- [x] `series_start`, `player_disconnect` acknowledged; failed `demo_upload_ended` logged
- [x] Null attacker/assist/weapon; players outside the rosters; team lookups scoped to the match; names/weapons fit their columns
- [x] Team2 pause string; `playerStatsExtraUpdate` emitted; `insertId` fix; draw isn't credited to team2; Challonge errors don't fail events
- [x] `backup_loaded` also drops bomb events; `round_restored` reset after cleanup
- [x] `trade_kills` stored (migration `20261021120000`)
- [x] Rate limiter keyed on the match key without a DB query
- [ ] zod schema per event; unique (match_id, map_number) on map_stats (needs a data check before adding the key)
### Matches / server actions
- [x] Bomb SQL spaces, paused route param, pause SSE terminator, bomb stream sends all events
- [x] Create: atomic server reservation (409), refuses offline/busy servers, undoes the match when MatchZy doesn't load it; 404 for missing server/teams
- [x] Seasons can only be used by their owner (Challonge results go to the owner's tournament)
- [x] PUT: team ids loaded for PUG cleanup, own server isn't "in use", ending frees the server, cvars replaced not duplicated
- [x] DELETE cascades through `Utils.deleteMatchProgress` + cvars/spectators; unknown `all_cancelled` gets 400
- [x] `?asc=false`, NaN limits, `!Object.keys(x)` checks (10 sites)
- [x] matchserver: forfeit sets `forfeit=1` and the right PUG winner, awaits, works without a server; cancel awaits; restart clears everything and reports load failures
- [x] MySQL 8 `ONLY_FULL_GROUP_BY`: match lists and player stats queries rewritten
### Stats / leaderboard
- [x] Player leaderboard: one query grouped by Steam ID (fixes the `getRating` argument shift, the name merge and the N+1 queries)
- [x] Team leaderboard: one query by team id; wins/losses per series; round diff over all maps
- [x] Wins count matches, not maps (leaderboards and player stats)
- [x] Extras: lookups by victim/attacker Steam ID, PUT fixed, `deaths` column removed; `mapstats.ts` per-map stream refresh
- [x] Season cvars built in code (no `GROUP_CONCAT` JSON)
- [x] New `__test__/leaderboard.test.js` suite (passes on MySQL 8 in CI)
### Challonge (`teams.ts` import, `services/challonge.ts`)
- [x] Import: dedupe on `challonge_team_id`, `getSteamPID` conversion (non-Steam values skipped and reported), names set, encoded ids, 502 on Challonge errors
- [x] Sync: no crashes on missing season/team/key/open match, draws reported as ties, finalize check and URL fixed
- [ ] The import isn't wrapped in a DB transaction (the db wrapper has no transaction helper yet)
### Cleanup / SSE
- [x] `routes/legacy/api.ts` deleted; `yarn build` cleans `dist/`
- [x] SSE: 25s heartbeat on every `/stream`, emitter listener cap removed
- [ ] Per-match emitter channels (each stream currently re-queries on every match's event; performance only)
- [ ] Rename Get5 wording in Swagger docs/types to MatchZy

## Phase 3: G5V stabilization (Vue 2) (G5V branch `phase3-stabilize`)
- [x] `api.vue`: one shared axios instance (30s timeout); all 69 catch blocks use `errorMessage()` / `errorData()`; `IsLoggedIn` falls back to the anonymous user
- [x] Login state: `id` is -1 while loading and null when logged out; the Navbar only shows logged-in menus after the check; CreateMatch shows a login hint to anonymous users
- [x] MatchesTable: server columns only when the data has servers, Connect only for live matches, synchronous status building (the full redesign is Phase 5.0)
- [x] NewMatchForm: season cvars copied, team/server errors handled, Back skips validation, ReloadServers guarded; the "Check Auths" switch was removed in Phase 2
- [x] Responsive navbar drawer (permanent on md and up, slide-out on phones)
- [x] `PlayerStatTable` SSE cleanup; VetoTable per-component streams and in-place side updates
- [x] Backup dialog uses the backend array (Phase 1)
- [x] Phase 1 API changes followed (POST actions, logout, masked RCON)
- [x] Also fixed: TeamTable (nickname wiped on typing, silent save failures, `/teams/undefined`), Server/Login/Password dialogs, Seasons/Servers delete rows, User page, MatchCard ordering, leaderboard ADR, stray `/create` route
- [x] Lint warnings 34 → 2
- [ ] Not verified in a browser against a running API (no local MySQL); click through the main pages after deploying

## Phase 4: G5V → Vue 3 + Vuetify 4 + Vite + Pinia + TS (worktree `../G5V-next`, branch `phase4-vue3`)
- [x] Scaffold: Vite 8, Vue 3.5, Vuetify 4, vue-router 5, Pinia 4, vue-i18n 11 (`fallbackLocale: 'en'`, `jp`→`ja`),
  axios 1, TS strict, Node 22; exact dependency pins
- [x] Typed `src/api/*.ts` modules on one axios instance (`ApiError`, timeout) replace the global mixin
- [x] Runtime `/config.json` for the API URL and panel name
- [x] Pinia `auth` + `ui` stores; `useEventSource` composable; router guards; `/teams/create` route fixed
- [x] All views ported (home, matches, match, create match, teams/team, servers, seasons/season, user,
  leaderboards, metrics); forms have loading, double-submit guard, toasts and client-side validation
- [x] Match page: one combined SSE stream (`GET /matches/:id/live/stream`) instead of five; admin menu with config
  preview and server console output
- [x] `/metrics` counts endpoint
- [ ] Server-side pagination → done with the Phase 5 match list redesign (paged summary endpoint)
- [x] Branding (panel name from config.json), MatchZy help links, self-hosted fonts/icons, i18n check in CI
- [x] nginx/Caddy config: cache headers, compression, security headers, SPA fallback, `/api` proxy with SSE settings
- [x] Backend fixes found while porting: `group_concat_max_len` (big teams' member JSON was cut), password change
  always needs the old password, map list validation, Challonge season import, team owner name, lint cap 681
- [ ] Merge `phase4-vue3` into G5V (after a manual check of every page against a running API)

## Phase 5: Features
- [x] **5.0 Match list redesign** (branches `phase5-match-list` in G5API and G5V-next):
  - `GET /matches/summary` (paged, filters, privacy-aware, unit-tested `buildSummary`) and `/matches/summary/stream`
  - migration: `map_stats.team1_side` / `round_number` and the `match_round` table, filled on round_end
  - match rows with W/L/T badges, LIVE/PAUSED/WARMUP chips, live map + round + CT/T score, mini map scores,
    connect/GOTV, filters, pagination, mobile layout; used on Matches, My Matches, Home, season and team pages
- [x] **5.0b Team management in one place** (user request): one team editor dialog for create and edit with info
  and players together; bulk add (paste many Steam IDs / profile links, split into separate players); Steam name
  and avatar preview via `POST /teams/members/resolve`; one Save writes info, added/changed and removed players;
  `/teams/create` opens the dialog on the teams list. Also: copy-connect button in match list rows
- [x] **5.1 Live match view:** round history strip per map (winner lane, CT/T colour, end reason, plant marker,
  halftime), kill feed, pause banner, demo status; `match_round` (+ `event_round`), `map_stats.demo_status`,
  `GET /matches/:id/timeline`, rounds/kills/bombs/pause on `/matches/:id/live/stream`. Fixed: MatchZy's
  `winner.side` is "3"/"2" and teams carry no side, so sides were never stored
  - [ ] ready status per player (needs MatchZy ready events or polling `get5_status`)
- [x] **5.2 Admin panel** `/admin` (super admins): live matches, users with role editing (server-side guard; unverified
  accounts can't be admins; panel-set roles survive Steam login via `user.roles_from_config`), all servers, audit log
  (`audited()` middleware on every match action and create/update/delete route, `GET /admin/audit`). Config preview
  is in the match admin menu.
- [x] **5.3 Tournament tooling:** single/double elimination (byes, lower bracket, grand final), round robin, Swiss
  (pairing by record, no rematches, byes) in `services/bracket.ts` (unit tested); tables tournament,
  tournament_team, tournament_match; slot matches via `POST /matches` + `tournament_match_id`; brackets advance on
  series_end/forfeit/cancel; bracket view, standings, "Start ready matches" on free servers
  - [ ] Challonge as an optional sync target for tournaments (today Challonge sync is per season)
  - [ ] live bracket updates over SSE (the page polls every 15 s)
- [ ] **5.4 PUG queue (opt-in at creation):**
  - "Team mode: Existing teams | PUG queue"
  - `queue_status` + `match_queue_player`
  - join/leave/ready + SSE; ready check
  - team formation random/captains/balanced
  - then load via `matchzy_loadmatch_url`
- [ ] **5.5 Admin match control center** (RCON, sanitized, confirm dialogs, audit):
  - force start/restart, skip veto, knife toggle, playout, readyrequired, addreadytime, force pause/unpause, endmatch with winner, change map
  - restore by round from `match_round` (`css_restore N`)
  - connected players: kick, move team, late sub, whitelist, rename team
  - `css_asay` broadcast templates; curated live cvars
  - match presets (Official/Scrim/PUG) and user templates
  - scheduled auto-load + no-show warning
  - RCON console, practice-mode launcher, server health card
- [ ] **5.6 Fun/community (optional):** match awards, highlights feed, player profiles 2.0 + achievements, Elo/OpenSkill, Discord webhooks, pick'em, OBS overlay, live widget, hall of fame, fun presets
- [ ] **5.7 Small:** connect links with server password, GOTV link, map pool per season/tournament

## Phase 6: Ops
- [ ] Node 22 LTS; pm2 ecosystem with env; nginx/Caddy examples (SSE settings) in `deploy/`
- [ ] pino logging; `/health`
- [ ] Rotate the Steam API key leaked in upstream history (`1916f7b`, `4ff0e1e`) if still used
- [ ] MockStrategy only with NODE_ENV=test **and** an explicit flag

## Verification checklist
- Unit: config builder snapshots, sanitizers, each webhook event (null attacker, non-roster player), auth matrix per mutating route
- Integration: supertest + MySQL; add v2 webhook, demo/backup uploads, leaderboard
- E2E with CS2 + MatchZy: BO3 with spectators and a coach → load, veto, live score, pause, demo upload, series_end frees the server; forfeit/cancel/restore (clean backup names); live list updates; admin commands + audit; PUG queue with 10 accounts
- Frontend: build, lint and vue-tsc pass; Playwright smoke tests; phone width
- Security: anonymous DELETEs → 401/403; RCON injection rejected; `/v2` with `Authorization: undefined` → 401, process survives
