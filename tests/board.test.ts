import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildIdeas,
  decimalOdds,
  easternDate,
  estimatedReturn,
  normalizeBoard,
  oddsNumber,
  upcoming,
  type Pick,
  type Feeds,
} from "../app/rdg/board.ts";
const now = Date.parse("2026-09-26T00:00:00Z");
function pick(overrides: Partial<Pick> = {}): Pick {
  return {
    id: "one",
    event: "one",
    sport: "NFL",
    starts: "2026-09-26T01:00:00Z",
    matchup: "A @ B",
    title: "A -3",
    market: "Spread",
    odds: -110,
    book: "Hard Rock Bet",
    score: 3,
    reasons: [],
    concerns: [],
    eligible: true,
    ...overrides,
  };
}
test("American prices and return include stake, with invalid prices rejected", () => {
  assert.equal(decimalOdds(-200), 1.5);
  assert.equal(decimalOdds(150), 2.5);
  assert.equal(
    estimatedReturn([pick({ odds: -200 }), pick({ odds: 150 })], 10),
    37.5,
  );
  for (const value of [0, null, "", Infinity, 75, -99])
    assert.equal(oddsNumber(value), null);
  assert.equal(estimatedReturn([pick({ odds: null })], 10), null);
  assert.equal(estimatedReturn([pick()], -10), null);
});
test("Today means Eastern date, and already started games disappear", () => {
  assert.equal(easternDate(now), "2026-09-25");
  assert.equal(upcoming("2026-09-26T03:30:00Z", now, "today"), true);
  assert.equal(upcoming("2026-09-26T04:30:00Z", now, "today"), false);
  assert.equal(upcoming("2026-09-25T23:30:00Z", now, "week"), false);
  assert.equal(upcoming("invalid", now, "week"), false);
});
test("Rejects other books, incomplete cards and duplicated games across provider IDs", () => {
  const candidates = [
    pick(),
    pick({ id: "duplicate", event: "other-provider" }),
    pick({
      id: "wrongbook",
      event: "second",
      matchup: "C @ D",
      book: "FanDuel",
    }),
  ];
  assert.deepEqual(buildIdeas(candidates, 2, now), []);
  const valid = pick({ id: "two", event: "two", matchup: "C @ D" });
  assert.equal(buildIdeas([...candidates, valid], 2, now).length, 1);
  assert.deepEqual(buildIdeas([pick(), valid], 3, now), []);
  assert.deepEqual(buildIdeas([pick(), valid], 1, now), []);
});
function propsFeed(
  changes: Record<string, unknown> = {},
  book = "Hard Rock Bet",
  quoteTime: string | null = new Date(now).toISOString(),
): Feeds {
  return {
    props: {
      loadedAt: now,
      data: {
        parlay_pool: [
          {
            event_id: "e",
            player_id: "p",
            player_name: "Test Player",
            provider_market: "player_rush_yds",
            market: "Rushing Yards",
            pick: "OVER",
            grade: "A",
            start_time: "2026-09-26T01:00:00Z",
            sportsbook_line: 60.5,
            rdg_projection: 75,
            matchup: { away: "A", home: "B" },
            sportsbook_lines: [
              {
                sportsbook: book,
                odds: -110,
                side: "OVER",
                line: 60.5,
                available: true,
                updated_at: quoteTime,
              },
            ],
            ...changes,
          },
        ],
      },
    },
    injuries: { loadedAt: now, data: { success: true, current_injuries: [] } },
  };
}
test("Props need matching, recent Hard Rock quotes and a working injury feed", () => {
  assert.equal(normalizeBoard(propsFeed(), now)[0].eligible, true);
  assert.equal(
    normalizeBoard(propsFeed({}, "FanDuel"), now)[0].eligible,
    false,
  );
  assert.equal(
    normalizeBoard(propsFeed({}, "Hard Rock Bet", null), now)[0].eligible,
    false,
  );
  assert.equal(
    normalizeBoard(
      propsFeed({}, "Hard Rock Bet", new Date(now - 16 * 60_000).toISOString()),
      now,
    )[0].eligible,
    false,
  );
  assert.equal(
    normalizeBoard(propsFeed({ sportsbook_line: 65.5 }), now)[0].eligible,
    false,
  );
  const feeds = propsFeed();
  delete feeds.injuries;
  assert.equal(normalizeBoard(feeds, now)[0].eligible, false);
});
test("Injury and role-change exclusions are enforced", () => {
  for (const status of ["OUT", "DOUBTFUL", "QUESTIONABLE"]) {
    const feeds = propsFeed();
    feeds.injuries!.data = {
      success: true,
      current_injuries: [
        {
          player_name: "Test Player",
          game_status: status,
          current_injury: true,
        },
      ],
    };
    assert.equal(normalizeBoard(feeds, now)[0].eligible, false);
  }
  assert.equal(
    normalizeBoard(
      propsFeed({ role_change_protection: { severity: "STRONG" } }),
      now,
    )[0].eligible,
    false,
  );
});
test("A stale response cannot supply a fresh eligible candidate", () => {
  const feeds = propsFeed();
  feeds.props!.loadedAt = now - 16 * 60_000;
  assert.equal(normalizeBoard(feeds, now)[0].eligible, false);
});
test("Cards never reuse an identical leg and started games cannot slip through", () => {
  const candidates = Array.from({ length: 6 }, (_, i) =>
    pick({ id: `${i}`, event: `${i}`, matchup: `Team ${i} @ Opponent` }),
  );
  const ideas = buildIdeas(candidates, 2, now);
  assert.equal(ideas.length, 3);
  assert.equal(new Set(ideas.flat().map((p) => p.id)).size, 6);
  assert.deepEqual(
    buildIdeas(
      candidates.map((p) => ({ ...p, starts: new Date(now).toISOString() })),
      2,
      now,
    ),
    [],
  );
});
