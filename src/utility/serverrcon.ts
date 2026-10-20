import Utils from "./utils.js";
import { Rcon } from "dathost-rcon-client";
import fetch from "node-fetch";
import { compare } from "compare-versions";
import { SteamApiResponse } from "../types/serverrcon/SteamApiResponse.js";

/** Thrown when a value can't safely be passed as an RCON command argument. */
export class RconArgumentError extends Error {}

/** Quotes, semicolons and control characters would let an argument break out into another console command. */
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const UNSAFE_RCON_CHARS = /[";\x00-\x1f\x7f]/;

/**
 * Validates a free-form RCON argument (nickname, URL, key).
 * @param value - The value to check.
 * @param label - Name used in the error message.
 * @param maxLength - Maximum allowed length.
 * @returns The value, if safe.
 */
export function safeRconArg(value: unknown, label: string, maxLength: number = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || UNSAFE_RCON_CHARS.test(value)) {
    throw new RconArgumentError(`Invalid ${label}.`);
  }
  return value;
}

function safeSteamId(value: unknown): string {
  if (typeof value !== "string" || !/^7656\d{13}$/.test(value)) {
    throw new RconArgumentError("Invalid Steam ID.");
  }
  return value;
}

/** MatchZy round backup file name: matchzy_<matchid>_<mapnumber>_round<NN>.json */
const MATCHZY_BACKUP_FILE = /^matchzy_(\d+)_(\d+)_round(\d+)\.json$/;

export interface BackupEntry {
  /** Exact file name to pass to matchzy_loadbackup. */
  file: string;
  /** Zero-based map number in the series. */
  map_number: number;
  round: number;
  /** Whatever MatchZy printed after the file name (timestamp, teams, map, score). */
  info: string;
}

/**
 * Parses matchzy_listbackups output. Each line is either
 * "<file> <timestamp> <team1> <team2> <map> <score1> <score2>" or a full path to the file;
 * RCON output can also contain CR characters, padding bytes and message lines.
 * @param output - Raw RCON output.
 * @returns Backups, newest round first.
 */
export function parseBackupList(output: string): BackupEntry[] {
  const backups = new Map<string, BackupEntry>();
  for (const rawLine of output.split(/\r?\n/)) {
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    const line = rawLine.replace(/[\x00-\x1f\x7f]/g, "").trim();
    const firstToken = line.split(/\s+/)[0] ?? "";
    const file = firstToken.split(/[\\/]/).pop() ?? "";
    const match = MATCHZY_BACKUP_FILE.exec(file);
    if (!match || backups.has(file)) continue;
    backups.set(file, {
      file,
      map_number: parseInt(match[2]),
      round: parseInt(match[3]),
      info: line.slice(firstToken.length).trim()
    });
  }
  return [...backups.values()].sort((a, b) => b.map_number - a.map_number || b.round - a.round);
}

/**
 * Creates a new server object to run various tasks.
 * @class
 */
class ServerRcon {
  host: string;
  port: number;
  password: string;
  rcon: Rcon;

  /**
   * Represents a game server.
   * @constructor
   * @param {string} hostName - IP String or host of server.
   * @param {number} portNumber - Integer port number of the server.
   * @param {string} rconPassword - Rcon password of the server, encrypted.
   */
  constructor(hostName: string, portNumber: number, rconPassword: string) {
    this.host = hostName;
    this.port = portNumber;
    this.password = Utils.decrypt(rconPassword)!;
    this.rcon = new Rcon({
      host: this.host,
      port: this.port,
      password: this.password,
    });
  }

  async execute(commandString: string): Promise<string> {
    try {
      await this.rcon.connect();
      const response = await this.rcon.send(commandString);
      this.rcon.disconnect();
      return response;
    } catch (error) {
      console.error("[RCON] Got error: " + error);
      throw error;
    }
  }

  /**
   * Retrieve Get5's version from the server.
   * @returns The version of the plugin if found, unknown otherwise.
   */
  async getGet5Version(): Promise<string> {
    if (process.env.NODE_ENV === "test") {
      return "unknown";
    }
    let get5Status = await this.execute("get5_status");
    if (get5Status.includes("Unknown command")) {
      return "unknown";
    }
    let get5JsonStatus = await JSON.parse(get5Status);
    return get5JsonStatus.plugin_version;
  }

  /**
   * Checks the availability of the game server via a get5 call.
   * @function
   */
  async isGet5Available(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      let get5Status = await this.execute("get5_web_available");
      if (get5Status.includes("Unknown command")) {
        let get5Version = await this.getGet5Version();
        if (compare(get5Version, "0.13.1", ">=")) {
          return true;
        } else {
          console.log("Either get5 or G5WS plugin is missing.");
          return false;
        }
      }
      let get5JsonStatus = await JSON.parse(get5Status);
      if (get5JsonStatus.gamestate != 0) {
        console.log("Server already has a get5 match setup.");
        return false;
      } else {
        return true;
      }
    } catch (err) {
      console.error("Error on isAvailable server: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Checks the availability of the game server via a get5 call.
   * @function
   */
  async isServerAlive(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      let get5Status = await this.execute("net_public_adr");
      return get5Status != "";
    } catch (err) {
      console.error("Error on game server: " + (err as Error).toString());
      return false;
    }
  }

  /**
   * Checks if the server is up to date via a steam API call.
   * @returns True if up to date, false otherwise.
   */
  async isServerUpToDate(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      let serverResponse: string = await this.execute("status");
      let serverVersion: string | undefined = serverResponse.match(/(?<=\/)\d+/)?.toString();

      if (!serverVersion) {
        throw new Error("Failed to extract server version from response.");
      }

      let response = await fetch(
        `https://api.steampowered.com/ISteamApps/UpToDateCheck/v0001/?appid=730&version=${serverVersion}&format=json`
      );

      
      let data: SteamApiResponse = await response.json() as SteamApiResponse;
      if (!data.response.up_to_date) {
        console.log(
          `Server is not up to date! Current version: ${serverVersion} - Latest version: ${data.response.required_version}`
        );
        return false;
      } else {
        return true;
      }
    } catch (err) {
      console.error("Error on game server: " + (err as Error).toString());
      return false;
    }
  }

  /**
   * Sends out an rcon command that is passed in. Returns results to be parsed.
   * @function
   * @param rconCommandString - The rcon command being passed to the server.
   * @returns response from the server.
   */
  async sendRconCommand(rconCommandString: string): Promise<string> {
    try {
      if (process.env.NODE_ENV === "test") {
        return "Cannot send rcon commands in a test instance, please use development or production instead.";
      }
      let returnValue = await this.execute(rconCommandString);
      return returnValue;
    } catch (err) {
      console.error("Error on sendRCON to server: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Sets the given URL and API key for a match
   * @function
   * @param get5URLString - The string of the host where the Get5 API is stored.
   * @param get5APIKeyString - The string API key for the game server to authenticate.
   * @returns True if we set everything, false on failure, throw error if there is a problem.
   */
  async prepareGet5Match(
    get5URLString: string,
    get5APIKeyString: string
  ): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      safeRconArg(get5URLString, "match config URL", 512);
      safeRconArg(get5APIKeyString, "match API key");
      let loadMatchResponse: string;
      let get5Version = await this.getGet5Version();
      if (compare(get5Version, "0.13.1", ">=")) {
        loadMatchResponse = await this.execute(
          `get5_loadmatch_url "${get5URLString}" "Authorization" "${get5APIKeyString}"`
        );
      } else {
        loadMatchResponse = await this.execute(
          `get5_loadmatch_url "${get5URLString}"`
        );
      }

      if (loadMatchResponse.includes("Failed")) return false;
      else if (loadMatchResponse.includes("another match already loaded"))
        return false;

      if (compare(get5Version, "0.13.1", "<")) {
        await this.execute(`get5_web_api_key ${get5APIKeyString}`);
      }
      return true;
    } catch (err) {
      console.error("Error on preparing match to server: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Function that will call a match to an end, if it has not been completed normally.
   * @function
   * @returns True if we succeed, false otherwise.
   */
  async endGet5Match(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      let loadMatchResponse = await this.execute("get5_endmatch");
      if (loadMatchResponse) return false;
      return true;
    } catch (err) {
      console.error("RCON error on ending match: " + (err as Error).toString());
      return false;
    }
  }

  /**
   * Function that will call a pause to the current match. This acts as an admin pause, and will have no time limit.
   * @function
   * @returns True if we succeed, false otherwise.
   */
  async pauseMatch(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      await this.execute("sm_pause");
      return true;
    } catch (err) {
      console.error("RCON error on pause: " + (err as Error).toString());
      return false;
    }
  }

  /**
   * Function that will call an unpause to the current match. This acts as an admin pause, and will have no time limit.
   * @function
   * @returns True if we succeed, false otherwise.
   */
  async unpauseMatch(): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === "test") {
        return false;
      }
      await this.execute("sm_unpause");
      return true;
    } catch (err) {
      console.error("RCON error on unpause server: " + (err as Error).toString());
      return false;
    }
  }

  /**
   * Adds a user to a given team.
   * @function
   * @param {String} teamString - Either team1 or team2.
   * @param {String} steamId - Formatted Steam64 ID.
   * @param {String} [nickName] - Optional nickname for a given steam ID.
   * @returns Returns the response from the server.
   */
  async addUser(teamString: string, steamId: string, nickName: string | null = null): Promise<string> {
    try {
      if (!["team1", "team2", "spec"].includes(teamString)) {
        throw new RconArgumentError("Invalid team.");
      }
      safeSteamId(steamId);
      if (nickName) safeRconArg(nickName, "nickname", 64);
      if (process.env.NODE_ENV === "test") {
        return "Cannot add user on a test instance. Please use a development or production environment.";
      }
      let loadMatchResponse: string;
      if (nickName)
        loadMatchResponse = await this.execute(
          `get5_addplayer ${steamId} ${teamString} "${nickName}"`
        );
      else
        loadMatchResponse = await this.execute(
          `get5_addplayer ${steamId} ${teamString}`
        );
      return loadMatchResponse;
    } catch (err) {
      console.error("RCON error on addUser: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Adds a coach to a given team.
   * @function
   * @param {String} teamString - Either team1 or team2.
   * @param {String} steamId - Formatted Steam64 ID.
   * @returns Returns the response from the server.
   */
  async addCoach(teamString: string, steamId: string): Promise<string> {
    try {
      if (!["team1", "team2"].includes(teamString)) {
        throw new RconArgumentError("Invalid team.");
      }
      safeSteamId(steamId);
      if (process.env.NODE_ENV === "test") {
        return "Cannot add coaches on a test instance. Please use a development or production environment.";
      }
      let loadMatchResponse = await this.execute(
        `get5_addcoach ${steamId} ${teamString}`
      );
      return loadMatchResponse;
    } catch (err) {
      console.error("RCON error on addCoach: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Removes a user from the match.
   * @function
   * @param {String} steamId - Formatted Steam64 ID.
   * @returns Returns the response from the server.
   */
  async removeUser(steamId: string): Promise<string> {
    try {
      safeSteamId(steamId);
      if (process.env.NODE_ENV === "test") {
        return "Cannot remove users on a test instance. Please use a development or production environment.";
      }
      let loadMatchResponse = await this.execute(`get5_removeplayer ${steamId}`);
      return loadMatchResponse;
    } catch (err) {
      console.error("RCON error on removeUser: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Retrieves the list of round backups for a match on the game server.
   * @function
   * @param {String|Number} matchId - The match ID to list backups for.
   * @returns The parsed backups, newest first.
   */
  async getBackups(matchId: string | number): Promise<BackupEntry[]> {
    try {
      if (process.env.NODE_ENV === "test") {
        return [];
      }
      const id = parseInt(String(matchId));
      if (isNaN(id)) throw new RconArgumentError("Invalid match ID.");
      let listResponse = await this.execute(`get5_listbackups ${id}`);
      return parseBackupList(listResponse);
    } catch (err) {
      console.error("RCON error on getBackups: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Attempts to restore a given backup on the server
   * @function
   * @param {String} backupName - The filename of the backup on the server, as returned by getBackups.
   * @returns Returns the response from the server.
   */
  async restoreBackup(backupName: string): Promise<string> {
    try {
      if (typeof backupName !== "string" || !MATCHZY_BACKUP_FILE.test(backupName)) {
        throw new RconArgumentError("Invalid backup name.");
      }
      if (process.env.NODE_ENV === "test") {
        return "Cannot restore backups on a test instance. Please use a development or production environment.";
      }
      let loadMatchResponse = await this.execute(`get5_loadbackup "${backupName}"`);
      return loadMatchResponse;
    } catch (err) {
      console.error("RCON error on restore backup: " + (err as Error).toString());
      throw err;
    }
  }

  /**
   * Attempts to restore a given backup from the API to a new server.
   * @function
   * @param {String} backupUrl - The URL of the backup on the API.
   * @param {String} matchApiKey - The match API key, sent as the Authorization header when the server downloads it.
   * @returns Returns the response from the server.
   */
  async restoreBackupFromURL(backupUrl: string, matchApiKey: string): Promise<string> {
    try {
      safeRconArg(backupUrl, "backup URL", 512);
      safeRconArg(matchApiKey, "match API key");
      if (process.env.NODE_ENV === "test") {
        return "Cannot restore backups on a test instance. Please use a development or production environment.";
      }
      let loadMatchResponse = await this.execute(
        `get5_loadbackup_url "${backupUrl}" "Authorization" "${matchApiKey}"`
      );
      return loadMatchResponse;
    } catch (err) {
      console.error("RCON error on restore backup: " + (err as Error).toString());
      throw err;
    }
  }
}

export default ServerRcon;
