// Cross-platform replacement for the old sed/export test setup.
// "set"   - makes the mock Steam user (src/utility/mockProfile.ts) a super admin in config/test.json.
// "admin"  - makes the mock Steam user a (non-super) admin, for suites that need admin rights only.
// "reset" - restores the super_admins placeholder and removes the mock user from admins.
import { readFileSync, writeFileSync } from "fs";

const configPath = "config/test.json";
const mode = process.argv[2];

const testConfig = JSON.parse(readFileSync(configPath, "utf8"));

const mockSteamId = () => {
  const mockProfile = readFileSync("src/utility/mockProfile.ts", "utf8");
  const steamId = mockProfile.match(/\d{17}/)?.[0];
  if (!steamId) {
    console.error("Could not find the mock Steam ID in src/utility/mockProfile.ts");
    process.exit(1);
  }
  return steamId;
};
const adminIds = () =>
  String(testConfig.admins?.steam_ids ?? "")
    .split(",")
    .filter((id) => id && id !== mockSteamId());

testConfig.admins ??= { steam_ids: "" };
if (mode === "set") {
  testConfig.super_admins.steam_ids = mockSteamId();
} else if (mode === "admin") {
  testConfig.admins.steam_ids = [...adminIds(), mockSteamId()].join(",");
} else if (mode === "reset") {
  testConfig.super_admins.steam_ids = "super_admins,go,here";
  testConfig.admins.steam_ids = adminIds().join(",") || "admins,go,here";
} else {
  console.error("Usage: node scripts/test-admin.mjs <set|admin|reset>");
  process.exit(1);
}

writeFileSync(configPath, JSON.stringify(testConfig, null, 2) + "\n");
