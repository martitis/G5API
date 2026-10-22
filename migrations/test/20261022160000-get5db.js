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

// Tournaments (single/double elimination, round robin, Swiss): the tournament with its match settings, its
// seeded teams, and one row per bracket slot (src/services/bracket.ts) linked to the real match once created.
exports.up = async function (db) {
  await db.createTable("tournament", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    user_id: { type: "int", length: 11, notNull: false, foreignKey: fk("user_id_tournament_fk", "user", "SET NULL") },
    season_id: { type: "int", length: 11, notNull: false, foreignKey: fk("season_id_tournament_fk", "season", "SET NULL") },
    name: { type: "string", length: 100, notNull: true },
    format: { type: "string", length: 20, notNull: true },
    status: { type: "string", length: 10, notNull: true, defaultValue: "draft" },
    // { best_of, final_best_of, swiss_rounds, map_pool, players_per_team, min_players_to_ready, side_type, ... }
    settings: { type: "text", notNull: false },
    created_at: { type: "datetime", notNull: true, defaultValue: new String("CURRENT_TIMESTAMP") }
  });
  await db.createTable("tournament_team", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    tournament_id: {
      type: "int", length: 11, notNull: true,
      foreignKey: fk("tournament_id_tournament_team_fk", "tournament", "CASCADE")
    },
    team_id: { type: "int", length: 11, notNull: true, foreignKey: fk("team_id_tournament_team_fk", "team", "CASCADE") },
    seed: { type: "int", notNull: true }
  });
  await db.addIndex("tournament_team", "tournament_team_uq", ["tournament_id", "team_id"], true);
  await db.createTable("tournament_match", {
    id: { type: "int", primaryKey: true, autoIncrement: true, length: 11 },
    tournament_id: {
      type: "int", length: 11, notNull: true,
      foreignKey: fk("tournament_id_tournament_match_fk", "tournament", "CASCADE")
    },
    node_key: { type: "string", length: 40, notNull: true },
    bracket: { type: "string", length: 20, notNull: true },
    round: { type: "int", notNull: true },
    position: { type: "int", notNull: true },
    is_final: { type: "boolean", notNull: true, defaultValue: false },
    // JSON of the two slot sources (seed / team / winner or loser of another node / null = bye).
    sources: { type: "string", length: 255, notNull: true },
    team1_id: { type: "int", length: 11, notNull: false },
    team2_id: { type: "int", length: 11, notNull: false },
    winner_id: { type: "int", length: 11, notNull: false },
    status: { type: "string", length: 10, notNull: true, defaultValue: "pending" },
    match_id: { type: "int", length: 11, notNull: false, foreignKey: fk("match_id_tournament_match_fk", "match", "SET NULL") }
  });
  await db.addIndex("tournament_match", "tournament_match_key_uq", ["tournament_id", "node_key"], true);
};

exports.down = async function (db) {
  await db.dropTable("tournament_match");
  await db.dropTable("tournament_team");
  await db.dropTable("tournament");
};
exports._meta = {
  version: 33
};
