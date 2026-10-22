/** Fetch for Challonge API integration.
 * @const
 */
import fetch from "node-fetch";

import Utils from "../utility/utils.js";

/** Database module.
 * @const
 */
import {db} from "../services/db.js";


/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../utility/emitter.js";
import { RowDataPacket } from "mysql2";

type ChallongeMatch = { match: { id: number; player1_id: number; player2_id: number } };

/** Base URL of a tournament in the Challonge v1 API. */
function tournamentUrl(challongeUrl: string): string {
  return "https://api.challonge.com/v1/tournaments/" + encodeURIComponent(challongeUrl);
}

/** Where a match's results go: its tournament's Challonge link (tournament settings), else its season's. */
async function challongeTarget(
  match_id: number | string,
  season_id: number | null
): Promise<{ url: string; ownerId: number; seasonId: number | null } | null> {
  const tournaments: RowDataPacket[] = await db.query(
    "SELECT t.user_id, t.settings FROM tournament_match tm JOIN tournament t ON t.id = tm.tournament_id WHERE tm.match_id = ?",
    [match_id]
  );
  for (const row of tournaments) {
    let url: unknown;
    try {
      url = (JSON.parse(String(row.settings)) as { challonge_url?: unknown }).challonge_url;
    } catch {
      url = undefined;
    }
    if (typeof url === "string" && url) return { url, ownerId: row.user_id, seasonId: null };
  }
  if (!season_id) return null;
  const seasons: RowDataPacket[] = await db.query("SELECT id, challonge_url, user_id FROM season WHERE id = ?", [season_id]);
  if (!seasons[0]?.challonge_url) return null;
  return { url: seasons[0].challonge_url, ownerId: seasons[0].user_id, seasonId: seasons[0].id };
}

/*** A PUT call to Challonge to update a match that is currently being played.
 * Does nothing when neither the match's tournament nor its season is linked to Challonge, the owner has no API key,
 * a team isn't a Challonge participant, or there's no open Challonge match between the teams.
 * @function
 * @memberof module:services/challonge
 * @param {number} match_id - The internal ID of the match being played.
 * @param {number|null} season_id - The internal ID of the current season of the match being played, if any.
 * @param {number} team1_id - The internal team ID of the first team.
 * @param {number} team2_id - The internal team ID of the second team.
 * @param {number} num_maps - The number of maps in the current match.
 * @param {string} [winner=null] - "team1", "team2", "none" for a draw, or null to only update the score.
 */
export default
async function update_challonge_match(
  match_id: number | string,
  season_id: number | null,
  team1_id: number,
  team2_id: number,
  num_maps: number,
  winner: string | null = null
): Promise<void> {
  const target = await challongeTarget(match_id, season_id);
  if (!target) return;
  const challongeUrl: string = target.url;

  let sql: string = "SELECT challonge_team_id FROM team WHERE id = ?";
  const team1ChallongeId = (await db.query(sql, [team1_id]))[0]?.challonge_team_id;
  const team2ChallongeId = (await db.query(sql, [team2_id]))[0]?.challonge_team_id;
  if (!team1ChallongeId || !team2ChallongeId) return;

  // Results are reported with the tournament's or season's owner's API key.
  sql = "SELECT challonge_api_key FROM user WHERE id = ?";
  const ownerKey: RowDataPacket[] = await db.query(sql, [target.ownerId]);
  const decryptedKey: string | null | undefined = Utils.decrypt(ownerKey[0]?.challonge_api_key);
  if (!decryptedKey) return;

  // The current open match between the two participants.
  const openMatchResponse = await fetch(
    tournamentUrl(challongeUrl) +
      "/matches.json?api_key=" + encodeURIComponent(decryptedKey) +
      "&state=open&participant_id=" + team1ChallongeId +
      "&participant_id=" + team2ChallongeId
  );
  const openMatches = (await openMatchResponse.json()) as ChallongeMatch[];
  const challongeMatch = Array.isArray(openMatches) ? openMatches[0]?.match : undefined;
  if (!challongeMatch) return;

  if (num_maps == 1) {
    // Submit the map's round score instead.
    sql = "SELECT team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY map_number";
  } else {
    sql = "SELECT team1_score, team2_score FROM `match` WHERE id = ?";
  }
  const scores: RowDataPacket[] = await db.query(sql, [match_id]);
  if (!scores.length) return;
  // Admins may create the match with the teams swapped compared to Challonge; scores_csv is player1-player2.
  const team1IsPlayer1: boolean = challongeMatch.player1_id == team1ChallongeId;
  const player1Score = team1IsPlayer1 ? scores[0].team1_score : scores[0].team2_score;
  const player2Score = team1IsPlayer1 ? scores[0].team2_score : scores[0].team1_score;

  const putBody: { api_key: string; match: { scores_csv: string; winner_id?: number | string } } = {
    api_key: decryptedKey,
    match: { scores_csv: `${player1Score}-${player2Score}` }
  };
  if (winner === "team1") putBody.match.winner_id = team1ChallongeId;
  else if (winner === "team2") putBody.match.winner_id = team2ChallongeId;
  else if (winner === "none") putBody.match.winner_id = "tie";

  await fetch(tournamentUrl(challongeUrl) + "/matches/" + challongeMatch.id + ".json", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(putBody)
  });

  // Once a result is in and no match is left open, finalize the Challonge tournament (and close the season).
  if (winner === null) return;
  const remainingResponse = await fetch(
    tournamentUrl(challongeUrl) + "/matches.json?api_key=" + encodeURIComponent(decryptedKey) + "&state=open"
  );
  const remaining = await remainingResponse.json();
  if (Array.isArray(remaining) && remaining.length === 0) {
    await fetch(
      tournamentUrl(challongeUrl) + "/finalize.json?api_key=" + encodeURIComponent(decryptedKey),
      { method: "POST" }
    );
    if (target.seasonId) {
      sql = "UPDATE season SET end_date = ? WHERE id = ?";
      await db.query(sql, [new Date().toISOString().slice(0, 19).replace("T", " "), target.seasonId]);
      GlobalEmitter.emit("seasonUpdate");
    }
  }
}

/** A participant as the Challonge v1 API returns it. */
export type ChallongeParticipant = {
  participant: {
    id: number;
    display_name: string;
    custom_field_response?: Record<string, string> | null;
  };
};

/** Creates or updates one team per Challonge participant (re-importing a tournament doesn't duplicate teams).
 * Custom fields of the sign-up form may hold the players' Steam IDs or profile URLs: the first valid one
 * becomes the captain, values that aren't Steam accounts are skipped.
 * @function
 * @memberof module:services/challonge
 * @param {number} userId - Owner of the imported teams.
 * @param {ChallongeParticipant[]} participants - From /participants.json or a tournament's participants.
 * @returns How many teams were created and updated, and the skipped custom field values.
 */
export async function importParticipants(
  userId: number,
  participants: ChallongeParticipant[]
): Promise<{ imported: number; updated: number; skipped: string[] }> {
  let imported: number = 0;
  const skipped: string[] = [];
  for (const team of participants) {
    const displayName: string = String(team.participant.display_name ?? "").substring(0, 40);
    const challongeTeamId: number = team.participant.id;
    const existing: RowDataPacket[] = await db.query(
      "SELECT id FROM team WHERE user_id = ? AND challonge_team_id = ?",
      [userId, challongeTeamId]
    );
    let teamId: number;
    if (existing.length) {
      teamId = existing[0].id;
      await db.query("UPDATE team SET name = ?, tag = ? WHERE id = ?", [displayName, displayName, teamId]);
    } else {
      const insertResult: any = await db.query(
        "INSERT INTO team (user_id, name, tag, challonge_team_id) VALUES (?, ?, ?, ?)",
        [userId, displayName, displayName, challongeTeamId]
      );
      teamId = insertResult.insertId;
      imported++;
    }
    let isFirstPlayer: boolean = true;
    for (const value of Object.values(team.participant.custom_field_response ?? {})) {
      if (!value) continue;
      const steamId: string = await Utils.getSteamPID(String(value));
      if (!steamId) {
        skipped.push(String(value));
        continue;
      }
      const member: RowDataPacket[] = await db.query(
        "SELECT id FROM team_auth_names WHERE team_id = ? AND auth = ?",
        [teamId, steamId]
      );
      if (!member.length) {
        await db.query(
          "INSERT INTO team_auth_names (team_id, auth, name, captain) VALUES (?, ?, ?, ?)",
          [teamId, steamId, "", isFirstPlayer ? 1 : 0]
        );
      }
      isFirstPlayer = false;
    }
  }
  return { imported, updated: participants.length - imported, skipped };
}
