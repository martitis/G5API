import { agent } from "supertest";
import app from "../app.js";
const request = agent(app);

// Runs after the other suites, so the database holds teams, matches and player stats.
describe("Test the leaderboard routes", () => {
  it("Should return the team leaderboard.", () => {
    return request
      .get("/leaderboard/")
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((result) => {
        expect(Array.isArray(result.body.leaderboard)).toBe(true);
        for (const team of result.body.leaderboard) {
          expect(typeof team.wins).toBe("number");
          expect(typeof team.losses).toBe("number");
          expect(typeof team.rounddiff).toBe("number");
        }
      });
  });
  it("Should return the player leaderboard with one row per player.", () => {
    return request
      .get("/leaderboard/players")
      .expect("Content-Type", /json/)
      .expect(200)
      .expect((result) => {
        const players = result.body.leaderboard;
        expect(Array.isArray(players)).toBe(true);
        const steamIds = players.map((player) => player.steamId);
        expect(new Set(steamIds).size).toBe(steamIds.length);
        for (const player of players) {
          expect(Number.isFinite(player.average_rating)).toBe(true);
          expect(player.wins).toBeLessThanOrEqual(player.total_maps);
        }
      });
  });
  it("Should return the PUG and season leaderboards.", async () => {
    await request.get("/leaderboard/players/pug").expect(200);
    await request.get("/leaderboard/players/1").expect(200);
    await request.get("/leaderboard/1").expect(200);
  });
});
