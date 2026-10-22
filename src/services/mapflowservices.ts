/** Service class for all map flow related logic during a live game.
 * @module routes/v2
 * @requires express
 * @requires db
 */
import { db } from "./db.js";

/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../utility/emitter.js";

/**
 * @const
 * Utility library to check API key validity.
 */
import Utils from "../utility/utils.js";
import { Get5_OnGoingLive } from "../types/map_flow/Get5_OnGoingLive.js";
import { Response } from "express";
import { RowDataPacket } from "mysql2";
import { Get5_OnMatchPausedUnpaused } from "../types/map_flow/Get5_OnMatchPausedUnpaused.js";
import { Get5_OnPlayerDeath } from "../types/map_flow/Get5_OnPlayerDeath.js";
import { Get5_OnBombEvent } from "../types/map_flow/Get5_OnBombEvent.js";
import { Get5_OnRoundEnd } from "../types/map_flow/Get5_OnRoundEnd.js";
import { Get5_OnRoundStart } from "../types/map_flow/Get5_OnRoundStart.js";
import update_challonge_match from "./challonge.js";
import { parseMapPool } from "./matchconfig.js";

/** Sends the error to the game server; MatchZy doesn't retry, so this mainly shows up in its log. */
function sendError(res: Response, error: unknown) {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).send({ message: error instanceof Error ? error.message : String(error) });
}

/** Map stats row of a map in a match, if the map has gone live. */
async function getMapStat(matchId: string, mapNumber: number): Promise<RowDataPacket | undefined> {
  const rows: RowDataPacket[] = await db.query(
    "SELECT id, round_restored FROM map_stats WHERE match_id = ? AND map_number = ?",
    [matchId, mapNumber]
  );
  return rows[0];
}

/** Team of a player in this match, or null for players not on either roster (added in game, PUG late joiners). */
async function getPlayerTeamId(matchId: string, steamId: string | undefined): Promise<number | null> {
  if (!steamId) return null;
  const rows: RowDataPacket[] = await db.query(
    "SELECT ta.team_id FROM team_auth_names ta JOIN `match` m " +
      "ON (m.team1_id = ta.team_id OR m.team2_id = ta.team_id) WHERE m.id = ? AND ta.auth = ? LIMIT 1",
    [matchId, steamId]
  );
  return rows[0]?.team_id ?? null;
}

/**
 * @class
 * Map flow service class for live games.
 */
/** "ct" or "t" from a MatchZy side value, null when unknown. MatchZy's winner.side uses the game's team
 * numbers ("3" = CT, "2" = T, "0" = none); player sides are "ct" / "t". */
export const normalizeSide = (side: unknown): "ct" | "t" | null => {
  const value = typeof side === "string" || typeof side === "number" ? String(side).toLowerCase() : "";
  if (value === "ct" || value === "3" || value === "counterterrorist") return "ct";
  if (value === "t" || value === "2" || value === "terrorist") return "t";
  return null;
};

class MapFlowService {
  /**
   * Updates the database and emits mapStatUpdate when the map has gone live.
   * @param {Get5_OnGoingLive} event The OnGoingLive event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnGoingLive(
    event: Get5_OnGoingLive,
    res: Response
  ) {
    try {
      let sqlString: string;
      let startTime: string = new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      let insUpdStatement: object;
      let mapName: string | undefined;

      // Picked maps are played in pick order; without a veto, the pool order is the map order.
      sqlString = "SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id";
      const vetoInfo: RowDataPacket[] = await db.query(sqlString, [event.matchid]);
      mapName = vetoInfo[event.map_number]?.map;
      if (!mapName) {
        sqlString = "SELECT veto_mappool FROM `match` WHERE id = ?";
        const matchInfo: RowDataPacket[] = await db.query(sqlString, [event.matchid]);
        mapName = parseMapPool(matchInfo[0]?.veto_mappool)[event.map_number];
      }
      const mapStat = await getMapStat(event.matchid, event.map_number);
      if (mapStat) {
        // Map restarted or the event was sent again: keep the row, refresh the map name.
        insUpdStatement = await db.buildUpdateStatement({ map_name: mapName });
        if (Object.keys(insUpdStatement).length > 0) {
          await db.query("UPDATE map_stats SET ? WHERE id = ?", [insUpdStatement, mapStat.id]);
        }
      } else {
        insUpdStatement = {
          match_id: event.matchid,
          map_number: event.map_number,
          map_name: mapName,
          start_time: startTime,
          team1_score: 0,
          team2_score: 0
        };
        insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
        await db.query("INSERT INTO map_stats SET ?", insUpdStatement);
      }
      GlobalEmitter.emit("mapStatUpdate");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      return sendError(res, error);
    }
  }

  /**
   * Updates the database and emits playerStatsExtraUpdate when a player has died.
   * @param {Get5_OnPlayerDeath} event The Get5_OnPlayerDeath event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnPlayerDeath(
    event: Get5_OnPlayerDeath,
    res: Response
  ) {
    try {
      if (event.player?.is_bot) {
        res
          .status(200)
          .send({ message: "Bot players do not count towards stats." });
        return;
      }
      const mapStat = await getMapStat(event.matchid, event.map_number);
      if (!mapStat) {
        return res.status(200).send({ message: "Map is not live yet, kill ignored." });
      }
      // attacker, weapon and assist are null for world damage, the bomb and suicides.
      const attacker = event.attacker;
      let insertObj: object = {
        match_id: event.matchid,
        map_id: mapStat.id,
        team_id: await getPlayerTeamId(event.matchid, event.player?.steamid),
        player_steam_id: event.player?.steamid,
        player_name: event.player?.name?.slice(0, 75),
        player_side: event.player?.side ?? "",
        round_number: event.round_number,
        round_time: event.round_time ?? 0,
        attacker_steam_id: attacker && !attacker.is_bot ? attacker.steamid : null,
        attacker_name: attacker?.name?.slice(0, 75),
        attacker_side: attacker?.side,
        // Column is varchar(15); some CS2 knife names are longer.
        weapon: (event.weapon?.name ?? (event.bomb ? "planted_c4" : "world")).slice(0, 15),
        bomb: event.bomb,
        headshot: event.headshot,
        thru_smoke: event.thru_smoke,
        attacker_blind: event.attacker_blind,
        no_scope: event.no_scope,
        suicide: event.suicide,
        friendly_fire: event.friendly_fire,
        assister_steam_id: event.assist?.player?.steamid,
        assister_name: event.assist?.player?.name?.slice(0, 75),
        assister_side: event.assist?.player?.side,
        assist_friendly_fire: event.assist?.friendly_fire,
        flash_assist: event.assist?.flash_assist
      };
      insertObj = await db.buildUpdateStatement(insertObj);
      await db.query("INSERT INTO player_stat_extras SET ?", insertObj);

      GlobalEmitter.emit("playerStatsExtraUpdate");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      return sendError(res, error);
    }
  }

  /**
   * Updates the database and emits bombEvent when a bomb has been planted or defused.
   * @param {Get5_OnBombEvent} event The Get5_OnBombEvent event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnBombEvent(
    event: Get5_OnBombEvent,
    res: Response,
    defused: boolean
  ) {
    try {
      let sqlString: string;
      let playerStatInfo: RowDataPacket[];
      let insObject: object;
      if (event.player?.is_bot) {
        res
          .status(200)
          .send({ message: "Bot players do not count towards stats." });
        return;
      }
      const mapStat = await getMapStat(event.matchid, event.map_number);
      if (!mapStat) {
        return res.status(200).send({ message: "Map is not live yet, bomb event ignored." });
      }
      sqlString =
        "SELECT id FROM player_stats WHERE match_id = ? AND map_id = ? AND steam_id = ?";
      playerStatInfo = await db.query(sqlString, [
        event.matchid,
        mapStat.id,
        event.player.steamid
      ]);
      // If player does not have player stats yet, insert them.
      if (!playerStatInfo.length) {
        const teamId = await getPlayerTeamId(event.matchid, event.player.steamid);
        await Utils.updatePlayerStats(event.matchid, teamId as any, mapStat.id, event.player, null);
        playerStatInfo = await db.query(sqlString, [
          event.matchid,
          mapStat.id,
          event.player.steamid
        ]);
      }
      insObject = {
        match_id: event.matchid,
        map_id: mapStat.id,
        player_stats_id: playerStatInfo[0]?.id,
        round_number: event.round_number,
        round_time: event.round_time,
        site: event.site,
        defused: defused,
        bomb_time_remaining: event?.bomb_time_remaining
      };

      insObject = await db.buildUpdateStatement(insObject);
      await db.query("INSERT INTO match_bomb_plants SET ?", insObject);
      GlobalEmitter.emit("bombEvent");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      return sendError(res, error);
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a round has ended.
   * @param {Get5_OnRoundEnd} event The Get5_OnRoundEnd event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundEnd(
    event: Get5_OnRoundEnd,
    res: Response
  ) {
    try {
      let sqlString: string;
      let singlePlayerStat: RowDataPacket[];

      const mapStat = await getMapStat(event.matchid, event.map_number);
      if (!mapStat) {
        return res.status(200).send({ message: "Map is not live yet, round ignored." });
      }
      sqlString =
        "SELECT id, steam_id FROM player_stats WHERE match_id = ? AND map_id = ?";
      const playerStats: RowDataPacket[] = await db.query(sqlString, [event.matchid, mapStat.id]);
      // Stats in round_end are cumulative for the map, so each player's row is simply overwritten.
      for (const team of [event.team1, event.team2]) {
        for (const player of team.players ?? []) {
          if (player.is_bot) continue;
          singlePlayerStat = playerStats.filter(
            (dbPlayer) => dbPlayer.steam_id == player.steamid
          );
          await Utils.updatePlayerStats(
            event.matchid,
            team.id,
            mapStat.id,
            player,
            singlePlayerStat[0]?.id
          );
        }
      }
      GlobalEmitter.emit("playerStatsUpdate");

      // Rounds played so far, from the score (doesn't depend on how MatchZy numbers rounds).
      const roundsPlayed: number = (Number(event.team1.score) || 0) + (Number(event.team2.score) || 0);
      // MatchZy's team objects carry no side; the winner's side tells which side team 1 played this round.
      const winnerSide = normalizeSide(event.winner?.side);
      const team1Side: string | null =
        winnerSide == null
          ? null
          : event.winner?.team === "team1"
            ? winnerSide
            : event.winner?.team === "team2"
              ? winnerSide === "ct" ? "t" : "ct"
              : null;
      await db.query("UPDATE map_stats SET ? WHERE id = ?", [
        {
          team1_score: event.team1.score,
          team2_score: event.team2.score,
          round_number: roundsPlayed,
          team1_side: team1Side
        },
        mapStat.id
      ]);
      // Round history; a round replayed after a backup restore replaces its row.
      if (roundsPlayed > 0) {
        await db.query(
          "INSERT INTO match_round (match_id, map_id, round_number, event_round, winner, winner_side, reason, team1_score, team2_score, round_time) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON DUPLICATE KEY UPDATE event_round = VALUES(event_round), winner = VALUES(winner), winner_side = VALUES(winner_side), " +
            "reason = VALUES(reason), team1_score = VALUES(team1_score), team2_score = VALUES(team2_score), round_time = VALUES(round_time)",
          [
            event.matchid,
            mapStat.id,
            roundsPlayed,
            Number.isFinite(Number(event.round_number)) ? Number(event.round_number) : null,
            event.winner?.team === "team1" || event.winner?.team === "team2" ? event.winner.team : null,
            winnerSide,
            Number.isFinite(Number(event.reason)) ? Number(event.reason) : null,
            event.team1.score,
            event.team2.score,
            Number.isFinite(Number(event.round_time)) ? Number(event.round_time) : null
          ]
        );
        // A restore to an earlier round drops the rounds after it.
        await db.query("DELETE FROM match_round WHERE map_id = ? AND round_number > ?", [mapStat.id, roundsPlayed]);
      }
      GlobalEmitter.emit("mapStatUpdate");
      GlobalEmitter.emit("matchUpdate");

      // Live Challonge scores for BO1s. A Challonge outage must not fail the round for the game server.
      sqlString = "SELECT max_maps, season_id FROM `match` WHERE id = ?";
      const matchSeasonInfo: RowDataPacket[] = await db.query(sqlString, [event.matchid]);
      if (matchSeasonInfo[0]?.max_maps == 1) {
        try {
          await update_challonge_match(
            event.matchid,
            matchSeasonInfo[0].season_id ?? null,
            +event.team1.id,
            +event.team2.id,
            matchSeasonInfo[0].max_maps
          );
        } catch (challongeError) {
          console.error("Challonge update failed:", challongeError);
        }
      }

      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      return sendError(res, error);
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a round has been restored and the match has started again.
   * @param {Get5_OnRoundStart} event The Get5_OnRoundStart event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundStart(
    event: Get5_OnRoundStart,
    res: Response
  ) {
    try {
      let sqlString: string;
      // After a backup restore, drop the kills and bomb events of the rounds that are being replayed.
      const mapStat = await getMapStat(event.matchid, event.map_number);
      if (mapStat?.round_restored) {
        sqlString =
          "DELETE FROM match_bomb_plants WHERE round_number > ? AND match_id = ? AND map_id = ?";
        await db.query(sqlString, [
          event.round_number,
          event.matchid,
          mapStat.id
        ]);

        sqlString =
          "DELETE FROM player_stat_extras WHERE match_id = ? AND map_id = ? AND round_number > ?";
        await db.query(sqlString, [
          event.matchid,
          mapStat.id,
          event.round_number
        ]);
        await db.query("UPDATE map_stats SET round_restored = 0 WHERE id = ?", [mapStat.id]);
        // Only emit if there was an actual update.
        GlobalEmitter.emit("playerStatsExtraUpdate");
        GlobalEmitter.emit("bombEvent");
      }
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      return sendError(res, error);
    }
  }

  /**
   * Updates the database and emits matchUpdate when a match has been paused or unpaused.
   * @param {Get5_OnMatchPausedUnpaused} event The Get5_OnMatchPausedUnpaused event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnMatchPausedUnPaused(
    event: Get5_OnMatchPausedUnpaused,
    res: Response
  ) {
    try {
      let sqlString: string;
      let insUpdStatement: object;
      let teamPaused: string;

      sqlString = "SELECT team1_string, team2_string FROM `match` WHERE id = ?";
      const matchInfo: RowDataPacket[] = await db.query(sqlString, [event.matchid]);

      sqlString = "SELECT id FROM match_pause WHERE match_id = ?";
      const pauseInfo: RowDataPacket[] = await db.query(sqlString, [event.matchid]);

      if (event.team == "team1") teamPaused = matchInfo[0]?.team1_string;
      else if (event.team == "team2") teamPaused = matchInfo[0]?.team2_string;
      else teamPaused = "Admin";

      insUpdStatement = {
        pause_type: event.pause_type,
        team_paused: teamPaused,
        paused: event.event == "game_paused"
      };
      if (pauseInfo.length) {
        insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
        await db.query("UPDATE match_pause SET ? WHERE match_id = ?", [insUpdStatement, event.matchid]);
      } else {
        insUpdStatement = await db.buildUpdateStatement({ match_id: event.matchid, ...insUpdStatement });
        await db.query("INSERT INTO match_pause SET ?", insUpdStatement);
      }
      GlobalEmitter.emit("matchUpdate");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      return sendError(res, error);
    }
  }
}

export default MapFlowService;
