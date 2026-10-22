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

// user.roles_from_config: the user's admin flags come from admins/super_admins.steam_ids (set again on every
// Steam login, removed when the Steam ID leaves the list); 0 means a super admin set them in the panel.
// match_audit becomes the panel's audit log: who did what (action), to what (target), with which result.
exports.up = async function (db) {
  await db.addColumn("user", "roles_from_config", { type: "boolean", notNull: true, defaultValue: false });
  // Until now every role came from the config lists.
  await db.runSql("UPDATE user SET roles_from_config = 1 WHERE admin = 1 OR super_admin = 1");
  await db.addColumn("match_audit", "action", { type: "string", length: 40, notNull: false });
  await db.addColumn("match_audit", "target_type", { type: "string", length: 20, notNull: false });
  await db.addColumn("match_audit", "target_id", { type: "int", notNull: false });
  await db.addColumn("match_audit", "status_code", { type: "int", notNull: false });
  await db.addIndex("match_audit", "match_audit_time_idx", ["time_affected"]);
};

exports.down = async function (db) {
  await db.removeIndex("match_audit", "match_audit_time_idx");
  await db.removeColumn("match_audit", "status_code");
  await db.removeColumn("match_audit", "target_id");
  await db.removeColumn("match_audit", "target_type");
  await db.removeColumn("match_audit", "action");
  await db.removeColumn("user", "roles_from_config");
};
exports._meta = {
  version: 32
};
