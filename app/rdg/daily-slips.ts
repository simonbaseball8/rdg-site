import {
  buildIdeas,
  easternDate,
  normalizeBoard,
  upcoming,
  type Feeds,
} from "./board.ts";
import { type TrackedBet } from "./journal.ts";
export function dailySlips(
  feeds: Feeds,
  now: number,
  scope: string,
): TrackedBet[] {
  const pool = normalizeBoard(feeds, now, false).filter((p) =>
    upcoming(p.starts, now, "today"),
  );
  return [2, 3, 5].flatMap((size) =>
    buildIdeas(pool, size, now).map((picks, i) => ({
      id: `${scope}-${easternDate(now)}-${size}-${i + 1}`,
      savedAt: new Date(now).toISOString(),
      kind: "parlay" as const,
      mode: "model" as const,
      stakeUnits: 1,
      picks: structuredClone(picks),
      settlements: [],
    })),
  );
}
