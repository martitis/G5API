/*Database driver.*/
import { createPool } from 'mysql2/promise';
import config from 'config';
import { FieldPacket, PoolOptions, RowDataPacket } from 'mysql2/typings/mysql';
interface IStringIndex {
  [key: string]: any;
}
// ES module imports run before bin/www.ts can default NODE_ENV, so default it here too
// (the config package itself also falls back to "development").
const env: string = process.env.NODE_ENV || "development";
const dbCfg = {
  host: config.get(env + ".host"),
  port: config.get(env + ".port"),
  user: config.get(env + ".user"),
  password: config.get(env + ".password"),
  database: config.get(env + ".database"),
  connectionLimit: config.get(env + ".connectionLimit")
} as PoolOptions;
const connPool = createPool(dbCfg);
// Team member lists and season cvars are built with GROUP_CONCAT, which MySQL cuts at
// 1024 bytes by default (big teams came back as invalid JSON).
connPool.on("connection", (conn) => {
  conn.query("SET SESSION group_concat_max_len = 1048576");
});

class Database {
  constructor() {
    this.setupAdmins();
  }

  async query(sql: string, args?: object): Promise<RowDataPacket[]> {
    try {
      let result: [RowDataPacket[], FieldPacket[]];
      result = await connPool.query<RowDataPacket[]>(sql, args);
      return result[0];
    } catch (error) {
      console.error("SQL ERROR SQL ERROR SQL ERROR SQL ERROR SQL ERROR\n" + error);
      throw error;
    }
  }
  
  async buildUpdateStatement(objValues: IStringIndex): Promise<IStringIndex> {
    for (let key in objValues) {
      if (objValues[key] == null || objValues[key] == undefined) delete objValues[key];
    }
    return objValues;
  }

  async setupAdmins(): Promise<void> {
    try {
      let listOfAdmins: Array<string> = (config.get("admins.steam_ids") as string).split(',');
      let listofSuperAdmins: Array<string> = (config.get("super_admins.steam_ids") as string).split(',');
      // Get list of admins from database and compare list and add new admins.
      // Only accounts whose Steam ID was proven by a Steam login can be promoted.
      let updateAdmins: string = "UPDATE user SET admin = 1, roles_from_config = 1 WHERE steam_verified = 1 AND steam_id IN (?)";
      let updateSuperAdmins: string = "UPDATE user SET super_admin = 1, roles_from_config = 1 WHERE steam_verified = 1 AND steam_id IN (?)";
      await connPool.query(updateAdmins, [listOfAdmins]);
      await connPool.query(updateSuperAdmins, [listofSuperAdmins]);
    } catch (err) {
      console.error("Failed to import users. " + err);
    }
  }
}
let db = new Database();
export {db};
