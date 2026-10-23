/** Match templates: each user's saved create-match settings.
 * @module routes/templates
 */
import { Router } from "express";
import { RowDataPacket } from "mysql2";
import { db } from "../services/db.js";
import Utils from "../utility/utils.js";
import { audited, firstBody } from "../utility/audit.js";

const router = Router();

const MAX_TEMPLATES = 50;

export interface TemplateSettings {
  maps_to_win: number;
  map_pool: string[];
  veto_first: "team1" | "team2" | "random";
  side_type: "standard" | "never_knife" | "always_knife";
  skip_veto: boolean;
  players_per_team: number;
  min_players_to_ready: number;
  min_spectators_to_ready: number;
  wingman: boolean;
  cvars: Record<string, string>;
}

/** Keeps only known settings with sane values; returns an error message for invalid cvars. */
export function cleanTemplate(input: unknown): TemplateSettings | string {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const int = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
    return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
  };
  const cvars: Record<string, string> = {};
  if (raw.cvars && typeof raw.cvars === "object" && !Array.isArray(raw.cvars)) {
    for (const [name, value] of Object.entries(raw.cvars as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") cvars[name] = String(value);
    }
  }
  const cvarError = Utils.validateCvars(cvars);
  if (cvarError) return cvarError;
  const players = int(raw.players_per_team, 5, 1, 10);
  const mapsToWin = int(raw.maps_to_win, 1, 1, 7);
  return {
    maps_to_win: [1, 2, 3, 5, 7].includes(mapsToWin) ? mapsToWin : 1,
    map_pool: Array.isArray(raw.map_pool)
      ? raw.map_pool.filter((map): map is string => typeof map === "string" && /^[A-Za-z0-9_./-]{1,128}$/.test(map)).slice(0, 30)
      : [],
    veto_first: (["team1", "team2", "random"].includes(String(raw.veto_first)) ? raw.veto_first : "team1") as TemplateSettings["veto_first"],
    side_type: (["standard", "never_knife", "always_knife"].includes(String(raw.side_type))
      ? raw.side_type
      : "standard") as TemplateSettings["side_type"],
    skip_veto: Boolean(raw.skip_veto),
    players_per_team: players,
    min_players_to_ready: int(raw.min_players_to_ready, players, 1, players),
    min_spectators_to_ready: int(raw.min_spectators_to_ready, 0, 0, 10),
    wingman: Boolean(raw.wingman),
    cvars
  };
}

const parse = (row: RowDataPacket) => {
  let settings: unknown;
  try {
    settings = JSON.parse(row.settings as string);
  } catch {
    // A broken row shows as a template without settings.
    settings = {};
  }
  const cleaned = cleanTemplate(settings);
  return { id: row.id, name: row.name, created_at: row.created_at, settings: typeof cleaned === "string" ? null : cleaned };
};

/**
 * @swagger
 *
 * /templates:
 *   get:
 *     description: The logged-in user's match templates.
 *     tags:
 *       - templates
 *     responses:
 *       200:
 *         description: "{ templates: [{ id, name, settings }] }"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const rows: RowDataPacket[] = await db.query("SELECT * FROM match_template WHERE user_id = ? ORDER BY name", [
      req.user!.id
    ]);
    res.json({ templates: rows.map(parse) });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 *
 * /templates:
 *   post:
 *     description: >
 *       Saves a match template (name, settings - maps_to_win, map_pool, veto_first, side_type, skip_veto,
 *       players_per_team, min_players_to_ready, min_spectators_to_ready, wingman, cvars). A template with the same
 *       name is replaced. Up to 50 per user.
 *     tags:
 *       - templates
 *     responses:
 *       200:
 *         description: "{ message, id }"
 *       412:
 *         description: Missing name, invalid cvars or too many templates.
 */
router.post(
  "/",
  Utils.ensureAuthenticated,
  audited("template.save", {
    target: (req, body) => ({ type: "template", id: body?.id ?? null }),
    detail: (req) => String(firstBody(req).name ?? "")
  }),
  async (req, res, next) => {
    try {
      const body = firstBody(req);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
      if (!name) {
        res.status(412).json({ message: "A name is required." });
        return;
      }
      const settings = cleanTemplate(body.settings);
      if (typeof settings === "string") {
        res.status(412).json({ message: settings });
        return;
      }
      const existing: RowDataPacket[] = await db.query(
        "SELECT id FROM match_template WHERE user_id = ? AND name = ?",
        [req.user!.id, name]
      );
      if (existing.length) {
        await db.query("UPDATE match_template SET settings = ? WHERE id = ?", [JSON.stringify(settings), existing[0].id]);
        res.json({ message: "Template saved.", id: existing[0].id });
        return;
      }
      const count: RowDataPacket[] = await db.query("SELECT COUNT(*) AS n FROM match_template WHERE user_id = ?", [
        req.user!.id
      ]);
      if (Number(count[0]?.n) >= MAX_TEMPLATES) {
        res.status(412).json({ message: `At most ${MAX_TEMPLATES} templates per user.` });
        return;
      }
      const insert: any = await db.query("INSERT INTO match_template (user_id, name, settings) VALUES (?, ?, ?)", [
        req.user!.id,
        name,
        JSON.stringify(settings)
      ]);
      res.json({ message: "Template saved.", id: insert.insertId });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 *
 * /templates/:template_id:
 *   delete:
 *     description: Deletes one of the user's templates.
 *     tags:
 *       - templates
 *     responses:
 *       200:
 *         description: Deleted.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  "/:template_id",
  Utils.ensureAuthenticated,
  audited("template.delete", { target: (req) => ({ type: "template", id: Number(req.params.template_id) || null }) }),
  async (req, res, next) => {
    try {
      const result: any = await db.query("DELETE FROM match_template WHERE id = ? AND user_id = ?", [
        req.params.template_id,
        req.user!.id
      ]);
      if (!result.affectedRows) {
        res.status(404).json({ message: "Template not found." });
        return;
      }
      res.json({ message: "Template deleted." });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
