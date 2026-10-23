/** Structured logging (pino): one JSON line per entry, for pm2 / journald / any log shipper.
 * Level from LOG_LEVEL (default "info"; tests default to "warn" so suites stay readable).
 * @module utility/logger
 */
import { pino } from "pino";

const env: string = process.env.NODE_ENV || "development";

const logger = pino({
  level: process.env.LOG_LEVEL || (env === "test" ? "warn" : "info"),
  base: { app: "g5api", env },
  // Never write credentials that arrive in headers (the match API key, cookies) to the log.
  redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]']
});

export default logger;
