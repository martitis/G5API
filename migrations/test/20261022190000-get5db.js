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

// Scheduled matches: a create-match request that the API runs at run_at (on its server, or the first free one).
exports.up = async function (db) {
  await db.createTable("scheduled_match", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    user_id: {
      type: "int",
      length: 11,
      notNull: true,
      foreignKey: {
        name: "user_id_scheduled_match_fk",
        table: "user",
        rules: { onDelete: "CASCADE", onUpdate: "RESTRICT" },
        mapping: "id"
      }
    },
    run_at: { type: "datetime", notNull: true },
    // The POST /matches body; server_id null = first free server at run time.
    body: { type: "text", notNull: true },
    // pending | running | loaded | failed | cancelled
    status: { type: "string", length: 10, notNull: true, defaultValue: "pending" },
    match_id: {
      type: "int",
      length: 11,
      notNull: false,
      foreignKey: {
        name: "match_id_scheduled_match_fk",
        table: "match",
        rules: { onDelete: "SET NULL", onUpdate: "RESTRICT" },
        mapping: "id"
      }
    },
    error: { type: "string", length: 500, notNull: false },
    created_at: { type: "datetime", notNull: true, defaultValue: new String("CURRENT_TIMESTAMP") }
  });
  await db.addIndex("scheduled_match", "scheduled_match_due_idx", ["status", "run_at"]);
};

exports.down = async function (db) {
  await db.dropTable("scheduled_match");
};
exports._meta = {
  version: 36
};
