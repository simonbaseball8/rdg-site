import test from "node:test";
import assert from "node:assert/strict";
import { buildIdeas, type Pick, normalizeBoard } from "../app/rdg/board.ts";
import {
  passesFilters,
  replacements,
  sameGame,
} from "../app/rdg/pick-controls.ts";
import {
  metrics,
  settlement,
  validBet,
  betSport,
  type TrackedBet,
  type Outcome,
} from "../app/rdg/journal.ts";
const now = Date.parse("2026-09-26T16:00Z");
const pick = (i: number): Pick => ({
  id: `pick${i}`,
  event: `game${i}`,
  sport: "CFB",
  starts: "2026-09-27T17:00Z",
  matchup: `Away${i} @ Home${i}`,
  title: `Home${i} moneyline`,
  market: "Moneyline",
  odds: -200,
  book: "Hard Rock Bet (FL)",
  score: 3,
  reasons: ["Model pick"],
  concerns: [],
  eligible: true,
});
const bet = (states: Outcome[], prices = [-200, 200]): TrackedBet => ({
  id: "bet-12345678",
  savedAt: "2026-09-26T16:00Z",
  kind: states.length === 1 ? "straight" : "parlay",
  mode: "paper",
  stakeUnits: 2,
  picks: states.map((_, i) => ({ ...pick(i), odds: prices[i] ?? -200 })),
  settlements: [
    {
      id: "settle-12345678",
      at: "2026-09-28T16:00Z",
      outcomes: states,
      source: "manual",
      note: "",
    },
  ],
});
test("8-leg slips require eight distinct eligible games and reject nine", () => {
  const pool = Array.from({ length: 24 }, (_, i) => pick(i));
  const cards = buildIdeas(pool, 8, now);
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.equal(card.length, 8);
    assert.equal(new Set(card.map((p) => p.event)).size, 8);
  }
  assert.equal(buildIdeas(pool.slice(0, 7), 8, now).length, 0);
  assert.equal(buildIdeas(pool, 9, now).length, 0);
});
test("filters honor maximum favorite price, canonical excluded teams and market selection", () => {
  const p = {
    ...pick(0),
    sport: "NFL" as const,
    matchup: "Miami Dolphins @ Buffalo Bills",
  };
  assert.equal(
    passesFilters(p, { maxFavorite: 150, excludedTeams: [], markets: [] }),
    false,
  );
  assert.equal(
    passesFilters(p, { maxFavorite: 200, excludedTeams: ["MIA"], markets: [] }),
    false,
  );
  assert.equal(
    passesFilters(p, {
      maxFavorite: 200,
      excludedTeams: [],
      markets: ["Player prop"],
    }),
    false,
  );
  assert.equal(
    passesFilters(
      { ...p, odds: 150 },
      { maxFavorite: 150, excludedTeams: [], markets: ["Moneyline"] },
    ),
    true,
  );
});
test("replacements reject duplicates, stale/ineligible picks, started games and other markets", () => {
  const slip = [pick(0), pick(1)];
  const pool = [
    ...slip,
    { ...pick(2), event: "other-id", matchup: pick(1).matchup },
    { ...pick(3), eligible: false },
    { ...pick(4), starts: "2026-09-25T17:00Z" },
    { ...pick(5), market: "Spread" as const },
    pick(6),
  ];
  const r = replacements(pool, slip, 0, now, "moneylines");
  assert.deepEqual(
    r.map((p) => p.id),
    ["pick6"],
  );
  assert.equal(sameGame(pool[2], slip[1]), true);
});
test("settlement handles American odds, pending, push and void without counting legs as wagers", () => {
  assert.equal(settlement(bet(["won", "won"])).profit, 7);
  assert.equal(settlement(bet(["won", "push"])).profit, 1);
  assert.equal(settlement(bet(["won", "void"])).profit, 1);
  assert.equal(settlement(bet(["push", "void"])).profit, 0);
  assert.equal(settlement(bet(["void", "void"])).status, "void");
  assert.equal(settlement(bet(["won", "pending"])).profit, null);
  assert.equal(settlement(bet(["lost", "pending"])).profit, -2);
  const m = metrics([
    bet(["won", "won"]),
    bet(["lost", "lost"]),
    bet(["pending", "pending"]),
    bet(["void", "void"]),
  ]);
  assert.equal(m.wins, 1);
  assert.equal(m.losses, 1);
  assert.equal(m.risked, 4);
  assert.equal(m.profit, 5);
  assert.equal(m.roi, 125);
});
test("actual payout override and immutable original prices remain distinct; incomplete overrides fail", () => {
  const b = bet(["won", "won"]);
  b.settlements[0].returnUnits = 8;
  assert.equal(settlement(b).profit, 6);
  assert.equal(b.picks[0].odds, -200);
  assert.equal(validBet(b), true);
  b.settlements[0].outcomes[0] = "pending";
  assert.equal(validBet(b), false);
  assert.equal(validBet({ ...bet(["won"]), stakeUnits: 0 }), false);
  const mixed = bet(["won", "won"]);
  mixed.picks[1].sport = "MLB";
  assert.equal(betSport(mixed), "Mixed sports");
});
test("provider quote age cannot be refreshed by receiving the feed again", () => {
  const data = {
    games: [
      {
        event_id: "cfb",
        start_date: "2026-09-27T17:00Z",
        away_team: "A",
        home_team: "B",
        stats_connected: true,
        quote_times: { moneyline: "2026-09-26T15:00Z" },
        hard_rock: { moneyline: { home_odds: -150 } },
        rdg: {
          projected_winner: "B",
          projected_margin: 8,
          sample_status: "Established",
          minimum_core_plays: 200,
        },
      },
    ],
  };
  const p = normalizeBoard({ CFB: { loadedAt: now, data } }, now)[0];
  assert.equal(p.eligible, false);
  assert.equal(p.quoteAt, "2026-09-26T15:00Z");
  assert.equal(p.lineupsAt, null);
});
