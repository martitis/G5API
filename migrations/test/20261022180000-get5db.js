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

// Match templates: a user's saved create-match settings (series, map pool, veto, ready counts, cvars).
exports.up = async function (db) {
  await db.createTable("match_template", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    user_id: {
      type: "int",
      length: 11,
      notNull: true,
      foreignKey: {
        name: "user_id_match_template_fk",
        table: "user",
        rules: { onDelete: "CASCADE", onUpdate: "RESTRICT" },
        mapping: "id"
      }
    },
    name: { type: "string", length: 60, notNull: true },
    settings: { type: "text", notNull: true },
    created_at: { type: "datetime", notNull: true, defaultValue: new String("CURRENT_TIMESTAMP") }
  });
};

exports.down = async function (db) {
  await db.dropTable("match_template");
};
exports._meta = {
  version: 35
};
