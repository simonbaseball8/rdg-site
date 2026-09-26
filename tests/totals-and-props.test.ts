import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeBoard,
  buildIdeas,
  type Feeds,
  type Pick,
} from "../app/rdg/board.ts";
import { passesFilters, replacements } from "../app/rdg/pick-controls.ts";
import { validBet } from "../app/rdg/journal.ts";
const now = Date.parse("2026-09-26T12:00:00Z");
function feeds(): Feeds {
  return {
    MLB: {
      loadedAt: now,
      data: {
        games: [
          {
            event_id: "mlb1",
            start_date: "2026-09-27T01:00:00Z",
            away_team: "A",
            home_team: "B",
            sportsbook: "Hard Rock Bet (FL)",
            quote_times: { total: new Date(now).toISOString() },
            hard_rock: {
              total: {
                over: 8.5,
                under: 8.5,
                over_odds: -110,
                under_odds: -110,
              },
            },
            starting_pitchers: {
              away: { name: "Pitcher A" },
              home: { name: "Pitcher B" },
            },
            rdg: {
              total_model: {
                lean: "Over",
                market_total: 8.5,
                projected_total_runs: 10,
                model_over_probability: 63,
                model_under_probability: 37,
                signal: "Experimental Review",
              },
            },
          },
        ],
      },
    },
  };
}
test("Totals retain both offered sides, nominate only supported side and preserve original odds in journal", () => {
  const p = normalizeBoard(feeds(), now).filter((p) => p.market === "Total");
  assert.equal(p.length, 2);
  assert.deepEqual(
    p.filter((p) => p.eligible).map((p) => p.title),
    ["Over 8.5 total runs"],
  );
  assert.equal(p[0].quoteAt, new Date(now).toISOString());
  assert.equal(
    validBet({
      id: "total-bet-123",
      savedAt: new Date(now).toISOString(),
      kind: "straight",
      mode: "paper",
      stakeUnits: 1,
      picks: [p[0]],
      settlements: [],
    }),
    true,
  );
  const other = { ...p[0], id: "second", event: "second", matchup: "C @ D" };
  assert.equal(buildIdeas([p[0], other, p[1]], 2, now, "totals").length, 1);
  assert.deepEqual(replacements(p, [p[0], other], 0, now, "totals"), []);
});
test("Totals reject missing starters, changed lines, stale quotes and reference prices without opt-in", () => {
  for (const change of [
    (g: any) => {
      g.starting_pitchers.away = null;
    },
    (g: any) => {
      g.hard_rock.total.over = 9.5;
    },
    (g: any) => {
      g.quote_times.total = "2026-09-25T12:00:00Z";
    },
    (g: any) => {
      g.requires_florida_verification = true;
      g.sportsbook = "Hard Rock Bet (IN reference)";
    },
    (g: any) => {
      g.rdg.total_model.model_over_probability = 40;
    },
  ]) {
    const f = feeds();
    change((f.MLB!.data as any).games[0]);
    assert.equal(
      normalizeBoard(f, now).some((p) => p.market === "Total" && p.eligible),
      false,
    );
  }
});
test("Unmodeled totals are visible research and cannot enter automatic parlays", () => {
  const f: Feeds = {
    NFL: {
      loadedAt: now,
      data: {
        games: [
          {
            event_id: "nfl1",
            start_date: "2026-09-27T01:00:00Z",
            away_team: "A",
            home_team: "B",
            sportsbook: "Hard Rock Bet (FL)",
            total: [
              { side: "Over", line: 44.5, odds: -110 },
              { side: "Under", line: 44.5, odds: -115 },
            ],
          },
        ],
      },
    },
  };
  const p = normalizeBoard(f, now);
  assert.equal(p.length, 2);
  assert.ok(p.every((p) => !p.eligible && p.market === "Total"));
  assert.deepEqual(buildIdeas(p, 2, now, "totals"), []);
});
test("Prop types filter rushing and strikeouts without excluding game markets", () => {
  const base = normalizeBoard(feeds(), now)[0];
  const rush: Pick = {
    ...base,
    market: "Player prop",
    propType: "player_rush_yds",
  };
  const strikeouts: Pick = { ...rush, propType: "pitcher_strikeouts" };
  const f = {
    maxFavorite: null,
    excludedTeams: [],
    markets: [],
    propTypes: ["pitcher_strikeouts"],
  };
  assert.equal(passesFilters(rush, f), false);
  assert.equal(passesFilters(strikeouts, f), true);
  assert.equal(passesFilters(base, f), true);
  assert.equal(passesFilters(rush, { ...f, propTypes: [] }), true);
});
