import { gameWindow } from "../lib/game-window.ts";
import { canonicalTeamKey } from "../app/rdg/team-aliases.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptOddsEvents,
  loadOddsMarket,
  SPORT_KEYS,
} from "../lib/odds-api.ts";
import { buildIdeas, normalizeBoard, type Pick } from "../app/rdg/board.ts";

test("all sports use only Florida prices and preserve spread sides and totals", async () => {
  for (const sport of Object.keys(SPORT_KEYS) as Array<
    keyof typeof SPORT_KEYS
  >) {
    const data = [
      {
        id: "1",
        commence_time: "2026-09-27T17:00:00Z",
        away_team: "Buffalo Bills",
        home_team: "Miami Dolphins",
        bookmakers: [
          {
            key: "fanduel",
            markets: [
              { key: "h2h", outcomes: [{ name: "Buffalo Bills", price: 900 }] },
            ],
          },
          {
            key: "hardrockbet_fl",
            markets: [
              {
                key: "spreads",
                outcomes: [{ name: "Buffalo Bills", price: -110, point: -3.5 }],
              },
              {
                key: "totals",
                outcomes: [{ name: "Over", price: -115, point: 45.5 }],
              },
            ],
          },
        ],
      },
    ];
    const result = await loadOddsMarket(sport, "secret", async (input) => {
      const u = new URL(String(input));
      assert.equal(
        u.searchParams.get("bookmakers"),
        "hardrockbet_fl,hardrockbet",
      );
      assert.ok(u.pathname.includes(SPORT_KEYS[sport]));
      return new Response(JSON.stringify(data));
    });
    assert.equal(result.events[0].odds.length, 2);
    assert.equal(result.events[0].odds[0].line, -3.5);
    assert.equal(result.events[0].odds[1].team, "Over");
    assert.equal(
      adaptOddsEvents(sport, [{ ...data[0], bookmakers: [] }])[0].odds.length,
      0,
    );
  }
});
test("provider failures redact credentials and do not invent prices", async () => {
  await assert.rejects(
    loadOddsMarket(
      "MLB",
      "secret",
      async () => new Response("secret", { status: 401 }),
    ),
    (e) =>
      e instanceof Error &&
      !e.message.includes("secret") &&
      e.message.includes("401"),
  );
});
test("balanced cards include props and mix sports, with dedicated filters", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const picks: Pick[] = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    event: String(i),
    sport: i % 2 ? "MLB" : "NFL",
    starts: "2026-09-27T17:00:00Z",
    matchup: `Away${i} @ Home${i}`,
    title: "Pick",
    market: i < 6 ? "Spread" : "Player prop",
    odds: -110,
    book: "Hard Rock Bet (FL)",
    score: i < 6 ? 4 : 2,
    reasons: [],
    concerns: [],
    eligible: true,
  }));
  const balanced = buildIdeas(picks, 2, now);
  assert.equal(balanced.length, 3);
  assert.ok(
    balanced.every((card) => card.some((p) => p.market === "Player prop")),
  );
  assert.ok(
    balanced.every((card) => new Set(card.map((p) => p.sport)).size === 2),
  );
  assert.ok(
    buildIdeas(picks, 2, now, "props")
      .flat()
      .every((p) => p.market === "Player prop"),
  );
  assert.ok(
    buildIdeas(picks, 2, now, "games")
      .flat()
      .every((p) => p.market !== "Player prop"),
  );
  assert.equal(new Set(balanced.flat().map((p) => p.id)).size, 6);
});

test("reference prices are labeled, Florida preferred, and reference ideas require opt-in", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const event = {
    id: "x",
    commence_time: "2026-09-27T17:00:00Z",
    away_team: "Pittsburgh Pirates",
    home_team: "Detroit Tigers",
    bookmakers: [
      {
        key: "hardrockbet",
        markets: [
          {
            key: "h2h",
            outcomes: [{ name: "Pittsburgh Pirates", price: 110 }],
          },
        ],
      },
    ],
  };
  const adapted = adaptOddsEvents("MLB", [event])[0];
  assert.equal(adapted.requires_florida_verification, true);
  assert.equal(adapted.sportsbook, "Hard Rock Bet (IN reference)");
  const both = adaptOddsEvents("MLB", [
    {
      ...event,
      bookmakers: [
        ...event.bookmakers,
        {
          key: "hardrockbet_fl",
          markets: [
            {
              key: "h2h",
              outcomes: [{ name: "Pittsburgh Pirates", price: 120 }],
            },
          ],
        },
      ],
    },
  ])[0];
  assert.equal(both.requires_florida_verification, false);
  assert.equal(both.odds[0].american_odds, 120);
  const game = {
    event_id: "x",
    start_date: event.commence_time,
    away_team: event.away_team,
    home_team: event.home_team,
    sportsbook: adapted.sportsbook,
    requires_florida_verification: true,
    starting_pitchers: {
      away: { name: "Away starter" },
      home: { name: "Home starter" },
    },
    hard_rock: { moneyline: { away_odds: 110 } },
    rdg: {
      projected_winner: event.away_team,
      moneyline_lean: event.away_team,
      model_away_probability: 60,
      signal: "Strong Review",
    },
  };
  const feeds = { MLB: { loadedAt: now, data: { games: [game] } } };
  assert.equal(normalizeBoard(feeds, now)[0].eligible, false);
  assert.equal(normalizeBoard(feeds, now, true)[0].eligible, true);
  assert.equal(adaptOddsEvents("NFL", [event])[0].odds.length, 0);
});

test("seven-day schedule includes future NHL games and honors Eastern midnight",()=>{
 assert.deepEqual(gameWindow(Date.parse("2026-09-27T02:00:00Z")),{start:"2026-09-26",end:"2026-10-02"});
 const w=gameWindow(Date.parse("2026-09-26T12:00:00Z"));assert.ok("2026-09-29">=w.start&&"2026-09-29"<=w.end);
 assert.equal(canonicalTeamKey("NHL","Montréal Canadiens"),canonicalTeamKey("NHL","MTL"));
});
