import { Router } from "express";
var router = Router();

/** Utility class for various methods used throughout.
 * @const */
import Utils from "../utility/utils.js";
import config from "config";
import { PASSWORD_MAX, PASSWORD_MIN } from "../utility/credentials.js";

/**
 * @swagger
 *
 * /auth/options:
 *   get:
 *     description: >
 *       How users can sign in on this panel: local_login is true when username/password accounts are enabled
 *       (server.localLoginEnabled), with the password length limits. Public.
 *     tags:
 *       - auth
 *     responses:
 *       200:
 *         description: "{ steam: true, local_login, password_min, password_max }"
 */
router.get("/auth/options", function (req, res) {
  res.json({
    steam: true,
    local_login: Boolean(config.get("server.localLoginEnabled")),
    password_min: PASSWORD_MIN,
    password_max: PASSWORD_MAX
  });
});

/* GET home page. */
router.get("/", Utils.ensureAuthenticated, function (req, res, next) {
  res.json({ message: "Welcome to G5API!" });
  return;
});

router.get("/isloggedin", function (req, res, next) {
  if (req.user) {
    res.json(req.user);
  } else {
    res.json(false);
  }
});

export default router;
