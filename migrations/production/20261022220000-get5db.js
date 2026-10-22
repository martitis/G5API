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

// One map_stats row per map of a match, so a going_live sent twice can't create a second row.
// Existing duplicates are not deleted (they hold stats): the key is skipped with a warning instead.
exports.up = async function (db) {
  const duplicates = await new Promise((resolve, reject) =>
    db.runSql(
      "SELECT match_id, map_number, COUNT(*) AS n FROM map_stats GROUP BY match_id, map_number HAVING n > 1",
      (err, rows) => (err ? reject(err) : resolve(rows))
    )
  );
  if (duplicates.length) {
    console.warn(
      "map_stats has duplicate (match_id, map_number) rows, so the unique key was not added: " +
        duplicates.map((row) => `match ${row.match_id} map ${row.map_number}`).join(", ") +
        ". Remove the extra rows, then run: ALTER TABLE map_stats ADD UNIQUE KEY map_stats_match_map_uq (match_id, map_number)"
    );
    return;
  }
  await db.addIndex("map_stats", "map_stats_match_map_uq", ["match_id", "map_number"], true);
};

exports.down = async function (db) {
  const indexes = await new Promise((resolve, reject) =>
    db.runSql("SHOW INDEX FROM map_stats WHERE Key_name = 'map_stats_match_map_uq'", (err, rows) =>
      err ? reject(err) : resolve(rows)
    )
  );
  // The foreign key on match_id needs an index; add a plain one before dropping the unique key.
  if (indexes.length) {
    await db.addIndex("map_stats", "match_id_map_stats_fk", ["match_id"]).catch(() => undefined);
    await db.removeIndex("map_stats", "map_stats_match_map_uq");
  }
};
exports._meta = {
  version: 39
};
