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

// Server heartbeat: when each game server last answered get5_status (checked every 10 s), when it was last
// checked, and the MatchZy game state it reported.
exports.up = async function (db) {
  await db.addColumn("game_server", "last_seen", { type: "datetime", notNull: false });
  await db.addColumn("game_server", "last_checked", { type: "datetime", notNull: false });
  await db.addColumn("game_server", "last_gamestate", { type: "string", length: 32, notNull: false });
};

exports.down = async function (db) {
  await db.removeColumn("game_server", "last_gamestate");
  await db.removeColumn("game_server", "last_checked");
  await db.removeColumn("game_server", "last_seen");
};
exports._meta = {
  version: 41
};
