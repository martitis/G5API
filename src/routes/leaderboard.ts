/** Express API router for leaderboards in get5.
 * @module routes/leaderboard
 * @requires express
 * @requires db
 */

/**
 * @swagger
 * resourcePath: /leaderboard
 * description: Leaderboard calls from the database.
 */
import { Router } from "express";

const router = Router();

import { db } from "../services/db.js";

import Utils from "../utility/utils.js";
import { TeamStanding } from "../types/leaderboard/TeamStanding.js";
import { Player } from "../types/leaderboard/Player.js";
import { RowDataPacket } from "mysql2";

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     SimpleResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *   responses:
 *     BadRequest:
 *       description: Bad request, information not provided.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 *     NotFound:
 *       description: The specified resource was not found.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 *     Unauthorized:
 *       description: Unauthorized.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 *     Error:
 *       description: Error
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 *     Success:
 *       description: Success
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 */

/**
 * @swagger
 *
 * /leaderboard/:
 *   get:
 *     description: Get lifetime leaderboard of teams
 *     produces:
 *       - application/json
 *     tags:
 *       - leaderboard
 *     responses:
 *       200:
 *         description: Leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", async (req, res, next) => {
  try {
    let leaderboard: TeamStanding[] = await getTeamLeaderboard();
    res.json({ leaderboard });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 *
 * /leaderboard/players:
 *   get:
 *     description: Get lifetime leaderboard for players
 *     produces:
 *       - application/json
 *     tags:
 *       - leaderboard
 *     responses:
 *       200:
 *         description: Leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/players", async (req, res, next) => {
  try {
    let leaderboard: Player[] = await getPlayerLeaderboard();
    res.json({ leaderboard });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 *
 * /leaderboard/players/pug:
 *   get:
 *     description: Get lifetime leaderboard for players in pickup games.
 *     produces:
 *       - application/json
 *     tags:
 *       - leaderboard
 *     responses:
 *       200:
 *         description: Leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/players/pug", async (req, res, next) => {
  try {
    let leaderboard: Player[] = await getPlayerLeaderboard(null, true);
    res.json({ leaderboard });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 *
 * /leaderboard/players/:season_id:
 *   get:
 *     description: Seasonal leaderboard for players
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: season_id
 *         required: true
 *         schema:
 *          type: string
 *     tags:
 *       - leaderboard
 *     responses:
 *       200:
 *         description: Leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/players/:season_id", async (req, res, next) => {
  try {
    let seasonId: number = parseInt(req.params.season_id);
    let leaderboard: Player[] = await getPlayerLeaderboard(seasonId);
    res.json({ leaderboard });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 *
 * /leaderboard/:season_id:
 *   get:
 *     description: Seasonal leaderboard for teams
 *     produces:
 *       - application/json
 *     tags:
 *       - leaderboard
 *     parameters:
 *       - name: season_id
 *         required: true
 *         schema:
 *          type: string
 *     responses:
 *       200:
 *         description: Leaderboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:season_id", async (req, res, next) => {
  try {
    let seasonId = parseInt(req.params.season_id);
    let leaderboard = await getTeamLeaderboard(seasonId);
    res.json({ leaderboard });
  } catch (err) {
    next(err);
  }
});

/** Function to get the current team leaderboard standings in a season, or all time.
 * @function
 * @memberof module:routes/leaderboard
 * @param {string} [seasonId=null] - Season ID to filter.
 * @inner */
const getTeamLeaderboard = async (seasonId: number | null = null) => {
  /* One query: finished, decided series per team (by team id, so equal names stay separate).
   * Wins and losses count series; rounddiff sums the round difference over every map of those series.
   * PUG teams are deleted after their match, so they drop out through the JOIN on team.
   */
  const params: number[] = [];
  let seasonFilter: string = "";
  if (seasonId) {
    seasonFilter = "AND m.season_id = ?";
    params.push(seasonId);
  }
  const standings: RowDataPacket[] = await db.query(
    `SELECT t.id, t.name,
       COUNT(DISTINCT CASE WHEN m.winner = t.id THEN m.id END) AS wins,
       COUNT(DISTINCT CASE WHEN m.winner <> t.id THEN m.id END) AS losses,
       COALESCE(SUM(CASE WHEN m.team1_id = t.id THEN ms.team1_score - ms.team2_score
                         ELSE ms.team2_score - ms.team1_score END), 0) AS rounddiff
     FROM team t
     JOIN \`match\` m ON (m.team1_id = t.id OR m.team2_id = t.id)
     LEFT JOIN map_stats ms ON ms.match_id = m.id
     WHERE m.end_time IS NOT NULL AND m.winner IS NOT NULL AND m.cancelled = 0 ${seasonFilter}
     GROUP BY t.id, t.name`,
    params
  );
  return standings.map((row): TeamStanding => ({
    id: row.id,
    name: row.name,
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    rounddiff: Number(row.rounddiff) || 0
  }));
};

/** Function to get the current player leaderboard standings in a season, or all time.
 * @function
 * @memberof module:routes/leaderboard
 * @param {string} [seasonId=null] - Season ID to filter.
 */
const getPlayerLeaderboard = async (
  seasonId: number | null = null,
  pug: boolean = false
) => {
  /* One aggregate query per leaderboard:
   * - grouped by Steam ID only, so a player who changed names is one row (the latest name is shown)
   * - wins count matches, not maps: official matches by the player's team, PUGs by player_stats.winner
   */
  const params: Array<number | boolean> = [pug ? 1 : 0];
  let seasonFilter: string = "";
  if (seasonId) {
    seasonFilter = "AND m.season_id = ?";
    params.push(seasonId);
  }
  const winCondition: string = pug ? "ps.winner = 1" : "ps.team_id = m.winner";
  const playerStats: RowDataPacket[] = await db.query(
    `SELECT ps.steam_id,
       SUBSTRING_INDEX(GROUP_CONCAT(ps.name ORDER BY ps.id DESC SEPARATOR '\\n'), '\\n', 1) AS name,
       SUM(ps.kills) AS kills, SUM(ps.deaths) AS deaths, SUM(ps.assists) AS assists,
       SUM(ps.k1) AS k1, SUM(ps.k2) AS k2, SUM(ps.k3) AS k3, SUM(ps.k4) AS k4, SUM(ps.k5) AS k5,
       SUM(ps.v1) AS v1, SUM(ps.v2) AS v2, SUM(ps.v3) AS v3, SUM(ps.v4) AS v4, SUM(ps.v5) AS v5,
       SUM(ps.roundsplayed) AS trp, SUM(ps.flashbang_assists) AS fba,
       SUM(ps.damage) AS dmg, SUM(ps.headshot_kills) AS hsk, COUNT(ps.id) AS totalMaps,
       SUM(ps.friendlies_flashed) AS fflash, SUM(ps.enemies_flashed) AS eflash,
       SUM(ps.util_damage) AS utildmg,
       COUNT(DISTINCT CASE WHEN ${winCondition} THEN m.id END) AS wins
     FROM player_stats ps
     JOIN \`match\` m ON m.id = ps.match_id
     WHERE m.cancelled = 0 AND m.is_pug = ? ${seasonFilter}
     GROUP BY ps.steam_id`,
    params
  );
  const allPlayers: Array<Player> = [];
  for (const player of playerStats) {
    const num = (value: any): number => parseFloat(value) || 0;
    const kills = num(player.kills);
    allPlayers.push({
      steamId: player.steam_id,
      name:
        player.name ||
        (await Utils.getSteamName(player.steam_id)) ||
        player.steam_id,
      kills,
      deaths: num(player.deaths),
      assists: num(player.assists),
      k1: num(player.k1),
      k2: num(player.k2),
      k3: num(player.k3),
      k4: num(player.k4),
      k5: num(player.k5),
      v1: num(player.v1),
      v2: num(player.v2),
      v3: num(player.v3),
      v4: num(player.v4),
      v5: num(player.v5),
      trp: num(player.trp),
      fba: num(player.fba),
      total_damage: num(player.dmg),
      hsk: num(player.hsk),
      hsp: kills === 0 ? 0 : +((num(player.hsk) / kills) * 100).toFixed(2),
      average_rating: Utils.getRating(
        kills,
        num(player.trp),
        num(player.deaths),
        num(player.k1),
        num(player.k2),
        num(player.k3),
        num(player.k4),
        num(player.k5)
      ),
      wins: num(player.wins),
      total_maps: num(player.totalMaps),
      enemies_flashed: num(player.eflash),
      friendlies_flashed: num(player.fflash),
      util_damage: num(player.utildmg)
    });
  }
  return allPlayers;
};
export default router;
