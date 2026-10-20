// Unit tests that need no database or game server.
import { agent } from "supertest";
import app from "../app.js";
import { parseBackupList, safeRconArg, RconArgumentError } from "../src/utility/serverrcon.js";
import Utils from "../src/utility/utils.js";

const request = agent(app);

describe("Routes refuse anonymous and malformed requests before touching the database", () => {
  it.each([
    ["delete", "/seasons"],
    ["delete", "/playerstats"],
    ["delete", "/playerstatsextra"],
    ["get", "/servers/1/rcon"],
    ["post", "/matches/1/cancel"],
    ["post", "/matches/1/pause"]
  ])("%s %s without login gives 401 JSON", (method, path) => {
    return request[method](path)
      .send([{ season_id: 1, match_id: 1 }])
      .expect("Content-Type", /json/)
      .expect(401);
  });

  it.each([
    ["get", "/matches/1/cancel"],
    ["get", "/matches/1/pause"],
    ["get", "/logout"],
    ["post", "/match/1/finish"]
  ])("%s %s no longer exists", (method, path) => {
    return request[method](path).expect(404);
  });

  it("rejects backup uploads with a path in the headers", () => {
    return request
      .post("/v2/backup")
      .set("Authorization", "key")
      .set("MatchZy-MatchId", "../../etc")
      .set("MatchZy-MapNumber", "0")
      .set("MatchZy-RoundNumber", "1")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("{}"))
      .expect(412);
  });

  it("rejects demo uploads with a path as the file name", () => {
    return request
      .post("/v2/demo")
      .set("Authorization", "key")
      .set("MatchZy-MatchId", "1")
      .set("MatchZy-MapNumber", "0")
      .set("MatchZy-FileName", "..\\..\\app.js")
      .set("Content-Type", "application/octet-stream")
      .send(Buffer.from("demo"))
      .expect((res) => {
        // 403 when demo uploads are disabled in the config, otherwise the name is refused.
        expect([403, 412]).toContain(res.status);
      });
  });
});

describe("parseBackupList", () => {
  // Shaped like MatchZy's matchzy_listbackups reply: "<file> <timestamp> <team1> <team2> <map> <score1> <score2>",
  // or the full path when the backup info can't be read, with CRLF line endings and padding bytes.
  const output =
    "matchzy_12_0_round05.json 2026-10-20 18:00:00 Team A Team B de_mirage 3 2\r\n" +
    "\u0000/home/cs2/game/csgo/MatchZyDataBackup/matchzy_12_0_round04.json\r\n" +
    "matchzy_12_1_round01.json 2026-10-20 19:00:00 Team A Team B de_inferno 0 1\r\n" +
    "matchzy_12_0_round05.json 2026-10-20 18:00:00 Team A Team B de_mirage 3 2\r\n" +
    "Found no backup files matching the provided parameters.\r\n" +
    "\r\n";

  it("returns only real backup file names, without CR, padding or details", () => {
    const backups = parseBackupList(output);
    expect(backups.map((b) => b.file)).toEqual([
      "matchzy_12_1_round01.json",
      "matchzy_12_0_round05.json",
      "matchzy_12_0_round04.json"
    ]);
  });

  it("keeps map, round and the info MatchZy printed", () => {
    const [latest] = parseBackupList(output);
    expect(latest).toEqual({
      file: "matchzy_12_1_round01.json",
      map_number: 1,
      round: 1,
      info: "2026-10-20 19:00:00 Team A Team B de_inferno 0 1"
    });
  });

  it("returns nothing for output without backups", () => {
    expect(parseBackupList("Found no backup files matching the provided parameters.\r\n")).toEqual([]);
    expect(parseBackupList("")).toEqual([]);
  });
});

describe("safeRconArg", () => {
  it("accepts ordinary values", () => {
    expect(safeRconArg("Player O'Neil", "nickname")).toBe("Player O'Neil");
    expect(safeRconArg("https://example.com/api/matches/1/config", "url", 512)).toMatch(/^https/);
  });

  it.each([
    ['name" ; rcon_password hacked', "quote and semicolon"],
    ["name; quit", "semicolon"],
    ["name\nquit", "newline"],
    ["", "empty"],
    ["x".repeat(65), "too long"]
  ])("rejects %j (%s)", (value) => {
    expect(() => safeRconArg(value, "nickname", 64)).toThrow(RconArgumentError);
  });

  it("rejects non-strings", () => {
    expect(() => safeRconArg(undefined, "nickname")).toThrow(RconArgumentError);
    expect(() => safeRconArg(123, "nickname")).toThrow(RconArgumentError);
  });
});

describe("Utils.validateCvars", () => {
  it("accepts normal cvars", () => {
    expect(Utils.validateCvars({ mp_maxrounds: 24, mp_overtime_enable: "1", sv_cheats: false })).toBeNull();
    expect(Utils.validateCvars(null)).toBeNull();
  });

  it.each([
    [{ rcon_password: "x" }, /cannot be set/],
    [{ matchzy_everyone_is_admin: "true" }, /cannot be set/],
    [{ matchzy_remote_log_url: "http://evil" }, /cannot be set/],
    [{ get5_demo_upload_header_value: "x" }, /cannot be set/],
    [{ "mp_maxrounds;quit": "1" }, /Invalid cvar name/],
    [{ hostname: 'a" ; rcon_password b' }, /Invalid value/],
    [{ hostname: "a\nb" }, /Invalid value/],
    [{ hostname: { nested: 1 } }, /Invalid value/],
    [["mp_maxrounds"], /must be an object/]
  ])("rejects %j", (cvars, message) => {
    expect(Utils.validateCvars(cvars)).toMatch(message);
  });
});

describe("Utils.isSteamId64 / safeCompare", () => {
  it("validates SteamID64s", () => {
    expect(Utils.isSteamId64("76561198025644194")).toBe(true);
    expect(Utils.isSteamId64("12345")).toBe(false);
    expect(Utils.isSteamId64("76561198025644194; quit")).toBe(false);
    expect(Utils.isSteamId64(76561198025644194)).toBe(false);
  });

  it("never matches missing keys", () => {
    expect(Utils.safeCompare("abc", "abc")).toBe(true);
    expect(Utils.safeCompare("abc", "abd")).toBe(false);
    expect(Utils.safeCompare("abc", undefined)).toBe(false);
    expect(Utils.safeCompare(undefined, undefined)).toBe(false);
    expect(Utils.safeCompare("undefined", undefined)).toBe(false);
  });
});
