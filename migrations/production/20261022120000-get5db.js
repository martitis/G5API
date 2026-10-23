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

// Live state for the match list (current side and round of the map being played) and one row per
// finished round (round history, round restore picker). Filled from MatchZy's round_end event.
exports.up = async function (db) {
  await db.addColumn("map_stats", "team1_side", { type: "string", length: 2, notNull: false });
  await db.addColumn("map_stats", "round_number", { type: "int", notNull: true, defaultValue: 0 });
  await db.createTable("match_round", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    match_id: {
      type: "int",
      length: 11,
      notNull: true,
      foreignKey: {
        name: "match_id_match_round_fk",
        table: "match",
        rules: { onDelete: "CASCADE", onUpdate: "RESTRICT" },
        mapping: "id"
      }
    },
    map_id: {
      type: "int",
      length: 11,
      notNull: true,
      foreignKey: {
        name: "map_id_match_round_fk",
        table: "map_stats",
        rules: { onDelete: "CASCADE", onUpdate: "RESTRICT" },
        mapping: "id"
      }
    },
    round_number: { type: "int", notNull: true },
    winner: { type: "string", length: 5, notNull: false },
    winner_side: { type: "string", length: 2, notNull: false },
    reason: { type: "int", notNull: false },
    team1_score: { type: "int", notNull: true, defaultValue: 0 },
    team2_score: { type: "int", notNull: true, defaultValue: 0 },
    round_time: { type: "int", notNull: false }
  });
  // A replayed round (after a backup restore) overwrites its row.
  await db.addIndex("match_round", "match_round_map_round_uq", ["map_id", "round_number"], true);
};

exports.down = async function (db) {
  await db.dropTable("match_round");
  await db.removeColumn("map_stats", "round_number");
  await db.removeColumn("map_stats", "team1_side");
};
exports._meta = {
  version: 30
};
