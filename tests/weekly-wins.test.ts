import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyWins, weekOf } from "../app/rdg/weekly-wins.ts";
import { metrics, type TrackedBet, type Outcome } from "../app/rdg/journal.ts";
function bet(
  id: string,
  legs = 5,
  status: Outcome = "won",
  at = "2026-09-27T03:30:00Z",
): TrackedBet {
  return {
    id,
    savedAt: "2026-09-25T12:00:00Z",
    kind: "parlay",
    mode: "placed",
    stakeUnits: 1,
    picks: Array.from({ length: legs }, (_, i) => ({
      id: `${i}`,
      event: `${i}`,
      sport: "NFL",
      starts: "2026-09-26T17:00:00Z",
      matchup: `A${i} @ B${i}`,
      title: "Moneyline",
      market: "Moneyline",
      odds: -200,
      book: "Hard Rock Bet (FL)",
      score: 3,
      reasons: [],
      concerns: [],
      eligible: true,
    })),
    settlements: [
      {
        id: "settlement-1",
        at,
        source: "manual",
        outcomes: Array(legs).fill(status),
        note: "",
      },
    ],
  };
}
test("Weekly wins use Eastern Sunday boundaries across DST and year boundaries", () => {
  assert.equal(weekOf("2026-09-27T03:59:00Z"), "2026-09-20");
  assert.equal(weekOf("2026-09-27T04:00:00Z"), "2026-09-27");
  assert.equal(weekOf("2026-11-01T05:30:00Z"), "2026-11-01");
  assert.equal(weekOf("2026-11-01T06:30:00Z"), "2026-11-01");
  assert.equal(weekOf("2027-01-01T12:00:00Z"), "2026-12-27");
});
test("Showcase includes 5–8 leg wins only; full record still counts losses", () => {
  const rows = [
    bet("five"),
    bet("eight", 8, "won", "2026-09-28T12:00:00Z"),
    bet("four", 4),
    bet("lost", 6, "lost"),
    bet("pending", 5, "pending"),
    bet("void", 5, "void"),
  ];
  const weeks = weeklyWins(rows);
  assert.deepEqual(
    weeks.map((w) => w.start),
    ["2026-09-27", "2026-09-20"],
  );
  assert.deepEqual(
    weeks.flatMap((w) => w.bets.map((b) => b.id)),
    ["eight", "five"],
  );
  assert.equal(weeks[1].profit, 1.5 ** 5 - 1);
  const m = metrics(rows);
  assert.equal(m.wins, 3);
  assert.equal(m.losses, 1);
  assert.equal(m.pending, 1);
  assert.equal(m.voids, 1);
});
test("Corrected payouts stay in original win week, reversed results remove wins", () => {
  const b = bet("corrected");
  b.settlements.push({
    ...b.settlements[0],
    id: "settlement-2",
    at: "2026-10-05T12:00:00Z",
    returnUnits: 10,
  });
  assert.equal(weeklyWins([b])[0].start, "2026-09-20");
  assert.equal(weeklyWins([b])[0].profit, 9);
  b.settlements.push({
    ...b.settlements[0],
    id: "settlement-3",
    at: "2026-10-06T12:00:00Z",
    outcomes: ["lost", "won", "won", "won", "won"],
  });
  assert.deepEqual(weeklyWins([b]), []);
});
test("Push/void legs reduce returns; a pending leg prevents a winning slip", () => {
  const b = bet("push");
  b.settlements[0].outcomes = ["won", "won", "won", "won", "push"];
  assert.equal(weeklyWins([b])[0].profit, 1.5 ** 4 - 1);
  b.settlements[0].outcomes[4] = "pending";
  assert.deepEqual(weeklyWins([b]), []);
});
