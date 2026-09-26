import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNflMarketFeed } from "../lib/nfl-market-feed.ts";
import { teamLogoUrl } from "../app/rdg/team-aliases.ts";
import { normalizeBoard, buildIdeas, upcoming } from "../app/rdg/board.ts";

test("missing keys and unavailable odds feeds do not throw or fabricate odds", async () => {
  let calls = 0;
  const failing: typeof fetch = async () => {
    calls++;
    throw new Error("offline");
  };
  assert.equal((await loadNflMarketFeed(undefined, failing)).available, false);
  assert.equal(calls, 0);
  assert.deepEqual((await loadNflMarketFeed("test", failing)).events, []);
  assert.equal(calls, 1);
  const unauthorized: typeof fetch = async () =>
    new Response("{}", { status: 401 });
  assert.equal(
    (await loadNflMarketFeed("test", unauthorized)).available,
    false,
  );
  const malformed: typeof fetch = async () => new Response("{not json");
  assert.equal((await loadNflMarketFeed("test", malformed)).available, false);
});
test("valid market data is retained for priced picks", async () => {
  const event = {
    id: "x",
    commence_time: "2026-09-27T17:00:00Z",
    away_team: "Los Angeles Chargers",
    home_team: "Buffalo Bills",
    bookmakers: [
      {
        key: "hardrockbet_fl",
        markets: [
          {
            key: "spreads",
            outcomes: [{ name: "Buffalo Bills", point: -7.5, price: -110 }],
          },
        ],
      },
    ],
  };
  const response: typeof fetch = async () =>
    new Response(JSON.stringify([event]));
  const feed = await loadNflMarketFeed("test", response);
  assert.equal(feed.available, true);
  assert.equal(feed.events[0].team1, "LAC");
  assert.equal(feed.events[0].odds[0].american_odds, -110);
});
test("full names and provider aliases resolve to team logos; unknowns use fallback", () => {
  assert.equal(teamLogoUrl("NFL", "LAC"), teamLogoUrl("NFL", "SDG"));
  assert.equal(teamLogoUrl("NFL", "Buffalo Bills"), teamLogoUrl("NFL", "BUF"));
  assert.equal(
    teamLogoUrl("MLB", "St. Louis Cardinals"),
    teamLogoUrl("MLB", "STL"),
  );
  assert.equal(
    teamLogoUrl("NHL", "Tampa Bay Lightning"),
    teamLogoUrl("NHL", "TBL"),
  );
  assert.equal(
    teamLogoUrl("CFB", "ohio-state"),
    teamLogoUrl("CFB", "Ohio State"),
  );
  assert.equal(teamLogoUrl("CFB", "Unknown School"), null);
});
test("next-seven-day board produces upcoming NFL parlays on a non-game day", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const games = Array.from({ length: 6 }, (_, i) => ({
    event_id: `event-${i}`,
    start_date: "2026-09-27T17:00:00Z",
    away_team: `Away${i}`,
    home_team: `Home${i}`,
    stats_connected: true,
    rdg: {
      projected_winner: `Away${i}`,
      projected_margin: 8,
      market_analysis: {
        spread_lean: `Away${i}`,
        model_vs_market_difference: 5,
        market_signal: "Priority Review",
        hard_rock_spread: { away_line: -3, away_odds: "-110" },
      },
    },
  }));
  const picks = normalizeBoard(
    { NFL: { data: { games }, loadedAt: now } },
    now,
  );
  assert.equal(picks.filter((p) => upcoming(p.starts, now, "today")).length, 0);
  assert.equal(
    buildIdeas(
      picks.filter((p) => upcoming(p.starts, now, "week")),
      2,
      now,
    ).length,
    3,
  );
});
test("CFB allows supported review signals but blocks missing prices and small samples", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const game = {
    event_id: "cfb",
    start_date: "2026-09-26T17:00:00Z",
    away_team: "A",
    home_team: "B",
    stats_connected: true,
    hard_rock: { spread: { away_line: -3, away_odds: "-110" } },
    rdg: {
      spread_lean: "A",
      projected_winner: "A",
      projected_margin: 10,
      signal: "Priority Review",
      sample_status: "Established",
      minimum_core_plays: 200,
    },
  };
  const run = (g: unknown) =>
    normalizeBoard({ CFB: { loadedAt: now, data: { games: [g] } } }, now)[0]
      .eligible;
  assert.equal(run(game), true);
  assert.equal(
    run({
      ...game,
      rdg: {
        ...game.rdg,
        sample_status: "Small Sample",
        minimum_core_plays: 50,
      },
    }),
    false,
  );
  assert.equal(run({ ...game, rdg: { ...game.rdg, signal: "Pass" } }), false);
  assert.equal(
    run({ ...game, hard_rock: { spread: { away_line: -3, away_odds: null } } }),
    false,
  );
});

test("game aliases cannot produce duplicate NFL legs", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const base = {
    sport: "NFL" as const,
    starts: "2026-09-27T17:00:00Z",
    title: "Test",
    market: "Spread" as const,
    odds: -110,
    book: "Hard Rock Bet (FL)",
    score: 3,
    reasons: [],
    concerns: [],
    eligible: true,
  };
  const picks = [
    { ...base, id: "game", event: "provider-a", matchup: "LAC @ BUF" },
    {
      ...base,
      id: "prop",
      event: "provider-b",
      matchup: "Los Angeles Chargers @ Buffalo Bills",
    },
  ];
  assert.deepEqual(buildIdeas(picks, 2, now), []);
});
