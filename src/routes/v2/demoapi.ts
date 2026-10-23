/** Express API router for demo uploads in get5.
 * @module routes/v2/demo
 * @requires express
 * @requires db
 */

/**
 * @swagger
 * resourcePath: /v2/demo
 * description: Express API for v2 API calls in G5API.
 */

/** ZIP files.
 * @const
 */
import JSZip from "jszip";

/** Required to save files.
 * @const
 */
import { mkdir, writeFile } from "fs/promises";

/** Config to check demo uploads.
 * @const
 */
import config from "config";

import { db } from "../../services/db.js";

import { Request, Response, Router } from "express";
import Utils from "../../utility/utils.js";
import { RowDataPacket } from "mysql2";

/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../../utility/emitter.js";

import logger from "../../utility/logger.js";
/** Express module
 * @const
 */
const router: Router = Router();

/**
 * @swagger
 *
 * /v2/demo:
 *   post:
 *     description: Retrieves the demos from the given match and map, zips and stores them on the server.
 *     produces:
 *       - application/json
 *     tags:
 *       - v2
 *     parameters:
 *      - in: header
 *        name: MatchZy-FileName
 *        description: Name of the file as defined by get5_demo_name_format
 *        schema:
 *          type: string
 *        required: true
 *      - in: header
 *        name: MatchZy-MapNumber
 *        description: Zero-indexed map number in the series.
 *        schema:
 *          type: string
 *        required: true
 *      - in: header
 *        name: Authorization
 *        description: The API key provided by the server.
 *        schema:
 *          type: string
 *        required: true
 *      - in: header
 *        name: MatchZy-MatchId
 *        description: The ID of the match.
 *        schema:
 *          type: string
 *        required: true
 *     requestBody:
 *       content:
 *         application/octet-stream:
 *           schema:
 *             format: binary
 *     responses:
 *       200:
 *         $ref: '#/components/responses/Success'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post("/", async (req: Request, res: Response) => {
  if (!config.get("server.uploadDemos")) {
    res.status(403).send({ message: "Demo uploads disabled for this server." });
    return;
  }
  try {
    const apiKey: string | undefined = req.get("Authorization");
    const matchId: string | undefined = req.get("MatchZy-MatchId") ?? req.get("Get5-MatchId");
    const mapNumber: string | undefined = req.get("MatchZy-MapNumber") ?? req.get("Get5-MapNumber");
    // Only the base name is used, so a header can never point outside public/demos.
    const demoFilename: string | undefined = (req.get("MatchZy-FileName") ?? req.get("Get5-FileName"))
      ?.split(/[\\/]/)
      .pop();
    // Check that the values have made it across.
    if (!apiKey || !matchId || !mapNumber || !demoFilename) {
      return res
        .status(401)
        .send({ message: "API key, Match ID, or Map Number not provided." });
    }
    if (!/^\d+$/.test(matchId) || !/^\d+$/.test(mapNumber) || !/^[\w.-]+\.dem$/.test(demoFilename)) {
      return res.status(412).send({ message: "Invalid match ID, map number or demo file name." });
    }
    // Check if our API key is correct.
    const matchApiCheck: number = await Utils.checkApiKey(apiKey, matchId);
    if (matchApiCheck == 1) {
      return res.status(401).send({
        message: "Invalid API key has been given."
      });
    }
    // Begin file compression into public/demos and check time variance of 8 minutes.
    let zip: JSZip = new JSZip();
    let sqlString: string =
      "SELECT id, end_time FROM map_stats WHERE match_id = ? AND map_number = ?";
    const mapInfo: RowDataPacket[] = await db.query(sqlString, [
      matchId,
      mapNumber
    ]);
    if (mapInfo.length == 0) {
      return res.status(404).send({ message: "Failed to find map stats object." });
    }
    let currentDate: Date = new Date();
    let endTimeMs: Date = new Date(mapInfo[0].end_time);
    let timeDifference: number = Math.abs(
      currentDate.getTime() - endTimeMs.getTime()
    );
    let minuteDifference = Math.floor(timeDifference / 1000 / 60);
    let updateStmt: object;
    if (minuteDifference > 8) {
      return res.status(401).json({ message: "Demo can no longer be uploaded." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(412).send({ message: "Demo file is empty or not sent as application/octet-stream." });
    }
    const zipFilename: string = demoFilename.replace(/\.dem$/, ".zip");
    zip.file(demoFilename, req.body, { binary: true });
    const zipBuffer: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await mkdir("public/demos", { recursive: true });
    await writeFile("public/demos/" + zipFilename, zipBuffer);
    // Update map stats object to include the link to the demo.
    updateStmt = {
      demoFile: zipFilename
    };
    updateStmt = await db.buildUpdateStatement(updateStmt);

    sqlString = "UPDATE map_stats SET ? WHERE id = ?";
    await db.query(sqlString, [updateStmt, mapInfo[0].id]);
    // A successful upload clears an earlier "failed" (buildUpdateStatement drops nulls, so separately).
    await db.query("UPDATE map_stats SET demo_status = NULL WHERE id = ?", [mapInfo[0].id]);
    GlobalEmitter.emit("mapStatUpdate");
    res.status(200).send({message: "Success"});
    return;
  } catch (error) {
    logger.error(error);
    res.status(500).send({ message: error });
    return;
  }
});

export { router };
