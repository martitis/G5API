/** Server heartbeat: polls get5_status for every live match, stores what the server reports
 * (match_server_state), marks interrupted matches and resyncs scores the panel missed.
 * @module services/heartbeat
 */
import { RowDataPacket } from "mysql2";
import { db } from "./db.js";
import GameServer from "../utility/serverrcon.js";
import GlobalEmitter from "../utility/emitter.js";
import Utils from "../utility/utils.js";
import logger from "../utility/logger.js";
import {
  assessServerState,
  Get5Status,
  nextState,
  PanelMatch,
  Resync,
  ServerState
} from "./serverstate.js";

const STATUS_TIMEOUT_MS = 5000;

const sqlNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** The match's game server's get5_status, or null when it doesn't answer in time. */
async function fetchStatus(serverId: number): Promise<Get5Status | null> {
  const rows: RowDataPacket[] = await db.query("SELECT ip_string, port, rcon_password FROM game_server WHERE id = ?", [
    serverId
  ]);
  if (!rows.length) return null;
  const server = new GameServer(rows[0].ip_string, rows[0].port, rows[0].rcon_password);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STATUS_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([server.getMatchStatus().catch(() => null), timeout])) as Get5Status | null;
  } finally {
    clearTimeout(timer);
  }
}

/** Writes a resync to the DB: the current map's score, earlier maps the panel missed the end of, the series score. */
async function applyResync(match: RowDataPacket, resync: Resync): Promise<void> {
  if (resync.map && !resync.map.insert) {
    // The rounds in between were missed, so the map's player stats are incomplete.
    await db.query(
      "UPDATE map_stats SET team1_score = ?, team2_score = ?, stats_incomplete = 1 WHERE match_id = ? AND map_number = ?",
      [resync.map.team1_score, resync.map.team2_score, match.id, resync.map.map_number]
    );
  } else if (resync.map) {
    const { map_number, map_name, team1_score, team2_score } = resync.map;
    // The panel never saw this map go live; a going_live arriving later keeps this row (unique key).
    await db.query(
      "INSERT INTO map_stats SET ? ON DUPLICATE KEY UPDATE team1_score = VALUES(team1_score), " +
        "team2_score = VALUES(team2_score), stats_incomplete = 1",
      [
        {
          match_id: match.id,
          map_number,
          map_name: map_name ?? "",
          start_time: sqlNow(),
          team1_score,
          team2_score,
          stats_incomplete: 1
        }
      ]
    );
  }
  for (const mapNumber of resync.close_maps) {
    const rows: RowDataPacket[] = await db.query(
      "SELECT id, team1_score, team2_score FROM map_stats WHERE match_id = ? AND map_number = ?",
      [match.id, mapNumber]
    );
    if (!rows.length) continue;
    const { team1_score, team2_score } = rows[0];
    const winner = team1_score > team2_score ? match.team1_id : team2_score > team1_score ? match.team2_id : null;
    const closed: any = await db.query("UPDATE map_stats SET end_time = ?, winner = ? WHERE id = ? AND end_time IS NULL", [
      sqlNow(),
      winner,
      rows[0].id
    ]);
    // Same as a real map_result: PUG player stats get their team and result (teams are kept until series end).
    if (closed.affectedRows && Number(match.is_pug) === 1) {
      await Utils.updatePugStats(match.id, rows[0].id, match.team1_id, match.team2_id, winner, false);
    }
  }
  if (resync.series) {
    await db.query("UPDATE `match` SET team1_score = ?, team2_score = ? WHERE id = ?", [
      resync.series.team1,
      resync.series.team2,
      match.id
    ]);
  }
}

/** The match's stored server state (the API's last check), or null if it was never checked. */
export async function getServerState(matchId: number | string): Promise<RowDataPacket | null> {
  const rows: RowDataPacket[] = await db.query("SELECT * FROM match_server_state WHERE match_id = ?", [matchId]);
  return rows[0] ?? null;
}

/**
 * Checks one match now.
 * @param matchId - A match that hasn't ended.
 * @param getStatus - How to read get5_status (tests pass a fake); defaults to RCON with a 5 s timeout.
 * @returns The stored state, or null when the match is over or has no server.
 */
export async function checkMatch(
  matchId: number,
  getStatus: (serverId: number) => Promise<Get5Status | null> = fetchStatus
): Promise<RowDataPacket | null> {
  const matches: RowDataPacket[] = await db.query(
    "SELECT id, server_id, team1_id, team2_id, team1_score, team2_score, start_time, end_time, cancelled, is_pug " +
      "FROM `match` WHERE id = ?",
    [matchId]
  );
  const match = matches[0];
  if (!match || match.end_time || Number(match.cancelled) === 1 || !match.server_id) return null;
  const maps: RowDataPacket[] = await db.query(
    "SELECT map_number, team1_score, team2_score, end_time FROM map_stats WHERE match_id = ?",
    [matchId]
  );
  const panel: PanelMatch = {
    id: match.id,
    team1_series_score: Number(match.team1_score) || 0,
    team2_series_score: Number(match.team2_score) || 0,
    maps: maps.map((row) => ({
      map_number: Number(row.map_number),
      team1_score: Number(row.team1_score) || 0,
      team2_score: Number(row.team2_score) || 0,
      ended: row.end_time != null
    })),
    age_s: match.start_time ? (Date.now() - new Date(match.start_time).getTime()) / 1000 : Infinity
  };
  const status = await getStatus(match.server_id);
  const previous = await getServerState(matchId);
  const assessment = assessServerState(panel, status);
  const next = nextState(
    { state: (previous?.state as ServerState) ?? "ok", strikes: Number(previous?.strikes) || 0 },
    assessment.seen
  );

  // Only resync a score the server reported on the previous check too: a check that lands between a round end
  // and its webhook event would otherwise "fix" a score that is about to arrive.
  let resync = assessment.resync;
  if (resync?.map && !resync.map.insert) {
    const stable =
      previous != null &&
      Number(previous.map_number) === resync.map.map_number &&
      Number(previous.team1_score) === resync.map.team1_score &&
      Number(previous.team2_score) === resync.map.team2_score;
    if (!stable) resync = resync.close_maps.length || resync.series ? { ...resync, map: null } : null;
  }
  if (resync) {
    await applyResync(match, resync);
    logger.warn({ match_id: matchId, resync }, "Resynced a match from its game server (events were missed)");
  }

  const now = sqlNow();
  const interrupted = next.state === "interrupted";
  const row = {
    match_id: matchId,
    state: next.state,
    strikes: next.strikes,
    reason: next.state === "ok" ? null : assessment.reason ?? previous?.reason ?? null,
    checked_at: now,
    last_seen: status ? now : previous?.last_seen ?? null,
    gamestate: status ? String(status.gamestate ?? "none") : previous?.gamestate ?? null,
    server_matchid: status?.matchid != null ? String(status.matchid) : null,
    map_number: status?.map_number ?? null,
    round_number: status?.round_number ?? null,
    team1_score: status?.team1?.current_map_score ?? null,
    team2_score: status?.team2?.current_map_score ?? null,
    team1_series_score: status?.team1?.series_score ?? null,
    team2_series_score: status?.team2?.series_score ?? null,
    interrupted_at: interrupted ? previous?.interrupted_at ?? now : null,
    // A dismissal lasts until the server is fine again.
    dismissed_at: next.state === "ok" ? null : previous?.dismissed_at ?? null,
    resynced_at: resync ? now : previous?.resynced_at ?? null
  };
  await db.query("INSERT INTO match_server_state SET ? ON DUPLICATE KEY UPDATE ?", [row, row]);

  if ((previous?.state ?? "ok") !== next.state) {
    logger.warn({ match_id: matchId, state: next.state, reason: row.reason }, "Match server state changed");
  }
  if (resync || (previous?.state ?? "ok") !== next.state) {
    GlobalEmitter.emit("matchUpdate", matchId);
    if (resync) GlobalEmitter.emit("mapStatUpdate", matchId);
  }
  return getServerState(matchId);
}

/** Marks the current problem as seen by an admin; it comes back if the server goes ok and then fails again. */
export async function dismissServerState(matchId: number | string): Promise<void> {
  await db.query("UPDATE match_server_state SET dismissed_at = ? WHERE match_id = ? AND state <> 'ok'", [
    sqlNow(),
    matchId
  ]);
  GlobalEmitter.emit("matchUpdate", matchId);
}

let sweeping = false;

/** Checks every match that hasn't ended and has a server, a few at a time. */
export async function checkAllMatches(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const rows: RowDataPacket[] = await db.query(
      "SELECT id FROM `match` WHERE end_time IS NULL AND (cancelled IS NULL OR cancelled = 0) AND server_id IS NOT NULL"
    );
    for (let i = 0; i < rows.length; i += 5) {
      await Promise.all(
        rows.slice(i, i + 5).map((row) =>
          checkMatch(row.id).catch((err) => logger.error({ err, match_id: row.id }, "Heartbeat check failed"))
        )
      );
    }
  } finally {
    sweeping = false;
  }
}

/** Runs a check at once (catches up on anything that happened while the API was down), then every 30 s. */
export function startHeartbeatSweep(intervalMs = 30000): NodeJS.Timeout {
  checkAllMatches().catch((err) => logger.error({ err }, "Heartbeat sweep failed"));
  const timer = setInterval(() => {
    checkAllMatches().catch((err) => logger.error({ err }, "Heartbeat sweep failed"));
  }, intervalMs);
  timer.unref();
  return timer;
}
