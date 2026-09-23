import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const MLB_API = "https://statsapi.mlb.com/api/v1";
const SPORT_KEY = "baseball_mlb";
const SEASON = 2026;

// Keep the live route fast and simple for Vercel.
const MAX_EVENTS_TO_ANALYZE = 4;

const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "pitcher_strikeouts",
] as const;

type MarketKey = (typeof MARKETS)[number];
type Side = "Over" | "Under";
type Signal = "OVER" | "UNDER" | "PASS";

type OddsEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

type OddsOutcome = {
  name: string;
  description?: string;
  price?: number;
  point?: number;
};

type OddsMarket = {
  key: string;
  last_update?: string;
  outcomes?: OddsOutcome[];
};

type OddsBookmaker = {
  key: string;
  title: string;
  last_update?: string;
  markets?: OddsMarket[];
};

type EventOdds = OddsEvent & {
  bookmakers?: OddsBookmaker[];
};

type BookQuote = {
  sportsbook_key: string;
  sportsbook: string;
  side: Side;
  line: number;
  odds: number | null;
};

type LineGroup = {
  event_id: string;
  commence_time: string;
  away_team: string;
  home_team: string;
  market: MarketKey;
  player: string;
  line: number;
  quotes: BookQuote[];
};

type PlayerHistory = {
  mlb_player_id: number;
  player: string;
  group: "hitting" | "pitching";
  games: number;
  season_avg: number;
  last_10_avg: number;
  last_5_avg: number;
  weighted_history_avg: number;
  recent_values: number[];
};

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function usageHeaders(response: Response) {
  return {
    last: response.headers.get("x-requests-last") ?? "unknown",
    used: response.headers.get("x-requests-used") ?? "unknown",
    remaining: response.headers.get("x-requests-remaining") ?? "unknown",
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${text.slice(0, 1000)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Provider returned invalid JSON.");
  }
}

function marketLabel(market: MarketKey) {
  if (market === "batter_hits") return "Batter Hits";
  if (market === "batter_total_bases") return "Batter Total Bases";
  return "Pitcher Strikeouts";
}

function statGroup(market: MarketKey): "hitting" | "pitching" {
  return market === "pitcher_strikeouts" ? "pitching" : "hitting";
}

function metricFromSplit(market: MarketKey, split: any): number | null {
  const stat = split?.stat ?? {};

  if (market === "batter_hits") {
    const value = Number(stat.hits);
    return Number.isFinite(value) ? value : null;
  }

  if (market === "batter_total_bases") {
    const direct = Number(stat.totalBases);
    if (Number.isFinite(direct)) return direct;

    const singles = Number(stat.hits ?? 0) - Number(stat.doubles ?? 0) - Number(stat.triples ?? 0) - Number(stat.homeRuns ?? 0);
    const doubles = Number(stat.doubles ?? 0);
    const triples = Number(stat.triples ?? 0);
    const homeRuns = Number(stat.homeRuns ?? 0);
    const calculated = singles + doubles * 2 + triples * 3 + homeRuns * 4;
    return Number.isFinite(calculated) ? calculated : null;
  }

  const strikeouts = Number(stat.strikeOuts);
  return Number.isFinite(strikeouts) ? strikeouts : null;
}

async function findMlbPlayerId(playerName: string): Promise<number | null> {
  const url = `${MLB_API}/people/search?names=${encodeURIComponent(playerName)}`;
  const data = await fetchJson(url);
  const people = Array.isArray(data?.people) ? data.people : [];

  if (!people.length) return null;

  const normalized = playerName.trim().toLowerCase();
  const exact = people.find(
    (person: any) => String(person?.fullName ?? "").trim().toLowerCase() === normalized
  );

  const chosen = exact ?? people[0];
  const id = Number(chosen?.id);
  return Number.isFinite(id) ? id : null;
}

async function loadPlayerHistory(
  playerName: string,
  market: MarketKey,
  cache: Map<string, Promise<PlayerHistory | null>>
): Promise<PlayerHistory | null> {
  const cacheKey = `${market}|${playerName.toLowerCase()}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const playerId = await findMlbPlayerId(playerName);
    if (!playerId) return null;

    const group = statGroup(market);
    const url =
      `${MLB_API}/people/${playerId}/stats` +
      `?stats=gameLog` +
      `&group=${group}` +
      `&season=${SEASON}`;

    const data = await fetchJson(url);
    const splits = Array.isArray(data?.stats?.[0]?.splits)
      ? data.stats[0].splits
      : [];

    const values = splits
      .map((split: any) => ({
        date: String(split?.date ?? ""),
        value: metricFromSplit(market, split),
      }))
      .filter((item: any) => item.value !== null && Number.isFinite(item.value))
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
      .map((item: any) => Number(item.value));

    if (!values.length) return null;

    const last5 = values.slice(-5);
    const last10 = values.slice(-10);

    const seasonAvg = average(values);
    const last5Avg = average(last5);
    const last10Avg = average(last10);

    // V1 history blend. This is intentionally conservative and must be backtested.
    // Season carries the most weight; recent form can only move it moderately.
    const weightedHistoryAvg =
      seasonAvg * 0.55 +
      last10Avg * 0.30 +
      last5Avg * 0.15;

    return {
      mlb_player_id: playerId,
      player: playerName,
      group,
      games: values.length,
      season_avg: round(seasonAvg),
      last_10_avg: round(last10Avg),
      last_5_avg: round(last5Avg),
      weighted_history_avg: round(weightedHistoryAvg),
      recent_values: values.slice(-10),
    };
  })().catch(() => null);

  cache.set(cacheKey, promise);
  return promise;
}

function modelSettings(market: MarketKey) {
  if (market === "batter_hits") {
    return { historyWeight: 0.28, maxAdjustment: 0.28, passEdge: 0.12, minGames: 30 };
  }
  if (market === "batter_total_bases") {
    return { historyWeight: 0.30, maxAdjustment: 0.45, passEdge: 0.25, minGames: 30 };
  }
  return { historyWeight: 0.32, maxAdjustment: 0.75, passEdge: 0.45, minGames: 10 };
}

function projectFromMarketAndHistory(
  market: MarketKey,
  line: number,
  history: PlayerHistory
) {
  const settings = modelSettings(market);
  const rawHistoryDifference = history.weighted_history_avg - line;
  const controlledAdjustment = clamp(
    rawHistoryDifference * settings.historyWeight,
    -settings.maxAdjustment,
    settings.maxAdjustment
  );

  const projection = line + controlledAdjustment;
  const edge = projection - line;

  let signal: Signal = "PASS";
  if (history.games >= settings.minGames) {
    if (edge >= settings.passEdge) signal = "OVER";
    if (edge <= -settings.passEdge) signal = "UNDER";
  }

  return {
    projection: round(projection),
    edge: round(edge),
    signal,
    controlled_adjustment: round(controlledAdjustment),
    settings,
  };
}

function buildReasons(
  signal: Signal,
  line: number,
  history: PlayerHistory
) {
  if (signal === "PASS") return [];

  const recent = history.recent_values ?? [];
  const cleared = recent.filter((v) =>
    signal === "OVER" ? v > line : v < line
  ).length;

  return [
    `Season average: ${history.season_avg}`,
    `Last 10 average: ${history.last_10_avg}`,
    `${signal === "OVER" ? "Cleared" : "Stayed under"} this line in ${cleared}/${recent.length || 0} recent games`,
  ];
}

function buildLineGroups(event: EventOdds): LineGroup[] {
  const groups = new Map<string, LineGroup>();

  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (!MARKETS.includes(market.key as MarketKey)) continue;
      const marketKey = market.key as MarketKey;

      for (const outcome of market.outcomes ?? []) {
        const player = outcome.description?.trim();
        const side = outcome.name as Side;
        const line = Number(outcome.point);
        const odds = Number(outcome.price);

        if (!player) continue;
        if (side !== "Over" && side !== "Under") continue;
        if (!Number.isFinite(line)) continue;

        // Critical: player + market + exact line are separate groups.
        // We never average 0.5 and 1.5 together.
        const key = `${event.id}|${marketKey}|${player.toLowerCase()}|${line}`;

        if (!groups.has(key)) {
          groups.set(key, {
            event_id: event.id,
            commence_time: event.commence_time,
            away_team: event.away_team,
            home_team: event.home_team,
            market: marketKey,
            player,
            line,
            quotes: [],
          });
        }

        groups.get(key)!.quotes.push({
          sportsbook_key: bookmaker.key,
          sportsbook: bookmaker.title,
          side,
          line,
          odds: Number.isFinite(odds) ? odds : null,
        });
      }
    }
  }

  return [...groups.values()];
}

function summarizeQuotes(quotes: BookQuote[]) {
  const sportsbookNames = [...new Set(quotes.map((quote) => quote.sportsbook))];
  const overOdds = quotes
    .filter((quote) => quote.side === "Over" && quote.odds !== null)
    .map((quote) => Number(quote.odds));
  const underOdds = quotes
    .filter((quote) => quote.side === "Under" && quote.odds !== null)
    .map((quote) => Number(quote.odds));

  return {
    sportsbooks: sportsbookNames.length,
    sportsbook_names: sportsbookNames,
    median_over_odds: median(overOdds),
    median_under_odds: median(underOdds),
    quotes,
  };
}

export async function GET() {
  try {
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Missing ODDS_API_KEY" },
        { status: 500 }
      );
    }

    // 1) Upcoming MLB events. Events endpoint is used only to discover event IDs.
    const eventsUrl =
      `${ODDS_API_BASE}/sports/${SPORT_KEY}/events` +
      `?apiKey=${encodeURIComponent(apiKey)}` +
      `&dateFormat=iso`;

    const eventsResponse = await fetch(eventsUrl, { cache: "no-store" });
    const eventsUsage = usageHeaders(eventsResponse);
    const eventsText = await eventsResponse.text();

    if (!eventsResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          stage: "events",
          status: eventsResponse.status,
          error: eventsText.slice(0, 1500),
          usage: eventsUsage,
        },
        { status: eventsResponse.status }
      );
    }

    const allEvents: OddsEvent[] = JSON.parse(eventsText);
    const now = Date.now();

    const upcomingEvents = (Array.isArray(allEvents) ? allEvents : [])
      .filter((event) => {
        const start = new Date(event.commence_time).getTime();
        return Number.isFinite(start) && start > now;
      })
      .sort(
        (a, b) =>
          new Date(a.commence_time).getTime() -
          new Date(b.commence_time).getTime()
      );

    const selectedEvents = upcomingEvents.slice(0, MAX_EVENTS_TO_ANALYZE);

    if (!selectedEvents.length) {
      return NextResponse.json({
        success: true,
        version: "2.0-rdg-mlb-simple-live-props",
        sport: "MLB",
        message: "No upcoming MLB events were found.",
        events_found: allEvents.length,
        usage: { events_request: eventsUsage },
      });
    }

    // 2) Fetch the three prop markets for a controlled number of upcoming games.
    const eventResults = await Promise.all(
      selectedEvents.map(async (event) => {
        const url =
          `${ODDS_API_BASE}/sports/${SPORT_KEY}/events/${event.id}/odds` +
          `?apiKey=${encodeURIComponent(apiKey)}` +
          `&regions=us` +
          `&markets=${encodeURIComponent(MARKETS.join(","))}` +
          `&oddsFormat=american` +
          `&dateFormat=iso`;

        const response = await fetch(url, { cache: "no-store" });
        const usage = usageHeaders(response);
        const text = await response.text();

        if (!response.ok) {
          return {
            ok: false as const,
            event,
            status: response.status,
            error: text.slice(0, 1000),
            usage,
          };
        }

        try {
          return {
            ok: true as const,
            event: JSON.parse(text) as EventOdds,
            usage,
          };
        } catch {
          return {
            ok: false as const,
            event,
            status: 500,
            error: "The Odds API returned invalid JSON.",
            usage,
          };
        }
      })
    );

    const successfulEvents = eventResults
      .filter((result): result is Extract<(typeof eventResults)[number], { ok: true }> => result.ok)
      .map((result) => result.event);

    const lineGroups = successfulEvents.flatMap(buildLineGroups);

    // Prefer groups with broader sportsbook coverage first.
    lineGroups.sort((a, b) => {
      const booksA = new Set(a.quotes.map((q) => q.sportsbook_key)).size;
      const booksB = new Set(b.quotes.map((q) => q.sportsbook_key)).size;
      return booksB - booksA;
    });

    const historyCache = new Map<string, Promise<PlayerHistory | null>>();

    // 3) Analyze every distinct player + market + exact line group.
    const analyses = await Promise.all(
      lineGroups.map(async (group) => {
        const history = await loadPlayerHistory(
          group.player,
          group.market,
          historyCache
        );

        const quoteSummary = summarizeQuotes(group.quotes);

        if (!history) {
          return {
            event_id: group.event_id,
            commence_time: group.commence_time,
            matchup: `${group.away_team} @ ${group.home_team}`,
            player: group.player,
            market: group.market,
            market_name: marketLabel(group.market),
            market_line: group.line,
            rdg_projection: null,
            edge: null,
            signal: "PASS" as Signal,
            reason: "No usable 2026 MLB game-log history found for this player/market.",
            history: null,
            market_data: quoteSummary,
          };
        }

        const model = projectFromMarketAndHistory(
          group.market,
          group.line,
          history
        );

        const sportsbookCount = new Set(
          group.quotes.map((q) => q.sportsbook_key)
        ).size;

        const publicSignal: Signal =
          sportsbookCount >= 2 ? model.signal : "PASS";

        return {
          event_id: group.event_id,
          commence_time: group.commence_time,
          matchup: `${group.away_team} @ ${group.home_team}`,
          player: group.player,
          mlb_player_id: history.mlb_player_id,
          market: group.market,
          market_name: marketLabel(group.market),
          market_line: group.line,
          market_baseline: group.line,
          rdg_projection: model.projection,
          edge: model.edge,
          signal: publicSignal,
          reasons: buildReasons(publicSignal, group.line, history),
          controlled_adjustment: model.controlled_adjustment,
          history: {
            games: history.games,
            season_avg: history.season_avg,
            last_10_avg: history.last_10_avg,
            last_5_avg: history.last_5_avg,
            weighted_history_avg: history.weighted_history_avg,
            recent_values: history.recent_values,
          },
          market_data: quoteSummary,
          model_status:
            "Simple live RDG suggestion based on sportsbook line plus MLB season/recent performance.",
        };
      })
    );

    const actionable = analyses
      .filter((analysis) => analysis.signal !== "PASS")
      .sort((a, b) => Math.abs(Number(b.edge ?? 0)) - Math.abs(Number(a.edge ?? 0)));

    const pass = analyses.filter((analysis) => analysis.signal === "PASS");

    const byMarket = Object.fromEntries(
      MARKETS.map((market) => {
        const rows = analyses.filter((analysis) => analysis.market === market);
        return [
          market,
          {
            analyzed: rows.length,
            over: rows.filter((row) => row.signal === "OVER").length,
            under: rows.filter((row) => row.signal === "UNDER").length,
            pass: rows.filter((row) => row.signal === "PASS").length,
          },
        ];
      })
    );

    const propsUsage = eventResults.map((result) => ({
      event_id: result.ok ? result.event.id : result.event.id,
      matchup: result.ok
        ? `${result.event.away_team} @ ${result.event.home_team}`
        : `${result.event.away_team} @ ${result.event.home_team}`,
      success: result.ok,
      usage: result.usage,
      ...(!result.ok ? { status: result.status, error: result.error } : {}),
    }));

    return NextResponse.json({
      success: true,
      version: "2.0-rdg-mlb-simple-live-props",
      sport: "MLB",
      season: SEASON,
      odds_provider: "The Odds API",
      stats_provider: "MLB Stats API",
      markets: MARKETS,
      model: {
        philosophy:
          "Simple live suggestions: current sportsbook line plus season and recent MLB performance.",
        history_blend: {
          season: 0.55,
          last_10: 0.30,
          last_5: 0.15,
        },
        minimum_sportsbooks_for_suggestion: 2,
        grading_enabled: false,
      },
      events: {
        returned: allEvents.length,
        future: upcomingEvents.length,
        analyzed: selectedEvents.length,
        max_events_per_request: MAX_EVENTS_TO_ANALYZE,
      },
      summary: {
        line_groups: analyses.length,
        actionable: actionable.length,
        pass: pass.length,
        over: actionable.filter((row) => row.signal === "OVER").length,
        under: actionable.filter((row) => row.signal === "UNDER").length,
        by_market: byMarket,
      },
      usage: {
        events_request: eventsUsage,
        event_prop_requests: propsUsage,
      },
      actionable,
      pass,
      next_step:
        "Use actionable OVER/UNDER suggestions on the website and ignore PASS rows.",
    });
  } catch (error) {
    console.error("RDG MLB Simple Props Error:", error);

    return NextResponse.json(
      {
        success: false,
        version: "2.0-rdg-mlb-simple-live-props",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
