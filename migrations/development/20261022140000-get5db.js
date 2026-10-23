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

// match_round.event_round: MatchZy's own round_number of the round, so kills and bomb events (which carry
// that number) can be matched to their round. map_stats.demo_status: "failed" when MatchZy reports that the
// demo upload failed (an uploaded demo is map_stats.demoFile).
exports.up = async function (db) {
  await db.addColumn("match_round", "event_round", { type: "int", notNull: false });
  await db.addColumn("map_stats", "demo_status", { type: "string", length: 10, notNull: false });
};

exports.down = async function (db) {
  await db.removeColumn("map_stats", "demo_status");
  await db.removeColumn("match_round", "event_round");
};
exports._meta = {
  version: 31
};
