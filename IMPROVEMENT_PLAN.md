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

## Phase 0: Build and tooling
- [ ] Install deps; make `yarn build` pass (merge broke TS: `src/routes/teams.ts:877-887` untyped Challonge JSON; `src/routes/matches/matches.ts:449` `req.user` possibly undefined)
- [ ] Fix dev/test migration duplicate `bomb_time_remaining` (`migrations/{development,test}/20230615140704-get5db.js:66` vs `20230630204451`); collapse the 3 migration copies into one
- [ ] ESLint + Prettier for G5API
- [ ] CI (build + lint + tests) for both repos; stop pushing to upstream GHCR
- [ ] URL-join helper for `apiURL` (`matches.ts:1288`, `matchserver.ts:369`, `utility/auth.ts:36`)
- [ ] Cross-platform test scripts (`cross-env`; `NODE_ENV=test &&` doesn't export)

## Phase 1: Critical security (backend)
- [ ] Auth on unauthenticated deletes: `seasons.ts:531`, `playerstats/playerstats.ts:892`, `playerstats/extrastats.ts:719`; audit all `req.user && …` checks
- [ ] `getUserMatchAccessNoFinalize` (`utility/utils.ts:355`) skips the ownership check when there's no server
- [ ] users.ts:
  - only super_admin grants roles or sets others' passwords (`:318-329`, `POST :203`)
  - IDOR: update `WHERE id = <resolved id>` (`:285-357`)
  - stop returning hashes and keys (`:148-162`)
- [ ] Local register can't claim a Steam ID or auto-get super admin (`utility/auth.ts:181-254`)
- [ ] RCON injection: `sanitizeRconArg()` + SteamID64 validation in addplayer/removeplayer/loadbackup/loadbackup_url (`utility/serverrcon.ts`); `getSteamPID` returns only valid IDs (`utils.ts:224`)
- [ ] Cvar validation with MatchZy rules (`matches.ts:1255,1534`, `seasons.ts`); whitelist on public servers that aren't yours
- [ ] `checkApiKey` (`utils.ts:519`): 401 on a missing match or key; `timingSafeEqual`
- [ ] Uploads:
  - sanitize paths (`v2/backupapi.ts:112-124`, `v2/demoapi.ts:140`)
  - per-route size limits (`app.ts:44`, global 2GB)
  - protect `/backups`
- [ ] Mask RCON passwords in server GETs (`servers.ts:96-305`); add an explicit owner/super-admin endpoint; G5V `ServersTable.vue:38-46`
- [ ] CSRF:
  - GET → POST for cancel/forfeit/restart/pause/unpause (`matchserver.ts:61,187,308,526,588`) and logout
  - cookie `sameSite/secure/httpOnly`
  - `trust proxy`
- [ ] Rate limit `/login` and `/register`; fix the inverted legacy key generator (`legacy/api.ts:59,81,103`)
- [ ] SVG logo sanitize/rasterize; PNG magic check (`teams.ts:360-371,511-522`)
- [ ] Enforce `private_match` / `public_team`; fix the `/mymatches` `OR cancelled IS NULL` leak (`matches.ts:444`)
- [ ] Global async error handling + `unhandledRejection` logging; no `err.toString()` to clients

## Phase 2: Backend bugs + MatchZy-native integration
### Config builder (`matches.ts:1012-1139`, `build_team_dict :1666-1708`, `types/matches/MatchJson.ts`)
- [ ] `maplist` always an array; spectators object (`:1128` uses an array, so they're never sent)
- [ ] Send `clinch_series`, `veto_mode`, `map_sides` when set; coaches into `players`; `min_players_to_ready` default = 2×ppt
- [ ] `matchzy_*` cvar names; drop `get5_check_auths`, `get5_web_api_url` and the `<0.13.1` branch; stop escaping `"`
### RCON (`utility/serverrcon.ts`)
- [ ] matchzy_* / css_* commands; remove `get5_addcoach` and `get5_web_api_key`
- [ ] Confirm load via `get5_status` matchid; disconnect on error; guard JSON.parse; fix the `compare("unknown")` crash; correct endmatch result; forfeit via `css_endmatch team1|team2`
- [ ] Check which `css_*` admin commands work from the RCON console on the deployed MatchZy
### Backup list/restore bug (user-reported: extra characters sent on restore)
- [ ] `getBackups()` returns `string[]`: split `/\r?\n/`, strip control chars, keep `^matchzy_\d+_\d+_round\d+\.json$` (+ legacy cfg) (`matchserver.ts:1010`)
- [ ] `restoreBackup()`: exact match against the list, quoted `matchzy_loadbackup "<name>"`, check the response (`serverrcon.ts:362`)
- [ ] G5V `MatchAdminButton.vue:424,507`: use the array, show "Map N – Round R" sorted desc
- [ ] Unit test the parser with real output (`\r\n`, header, NUL)
### Event webhook (`v2/api.ts`, `services/mapflowservices.ts`, `services/seriesflowservices.ts`)
- [ ] Await all handlers, one try/catch, always respond; zod schema per event
- [ ] Handle `series_start`, `player_disconnect`, `demo_upload_ended`
- [ ] Null-safe attacker/assist/weapon (`mapflow:139`); non-roster players (`:133,:206`)
- [ ] `OnGoingLive` responds when the row exists (`:70-79`); team2 pause string (`:387`); emit `playerStatsExtraUpdate` (`:160`)
- [ ] `insert_id` → `insertId` (`seriesflow:82`); draw/none winner (`:101`, `challonge.ts:96`)
- [ ] Store `trade_kills`; idempotent map_stats (unique match_id+map_number, upsert)
### Matches / server actions
- [ ] Bomb SQL missing space (`matches.ts:778,862`); paused route param (`:726`); SSE newline (`:665`)
- [ ] PUG cleanup SELECT (`:1372`); PUT in-use self-check (`:1389`); `!Object.keys(x)` → `.length === 0` (~12 sites)
- [ ] Create in a transaction + `FOR UPDATE` on server in_use, 409 on conflict (`:1176`); DELETE cascades; `asc=false`/NaN limits
- [ ] matchserver.ts: forfeit sets `forfeit=1` (`:103`); PUG winner compare (`:138`); await endmatch (`:142,:262`); swapped change-server params (`:1209`); restart cleanup
### Stats / leaderboard
- [ ] `getRating` arg order (`leaderboard.ts:489`); merge condition (`:455`); `.replace` regex (`:443`, `playerstats.ts:1021`)
- [ ] Wins per match, teams by id, no N+1
- [ ] extrastats (`:653,664,745,180,799`), `mapstats.ts:284`, `playerstats.ts:899` cross join; seasons cvars via `JSON_OBJECTAGG`
### Challonge (`teams.ts:864-930`, `services/challonge.ts`)
- [ ] Transaction, `getSteamPID` validation, set `name`, dedupe, encode id, handle error object
- [ ] Merge the duplicate code from `legacy/api.ts:1636`; fix finalize URL and null crashes
### Cleanup / SSE
- [ ] Delete `routes/legacy/api.ts` and Get5-only types; rename Get5 → MatchZy in docs/Swagger; remove dead code
- [ ] Per-match emitter channels, 25s heartbeat, `setMaxListeners(0)`, listener removal on close

## Phase 3: G5V stabilization (Vue 2)
- [ ] `api.vue` catch blocks null-safe; try/catch in `IsLoggedIn`
- [ ] Anonymous user `id: null` everywhere (`App.vue:21`, `CreateMatch.vue:6`)
- [ ] MatchesTable server/connect columns (`MatchesTable.vue:52-69`; `/matches` has no server fields)
- [ ] NewMatchForm: `:true-value` + i18n key (`:313-316`), don't mutate season cvars (`:476`), guard ReloadServers (`:532`), Back without validate (`:326`)
- [ ] Responsive navbar drawer (`Navbar.vue:47`)
- [ ] `PlayerStatTable` SSE cleanup
- [ ] Backup dialog uses the backend array
- [ ] Adapt to the Phase 1 API changes (POST actions, masked RCON)

## Phase 4: G5V → Vue 3 + Vuetify 3 + Vite + Pinia + TS
- [ ] Scaffold; vue-i18n 9 (`fallbackLocale: 'en'`, `jp`→`ja`); axios 1.x; Node 20+
- [ ] Typed `src/api/*.ts` modules on one axios instance + interceptors (replaces the global mixin)
- [ ] Runtime `/config.json` for the API URL
- [ ] Pinia `auth` + `ui` stores; `useEventSource` composable; router guards; fix `/teams/create`
- [ ] Port all views; every form gets loading, double-submit guard, toasts, validation
- [ ] Server-side pagination; `/metrics` counts endpoint
- [ ] Branding (drop "Get5Vue"), MatchZy help links, self-hosted fonts/icons, i18n completeness check
- [ ] nginx/Caddy config: cache headers, compression, security headers

## Phase 5: Features
- [ ] **5.0 Match list redesign:** single-SQL summary endpoint (series score, status, current map + round score + sides), `/matches/live/stream`, card rows with W/L badges, LIVE/PAUSED chips, per-map mini scores, filters, mobile layout; reuse it on Home
- [ ] **5.1 Live match view:** `match_round` table, round history, kill feed, bomb markers, pause banner, demo status, `/matches/:id/live/stream`
- [ ] **5.2 Admin panel** `/admin`: users and roles, servers, live matches, audit log, config preview
- [ ] **5.3 Tournament tooling:** tournament/stage/bracket tables; SE/DE/RR/Swiss; auto-advance on series_end; auto server assign; bracket UI; Challonge optional
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
