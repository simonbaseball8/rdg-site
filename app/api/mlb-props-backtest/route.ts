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
  return new Date(new Date(iso).getTime() - hours * 60 * 60 * 1000).toISOString();
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function marketThreshold(market: MarketKey) {
  if (market === "batter_hits") return 0.12;
  if (market === "batter_total_bases") return 0.25;
  return 0.45;
}

function maxAdjustment(market: MarketKey) {
  if (market === "batter_hits") return 0.35;
  if (market === "batter_total_bases") return 0.75;
  return 1.25;
}

function minHistory(market: MarketKey) {
  return market === "pitcher_strikeouts" ? 5 : 10;
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

  const projectionRows = scoped.filter(
    (r) =>
      typeof r.actual === "number" &&
      typeof r.rdg_projection === "number"
  );

  const rdgMae = projectionRows.length
    ? avg(
        projectionRows.map((r) =>
          Math.abs(r.actual - r.rdg_projection)
        )
      )
    : null;

  const marketMae = projectionRows.length
    ? avg(
        projectionRows.map((r) =>
          Math.abs(r.actual - r.market_line)
        )
      )
    : null;

  return {
    rows: scoped.length,
    actionable: graded.length + pushes,
    wins,
    losses,
    pushes,
    pass: passes,
    win_rate_ex_pushes:
      graded.length ? round((wins / graded.length) * 100, 2) : null,
    rdg_mae: rdgMae === null ? null : round(rdgMae),
    market_line_mae: marketMae === null ? null : round(marketMae),
    rdg_mae_improvement:
      rdgMae === null || marketMae === null
        ? null
        : round(marketMae - rdgMae),
  };
}

function summarizeEdges(rows: any[]) {
  const buckets = [
    { name: "0.12-0.24", min: 0.12, max: 0.25 },
    { name: "0.25-0.49", min: 0.25, max: 0.50 },
    { name: "0.50-0.74", min: 0.50, max: 0.75 },
    { name: "0.75+", min: 0.75, max: Infinity },
  ];

  return buckets.map((bucket) => {
    const scoped = rows.filter((r) => {
      const edge = Math.abs(Number(r.edge ?? 0));
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
    const targetDate = searchParams.get("date") ?? "2026-09-14";
    const noonSnapshot = `${targetDate}T12:00:00Z`;

    const eventLookup = await getHistoricalEvents(apiKey, noonSnapshot);

    const allEvents: HistoricalEvent[] = (eventLookup.data?.data ?? [])
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

          const rawDifference =
            hist.weighted_history_avg - group.line;

          const adjustment = Math.max(
            -maxAdjustment(group.market),
            Math.min(
              maxAdjustment(group.market),
              rawDifference * 0.35
            )
          );

          const rdgProjection = group.line + adjustment;
          const edge = rdgProjection - group.line;

          let signal: "OVER" | "UNDER" | "PASS" = "PASS";

          if (hist.games >= minHistory(group.market)) {
            const threshold = marketThreshold(group.market);

            if (edge >= threshold) signal = "OVER";
            if (edge <= -threshold) signal = "UNDER";
          }

          const result = gradeResult(
            actual,
            group.line,
            signal
          );

          let noVigOverProbability: number | null = null;

          const completePairs = [...completeBooks]
            .map((bookKey) => {
              const over = group.quotes.find(
                (q) =>
                  q.sportsbook_key === bookKey &&
                  q.side === "Over"
              );
              const under = group.quotes.find(
                (q) =>
                  q.sportsbook_key === bookKey &&
                  q.side === "Under"
              );

              if (!over || !under) return null;

              const op = americanToImplied(over.odds);
              const up = americanToImplied(under.odds);

              return op / (op + up);
            })
            .filter((x): x is number => x !== null);

          if (completePairs.length) {
            noVigOverProbability = avg(completePairs);
          }

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
            rdg_projection: round(rdgProjection),
            edge: round(edge),
            signal,
            actual,
            result,
            history: hist,
            market_data: {
              sportsbooks: new Set(
                group.quotes.map((q) => q.sportsbook_key)
              ).size,
              complete_over_under_books: completeBooks.size,
              median_over_odds: median(overOdds),
              median_under_odds: median(underOdds),
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
      version: "1.0-rdg-mlb-props-historical-backtest",
      sport: "MLB",
      season: SEASON,
      date: targetDate,
      leakage_protection: {
        historical_odds_snapshot_before_game: true,
        snapshot_offset_minutes: 90,
        player_history_only_before_game_date: true,
        actual_game_result_excluded_from_projection: true,
      },
      model: {
        history_blend: {
          season: 0.55,
          last_10: 0.30,
          last_5: 0.15,
        },
        market_adjustment_factor: 0.35,
        thresholds: {
          batter_hits: marketThreshold("batter_hits"),
          batter_total_bases: marketThreshold(
            "batter_total_bases"
          ),
          pitcher_strikeouts: marketThreshold(
            "pitcher_strikeouts"
          ),
        },
        grading_enabled: false,
        purpose:
          "Validate V1 before creating A+/A/B+/B grades.",
      },
      sample: {
        requested_games: requestedGames,
        historical_events_found: allEvents.length,
        rows_scored: rows.length,
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
        historical_events_request: eventLookup.usage,
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
