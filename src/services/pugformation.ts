/** Splitting a full PUG queue into two teams. Pure functions (unit tested).
 * @module services/pugformation
 */

export type Formation = "random" | "balanced" | "captains";

export interface QueuedPlayer {
  user_id: number;
  /** HLTV 1.0-style rating from the player's stats; 1.0 for players without stats. */
  rating: number;
}

/** Random split (Fisher-Yates); `random` is injectable for tests. */
export function randomTeams<T>(players: T[], random: () => number = Math.random): [T[], T[]] {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const half = Math.ceil(shuffled.length / 2);
  return [shuffled.slice(0, half), shuffled.slice(half)];
}

/** Two teams with total ratings as close as possible. Every split is tried for up to 14 players (3432 splits for
 * 7v7); bigger queues use a snake draft (best, then 2nd+3rd to the other team, ...). */
export function balancedTeams<T extends QueuedPlayer>(players: T[]): [T[], T[]] {
  const half = Math.ceil(players.length / 2);
  if (players.length <= 14) {
    let best: { diff: number; mask: number } | null = null;
    const total = players.reduce((sum, player) => sum + player.rating, 0);
    // Player 0 always goes to team 1, so mirrored splits are skipped.
    for (let mask = 1; mask < 1 << players.length; mask += 2) {
      if (popCount(mask) !== half) continue;
      let sum = 0;
      for (let i = 0; i < players.length; i++) if (mask & (1 << i)) sum += players[i].rating;
      const diff = Math.abs(total - 2 * sum);
      if (!best || diff < best.diff - 1e-9) best = { diff, mask };
    }
    const mask = best!.mask;
    return [players.filter((_, i) => mask & (1 << i)), players.filter((_, i) => !(mask & (1 << i)))];
  }
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const teams: [T[], T[]] = [[], []];
  sorted.forEach((player, index) => teams[snakeTeam(index)].push(player));
  return teams;
}

function popCount(n: number): number {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

/** 0, 1, 1, 0, 0, 1, 1, 0 ...: whose turn it is in a snake (ABBA) draft. */
const snakeTeam = (index: number) => ([0, 1, 1, 0] as const)[index % 4];

/** In captains mode: the team (1 or 2) that picks next, after `picksMade` picks (ABBA order, team 1 first). */
export const nextPickingTeam = (picksMade: number): 1 | 2 => (snakeTeam(picksMade) === 0 ? 1 : 2);

/** The two captains: the highest-rated players (the earlier joiner wins a tie). */
export function chooseCaptains<T extends QueuedPlayer>(players: T[]): [T, T] {
  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  return [sorted[0], sorted[1]];
}
