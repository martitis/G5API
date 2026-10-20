# G5API: backend for a CS2 tournament panel (MatchZy)

Express/TypeScript API that manages CS2 matches, teams, servers, seasons and stats, and drives the
**MatchZy** plugin over RCON. It started as a fork of PhlexPlexico/G5API (built for Get5) and now **diverges
freely**, so don't try to stay merge-compatible with upstream.
Frontend: `../G5V` (Vue). Roadmap and progress: [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md). Tick items off as they land.

## Stack
- Node (ESM, `"type": "module"`), Express 4, TypeScript `strict` → `dist/` via `tsc`
- MySQL via `mysql2` (`src/services/db.ts`), migrations via `db-migrate`
- passport: Steam OpenID plus optional local login (`src/utility/auth.ts`), express-session (optional Redis store)
- RCON: `dathost-rcon-client` (`src/utility/serverrcon.ts`)
- Swagger at `/api-docs` (JSDoc `@swagger` blocks in the route files plus `src/types/swagger/`)

## Commands
- `yarn build`: tsc. It must pass; a failing build blocks `yarn start` and deploys.
- `yarn start`: dev (tsc-watch + nodemon). `yarn startprod` / `restartprod` / `stopprod` run pm2 with `prodrun.json`.
- Migrations: `yarn migrate-<dev|prod|test>-upgrade`, `migrate-create-*`, `migrate-drop-*`.
- `yarn test`: builds, recreates the test DB, then runs the Jest suites in `__test__/` in a fixed order. It needs a live MySQL
  and `config/test.json`, and the scripts use POSIX `sed`/`export` (run them from Git Bash or WSL).
- Don't put files in `docs/`: `yarn doc` writes jsdoc there and `yarn docclean` deletes it.

## Config
- `config/{development,production,test}.json` are created from `*.json.template` and gitignored (they hold secrets).
- `server.dbKey` must be exactly 16 bytes (the AES key that encrypts RCON passwords and API keys in the DB).
- `server.apiURL` is the public base URL that the game server calls back on. Watch for trailing-slash double `//`.
- `admins.steam_ids` / `super_admins.steam_ids` overwrite the user's role flags on every Steam login.
- Deployment: bare Node + pm2 behind nginx/Caddy. SSE routes need `proxy_buffering off` and long timeouts.

## Layout
- `app.ts`: middleware, auth routes (`/auth/steam`, `/login`, `/register`, `/logout`), router mounts, and static
  `/demos` and `/backups` from `public/`.
- `src/routes/`
  - `matches/matches.ts`: match CRUD, SSE streams, and **`GET /matches/:id/config`, the MatchZy match JSON**
    (`build_team_dict` builds the team objects)
  - `matches/matchserver.ts`: RCON actions (pause, forfeit, cancel, restart, add player, backups, rcon)
  - `v2/api.ts`: **MatchZy event webhook** (remote log URL) → `src/services/{seriesflowservices,mapflowservices}.ts`
  - `v2/demoapi.ts`, `v2/backupapi.ts`: demo and round-backup uploads from the game server
  - `legacy/api.ts`: old G5WS callbacks (unused by MatchZy, slated for removal)
  - teams, servers, seasons, users, vetoes, vetosides, mapstats, playerstats (+ `extrastats.ts`), leaderboard, maps
- `src/utility/utils.ts`: auth guards (`ensureAuthenticated`, `adminCheck`, `superAdminCheck`, `getUserMatchAccess*`),
  `checkApiKey` (game-server auth), `encrypt`/`decrypt`, `getRating`, `getSteamPID`, `updatePlayerStats`, `updatePugStats`
- `src/utility/emitter.ts`: a global EventEmitter feeding the SSE streams
- `src/services/challonge.ts`: Challonge score sync. `src/types/`: TS types.

## MatchZy integration facts (verified against the MatchZy source)
Docs: https://shobhit-pathak.github.io/MatchZy/ (commands, configuration, match setup, events).
- **Load:** `matchzy_loadmatch_url "<url>" "Authorization" "<match api_key>"` (`get5_*` aliases exist). The fetch is
  **async**: the RCON reply says nothing about success, so confirm via `get5_status` (`matchid`).
  `get5_status` always reports `plugin_version` 0.15.0.
- **Config JSON:**
  - `maplist` must be an array (null fails the load). `num_maps` ≤ maplist length.
  - Team: only `id`, `name` and `players` (`{steamid64: name}`) are read. `tag`/`flag`/`logo`/`coaches` are ignored, so
    coaches must be listed in `players` and use `.coach` in game.
  - Also read: `spectators.players`, `map_sides` (`team1_ct|team1_t|team2_ct|team2_t|knife`), `veto_first`,
    `side_type`, `skip_veto`, `clinch_series`, `wingman`, `players_per_team`, `min_players_to_ready` (total, not per team)
    and `cvars`. `match_title` is ignored.
- **Cvars in the config:**
  - name must match `^[A-Za-z0-9_]+$`
  - a value containing `"`, `;`, CR or LF is rejected
  - `rcon_password` and `matchzy_everyone_is_admin` are blocked
  - `matchzy_*` / `get5_*` names must be on MatchZy's allowlist (`*_remote_log_*`, `*_demo_upload_*` and
    `*_remote_backup_*` are; `get5_check_auths` and `get5_web_api_url` are not)
- **Events** (POST JSON to the remote log URL, header auth): series_start, series_end, map_picked, map_vetoed,
  side_picked, going_live, round_start, round_end (team objects with players[].stats), map_result, player_death,
  bomb_planted, bomb_defused, game_paused, game_unpaused, backup_loaded, player_disconnect, demo_upload_ended.
  **`attacker`, `assist` and `weapon` can be null.** There's no retry or dedupe, so handlers must be idempotent and must always respond.
- **Uploads:**
  - demos are raw `.dem` (application/octet-stream) with headers `MatchZy-FileName/MatchId/MapNumber/RoundNumber`
    (also sent as `Get5-*`)
  - backups are JSON `matchzy_<matchid>_<map>_round<NN>.json`
- **RCON commands:** `matchzy_addplayer <steam64> <team1|team2|spec> "<name>"`, `matchzy_removeplayer`,
  `css_forcepause`/`css_forceunpause` (`sm_pause`/`sm_unpause` are aliases), `css_endmatch [team1|team2]`,
  `css_restore <round>`, `matchzy_listbackups`, `matchzy_loadbackup <file>`, `matchzy_loadbackup_url`.
  **`get5_addcoach` does not exist.** `listbackups` output contains `\r\n` and noise lines, so parse it strictly.

## Conventions (must follow)
- SQL uses `?` placeholders only, through `db.query`.
- Every mutating route has `Utils.ensureAuthenticated` plus an explicit owner/admin check. Never `req.user && …`, which
  skips the check for anonymous users.
- Validate and sanitize **every** value interpolated into an RCON command: SteamID64 `^7656\d{13}$`; reject `" ; \r \n`.
- Async handlers wrap their bodies in try/catch and always send a response. An unhandled rejection kills the process.
- Error responses carry a generic message (no `err.toString()` or stack traces to clients).
- Never return RCON passwords, password hashes or other users' API keys.
- Match the surrounding style (2-space indent, double quotes, JSDoc `@swagger` blocks on routes).
