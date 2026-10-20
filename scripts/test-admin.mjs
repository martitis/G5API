// Cross-platform replacement for the old sed/export test setup.
// "set"   - makes the mock Steam user (src/utility/mockProfile.ts) a super admin in config/test.json.
// "reset" - restores the super_admins placeholder in config/test.json.
import { readFileSync, writeFileSync } from "fs";

const configPath = "config/test.json";
const mode = process.argv[2];

const testConfig = JSON.parse(readFileSync(configPath, "utf8"));

if (mode === "set") {
  const mockProfile = readFileSync("src/utility/mockProfile.ts", "utf8");
  const steamId = mockProfile.match(/\d{17}/)?.[0];
  if (!steamId) {
    console.error("Could not find the mock Steam ID in src/utility/mockProfile.ts");
    process.exit(1);
  }
  testConfig.super_admins.steam_ids = steamId;
} else if (mode === "reset") {
  testConfig.super_admins.steam_ids = "super_admins,go,here";
} else {
  console.error("Usage: node scripts/test-admin.mjs <set|reset>");
  process.exit(1);
}

writeFileSync(configPath, JSON.stringify(testConfig, null, 2) + "\n");
