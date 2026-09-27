import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gradePick,
  automaticSettlement,
  type FinalGame,
} from "../app/rdg/auto-grade.ts";
import { dailySlips } from "../app/rdg/daily-slips.ts";
import { validBet, metrics, type TrackedBet } from "../app/rdg/journal.ts";
import { type Pick } from "../app/rdg/board.ts";
const starts = "2026-09-26T20:00:00Z";
const game: FinalGame = {
  id: "game1",
  starts,
  home: "Kansas City Chiefs",
  away: "Buffalo Bills",
  homeScore: 24,
  awayScore: 21,
  final: true,
};
const pick: Pick = {
  id: "pick1",
  event: "event1",
  sport: "NFL",
  starts,
  matchup: "BUF @ KC",
  title: "Kansas City -3",
  market: "Spread",
  grading: { team: "KC", line: -3 },
  odds: -110,
  book: "Hard Rock Bet (FL)",
  score: 3,
  reasons: [],
  concerns: [],
  eligible: true,
};
const bet: TrackedBet = {
  id: "test-bet-1",
  savedAt: "2026-09-26T12:00:00Z",
  kind: "straight",
  mode: "model",
  stakeUnits: 1,
  picks: [pick],
  settlements: [],
};
test("Grade spread pushes, either side, totals and moneylines from exact final matchup", () => {
  assert.equal(gradePick(pick, [game]), "push");
  assert.equal(
    gradePick({ ...pick, grading: { team: "KC", line: -2.5 } }, [game]),
    "won",
  );
  assert.equal(
    gradePick({ ...pick, grading: { team: "BUF", line: 2.5 } }, [game]),
    "lost",
  );
  assert.equal(
    gradePick({ ...pick, market: "Moneyline", grading: { team: "KC" } }, [
      game,
    ]),
    "won",
  );
  assert.equal(
    gradePick(
      { ...pick, market: "Total", grading: { side: "Under", line: 45.5 } },
      [game],
    ),
    "won",
  );
  assert.equal(
    gradePick(
      { ...pick, market: "Total", grading: { side: "Over", line: 45 } },
      [game],
    ),
    "push",
  );
});
test("Never guess incomplete, canceled, ambiguous, old unstructured or player-prop results", () => {
  for (const games of [
    [{ ...game, final: false }],
    [{ ...game, homeScore: NaN }],
    [game, { ...game, id: "doubleheader" }],
    [{ ...game, starts: "2026-09-27T20:00:00Z" }],
    [{ ...game, away: "Miami Dolphins" }],
  ])
    assert.equal(gradePick(pick, games), "pending");
  assert.equal(gradePick({ ...pick, grading: undefined }, [game]), "pending");
  assert.equal(
    gradePick({ ...pick, market: "Player prop" }, [game]),
    "pending",
  );
});
test("Automatic settlements are repeatable, preserve prices, and never replace manual results", () => {
  const s = automaticSettlement(bet, ["won"], "2026-09-26T23:00:00Z")!;
  const saved = { ...bet, settlements: [s] };
  assert.equal(validBet(saved), true);
  assert.equal(metrics([saved]).wins, 1);
  assert.equal(automaticSettlement(saved, ["won"], s.at), null);
  assert.equal(automaticSettlement(saved, ["pending"], s.at), null);
  assert.equal(
    automaticSettlement(
      { ...saved, settlements: [{ ...s, source: "manual" }] },
      ["lost"],
      s.at,
    ),
    null,
  );
  assert.equal(automaticSettlement(saved, ["lost"], s.at)?.outcomes[0], "lost");
  assert.equal(bet.picks[0].odds, -110);
  assert.equal(bet.settlements.length, 0);
});
test("Daily archive uses fixed model stakes and saves only upcoming same-day eligible slips", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const games = Array.from({ length: 7 }, (_, i) => ({
    event_id: `g${i}`,
    start_date: starts,
    away_team: `Away${i}`,
    home_team: `Home${i}`,
    stats_connected: true,
    sportsbook: "Hard Rock Bet (FL)",
    quote_times: { moneyline: new Date(now).toISOString() },
    hard_rock: { moneyline: { home_odds: -120 } },
    rdg: {
      projected_winner: `Home${i}`,
      projected_margin: 7,
      sample_status: "Established",
      minimum_core_plays: 200,
    },
  }));
  const feeds = { CFB: { loadedAt: now, data: { games } } };
  const saved = dailySlips(feeds, now, "test");
  assert.ok(saved.length > 0);
  assert.ok(
    saved.every(
      (b) =>
        validBet(b) &&
        b.mode === "model" &&
        b.stakeUnits === 1 &&
        b.picks.every((p) => Date.parse(p.starts) > now),
    ),
  );
  assert.deepEqual(dailySlips(feeds, now + 86400000, "test"), []);
  assert.deepEqual(dailySlips(feeds, Date.parse(starts) + 1, "test"), []);
  assert.deepEqual(dailySlips({}, now, "test"), []);
});
