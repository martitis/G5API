/** Scheduled matches: create-match requests that run at a set time.
 * @module services/scheduler
 */
import { RowDataPacket } from "mysql2";
import { db } from "./db.js";
import GlobalEmitter from "../utility/emitter.js";
import { createMatchAs } from "../routes/matches/matches.js";

/** Runs one scheduled match now: on its server, or the owner's first free server (own ones first, then public). */
export async function runScheduled(id: number): Promise<void> {
  // Claim the row, so two sweeps never create the same match.
  const claim: any = await db.query(
    "UPDATE scheduled_match SET status = 'running', error = NULL WHERE id = ? AND status IN ('pending', 'failed')",
    [id]
  );
  if (!claim.affectedRows) return;
  const rows: RowDataPacket[] = await db.query("SELECT * FROM scheduled_match WHERE id = ?", [id]);
  const entry = rows[0];
  try {
    const owners: RowDataPacket[] = await db.query(
      "SELECT id, steam_id, name, admin, super_admin, small_image, medium_image, large_image FROM user WHERE id = ?",
      [entry.user_id]
    );
    const owner = owners[0] as Express.User | undefined;
    if (!owner) throw new Error("The match's owner no longer exists.");
    const body = JSON.parse(String(entry.body)) as Record<string, unknown>;
    if (!body.server_id && !body.ignore_server) {
      const free: RowDataPacket[] = await db.query(
        "SELECT id FROM game_server WHERE in_use = 0 AND (user_id = ? OR public_server = 1) ORDER BY user_id = ? DESC, id",
        [owner.id, owner.id]
      );
      if (!free.length) throw new Error("No free server at the scheduled time.");
      body.server_id = free[0].id;
    }
    body.start_time = new Date().toISOString().slice(0, 19).replace("T", " ");
    const result = await createMatchAs(owner, body);
    if (result.status !== 200 || !result.json?.id) {
      throw new Error(String(result.json?.message ?? "The match could not be created."));
    }
    await db.query("UPDATE scheduled_match SET status = 'loaded', match_id = ? WHERE id = ?", [result.json.id, id]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The match could not be created.";
    await db.query("UPDATE scheduled_match SET status = 'failed', error = ? WHERE id = ?", [message.slice(0, 500), id]);
  }
  GlobalEmitter.emit("matchUpdate");
}

/** Runs everything that is due. */
export async function runDueSchedules(): Promise<void> {
  const due: RowDataPacket[] = await db.query(
    "SELECT id FROM scheduled_match WHERE status = 'pending' AND run_at <= UTC_TIMESTAMP() ORDER BY run_at"
  );
  for (const row of due) await runScheduled(row.id);
}

/** Checks for due matches every 30 s; started with the API. A run left "running" by a crash is retried. */
export function startScheduleSweep(intervalMs = 30000): NodeJS.Timeout {
  void db
    .query("UPDATE scheduled_match SET status = 'pending' WHERE status = 'running'")
    .catch((err) => console.error("Scheduler reset failed:", err));
  const timer = setInterval(() => {
    runDueSchedules().catch((err) => console.error("Scheduled matches failed:", err));
  }, intervalMs);
  timer.unref();
  return timer;
}
