import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptOddsEvents,
  loadOddsMarket,
  SPORT_KEYS,
} from "../lib/odds-api.ts";
import { buildIdeas, type Pick } from "../app/rdg/board.ts";

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
      assert.equal(u.searchParams.get("bookmakers"), "hardrockbet_fl");
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
