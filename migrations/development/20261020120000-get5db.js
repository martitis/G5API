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

// steam_verified: the account's steam_id was proven by a Steam login.
// Locally registered accounts start unverified, so they can't claim admin rights
// or another person's Steam ID. Existing accounts are kept as verified.
exports.up = function (db, callback) {
  return db.addColumn("user", "steam_verified", {
    type: "boolean",
    notNull: true,
    defaultValue: true
  });
};

exports.down = function (db, callback) {
  return db.removeColumn("user", "steam_verified");
};
exports._meta = {
  version: 28
};
