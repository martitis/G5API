/** Match list summaries: one object per match with everything the match list shows,
 * built from a handful of queries instead of one request per match from the panel.
 * @module services/matchsummary
 */
import { RowDataPacket } from "mysql2";
import { db } from "./db.js";
import Utils from "../utility/utils.js";

export type MatchStatus = "pending" | "warmup" | "live" | "paused" | "finished" | "cancelled";

export interface SummaryTeam {
  id: number | null;
  name: string;
  tag: string | null;
  logo: string | null;
  flag: string | null;
  /** Maps won. */
  score: number;
}

export interface SummaryMap {
  number: number;
  name: string | null;
  team1_score: number;
  team2_score: number;
  /** 1 or 2 when the map is decided. */
  winner: 1 | 2 | null;
  finished: boolean;
}

export interface MatchSummary {
  id: number;
  title: string | null;
  status: MatchStatus;
  /** 1 or 2 once the series is decided (also for forfeits). */
  winner: 1 | 2 | null;
  forfeit: boolean;
  max_maps: number;
  season_id: number | null;
  is_pug: boolean;
  private_match: boolean;
  owner: { id: number; name: string | null };
  start_time: string | null;
  end_time: string | null;
  team1: SummaryTeam;
  team2: SummaryTeam;
  maps: SummaryMap[];
  /** The map being played, while the match is live or paused. */
  current_map: {
    number: number;
    name: string | null;
    team1_score: number;
    team2_score: number;
    /** Rounds played so far; the current round is round + 1. */
    round: number;
    team1_side: "ct" | "t" | null;
  } | null;
  pause: { type: string | null; team: string | null } | null;
  /** Minutes since the match was loaded while its first map hasn't gone live (no-show check); null otherwise. */
  waiting_minutes: number | null;
  /** The heartbeat's last word on the game server while the match runs; null when it is fine or unchecked. */
  server_state: { state: "offline" | "interrupted"; dismissed: boolean } | null;
  /** Only for viewers who may connect (owner, admins, players of both teams, spectators). */
  server: {
    name: string | null;
    ip: string;
    port: number;
    gotv_port: number | null;
    /** The join password (sv_password), if the server has one. */
    password: string | null;
  } | null;
}

export interface Viewer {
  id: number;
  steam_id: string;
  admin: boolean;
}

/** The rows buildSummary needs (see loadSummaries for the queries). */
export interface SummaryInput {
  match: RowDataPacket | Record<string, any>;
  maps: Array<Record<string, any>>;
  pause: Record<string, any> | null;
  /** Whether the viewer may see the server address. */
  canConnect: boolean;
  now?: Date;
}

const truthy = (value: unknown): boolean => value === true || Number(value) === 1;

const side = (value: unknown): "ct" | "t" | null => (value === "ct" || value === "t" ? value : null);

/** Shapes one match row (with its maps and pause row) into a summary. Pure, so it is unit tested. */
export function buildSummary(input: SummaryInput): MatchSummary {
  const m = input.match;
  const sideOf = (teamId: unknown): 1 | 2 | null =>
    teamId == null ? null : teamId == m.team1_id ? 1 : teamId == m.team2_id ? 2 : null;

  const maps: SummaryMap[] = [...input.maps]
    .sort((a, b) => a.map_number - b.map_number)
    .map((map) => ({
      number: Number(map.map_number),
      name: map.map_name ?? null,
      team1_score: Number(map.team1_score) || 0,
      team2_score: Number(map.team2_score) || 0,
      winner: sideOf(map.winner),
      finished: map.end_time != null
    }));
  const playing = [...input.maps].filter((map) => map.end_time == null).sort((a, b) => b.map_number - a.map_number)[0];

  const cancelled = truthy(m.cancelled);
  const forfeit = truthy(m.forfeit);
  const paused = input.pause != null && truthy(input.pause.paused);
  const startTime = m.start_time ? new Date(m.start_time) : null;
  let status: MatchStatus;
  if (cancelled) status = "cancelled";
  else if (m.end_time != null || forfeit) status = "finished";
  else if (startTime && startTime.getTime() > (input.now ?? new Date()).getTime()) status = "pending";
  else if (playing) status = paused ? "paused" : "live";
  // Loaded but no map running: veto, warmup or between maps.
  else status = "warmup";

  const live = status === "live" || status === "paused";
  const mapsWon = (team: 1 | 2) => maps.filter((map) => map.winner === team).length;
  return {
    id: Number(m.id),
    // Get5's default title template ("Map {MAPNUMBER} of {MAXMAPS}") isn't a real title; MatchZy ignores it.
    title: m.title && !/\{[A-Z_]+\}/.test(m.title) ? m.title : null,
    status,
    winner: status === "finished" ? sideOf(m.winner) : null,
    forfeit,
    max_maps: Number(m.max_maps) || 1,
    season_id: m.season_id ?? null,
    is_pug: truthy(m.is_pug),
    private_match: truthy(m.private_match),
    owner: { id: Number(m.user_id), name: m.owner_name ?? null },
    start_time: m.start_time ?? null,
    end_time: m.end_time ?? null,
    team1: {
      id: m.team1_id ?? null,
      name: m.team1_string,
      tag: m.team1_tag ?? null,
      logo: m.team1_logo ?? null,
      flag: m.team1_flag ?? null,
      // The match row holds the series score; fall back to counting map wins.
      score: Math.max(Number(m.team1_score) || 0, mapsWon(1))
    },
    team2: {
      id: m.team2_id ?? null,
      name: m.team2_string,
      tag: m.team2_tag ?? null,
      logo: m.team2_logo ?? null,
      flag: m.team2_flag ?? null,
      score: Math.max(Number(m.team2_score) || 0, mapsWon(2))
    },
    maps,
    current_map:
      live && playing
        ? {
            number: Number(playing.map_number),
            name: playing.map_name ?? null,
            team1_score: Number(playing.team1_score) || 0,
            team2_score: Number(playing.team2_score) || 0,
            round: Number(playing.round_number) || 0,
            team1_side: side(playing.team1_side)
          }
        : null,
    pause: status === "paused" ? { type: input.pause?.pause_type ?? null, team: input.pause?.team_paused ?? null } : null,
    waiting_minutes:
      status === "warmup" && maps.length === 0 && startTime
        ? Math.max(0, Math.floor(((input.now ?? new Date()).getTime() - startTime.getTime()) / 60000))
        : null,
    server_state:
      !["finished", "cancelled"].includes(status) && (m.server_state === "offline" || m.server_state === "interrupted")
        ? { state: m.server_state, dismissed: m.server_state_dismissed_at != null }
        : null,
    server:
      input.canConnect && !["finished", "cancelled"].includes(status) && m.ip_string
        ? {
            name: m.server_name ?? null,
            ip: m.ip_string,
            port: Number(m.port),
            gotv_port: m.gotv_port == null ? null : Number(m.gotv_port),
            password: m.join_password ? String(m.join_password) : null
          }
        : null
  };
}

export interface SummaryFilters {
  /** "active" (pending/warmup/live/paused), "finished", "cancelled" or "all"; default: everything but cancelled. */
  status?: string;
  season_id?: number;
  team_id?: number;
  server_id?: number;
  /** Only matches owned by the viewer. */
  mine?: boolean;
  /** Team name contains. */
  q?: string;
  /** Only these match ids (the live stream refreshes known matches). */
  ids?: number[];
  limit?: number;
  offset?: number;
}

const ACTIVE_SQL = "(m.cancelled IS NULL OR m.cancelled = 0) AND m.end_time IS NULL AND (m.forfeit IS NULL OR m.forfeit = 0)";

/** Loads one page of summaries, live and upcoming matches first, then the newest.
 * Private matches are only listed for their owner, admins and members of both teams.
 */
export async function loadSummaries(
  filters: SummaryFilters,
  viewer: Viewer | null
): Promise<{ matches: MatchSummary[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];

  // Teams the viewer plays in (for private matches and connect info).
  let myTeams: number[] = [];
  let spectating: Set<number> = new Set();
  // A local account's Steam ID is only trusted once proven by a Steam login (steam_verified).
  let verifiedSteamId: string | null = null;
  if (viewer?.steam_id) {
    const userRows: RowDataPacket[] = await db.query("SELECT steam_verified FROM user WHERE id = ?", [viewer.id]);
    if (truthy(userRows[0]?.steam_verified)) verifiedSteamId = viewer.steam_id;
  }
  if (verifiedSteamId) {
    const teamRows: RowDataPacket[] = await db.query(
      "SELECT DISTINCT team_id FROM team_auth_names WHERE auth = ?",
      [verifiedSteamId]
    );
    myTeams = teamRows.map((row) => row.team_id);
    const specRows: RowDataPacket[] = await db.query("SELECT match_id FROM match_spectator WHERE auth = ?", [
      verifiedSteamId
    ]);
    spectating = new Set(specRows.map((row) => row.match_id));
  }
  if (!viewer?.admin) {
    const visible = ["m.private_match IS NULL", "m.private_match = 0"];
    if (viewer) {
      visible.push("m.user_id = ?");
      args.push(viewer.id);
      if (myTeams.length) {
        visible.push("m.team1_id IN (?)", "m.team2_id IN (?)");
        args.push(myTeams, myTeams);
      }
    }
    where.push(`(${visible.join(" OR ")})`);
  }

  switch (filters.status) {
    case "active":
      where.push(ACTIVE_SQL);
      break;
    case "finished":
      where.push("(m.cancelled IS NULL OR m.cancelled = 0) AND (m.end_time IS NOT NULL OR m.forfeit = 1)");
      break;
    case "cancelled":
      where.push("m.cancelled = 1");
      break;
    case "all":
      break;
    default:
      where.push("(m.cancelled IS NULL OR m.cancelled = 0)");
  }
  if (filters.season_id) {
    where.push("m.season_id = ?");
    args.push(filters.season_id);
  }
  if (filters.team_id) {
    where.push("(m.team1_id = ? OR m.team2_id = ?)");
    args.push(filters.team_id, filters.team_id);
  }
  if (filters.server_id) {
    where.push("m.server_id = ?");
    args.push(filters.server_id);
  }
  if (filters.mine && viewer) {
    where.push("m.user_id = ?");
    args.push(viewer.id);
  }
  if (filters.q) {
    where.push("(m.team1_string LIKE ? OR m.team2_string LIKE ? OR m.title LIKE ?)");
    const like = "%" + filters.q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    args.push(like, like, like);
  }
  if (filters.ids) {
    if (!filters.ids.length) return { matches: [], total: 0 };
    where.push("m.id IN (?)");
    args.push(filters.ids);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const countRows: RowDataPacket[] = await db.query(`SELECT COUNT(*) AS total FROM \`match\` m ${whereSql}`, args);
  const rows: RowDataPacket[] = await db.query(
    "SELECT m.id, m.user_id, m.server_id, m.team1_id, m.team2_id, m.winner, m.team1_score, m.team2_score, " +
      "m.team1_string, m.team2_string, m.cancelled, m.forfeit, m.start_time, m.end_time, m.max_maps, m.title, " +
      "m.season_id, m.is_pug, m.private_match, u.name AS owner_name, " +
      "t1.tag AS team1_tag, t1.logo AS team1_logo, t1.flag AS team1_flag, " +
      "t2.tag AS team2_tag, t2.logo AS team2_logo, t2.flag AS team2_flag, " +
      "gs.display_name AS server_name, gs.ip_string, gs.port, gs.gotv_port, gs.join_password, " +
      "mss.state AS server_state, mss.dismissed_at AS server_state_dismissed_at " +
      "FROM `match` m " +
      "LEFT JOIN user u ON u.id = m.user_id " +
      "LEFT JOIN team t1 ON t1.id = m.team1_id " +
      "LEFT JOIN team t2 ON t2.id = m.team2_id " +
      "LEFT JOIN game_server gs ON gs.id = m.server_id " +
      "LEFT JOIN match_server_state mss ON mss.match_id = m.id " +
      `${whereSql} ORDER BY (${ACTIVE_SQL}) DESC, m.id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  if (!rows.length) return { matches: [], total: Number(countRows[0]?.total) || 0 };

  const ids = rows.map((row) => row.id);
  const mapRows: RowDataPacket[] = await db.query(
    "SELECT match_id, map_number, map_name, team1_score, team2_score, winner, end_time, team1_side, round_number " +
      "FROM map_stats WHERE match_id IN (?)",
    [ids]
  );
  const pauseRows: RowDataPacket[] = await db.query(
    "SELECT match_id, paused, pause_type, team_paused FROM match_pause WHERE match_id IN (?)",
    [ids]
  );

  const matches = rows.map((match) =>
    buildSummary({
      match,
      maps: mapRows.filter((map) => map.match_id === match.id),
      pause: pauseRows.find((pause) => pause.match_id === match.id) ?? null,
      canConnect:
        viewer != null &&
        (viewer.admin ||
          match.user_id === viewer.id ||
          myTeams.includes(match.team1_id) ||
          myTeams.includes(match.team2_id) ||
          spectating.has(match.id))
    })
  );
  return { matches, total: Number(countRows[0]?.total) || 0 };
}

/** The viewer of a request, for loadSummaries. */
export function viewerOf(user: Express.User | undefined): Viewer | null {
  if (!user) return null;
  return {
    id: user.id,
    steam_id: user.steam_id,
    admin: Utils.adminCheck(user) || Utils.superAdminCheck(user)
  };
}
