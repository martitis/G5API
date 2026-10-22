# Improvement plan: G5API + G5V (CS2 / MatchZy panel)

This file is shared by both repos. The frontend repo is `../G5V`; the new Vue 3 panel is developed in the worktree
`../G5V-next` (same repo, branch `phase5-match-list`). Tick items (`- [x]`) as they land and note the PR.
The line numbers are from the 2026-10-20 analysis and will drift, so search for the code if they no longer match.
Last reviewed against the code: 2026-10-22.

**Decisions:**
- phased Vue 3 migration
- diverge freely from upstream
- deploy on bare Node + pm2 behind nginx/Caddy
- PUG queue is opt-in per match at creation (no global queue)
- each phase is its own branch and PR per repo (see "Branches and merging" below: Phases 3-5 are not pushed yet)
- only admins (admin or super admin) create matches, tournaments and PUG queues (API returns 403 otherwise)
- no "private match" option: matches are created by admins, so the switch was removed from create match
- roles: `admins` / `super_admins.steam_ids` grant their role at every Steam login; roles a super admin sets in the
  panel survive logins (`user.roles_from_config`)
- local dev runs only the API (3301) and the new panel (5173, Vite proxies `/api`); the old Vue 2 panel is retired
  and not started. `config/development.json` points `apiURL`/`clientHome` at the panel on the LAN IP

## Step 0: Context files
- [x] `G5API/CLAUDE.md`, `G5V/CLAUDE.md`, this checklist

## Phase 0: Build and tooling (branch `phase0-build-tooling` in both repos)
- [x] `yarn build` passes. Fixed the merge's TS errors (Challonge JSON typed in `teams.ts`; `req.user!` in `matches.ts` mymatches). Removed the bogus `tsc` npm package, which shadowed TypeScript's `tsc` binary so `yarn build` compiled nothing
- [x] The dev migration's duplicate `bomb_time_remaining` is fixed (test was already correct). **Not** collapsing the 3 migration folders: db-migrate stores the scope in applied migration names, so live DBs would re-run everything
- [x] ESLint 10 + typescript-eslint (type-aware) + Prettier. Existing violations are warnings with a `--max-warnings` cap (1189 then; 616 as of Phase 5.4, lowered whenever warnings are fixed). No mass reformat
- [x] CI `ci.yml` in both repos (G5API: build + lint + MySQL integration tests; old G5V: lint cap 34 + build; the new panel's CI runs lint with 0 warnings, Prettier check, i18n check, vue-tsc + build). GHCR image workflows are now manual-only (they pushed to your own GHCR on every push, not upstream's). The G5API test job now runs every suite and posts failing tests as public annotations; all suites pass as of Phase 1 (they had been failing unnoticed because the old teardown hid failures)
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
- [x] **Backup restore bug** (user-reported). MatchZy's `listbackups` prints `<file> <timestamp> <teams> <map> <score>` (or a full path) per line, and the panel sent the whole line, `\r` included. `getBackups()` now parses this into `{file, map_number, round, info}`; restore checks the name against the server's list. G5V shows "Map N, round R · details". **Correction (Phase 5):** the name must be sent **unquoted**: `matchzy_loadbackup` reads its argument raw, so quotes became part of the path (`backupLoadCommand()`, unit tested). Restore now also returns 409 with MatchZy's reply when MatchZy restored nothing
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
- [x] ~~Enforce `private_match` on reads~~: dropped (decision: no private matches). The match list summary still hides
  `private_match` rows from outsiders; the match page and old list routes don't check it
- [x] ~~`public_team` on team reads; per-server cvar whitelist for public servers~~: dropped after the decision that
  only admins create matches. `public_team` means "others may use this team", not "hidden" (names show on every
  match page), and cvars are validated (`Utils.validateCvars`) for the admins who can set them
- [x] The 66 route handlers that answered `err.toString()` now call `next(err)` (the global handler logs and sends
  a generic message)

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
- [x] `css_*` admin commands from RCON: MatchZy's `IsPlayerAdmin` treats a null player (server console) as admin; `css_team1/2` and `css_asay` read their text raw (sent unquoted). Checked in MatchZy's source (2026-10-22); still worth one test on the deployed server
### Backup list/restore bug: done in Phase 1
### Event webhook (`v2/api.ts`, `services/mapflowservices.ts`, `services/seriesflowservices.ts`)
- [x] Handlers awaited, every handler catches and always responds; `going_live` no longer hangs
- [x] `series_start`, `player_disconnect` acknowledged; failed `demo_upload_ended` stored as `map_stats.demo_status = 'failed'` (shown on the match page)
- [x] Null attacker/assist/weapon; players outside the rosters; team lookups scoped to the match; names/weapons fit their columns
- [x] Team2 pause string; `playerStatsExtraUpdate` emitted; `insertId` fix; draw isn't credited to team2; Challonge errors don't fail events
- [x] `backup_loaded` also drops bomb events; `round_restored` reset after cleanup
- [x] `trade_kills` stored (migration `20261021120000`)
- [x] Rate limiter keyed on the match key without a DB query
- [x] unique (match_id, map_number) on map_stats (migration `20261022220000` skips it with a warning when duplicates
  exist instead of deleting stats); going_live inserts `ON DUPLICATE KEY`; `POST /mapstats` answers 409 for a second row
- [x] zod schema per event (`services/eventschemas.ts`, unit tested): checks only the fields the handlers read, no
  conversion, extra fields allowed; a malformed event gets 400 and an API log line "Malformed MatchZy event". Built
  from the payload types, not from captured live events, so watch the log after the next real match
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
- [x] The import runs in one transaction (`db.transaction()`); Steam ID lookups happen before it (tested: a failing
  participant rolls back the batch)
### Cleanup / SSE
- [x] `routes/legacy/api.ts` deleted; `yarn build` cleans `dist/`
- [x] SSE: 25s heartbeat on every `/stream`, emitter listener cap removed
- [x] Per-match events: webhook handlers emit with the match id and per-match streams listen through `forMatch()`
  (`utility/emitter.ts`), so a round in one match no longer re-queries every other match's streams. Emits from the
  REST routes are still unscoped (they reach every stream, as before)
- [x] `tournamentUpdate` feeds the tournament stream (5.3 live bracket)
- [x] Get5 wording in Swagger docs renamed (router descriptions, `/v2` webhook, MatchZy-* upload headers). The
  `Get5_*` TS type names and `get5_*` RCON commands stay (the commands are MatchZy's Get5-compatible names)

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
- [x] ~~Verify in a browser~~: superseded. The Vue 2 panel is retired in favour of the Phase 4 panel

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
- [x] Server-side pagination: done in 5.0 (paged `GET /matches/summary`)
- [x] Branding (panel name from config.json), MatchZy help links, self-hosted fonts/icons, i18n check in CI
- [x] nginx/Caddy config: cache headers, compression, security headers, SPA fallback, `/api` proxy with SSE settings
- [x] Backend fixes found while porting: `group_concat_max_len` (big teams' member JSON was cut), password change
  always needs the old password (`force_reset` used to skip the check), map list validation, Challonge season import
  (shared `importParticipants()`), team owner name, lint cap 681. These commits are on `phase2-matchzy` (not pushed)
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
- [x] **5.0c Navigation and search cleanup** (user request, reviewed and done 2026-10-22):
  - sidebar duplicates to remove: "Add server" (same dialog as on the servers page, and it reloads the whole page with
    `router.go(0)`), "Create team" (only redirects to the teams list dialog), "Create match" (button on Matches);
    create/add actions live only on their lists
  - one entry per area instead of "All …" / "My …" pairs (matches, teams, seasons; servers only had "My servers"):
    each list gets an "Only mine" toggle (remembered per browser); `/mymatches`, `/myteams`, `/myseasons`,
    `/myservers` redirect to their list with the toggle on, so bookmarks keep working
  - missing entries: team leaderboard (one Leaderboards page with Players / Teams tabs), Metrics ("Stats"), public
    servers, a PUG queues list (today only cards above the match list)
  - grouped sidebar with section headers: Play (Matches, Tournaments, PUG queues, Seasons), Manage (Teams, Servers),
    Stats (Leaderboards, Stats), Admin
  - search on every list that lacks it: servers, tournaments, player and team leaderboards, audit log (text search)
  - global search in the app bar (teams, players, matches, tournaments) with a new `GET /search?q=` API route
- [x] **5.1 Live match view:** round history strip per map (winner lane, CT/T colour, end reason, plant marker,
  halftime), kill feed, pause banner, demo status; `match_round` (+ `event_round`), `map_stats.demo_status`,
  `GET /matches/:id/timeline`, rounds/kills/bombs/pause on `/matches/:id/live/stream`. Fixed: MatchZy's
  `winner.side` is "3"/"2" and teams carry no side, so sides were never stored
  - [x] ready status: per team (`GET /matches/:id/ready`, public, cached 5 s) from `get5_status`, which reports
    `ready` and `connected_clients` per team only (checked in MatchZy's G5API.cs); per player isn't exposed by MatchZy
- [x] **5.2 Admin panel** `/admin` (super admins): live matches, users with role editing (server-side guard; unverified
  accounts can't be admins; panel-set roles survive Steam login via `user.roles_from_config`), all servers, audit log
  (`audited()` middleware on every match action and create/update/delete route, `GET /admin/audit`). Config preview
  is in the match admin menu.
- [x] **5.3 Tournament tooling:** single/double elimination (byes, lower bracket, grand final), round robin, Swiss
  (pairing by record, no rematches, byes) in `services/bracket.ts` (unit tested); tables tournament,
  tournament_team, tournament_match; slot matches via `POST /matches` + `tournament_match_id`; brackets advance on
  series_end/forfeit/cancel; bracket view, standings, "Start ready matches" on free servers
  - [x] Challonge as an optional sync target for tournaments (`settings.challonge_url`; reported with the
    tournament owner's key, season link otherwise). Not tested against Challonge itself (needs an API key)
  - [x] live bracket updates over SSE (`GET /tournaments/:id/stream`: tournament writes and match updates)
- [x] **5.4 PUG queue (opt-in at creation):** team mode on create match; `pug_queue` / `pug_queue_player`; join (Steam
  verified, one queue at a time), leave, ready check with timeout sweep, formation random / balanced (exhaustive up
  to 7v7) / captains (ABBA picks); PUG teams (`team.is_pug`, hidden) and the match created via `createMatchAs()`;
  failed + retry; SSE queue page; open queues above the match list
  - [ ] a two-player end-to-end test (needs a second Steam-verified test account)
- [x] **Fixes found during Phase 5** (not features, listed so they aren't lost):
  - `Utils.adminCheck` / `superAdminCheck` treated `false`, `"0"` or a missing flag as admin (unit tested)
  - `PUT /users` refuses admin rights for unverified local accounts (tested with a registered account)
  - backup restore sent the file name in quotes; restore reported success when MatchZy restored nothing
  - `POST /matches/:id/callbacks` + "Send panel address to server": re-sends event/backup/demo URLs to a match
    loaded before `server.apiURL` changed (MatchZy keeps the URLs from the config)
  - CT/T sides were never stored (MatchZy's `winner.side` is "3"/"2", round_end teams have no side)
  - copy buttons work on plain-HTTP LAN addresses (clipboard fallback); match title templates (`{MAPNUMBER}`) hidden
  - test-suite backups were committed; `public/backups` and `public/demos` are now gitignored
  - the `POST /matches` handler is `createMatchHandler` / `createMatchAs()` (used by PUG queues)
  - database times are UTC end to end (mysql2 read DATETIME as local time; rows written before by NOW() stay shifted);
    the session settings now run on the pool's callback connection (the promise form logged an error)
- [ ] **5.5 Admin match control center** (RCON, sanitized, confirm dialogs, audit):
  - [x] earlier in the match admin menu: force pause/unpause, end with a winner (forfeit), cancel, restart,
    add/remove player, backup restore, change server, MatchZy config preview, send panel address
  - [x] match control panel (`POST /matches/:id/control`, `utility/matchcontrol.ts`, unit tested, audited): force start,
    skip veto, knife/playout/whitelist toggles, ready required, add ready time, change map, rename teams,
    `css_asay` with templates, curated live cvars
  - [x] server health card (`GET /matches/:id/server/status`: RCON reachable + get5_status); RCON console with history
  - [ ] restore by round from `match_round` (`css_restore N`). **Blocked** until the server runs a MatchZy build with
    PR #422 (CS2 1.41.9.1 rejects MatchZy's absolute round-backup paths, so no round files are written; see Phase 6)
  - [x] connected players panel (`GET /matches/:id/server/players` from CS2's `status`, `parseStatusPlayers` unit
    tested; kick via `POST /server/kick` = `kickid`). Move team / late sub stay in the match menu (by Steam ID),
    since `status` has no Steam IDs. **Check against a live server:** the `status` row format was written from
    known CS2 output, not captured from this server
  - [x] match presets (Official/Scrim/PUG, cvars MatchZy accepts in a config) and user templates (`match_template`,
    `/templates`) on create match
  - [x] scheduled matches (`scheduled_match`, `/scheduled`, 30 s sweep; any free server at that time; failed runs
    keep the reason and can be retried) on create match; no-show chip/warning after 10 minutes waiting for players
  - [x] practice-mode launcher (`POST /servers/:id/practice`, `game_server.practice_mode`; the server counts as in
    use while practicing) on the servers page
- [ ] **5.6 Fun/community (optional):** match awards, highlights feed, player profiles 2.0 + achievements, Elo/OpenSkill, Discord webhooks, pick'em, OBS overlay, live widget, hall of fame, fun presets
- [ ] **5.7 Small:**
  - [x] GOTV link (match page and match list rows)
  - [x] map pool per season (season defaults) and per tournament (tournament settings)
  - [x] copy connect command (match page and match list rows)
  - [x] connect links with the server password (`game_server.join_password`, sent as `sv_password` in the match
    config; `steam://connect/ip:port/password` and `connect ip:port; password …`). The cvar stays set on the server
    after the match

## Phase 6: Ops
- [ ] Node 22 LTS; pm2 ecosystem with env. nginx/Caddy examples with SSE settings exist in the panel repo
  (`default.conf`, `Caddyfile`, Phase 4); add an API-side deployment note (not in `docs/`, which `yarn docclean` wipes)
- [ ] **Game server requirements** to document: MatchZy with PR #422 (merged into MatchZy `dev` on 2026-10-18) for
  round backups on CS2 1.41.9.1; possibly the `-allow_round_backup_files` launch flag; `apiURL` reachable from the
  game server (matches keep the URLs they were loaded with)
- [ ] pino logging; `/health`
- [ ] Rotate the Steam API key leaked in upstream history (`1916f7b`, `4ff0e1e`) if still used
- [x] MockStrategy only with NODE_ENV=test **and** `G5API_MOCK_AUTH=1` (set in the jest configs)
- [ ] `docker-compose.yml` still pulls upstream's image (from Phase 0)

## Branches and merging
State on 2026-10-22: nothing after Phase 2 is pushed or merged.
- G5API: `phase2-matchzy` is 6 commits ahead of origin (the Phase 4 backend fixes); `phase5-match-list` is based on
  it and never pushed. Local `master` is 4 commits behind origin.
- G5V: `phase4-vue3` and `phase5-match-list` (worktree `../G5V-next`) were never pushed. The `../G5V` checkout is on
  `pr/tech62/171` (an upstream PR branch), not on a phase branch. Local `master` is 4 commits behind origin.
- [ ] Plan: pull `master` in both repos; push `phase2-matchzy` (G5API) and open/refresh its PR; then push
  `phase5-match-list` in both repos as one PR each (it contains the Phase 3/4/5 work), or split per phase if reviews
  need it. The G5V PR replaces the Vue 2 code with the Vite panel
- [ ] Before merging the panel: click through every page against a running API (Phase 4 open item), PUG queue with two
  Steam accounts, a tournament with real matches

## Verification checklist
- Unit: config builder snapshots, sanitizers, each webhook event (null attacker, non-roster player), auth matrix per mutating route
- Integration: supertest + MySQL; add v2 webhook, demo/backup uploads, leaderboard
- E2E with CS2 + MatchZy: BO3 with spectators and a coach → load, veto, live score, pause, demo upload, series_end frees the server; forfeit/cancel/restore (clean backup names); live list updates; admin commands + audit; PUG queue with 10 accounts. Done manually so far (2026-10-22, match 3): load, live rounds and kills, pause, backup list; restore blocked by the MatchZy/CS2 round-file issue
- Frontend: build, lint and vue-tsc pass (done in CI); Playwright smoke tests (not started); phone width
- Security: anonymous DELETEs → 401/403; RCON injection rejected; `/v2` with `Authorization: undefined` → 401, process survives
