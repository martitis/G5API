"use strict";

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

// Server heartbeat: what the game server last reported for a live match (get5_status), and whether the match looks
// interrupted (server restarted, another match loaded). map_stats.stats_incomplete marks maps whose scores were
// resynced from the server because events were missed (player stats of those rounds are lost).
exports.up = async function (db) {
  await db.createTable("match_server_state", {
    match_id: {
      type: "int",
      length: 11,
      primaryKey: true,
      foreignKey: {
        name: "match_id_server_state_fk",
        table: "match",
        rules: { onDelete: "CASCADE", onUpdate: "RESTRICT" },
        mapping: "id"
      }
    },
    // ok | offline | interrupted
    state: { type: "string", length: 16, notNull: true, defaultValue: "ok" },
    // Consecutive checks that saw a problem; a state only changes after two, so a map change isn't an alarm.
    strikes: { type: "int", notNull: true, defaultValue: 0 },
    reason: { type: "string", length: 255, notNull: false },
    checked_at: { type: "datetime", notNull: false },
    last_seen: { type: "datetime", notNull: false },
    gamestate: { type: "string", length: 32, notNull: false },
    server_matchid: { type: "string", length: 32, notNull: false },
    map_number: { type: "int", notNull: false },
    round_number: { type: "int", notNull: false },
    team1_score: { type: "int", notNull: false },
    team2_score: { type: "int", notNull: false },
    team1_series_score: { type: "int", notNull: false },
    team2_series_score: { type: "int", notNull: false },
    interrupted_at: { type: "datetime", notNull: false },
    dismissed_at: { type: "datetime", notNull: false },
    resynced_at: { type: "datetime", notNull: false }
  });
  await db.addColumn("map_stats", "stats_incomplete", { type: "boolean", notNull: true, defaultValue: false });
};

exports.down = async function (db) {
  await db.removeColumn("map_stats", "stats_incomplete");
  await db.dropTable("match_server_state");
};
exports._meta = {
  version: 40
};
