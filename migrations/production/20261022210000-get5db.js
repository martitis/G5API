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

// The join password (sv_password): sent in the match config and in connect links for those who see the address.
exports.up = async function (db) {
  await db.addColumn("game_server", "join_password", { type: "string", length: 64, notNull: false });
};

exports.down = async function (db) {
  await db.removeColumn("game_server", "join_password");
};
exports._meta = {
  version: 38
};
