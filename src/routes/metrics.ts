/** Site-wide counters for the metrics page (one query instead of downloading every table).
 * @module routes/metrics
 */
import { Router } from "express";
import { RowDataPacket } from "mysql2";
import { db } from "../services/db.js";

const router = Router();

/**
 * @swagger
 *
 * /metrics:
 *   get:
 *     description: Counts of users, teams, matches, servers, maps played, players and seasons.
 *     produces:
 *       - application/json
 *     tags:
 *       - metrics
 *     responses:
 *       200:
 *         description: The counters.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 metrics:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", async (req, res, next) => {
  try {
    const rows: RowDataPacket[] = await db.query(
      "SELECT " +
        "(SELECT COUNT(*) FROM user) AS users, " +
        "(SELECT COUNT(*) FROM team) AS teams, " +
        "(SELECT COUNT(*) FROM `match`) AS matches, " +
        "(SELECT COUNT(*) FROM `match` WHERE end_time IS NOT NULL AND (cancelled IS NULL OR cancelled = 0)) AS completed_matches, " +
        "(SELECT COUNT(*) FROM `match` WHERE start_time IS NOT NULL AND end_time IS NULL " +
        "AND (cancelled IS NULL OR cancelled = 0) AND (forfeit IS NULL OR forfeit = 0)) AS live_matches, " +
        "(SELECT COUNT(*) FROM game_server) AS servers, " +
        "(SELECT COUNT(*) FROM map_stats) AS maps_played, " +
        "(SELECT COUNT(DISTINCT steam_id) FROM player_stats) AS players, " +
        "(SELECT COUNT(*) FROM season) AS seasons"
    );
    const metrics: Record<string, number> = {};
    for (const [key, value] of Object.entries(rows[0] ?? {})) metrics[key] = Number(value) || 0;
    res.json({ metrics });
  } catch (err) {
    next(err);
  }
});

export default router;
