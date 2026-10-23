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

const fk = (name, table, onDelete) => ({ name, table, rules: { onDelete, onUpdate: "RESTRICT" }, mapping: "id" });

// PUG queues: players join until the queue is full, confirm in a ready check, get split into two teams, and the
// match is created on a server. team.is_pug marks the generated teams (hidden from the team lists).
exports.up = async function (db) {
  await db.createTable("pug_queue", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    user_id: { type: "int", length: 11, notNull: false, foreignKey: fk("user_id_pug_queue_fk", "user", "SET NULL") },
    server_id: { type: "int", length: 11, notNull: false, foreignKey: fk("server_id_pug_queue_fk", "game_server", "SET NULL") },
    season_id: { type: "int", length: 11, notNull: false, foreignKey: fk("season_id_pug_queue_fk", "season", "SET NULL") },
    match_id: { type: "int", length: 11, notNull: false, foreignKey: fk("match_id_pug_queue_fk", "match", "SET NULL") },
    title: { type: "string", length: 100, notNull: false },
    // open | ready_check | picking | loading | loaded | failed | cancelled
    status: { type: "string", length: 12, notNull: true, defaultValue: "open" },
    // { players_per_team, formation (random|balanced|captains), max_maps, map_pool, side_type, skip_veto, ready_seconds }
    settings: { type: "text", notNull: false },
    ready_deadline: { type: "datetime", notNull: false },
    expires_at: { type: "datetime", notNull: false },
    error: { type: "string", length: 500, notNull: false },
    created_at: { type: "datetime", notNull: true, defaultValue: new String("CURRENT_TIMESTAMP") }
  });
  await db.createTable("pug_queue_player", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    queue_id: { type: "int", length: 11, notNull: true, foreignKey: fk("queue_id_pug_queue_player_fk", "pug_queue", "CASCADE") },
    user_id: { type: "int", length: 11, notNull: true, foreignKey: fk("user_id_pug_queue_player_fk", "user", "CASCADE") },
    steam_id: { type: "string", length: 20, notNull: true },
    name: { type: "string", length: 75, notNull: false },
    ready: { type: "boolean", notNull: true, defaultValue: false },
    // 1 or 2 once teams are formed; captain picks in captains mode
    team: { type: "int", notNull: false },
    captain: { type: "boolean", notNull: true, defaultValue: false },
    joined_at: { type: "datetime", notNull: true, defaultValue: new String("CURRENT_TIMESTAMP") }
  });
  await db.addIndex("pug_queue_player", "pug_queue_player_uq", ["queue_id", "user_id"], true);
  await db.addColumn("team", "is_pug", { type: "boolean", notNull: true, defaultValue: false });
};

exports.down = async function (db) {
  await db.removeColumn("team", "is_pug");
  await db.dropTable("pug_queue_player");
  await db.dropTable("pug_queue");
};
exports._meta = {
  version: 34
};
