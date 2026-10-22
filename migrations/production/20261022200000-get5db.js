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

// Practice mode: a server running css_prac is marked in use (no match) with practice_mode = 1.
exports.up = async function (db) {
  await db.addColumn("game_server", "practice_mode", { type: "boolean", notNull: true, defaultValue: false });
};

exports.down = async function (db) {
  await db.removeColumn("game_server", "practice_mode");
};
exports._meta = {
  version: 37
};
