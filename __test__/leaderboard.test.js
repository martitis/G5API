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

describe("Test the metrics route", () => {
  it("Should return every counter as a number.", () => {
    return request
      .get("/metrics")
      .expect(200)
      .expect((result) => {
        const { metrics } = result.body;
        for (const key of ["users", "teams", "matches", "completed_matches", "live_matches", "servers", "maps_played", "players", "seasons"]) {
          expect(typeof metrics[key]).toBe("number");
        }
        expect(metrics.users).toBeGreaterThan(0);
      });
  });
});

describe("Test the match list summary route", () => {
  it("Should return a page of summaries with a total.", () => {
    return request
      .get("/matches/summary?limit=5")
      .expect(200)
      .expect((result) => {
        expect(Array.isArray(result.body.matches)).toBe(true);
        expect(typeof result.body.total).toBe("number");
        expect(result.body.matches.length).toBeLessThanOrEqual(5);
        for (const match of result.body.matches) {
          expect(["pending", "warmup", "live", "paused", "finished", "cancelled"]).toContain(match.status);
          expect(Array.isArray(match.maps)).toBe(true);
          expect(typeof match.team1.score).toBe("number");
        }
      });
  });
  it("Should apply the status filter and clamp the limit.", async () => {
    const cancelled = await request.get("/matches/summary?status=cancelled&limit=1000").expect(200);
    for (const match of cancelled.body.matches) expect(match.status).toBe("cancelled");
    expect(cancelled.body.matches.length).toBeLessThanOrEqual(100);
  });
});
