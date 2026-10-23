/** Compares what the panel knows about a live match with what the game server reports (get5_status).
 * Pure functions, unit tested; services/heartbeat.ts does the polling and the DB writes.
 * @module services/serverstate
 */

/** MatchZy's get5_status fields used here (G5API.cs: matchid and map_number are left out when no match is set up). */
export interface Get5Status {
  gamestate?: string;
  matchid?: string | number;
  map_number?: number;
  round_number?: number;
  maps?: string[];
  team1?: { series_score?: number; current_map_score?: number } | null;
  team2?: { series_score?: number; current_map_score?: number } | null;
}

export interface PanelMap {
  map_number: number;
  team1_score: number;
  team2_score: number;
  ended: boolean;
}

export interface PanelMatch {
  id: number;
  team1_series_score: number;
  team2_series_score: number;
  maps: PanelMap[];
  /** Seconds since the match was created or restarted; MatchZy needs a moment to load a new match. */
  age_s: number;
}

export type ServerState = "ok" | "offline" | "interrupted";

export interface Resync {
  /** The map the server is on, with its score (inserted when the panel never saw it go live). */
  map: { map_number: number; map_name: string | null; team1_score: number; team2_score: number; insert: boolean } | null;
  /** Earlier maps the panel still shows as running (their map_result was missed). */
  close_maps: number[];
  series: { team1: number; team2: number } | null;
}

export interface Assessment {
  /** What this single check saw. */
  seen: ServerState;
  reason: string | null;
  resync: Resync | null;
}

/** Game states in which the map score is meaningful. */
const SCORING_STATES = ["live", "post_game", "pending_restore"];
/** A new or restarted match gets this long to show up on the server before "no match loaded" counts. */
export const LOAD_GRACE_S = 90;

const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * One heartbeat check.
 * @param match - The panel's view of a match that hasn't ended.
 * @param status - get5_status, or null when the server didn't answer.
 */
export function assessServerState(match: PanelMatch, status: Get5Status | null): Assessment {
  if (!status) return { seen: "offline", reason: "The game server does not answer RCON.", resync: null };
  const gamestate = String(status.gamestate ?? "none");
  if (gamestate === "none") {
    if (match.age_s < LOAD_GRACE_S) return { seen: "ok", reason: null, resync: null };
    return {
      seen: "interrupted",
      reason: "No match is loaded on the game server (restarted, or the match was ended from the console).",
      resync: null
    };
  }
  if (String(status.matchid ?? "") !== String(match.id)) {
    return {
      seen: "interrupted",
      reason: `The game server has another match loaded (match ${String(status.matchid ?? "?")}).`,
      resync: null
    };
  }
  return { seen: "ok", reason: null, resync: SCORING_STATES.includes(gamestate) ? resyncFor(match, status) : null };
}

/** What has to change in the DB so it matches the server; null when nothing does. */
export function resyncFor(match: PanelMatch, status: Get5Status): Resync | null {
  const mapNumber = num(status.map_number);
  const score1 = num(status.team1?.current_map_score);
  const score2 = num(status.team2?.current_map_score);
  let map: Resync["map"] = null;
  if (mapNumber !== null && score1 !== null && score2 !== null) {
    const known = match.maps.find((entry) => entry.map_number === mapNumber);
    if (!known || known.team1_score !== score1 || known.team2_score !== score2) {
      map = {
        map_number: mapNumber,
        map_name: status.maps?.[mapNumber] ?? null,
        team1_score: score1,
        team2_score: score2,
        insert: !known
      };
    }
  }
  const close_maps =
    mapNumber === null
      ? []
      : match.maps.filter((entry) => entry.map_number < mapNumber && !entry.ended).map((entry) => entry.map_number);
  const series1 = num(status.team1?.series_score);
  const series2 = num(status.team2?.series_score);
  const series =
    series1 !== null && series2 !== null && (series1 !== match.team1_series_score || series2 !== match.team2_series_score)
      ? { team1: series1, team2: series2 }
      : null;
  return map || close_maps.length || series ? { map, close_maps, series } : null;
}

/**
 * The stored state after a check: a problem must be seen twice in a row before it is reported (a map change or a
 * slow RCON reply shouldn't raise an alarm), and "ok" clears it at once.
 */
export function nextState(
  previous: { state: ServerState; strikes: number },
  seen: ServerState
): { state: ServerState; strikes: number } {
  if (seen === "ok") return { state: "ok", strikes: 0 };
  const strikes = previous.strikes + 1;
  return { state: strikes >= 2 ? seen : previous.state, strikes };
}
