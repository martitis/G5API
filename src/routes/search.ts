/** Global search for the panel's top bar: teams, players, matches and tournaments by name.
 * @module routes/search
 */
import { Router } from "express";
import { RowDataPacket } from "mysql2";
import { db } from "../services/db.js";
import Utils from "../utility/utils.js";

const router = Router();

/** LIKE pattern for "contains", with the wildcards in the input escaped. */
const contains = (text: string) => "%" + text.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

/**
 * @swagger
 *
 * /search:
 *   get:
 *     description: >
 *       Up to 8 results per kind whose name contains q (at least 2 characters). Teams - public ones plus the
 *       viewer's own (all for admins), no PUG teams. Players - panel accounts and names from player stats (a
 *       SteamID64 also matches). Matches - by team name or title, newest first; private matches only for
 *       admins and their owner. Tournaments - by name.
 *     produces:
 *       - application/json
 *     parameters:
 *       - { name: q, in: query, required: true, schema: { type: string } }
 *     tags:
 *       - search
 *     responses:
 *       200:
 *         description: "{ teams, players, matches, tournaments }"
 */
router.get("/", async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64) : "";
    if (q.length < 2) {
      res.json({ teams: [], players: [], matches: [], tournaments: [] });
      return;
    }
    const like = contains(q);
    const viewer = req.user;
    const admin = viewer ? Utils.adminCheck(viewer) : false;
    const viewerId = viewer?.id ?? -1;

    const teams: RowDataPacket[] = await db.query(
      "SELECT id, name, tag, logo FROM team WHERE is_pug = 0 AND (name LIKE ? OR tag LIKE ?) " +
        "AND (public_team = 1 OR user_id = ? OR ?) ORDER BY name LIMIT 8",
      [like, like, viewerId, admin]
    );
    // Panel accounts first; players who only appear in match stats link to their Steam ID.
    const accounts: RowDataPacket[] = await db.query(
      "SELECT id, name, steam_id, small_image FROM user WHERE name LIKE ? OR steam_id = ? ORDER BY name LIMIT 8",
      [like, q]
    );
    const known = new Set(accounts.map((row) => row.steam_id));
    const statPlayers: RowDataPacket[] = await db.query(
      "SELECT steam_id, MAX(name) AS name FROM player_stats WHERE name LIKE ? OR steam_id = ? " +
        "GROUP BY steam_id ORDER BY MAX(id) DESC LIMIT 8",
      [like, q]
    );
    const players = [
      ...accounts.map((row) => ({ user_id: row.id, steam_id: row.steam_id, name: row.name, image: row.small_image })),
      ...statPlayers
        .filter((row) => !known.has(row.steam_id))
        .map((row) => ({ user_id: null, steam_id: row.steam_id, name: row.name, image: null }))
    ].slice(0, 8);
    const matches: RowDataPacket[] = await db.query(
      "SELECT id, team1_string, team2_string, title, start_time, end_time, cancelled FROM `match` " +
        "WHERE (team1_string LIKE ? OR team2_string LIKE ? OR title LIKE ?) " +
        "AND (private_match IS NULL OR private_match = 0 OR user_id = ? OR ?) ORDER BY id DESC LIMIT 8",
      [like, like, like, viewerId, admin]
    );
    const tournaments: RowDataPacket[] = await db.query(
      "SELECT id, name, format, status FROM tournament WHERE name LIKE ? ORDER BY id DESC LIMIT 8",
      [like]
    );
    res.json({ teams, players, matches, tournaments });
  } catch (err) {
    next(err);
  }
});

export default router;
