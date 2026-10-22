/** PUG queues: opened per match by an admin, joined by players, split into teams and loaded on a server.
 * @module routes/pugs
 */
import { NextFunction, Request, Response, Router } from "express";
import Utils from "../utility/utils.js";
import { audited, firstBody } from "../utility/audit.js";
import GlobalEmitter from "../utility/emitter.js";
import logger from "../utility/logger.js";
import {
  createQueue,
  joinQueue,
  leaveQueue,
  loadQueue,
  manageQueue,
  openQueues,
  pickPlayer,
  PugError,
  readyUp
} from "../services/pugs.js";

const router = Router();

/** Answers a refused queue action with its status; anything else goes to the error handler. */
const run =
  (action: (req: Request) => Promise<unknown>, message: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await action(req);
      res.json(typeof result === "number" ? { message, id: result } : { message });
    } catch (err) {
      if (err instanceof PugError) res.status(err.status).json({ message: err.message });
      else next(err);
    }
  };

const queueId = (req: Request) => parseInt(req.params.queue_id) || 0;
const target = (req: Request) => ({ type: "pug", id: queueId(req) || null });

/**
 * @swagger
 *
 * /pugs:
 *   get:
 *     description: Queues that are open or forming teams ("Open queue 7/10" in the match list).
 *     tags:
 *       - pugs
 *     responses:
 *       200:
 *         description: "{ queues: [{ id, title, status, joined, size }] }"
 */
router.get("/", async (req, res, next) => {
  try {
    res.json({ queues: await openQueues() });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 *
 * /pugs/:queue_id:
 *   get:
 *     description: >
 *       A queue with its settings and players (rating, ready, team, captain). status - open, ready_check, picking,
 *       loading, loaded (match_id set), failed (error set) or cancelled.
 *     tags:
 *       - pugs
 *     responses:
 *       200:
 *         description: "{ queue, players }"
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get("/:queue_id", async (req, res, next) => {
  try {
    res.json(await loadQueue(queueId(req)));
  } catch (err) {
    if (err instanceof PugError) res.status(err.status).json({ message: err.message });
    else next(err);
  }
});

/**
 * @swagger
 *
 * /pugs/:queue_id/stream:
 *   get:
 *     description: Server sent events - "queue" with the same data as GET /pugs/:queue_id, on every change.
 *     produces:
 *       - text/event-stream
 *     tags:
 *       - pugs
 */
router.get("/:queue_id/stream", async (req, res, next) => {
  try {
    const id = queueId(req);
    const first = await loadQueue(id);
    res.set({
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();
    let closed = false;
    const send = (data: unknown) => {
      if (!closed) res.write(`event: queue\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let timer: NodeJS.Timeout | null = null;
    const onChange = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        loadQueue(id).then(send).catch((err) => logger.error({ err }, "PUG stream failed"));
      }, 200);
    };
    GlobalEmitter.on("pugUpdate", onChange);
    req.on("close", () => {
      closed = true;
      if (timer) clearTimeout(timer);
      GlobalEmitter.removeListener("pugUpdate", onChange);
      res.end();
    });
    send(first);
  } catch (err) {
    if (err instanceof PugError && !res.headersSent) res.status(err.status).json({ message: err.message });
    else next(err);
  }
});

/**
 * @swagger
 *
 * /pugs:
 *   post:
 *     description: >
 *       Opens a PUG queue (admins only). Body - title, server_id (optional; else the first free server when the
 *       queue fills), season_id, expires_minutes, settings (players_per_team, formation random|balanced|captains,
 *       max_maps, map_pool, side_type, skip_veto, ready_seconds).
 *     tags:
 *       - pugs
 *     responses:
 *       200:
 *         description: "{ message, id }"
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  "/",
  Utils.ensureAuthenticated,
  audited("pug.create", {
    target: (req, body) => ({ type: "pug", id: body?.id ?? null }),
    detail: (req) => String(firstBody(req).title ?? "")
  }),
  run((req) => createQueue(req.user!, firstBody(req)), "Queue opened.")
);

/**
 * @swagger
 *
 * /pugs/:queue_id/join:
 *   post:
 *     description: >
 *       Joins an open queue (Steam-verified accounts only; one queue at a time). The last player to join starts
 *       the ready check. Also - /leave, /ready, /pick (body - user_id, by the captain whose turn it is),
 *       /retry and /cancel (queue owner or super admin).
 *     tags:
 *       - pugs
 *     responses:
 *       200:
 *         description: Done.
 *       403:
 *         description: Not allowed (not signed in with Steam, not your pick, ...).
 *       409:
 *         description: Not possible in the queue's current state.
 */
router.post("/:queue_id/join", Utils.ensureAuthenticated, run((req) => joinQueue(queueId(req), req.user!), "Joined."));
router.post("/:queue_id/leave", Utils.ensureAuthenticated, run((req) => leaveQueue(queueId(req), req.user!), "Left."));
router.post("/:queue_id/ready", Utils.ensureAuthenticated, run((req) => readyUp(queueId(req), req.user!), "Ready."));
router.post(
  "/:queue_id/pick",
  Utils.ensureAuthenticated,
  run((req) => pickPlayer(queueId(req), req.user!, Number(firstBody(req).user_id) || 0), "Picked.")
);
router.post(
  "/:queue_id/retry",
  Utils.ensureAuthenticated,
  audited("pug.retry", { target }),
  run((req) => manageQueue(queueId(req), req.user!, "retry"), "Retried.")
);
router.post(
  "/:queue_id/cancel",
  Utils.ensureAuthenticated,
  audited("pug.cancel", { target }),
  run((req) => manageQueue(queueId(req), req.user!, "cancel"), "Queue cancelled.")
);

export default router;
