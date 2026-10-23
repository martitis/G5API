/** Audit log of the panel's admin and write actions (table match_audit).
 * @module utility/audit
 */
import { NextFunction, Request, Response } from "express";
import { db } from "../services/db.js";

import logger from "./logger.js";
type Target = { type: string; id: number | null };

export interface AuditOptions {
  /** What the action was done to; defaults to the match in :match_id. */
  target?: (req: Request, body: any) => Target | null;
  /** A short description (never secrets such as passwords or RCON passwords). */
  detail?: (req: Request, body: any) => string | null | undefined;
}

/** The first object of the array bodies the API uses. */
export const firstBody = (req: Request): Record<string, any> =>
  Array.isArray(req.body) ? (req.body[0] ?? {}) : (req.body ?? {});

const defaultTarget = (req: Request): Target | null =>
  req.params.match_id ? { type: "match", id: parseInt(req.params.match_id) || null } : null;

/**
 * Express middleware that writes one audit row once the response is sent (also for refused requests, so the
 * log shows attempts). Put it after Utils.ensureAuthenticated; anonymous requests are not logged.
 * @param action - e.g. "match.pause", "user.update"
 */
export function audited(action: string, options: AuditOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Remember what the handler answered (e.g. the id of a created item).
    let responseBody: any = null;
    const json = res.json.bind(res);
    res.json = (body: any) => {
      responseBody = body;
      return json(body);
    };
    res.on("finish", () => {
      if (!req.user) return;
      const target = (options.target ?? defaultTarget)(req, responseBody) ?? defaultTarget(req);
      let detail: string | null;
      try {
        detail = options.detail?.(req, responseBody) ?? null;
      } catch {
        // A detail callback must never stop the audit row.
        detail = null;
      }
      void db
        .query(
          // match_id (a foreign key) stays empty: the target may not exist (refused request) or be deleted.
          "INSERT INTO match_audit (user_id, action, target_type, target_id, status_code, cmd_used) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
          [
            req.user.id,
            action,
            target?.type ?? null,
            target?.id ?? null,
            res.statusCode,
            detail ? detail.slice(0, 4000) : null
          ]
        )
        .catch((err) => logger.error({ err }, "Could not write the audit log"));
    });
    next();
  };
}
