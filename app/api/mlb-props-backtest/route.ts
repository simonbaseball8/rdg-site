import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const MLB_API = "https://statsapi.mlb.com/api/v1";
const SPORT_KEY = "baseball_mlb";
const SEASON = 2026;

const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "pitcher_strikeouts",
] as const;

type MarketKey = (typeof MARKETS)[number];

type Quote = {
  sportsbook_key: string;
  sportsbook: string;
  side: "Over" | "Under";
  line: number;
  odds: number;
};

type HistoricalEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

type PlayerHistory = {
  player_id: number;
  player_name: string;
  group: "hitting" | "pitching";
  games: Array<{ date: string; value: number }>;
};

function round(value: number, digits = 3) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function avg(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(iso: string) {
  return iso.slice(0, 10);
}

function isoHoursBefore(iso: string, hours: number) {
  return new Date(new Date(iso).getTime() - hours * 60 * 60 * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function probabilityEdgeThreshold(market: MarketKey) {
  // Strict V2 thresholds: minimum RDG advantage over the no-vig market.
  if (market === "batter_hits") return 0.07;
  if (market === "batter_total_bases") return 0.08;
  return 0.09;
}

function minHistory(market: MarketKey) {
  // Deliberately conservative. We want stable samples before calling a play.
  return market === "pitcher_strikeouts" ? 10 : 30;
}

function minCompleteBooks(market: MarketKey) {
  // Require real market consensus, not a single-book opinion.
  return market === "pitcher_strikeouts" ? 3 : 3;
}

function historyWeight(market: MarketKey) {
  // Market remains the anchor. Historical evidence only moves us modestly.
  if (market === "batter_hits") return 0.35;
  if (market === "batter_total_bases") return 0.30;
  return 0.25;
}

function validAmericanOdds(odds: number) {
  return Number.isFinite(odds) && (odds >= 100 || odds <= -100);
}

function americanToImplied(odds: number) {
  if (odds < 0) return -odds / (-odds + 100);
  return 100 / (odds + 100);
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${url}: ${text}`);
  }

  return {
    data: text ? JSON.parse(text) : null,
    usage: {
      last: response.headers.get("x-requests-last"),
      used: response.headers.get("x-requests-used"),
      remaining: response.headers.get("x-requests-remaining"),
    },
  };
}

async function getHistoricalEvents(apiKey: string, snapshot: string) {
  const url =
    `${ODDS_API_BASE}/historical/sports/${SPORT_KEY}/events` +
    `?apiKey=${encodeURIComponent(apiKey)}` +
    `&date=${encodeURIComponent(snapshot)}` +
    `&dateFormat=iso`;

  return fetchJson(url);
}

async function getHistoricalProps(
  apiKey: string,
  eventId: string,
  snapshot: string
) {
  const url =
    `${ODDS_API_BASE}/historical/sports/${SPORT_KEY}/events/${eventId}/odds` +
    `?apiKey=${encodeURIComponent(apiKey)}` +
    `&regions=us` +
    `&markets=${MARKETS.join(",")}` +
    `&oddsFormat=american` +
    `&dateFormat=iso` +
    `&date=${encodeURIComponent(snapshot)}`;

  return fetchJson(url);
}

async function getMlbPlayers() {
  const url = `${MLB_API}/sports/1/players?season=${SEASON}`;
  const { data } = await fetchJson(url);

  const byName = new Map<string, { id: number; fullName: string }>();

  for (const person of data?.people ?? []) {
    if (!person?.id || !person?.fullName) continue;
    byName.set(normalizeName(person.fullName), {
      id: Number(person.id),
      fullName: String(person.fullName),
    });
  }

  return byName;
}

async function getPlayerGameLog(
  playerId: number,
  playerName: string,
  market: MarketKey
): Promise<PlayerHistory> {
  const group = market === "pitcher_strikeouts" ? "pitching" : "hitting";
  const url =
    `${MLB_API}/people/${playerId}/stats` +
    `?stats=gameLog` +
    `&group=${group}` +
    `&season=${SEASON}`;

  const { data } = await fetchJson(url);
  const splits = data?.stats?.[0]?.splits ?? [];

  const games = splits
    .map((split: any) => {
      const stat = split?.stat ?? {};
      let value = 0;

      if (market === "batter_hits") {
        value = Number(stat.hits ?? 0);
      } else if (market === "batter_total_bases") {
        const hits = Number(stat.hits ?? 0);
        const doubles = Number(stat.doubles ?? 0);
        const triples = Number(stat.triples ?? 0);
        const homeRuns = Number(stat.homeRuns ?? 0);
        value = hits + doubles + 2 * triples + 3 * homeRuns;
      } else {
        value = Number(stat.strikeOuts ?? 0);
      }

      return {
        date: String(split?.date ?? ""),
        value,
      };
    })
    .filter((g: any) => g.date);

  return {
    player_id: playerId,
    player_name: playerName,
    group,
    games,
  };
}

function buildLineGroups(eventData: any) {
  const groups = new Map<
    string,
    {
      player: string;
      market: MarketKey;
      line: number;
      quotes: Quote[];
    }
  >();

  for (const book of eventData?.bookmakers ?? []) {
    for (const market of book?.markets ?? []) {
      if (!MARKETS.includes(market.key as MarketKey)) continue;

      for (const outcome of market?.outcomes ?? []) {
        if (
          outcome?.name !== "Over" &&
          outcome?.name !== "Under"
        ) {
          continue;
        }

        const player = String(outcome?.description ?? "").trim();
        const line = Number(outcome?.point);
        const odds = Number(outcome?.price);

        if (!player || !Number.isFinite(line) || !Number.isFinite(odds)) {
          continue;
        }

        const key = `${market.key}|${normalizeName(player)}|${line}`;

        if (!groups.has(key)) {
          groups.set(key, {
            player,
            market: market.key as MarketKey,
            line,
            quotes: [],
          });
        }

        groups.get(key)!.quotes.push({
          sportsbook_key: String(book.key ?? ""),
          sportsbook: String(book.title ?? book.key ?? ""),
          side: outcome.name,
          line,
          odds,
        });
      }
    }
  }

  return [...groups.values()];
}

function historicalProjection(
  history: Array<{ date: string; value: number }>,
  eventDate: string
) {
  const prior = history
    .filter((g) => g.date < eventDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const values = prior.map((g) => g.value);
  const last10 = values.slice(-10);
  const last5 = values.slice(-5);

  if (!values.length) {
    return {
      games: 0,
      season_avg: null,
      last_10_avg: null,
      last_5_avg: null,
      weighted_history_avg: null,
    };
  }

  const seasonAvg = avg(values);
  const last10Avg = avg(last10);
  const last5Avg = avg(last5);

  const weighted =
    seasonAvg * 0.55 +
    last10Avg * 0.30 +
    last5Avg * 0.15;

  return {
    games: values.length,
    season_avg: round(seasonAvg),
    last_10_avg: round(last10Avg),
    last_5_avg: round(last5Avg),
    weighted_history_avg: round(weighted),
  };
}

function historicalOverProbability(
  history: Array<{ date: string; value: number }>,
  eventDate: string,
  line: number
) {
  const prior = history
    .filter((g) => g.date < eventDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const overRate = (games: Array<{ date: string; value: number }>) => {
    if (!games.length) return null;
    const overs = games.filter((g) => g.value > line).length;
    const pushes = games.filter((g) => g.value === line).length;
    const decisions = games.length - pushes;
    return decisions ? overs / decisions : null;
  };

  const season = overRate(prior);
  const last10 = overRate(prior.slice(-10));
  const last5 = overRate(prior.slice(-5));

  if (season === null) {
    return {
      games: prior.length,
      season_over_probability: null,
      last_10_over_probability: null,
      last_5_over_probability: null,
      weighted_over_probability: null,
    };
  }

  const p10 = last10 ?? season;
  const p5 = last5 ?? p10;
  const weighted = season * 0.55 + p10 * 0.30 + p5 * 0.15;

  return {
    games: prior.length,
    season_over_probability: round(season, 4),
    last_10_over_probability: round(p10, 4),
    last_5_over_probability: round(p5, 4),
    weighted_over_probability: round(weighted, 4),
  };
}

function actualResult(
  history: Array<{ date: string; value: number }>,
  eventDate: string
) {
  const game = history.find((g) => g.date === eventDate);
  return game ? game.value : null;
}

function gradeResult(actual: number, line: number, signal: string) {
  if (actual === line) return "PUSH";
  if (signal === "OVER") return actual > line ? "WIN" : "LOSS";
  if (signal === "UNDER") return actual < line ? "WIN" : "LOSS";
  return "PASS";
}

function summarize(rows: any[], market?: MarketKey) {
  const scoped = market ? rows.filter((r) => r.market === market) : rows;
  const graded = scoped.filter(
    (r) => r.result === "WIN" || r.result === "LOSS"
  );
  const wins = graded.filter((r) => r.result === "WIN").length;
  const losses = graded.filter((r) => r.result === "LOSS").length;
  const pushes = scoped.filter((r) => r.result === "PUSH").length;
  const passes = scoped.filter((r) => r.signal === "PASS").length;

  const overs = graded.filter((r) => r.signal === "OVER");
  const unders = graded.filter((r) => r.signal === "UNDER");

  return {
    rows: scoped.length,
    actionable: graded.length + pushes,
    wins,
    losses,
    pushes,
    pass: passes,
    win_rate_ex_pushes:
      graded.length ? round((wins / graded.length) * 100, 2) : null,
    over_picks: overs.length,
    over_win_rate:
      overs.length
        ? round(
            (overs.filter((r) => r.result === "WIN").length / overs.length) * 100,
            2
          )
        : null,
    under_picks: unders.length,
    under_win_rate:
      unders.length
        ? round(
            (unders.filter((r) => r.result === "WIN").length / unders.length) * 100,
            2
          )
        : null,
  };
}

function summarizeEdges(rows: any[]) {
  const buckets = [
    { name: "0-2.9pp", min: 0, max: 0.03 },
    { name: "3-4.9pp", min: 0.03, max: 0.05 },
    { name: "5-6.9pp", min: 0.05, max: 0.07 },
    { name: "7-8.9pp", min: 0.07, max: 0.09 },
    { name: "9-11.9pp", min: 0.09, max: 0.12 },
    { name: "12pp+", min: 0.12, max: Infinity },
  ];

  return buckets.map((bucket) => {
    const scoped = rows.filter((r) => {
      const edge = Math.abs(Number(r.probability_edge ?? 0));
      return edge >= bucket.min && edge < bucket.max;
    });
    const graded = scoped.filter(
      (r) => r.result === "WIN" || r.result === "LOSS"
    );
    const wins = graded.filter((r) => r.result === "WIN").length;
    return {
      bucket: bucket.name,
      rows: scoped.length,
      graded: graded.length,
      wins,
      losses: graded.length - wins,
      win_rate_ex_pushes:
        graded.length ? round((wins / graded.length) * 100, 2) : null,
    };
  });
}

export async function GET(request: Request) {
  try {
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ODDS_API_KEY" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Safe default: only 10 games.
    const requestedGames = Math.max(
      1,
      Math.min(Number(searchParams.get("games") ?? 10), 25)
    );

    // Default historical anchor. You can override:
    // /api/mlb-props-backtest?date=2026-09-14&games=10
    const datesParam = searchParams.get("dates");
    const singleDate = searchParams.get("date");
    const targetDates = datesParam
      ? datesParam.split(",").map((d) => d.trim()).filter(Boolean).slice(0, 10)
      : singleDate
        ? [singleDate]
        : ["2026-09-08", "2026-09-10", "2026-09-12", "2026-09-14"];

    const historicalEventUsage: any[] = [];
    const allEvents: HistoricalEvent[] = [];

    for (const targetDate of targetDates) {
      const noonSnapshot = `${targetDate}T12:00:00Z`;
      const eventLookup = await getHistoricalEvents(apiKey, noonSnapshot);
      historicalEventUsage.push({
        dates: targetDates,
        usage: eventLookup.usage,
      });

      const dateEvents: HistoricalEvent[] = (eventLookup.data?.data ?? [])
        .map((event: any) => ({
          id: String(event.id),
          commence_time: String(event.commence_time),
          home_team: String(event.home_team),
          away_team: String(event.away_team),
        }))
        .filter(
          (event: HistoricalEvent) =>
            event.id &&
            event.commence_time &&
            dateOnly(event.commence_time) === targetDate
        )
        .sort(
          (a: HistoricalEvent, b: HistoricalEvent) =>
            new Date(a.commence_time).getTime() -
            new Date(b.commence_time).getTime()
        )
        .slice(0, requestedGames);

      allEvents.push(...dateEvents);
    }

    const playersByName = await getMlbPlayers();

    const playerLogCache = new Map<string, Promise<PlayerHistory>>();
    const rows: any[] = [];
    const eventUsage: any[] = [];
    const errors: any[] = [];

    for (const event of allEvents) {
      // Snapshot 90 minutes before first pitch prevents post-start leakage.
      const snapshot = isoHoursBefore(event.commence_time, 1.5);

      try {
        const propsResponse = await getHistoricalProps(
          apiKey,
          event.id,
          snapshot
        );

        eventUsage.push({
          event_id: event.id,
          matchup: `${event.away_team} @ ${event.home_team}`,
          snapshot,
          usage: propsResponse.usage,
        });

        const eventData = propsResponse.data?.data ?? propsResponse.data;
        const lineGroups = buildLineGroups(eventData);
        const eventDate = dateOnly(event.commence_time);

        for (const group of lineGroups) {
          const playerMatch = playersByName.get(
            normalizeName(group.player)
          );

          if (!playerMatch) {
            continue;
          }

          const cacheKey = `${playerMatch.id}|${group.market}`;

          if (!playerLogCache.has(cacheKey)) {
            playerLogCache.set(
              cacheKey,
              getPlayerGameLog(
                playerMatch.id,
                playerMatch.fullName,
                group.market
              )
            );
          }

          const playerLog = await playerLogCache.get(cacheKey)!;
          const hist = historicalProjection(
            playerLog.games,
            eventDate
          );
          const actual = actualResult(playerLog.games, eventDate);

          if (
            actual === null ||
            hist.weighted_history_avg === null
          ) {
            continue;
          }

          const overOdds = group.quotes
            .filter((q) => q.side === "Over")
            .map((q) => q.odds);

          const underOdds = group.quotes
            .filter((q) => q.side === "Under")
            .map((q) => q.odds);

          const completeBooks = new Set<string>();

          for (const q of group.quotes) {
            const sameBook = group.quotes.filter(
              (x) => x.sportsbook_key === q.sportsbook_key
            );
            if (
              sameBook.some((x) => x.side === "Over") &&
              sameBook.some((x) => x.side === "Under")
            ) {
              completeBooks.add(q.sportsbook_key);
            }
          }

          // V1.1: Do not score one-sided alternate lines.
          if (completeBooks.size === 0) {
            continue;
          }

          const validCompletePairs = [...completeBooks]
            .map((bookKey) => {
              const over = group.quotes.find(
                (q) =>
                  q.sportsbook_key === bookKey &&
                  q.side === "Over" &&
                  validAmericanOdds(q.odds)
              );
              const under = group.quotes.find(
                (q) =>
                  q.sportsbook_key === bookKey &&
                  q.side === "Under" &&
                  validAmericanOdds(q.odds)
              );

              if (!over || !under) return null;

              const op = americanToImplied(over.odds);
              const up = americanToImplied(under.odds);
              if (!Number.isFinite(op) || !Number.isFinite(up) || op + up <= 0) {
                return null;
              }

              return {
                bookKey,
                overOdds: over.odds,
                underOdds: under.odds,
                noVigOver: op / (op + up),
              };
            })
            .filter((x): x is {
              bookKey: string;
              overOdds: number;
              underOdds: number;
              noVigOver: number;
            } => x !== null);

          const noVigOverProbability = validCompletePairs.length
            ? avg(validCompletePairs.map((x) => x.noVigOver))
            : null;

          const histProb = historicalOverProbability(
            playerLog.games,
            eventDate,
            group.line
          );

          let signal: "OVER" | "UNDER" | "PASS" = "PASS";
          let rdgOverProbability: number | null = null;
          let probabilityEdge: number | null = null;
          let passReason: string | null = null;

          if (validCompletePairs.length < minCompleteBooks(group.market)) {
            passReason = "INSUFFICIENT_COMPLETE_BOOKS";
          } else if (histProb.games < minHistory(group.market)) {
            passReason = "INSUFFICIENT_HISTORY";
          } else if (
            noVigOverProbability === null ||
            histProb.weighted_over_probability === null
          ) {
            passReason = "MISSING_PROBABILITY";
          } else {
            const w = historyWeight(group.market);

            // Market is the anchor; history can only make a controlled correction.
            rdgOverProbability =
              noVigOverProbability * (1 - w) +
              histProb.weighted_over_probability * w;

            probabilityEdge =
              rdgOverProbability - noVigOverProbability;

            const threshold = probabilityEdgeThreshold(group.market);

            if (probabilityEdge >= threshold) signal = "OVER";
            else if (probabilityEdge <= -threshold) signal = "UNDER";
            else passReason = "EDGE_BELOW_STRICT_THRESHOLD";
          }

          const result = gradeResult(actual, group.line, signal);

          rows.push({
            event_id: event.id,
            game_date: eventDate,
            commence_time: event.commence_time,
            snapshot,
            matchup: `${event.away_team} @ ${event.home_team}`,
            player: group.player,
            mlb_player_id: playerMatch.id,
            market: group.market,
            market_line: group.line,
            rdg_over_probability:
              rdgOverProbability === null ? null : round(rdgOverProbability, 4),
            probability_edge:
              probabilityEdge === null ? null : round(probabilityEdge, 4),
            edge: probabilityEdge === null ? 0 : round(probabilityEdge, 4),
            signal,
            pass_reason: passReason,
            actual,
            result,
            history: {
              ...hist,
              ...histProb,
            },
            market_data: {
              sportsbooks: new Set(
                group.quotes.map((q) => q.sportsbook_key)
              ).size,
              complete_over_under_books: validCompletePairs.length,
              median_over_odds: median(
                validCompletePairs.map((x) => x.overOdds)
              ),
              median_under_odds: median(
                validCompletePairs.map((x) => x.underOdds)
              ),
              no_vig_over_probability:
                noVigOverProbability === null
                  ? null
                  : round(noVigOverProbability, 4),
            },
          });
        }
      } catch (error) {
        errors.push({
          event_id: event.id,
          matchup: `${event.away_team} @ ${event.home_team}`,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }

    rows.sort(
      (a, b) =>
        Math.abs(b.edge) - Math.abs(a.edge)
    );

    return NextResponse.json({
      success: true,
      version: "2.0-rdg-mlb-strict-probability-backtest",
      sport: "MLB",
      season: SEASON,
      dates: targetDates,
      leakage_protection: {
        historical_odds_snapshot_before_game: true,
        snapshot_offset_minutes: 90,
        player_history_only_before_game_date: true,
        actual_game_result_excluded_from_projection: true,
      },
      model: {
        approach: "market-anchored probability edge",
        historical_over_probability_blend: {
          season: 0.55,
          last_10: 0.30,
          last_5: 0.15,
        },
        history_weight: {
          batter_hits: historyWeight("batter_hits"),
          batter_total_bases: historyWeight("batter_total_bases"),
          pitcher_strikeouts: historyWeight("pitcher_strikeouts"),
        },
        strict_probability_edge_thresholds: {
          batter_hits: probabilityEdgeThreshold("batter_hits"),
          batter_total_bases: probabilityEdgeThreshold("batter_total_bases"),
          pitcher_strikeouts: probabilityEdgeThreshold("pitcher_strikeouts"),
        },
        minimum_history_games: {
          batter_hits: minHistory("batter_hits"),
          batter_total_bases: minHistory("batter_total_bases"),
          pitcher_strikeouts: minHistory("pitcher_strikeouts"),
        },
        minimum_complete_books: 3,
        grading_enabled: false,
        purpose:
          "Strict V2 validation: market-anchored no-vig probability versus historical line-clearing probability. No grades until calibrated.",
      },
      sample: {
        requested_games_per_date: requestedGames,
        requested_dates: targetDates.length,
        historical_events_found: allEvents.length,
        rows_scored: rows.length,
        two_sided_market_required: true,
        minimum_complete_books_required_for_action: 3,
      },
      summary: {
        overall: summarize(rows),
        by_market: {
          batter_hits: summarize(rows, "batter_hits"),
          batter_total_bases: summarize(
            rows,
            "batter_total_bases"
          ),
          pitcher_strikeouts: summarize(
            rows,
            "pitcher_strikeouts"
          ),
        },
        by_edge: summarizeEdges(rows),
      },
      odds_api_usage: {
        historical_events_requests: historicalEventUsage,
        historical_prop_requests: eventUsage,
      },
      errors,
      rows,
    });
  } catch (error) {
    console.error("RDG MLB Props Backtest Error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "RDG MLB props backtest failed",
        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
