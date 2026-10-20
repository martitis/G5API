/**
 * Forwards rejected promises from async route handlers to the Express error handler.
 * Express 4 ignores the promise an async handler returns, so a throw outside a try/catch
 * left the request hanging (or crashed the process). Express 5 does this natively; remove
 * this file when upgrading. Import it once, before any router is created.
 * @module utility/asyncErrors
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Layer = require("express/lib/router/layer");

// Same as Express 4's Layer.prototype.handle_request, plus the promise check.
Layer.prototype.handle_request = function handle(req: any, res: any, next: any) {
  const fn = this.handle;

  if (fn.length > 3) {
    // not a standard request handler
    return next();
  }

  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === "function") {
      result.catch(next);
    }
  } catch (err) {
    next(err);
  }
};
