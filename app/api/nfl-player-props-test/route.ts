import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VERSION = "5.0-rushing-v5-direct-yards";
const MIN_CARRIES = 5;
const MIN_PRIOR_GAMES = 3;
const RECENT_GAMES = 4;

type PlayerGame = {
  season: number;
  week: number;
  gameId: string;
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  carries: number;
  rushYards: number;
};

type History = { games: PlayerGame[] };

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function avg(values: number[]): number {
  return values.length
    ? values.reduce((sum, x) => sum + x, 0) / values.length
    : 0;
}

function clamp(x: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, x));
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const split = (line: string): string[] => {
    const out: string[] = [];
    let current = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];

      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (c === "," && !quoted) {
        out.push(current);
        current = "";
      } else {
        current += c;
      }
    }

    out.push(current);
    return out;
  };

  const headers = split(lines[0]);

  return lines.slice(1).map((line) => {
    const values = split(line);
    const row: Record<string, string> = {};

    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });

    return row;
  });
}

async function loadSeason(season: number): Promise<PlayerGame[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "RDG-Rushing-V5/5.0",
    },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(
      `nflverse ${season} weekly player stats failed: ${response.status}`,
    );
  }

  const rows = parseCSV(await response.text());
  const games: PlayerGame[] = [];

  for (const row of rows) {
    const seasonType = (row.season_type || "").toUpperCase();
    if (seasonType && seasonType !== "REG") continue;

    const carries = num(row.carries);

    // Keep the same sample definition as V2-V4 so comparisons remain fair.
    if (carries < MIN_CARRIES) continue;

    const playerId =
      row.player_id ||
      row.player_display_name ||
      row.player_name ||
      "";

    if (!playerId) continue;

    games.push({
      season,
      week: num(row.week),
      gameId:
        row.game_id ||
        `${season}-${row.week}-${row.recent_team || row.team}-${playerId}`,
      playerId,
      playerName:
        row.player_display_name ||
        row.player_name ||
        playerId,
      position: (
        row.position ||
        row.position_group ||
        ""
      ).toUpperCase(),
      team: row.recent_team || row.team || "",
      carries,
      rushYards: num(row.rushing_yards),
    });
  }

  return games.sort(
    (a, b) =>
      a.week - b.week ||
      a.gameId.localeCompare(b.gameId),
  );
}

function addHistory(
  map: Map<string, History>,
  game: PlayerGame,
) {
  const history = map.get(game.playerId) ?? { games: [] };
  history.games.push(game);
  map.set(game.playerId, history);
}

function metrics(errors: number[]) {
  if (!errors.length) {
    return {
      n: 0,
      mae: null,
      rmse: null,
      mean_error: null,
    };
  }

  return {
    n: errors.length,
    mae: Number(
      avg(errors.map((e) => Math.abs(e))).toFixed(2),
    ),
    rmse: Number(
      Math.sqrt(avg(errors.map((e) => e * e))).toFixed(2),
    ),
    mean_error: Number(avg(errors).toFixed(2)),
  };
}


const ODDS_BASE = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_nfl";
const MARKET = "player_rush_yds";
const TEST_SEASON = 2025;
const DEFAULT_START_WEEK = 7;
const DEFAULT_END_WEEK = 18;
const SNAPSHOT_MINUTES_BEFORE_KICKOFF = 30;

const WEEK_WINDOWS_2025: Record<number, { start: string; end: string; discovery: string }> = {
  1:{start:"2025-09-04T00:00:00Z",end:"2025-09-09T12:00:00Z",discovery:"2025-09-03T12:00:00Z"},
  2:{start:"2025-09-11T00:00:00Z",end:"2025-09-16T12:00:00Z",discovery:"2025-09-10T12:00:00Z"},
  3:{start:"2025-09-18T00:00:00Z",end:"2025-09-23T12:00:00Z",discovery:"2025-09-17T12:00:00Z"},
  4:{start:"2025-09-25T00:00:00Z",end:"2025-09-30T12:00:00Z",discovery:"2025-09-24T12:00:00Z"},
  5:{start:"2025-10-02T00:00:00Z",end:"2025-10-07T12:00:00Z",discovery:"2025-10-01T12:00:00Z"},
  6:{start:"2025-10-09T00:00:00Z",end:"2025-10-14T12:00:00Z",discovery:"2025-10-08T12:00:00Z"},
  7:{start:"2025-10-16T00:00:00Z",end:"2025-10-21T12:00:00Z",discovery:"2025-10-15T12:00:00Z"},
  8:{start:"2025-10-23T00:00:00Z",end:"2025-10-28T12:00:00Z",discovery:"2025-10-22T12:00:00Z"},
  9:{start:"2025-10-30T00:00:00Z",end:"2025-11-04T12:00:00Z",discovery:"2025-10-29T12:00:00Z"},
  10:{start:"2025-11-06T00:00:00Z",end:"2025-11-11T12:00:00Z",discovery:"2025-11-05T12:00:00Z"},
  11:{start:"2025-11-13T00:00:00Z",end:"2025-11-18T12:00:00Z",discovery:"2025-11-12T12:00:00Z"},
  12:{start:"2025-11-20T00:00:00Z",end:"2025-11-25T12:00:00Z",discovery:"2025-11-19T12:00:00Z"},
  13:{start:"2025-11-27T00:00:00Z",end:"2025-12-02T12:00:00Z",discovery:"2025-11-26T12:00:00Z"},
  14:{start:"2025-12-04T00:00:00Z",end:"2025-12-09T12:00:00Z",discovery:"2025-12-03T12:00:00Z"},
  15:{start:"2025-12-11T00:00:00Z",end:"2025-12-16T12:00:00Z",discovery:"2025-12-10T12:00:00Z"},
  16:{start:"2025-12-18T00:00:00Z",end:"2025-12-23T12:00:00Z",discovery:"2025-12-17T12:00:00Z"},
  17:{start:"2025-12-24T00:00:00Z",end:"2025-12-30T12:00:00Z",discovery:"2025-12-23T12:00:00Z"},
  18:{start:"2026-01-01T00:00:00Z",end:"2026-01-05T12:00:00Z",discovery:"2025-12-31T12:00:00Z"},
};


function normalizeName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function americanProfit(odds: number, stake = 1): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds);
}

function isoMinusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() - minutes * 60000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

async function oddsJson(url: string, apiKey: string) {
  const joiner = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${joiner}apiKey=${encodeURIComponent(apiKey)}`, {
    cache: "no-store",
  });
  const usage = {
    used: Number(response.headers.get("x-requests-used")) || null,
    remaining: Number(response.headers.get("x-requests-remaining")) || null,
    last: Number(response.headers.get("x-requests-last")) || null,
  };
  const text = await response.text();
  if (!response.ok) throw new Error(`The Odds API ${response.status}: ${text}`);
  return { data: JSON.parse(text), usage };
}

function projectV5(history: History, position: string) {
  const all = history.games;
  if (all.length < MIN_PRIOR_GAMES) return null;

  const recent = all.slice(-RECENT_GAMES);
  const lastTwo = all.slice(-2);
  const careerYpg = avg(all.map(g => g.rushYards));
  const recentYpg = avg(recent.map(g => g.rushYards));
  const lastTwoYpg = avg(lastTwo.map(g => g.rushYards));
  const careerCarries = avg(all.map(g => g.carries));
  const recentCarries = avg(recent.map(g => g.carries));
  const rawCarryTrend = careerCarries > 0 ? recentCarries / careerCarries : 1;
  const carryTrend = clamp(rawCarryTrend, 0.80, 1.20);
  const isQB = position === "QB";

  let directYards = isQB
    ? 0.80 * careerYpg + 0.15 * recentYpg + 0.05 * lastTwoYpg
    : 0.65 * careerYpg + 0.25 * recentYpg + 0.10 * lastTwoYpg;

  const workloadModifier = isQB
    ? 1 + 0.10 * (carryTrend - 1)
    : 1 + 0.20 * (carryTrend - 1);

  directYards *= workloadModifier;
  const maxMove = isQB ? 0.20 : 0.30;
  const projection = clamp(
    directYards,
    careerYpg * (1 - maxMove),
    careerYpg * (1 + maxMove)
  );

  return {
    projection,
    priorGames: all.length,
    careerYpg,
    recentYpg,
    lastTwoYpg,
    carryTrend,
    workloadModifier,
  };
}

function chooseMainLine(bookmakers: any[], playerName: string) {
  const target = normalizeName(playerName);
  const rows: any[] = [];

  for (const book of bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.key !== MARKET) continue;
      const grouped = new Map<number, any>();

      for (const o of market.outcomes || []) {
        if (normalizeName(o.description) !== target) continue;
        const point = Number(o.point);
        const side = String(o.name || "").toUpperCase();
        const price = Number(o.price);
        if (!Number.isFinite(point) || !Number.isFinite(price)) continue;
        if (!grouped.has(point)) grouped.set(point, {});
        grouped.get(point)[side] = { price };
      }

      for (const [line, pair] of grouped) {
        if (!pair.OVER || !pair.UNDER) continue;
        rows.push({
          sportsbook: book.title || book.key,
          sportsbook_key: book.key,
          line,
          over_odds: pair.OVER.price,
          under_odds: pair.UNDER.price,
          balance: Math.abs(pair.OVER.price - pair.UNDER.price),
        });
      }
    }
  }

  if (!rows.length) return null;

  // Prefer a balanced paired main line. This avoids alternate/milestone lines.
  rows.sort((a,b) => a.balance - b.balance);
  const bestBalance = rows[0].balance;
  const balanced = rows.filter(x => x.balance === bestBalance);
  balanced.sort((a,b) => {
    const ah = a.sportsbook_key === "hardrockbet_fl" ? -1 : 0;
    const bh = b.sportsbook_key === "hardrockbet_fl" ? -1 : 0;
    return ah - bh;
  });
  return { selected: balanced[0], available: rows };
}

function gradeBet(side: "OVER"|"UNDER", line: number, actual: number, odds: number) {
  if (actual === line) return { result: "PUSH", profit: 0 };
  const won = side === "OVER" ? actual > line : actual < line;
  return { result: won ? "WIN" : "LOSS", profit: won ? americanProfit(odds) : -1 };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const startWeekRaw = Number(url.searchParams.get("startWeek") || DEFAULT_START_WEEK);
  const endWeekRaw = Number(url.searchParams.get("endWeek") || DEFAULT_END_WEEK);
  const START_WEEK = Number.isInteger(startWeekRaw) ? clamp(startWeekRaw, 1, 18) : DEFAULT_START_WEEK;
  const END_WEEK = Number.isInteger(endWeekRaw) ? clamp(endWeekRaw, START_WEEK, 18) : DEFAULT_END_WEEK;

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success:false, error:"ODDS_API_KEY is missing." }, { status:500 });
  }

  try {
    const [season2024, season2025] = await Promise.all([loadSeason(2024), loadSeason(2025)]);
    const history = new Map<string, History>();
    for (const game of season2024) addHistory(history, game);

    // IMPORTANT: advance 2025 history chronologically so every week uses only prior games.
    const results:any[] = [];
    const weekSummaries:any[] = [];
    const historicalOddsErrors:any[] = [];
    let lastUsage:any = null;
    let totalEventOddsAttempts = 0;
    let totalEventOddsCalls = 0;
    let totalEventsMatched = 0;

    function summarize(rows:any[]) {
      const graded = rows.filter(x => x.result !== "PUSH");
      const wins = graded.filter(x => x.result === "WIN").length;
      const losses = graded.filter(x => x.result === "LOSS").length;
      const profit = rows.reduce((sum,x) => sum + x.profit_units, 0);
      return {
        bets: graded.length,
        wins,
        losses,
        win_rate: graded.length ? Number((wins / graded.length * 100).toFixed(2)) : null,
        profit_units: Number(profit.toFixed(3)),
        roi_percent: graded.length ? Number((profit / graded.length * 100).toFixed(2)) : null,
      };
    }

    function bucket(rows:any[], min:number) {
      return summarize(rows.filter(r => Math.abs(r.edge_yards) >= min && r.result !== "PUSH"));
    }

    function breakdown(rows:any[], predicate:(r:any)=>boolean) {
      const x = rows.filter(predicate);
      return {
        overall: summarize(x),
        edge_5_plus: bucket(x,5),
        edge_10_plus: bucket(x,10),
        edge_15_plus: bucket(x,15),
        edge_20_plus: bucket(x,20),
      };
    }

    for (let week = 1; week <= 18; week++) {
      const weekGames = season2025.filter(g => g.week === week);

      // Only fetch sportsbook history for the requested range. Earlier weeks are
      // still added to player history after the week so projections remain chronological.
      if (week >= START_WEEK && week <= END_WEEK) {
        const window = WEEK_WINDOWS_2025[week];
        if (!window) throw new Error(`No 2025 date window configured for Week ${week}.`);

        const weekStartMs = new Date(window.start).getTime();
        const weekEndMs = new Date(window.end).getTime();
        const discoverySnapshots = [
          window.discovery,
          new Date(weekStartMs + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          new Date(weekStartMs + 3 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          new Date(weekStartMs + 4 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        ];

        const eventsById = new Map<string,any>();
        for (const date of discoverySnapshots) {
          const r = await oddsJson(
            `${ODDS_BASE}/historical/sports/${SPORT}/events?date=${encodeURIComponent(date)}&dateFormat=iso`,
            apiKey
          );
          lastUsage = r.usage;
          const events = Array.isArray(r.data?.data) ? r.data.data : [];
          for (const event of events) {
            const commenceMs = new Date(String(event.commence_time || "")).getTime();
            if (Number.isFinite(commenceMs) && commenceMs >= weekStartMs && commenceMs <= weekEndMs) {
              eventsById.set(event.id, event);
            }
          }
        }

        const weekRows:any[] = [];
        let weekAttempts = 0;
        let weekCalls = 0;
        let weekMatched = 0;

        for (const event of eventsById.values()) {
          const commence = String(event.commence_time || "");
          const kickoffMs = new Date(commence).getTime();
          if (!Number.isFinite(kickoffMs) || kickoffMs < weekStartMs || kickoffMs > weekEndMs) continue;

          const snapshot = isoMinusMinutes(commence, SNAPSHOT_MINUTES_BEFORE_KICKOFF);
          let odds:any;
          weekAttempts++;
          totalEventOddsAttempts++;

          try {
            const r = await oddsJson(
              `${ODDS_BASE}/historical/sports/${SPORT}/events/${event.id}/odds?regions=us&markets=${MARKET}&oddsFormat=american&dateFormat=iso&date=${encodeURIComponent(snapshot)}`,
              apiKey
            );
            lastUsage = r.usage;
            odds = r.data?.data ?? r.data;
            weekCalls++;
            totalEventOddsCalls++;
          } catch (error:any) {
            historicalOddsErrors.push({
              week,
              event_id:event.id,
              home_team:event.home_team,
              away_team:event.away_team,
              commence_time:commence,
              snapshot_requested:snapshot,
              error:error?.message || String(error),
            });
            continue;
          }

          const marketPlayers = new Set<string>();
          for (const book of odds?.bookmakers || [])
            for (const market of book.markets || [])
              if (market.key === MARKET)
                for (const outcome of market.outcomes || [])
                  if (outcome.description) marketPlayers.add(normalizeName(outcome.description));

          const candidates = weekGames.filter(g => marketPlayers.has(normalizeName(g.playerName)));
          if (!candidates.length) continue;
          weekMatched++;
          totalEventsMatched++;

          for (const game of candidates) {
            const playerHistory = history.get(game.playerId);
            if (!playerHistory) continue;
            const model = projectV5(playerHistory, game.position || "UNKNOWN");
            if (!model) continue;

            const market = chooseMainLine(odds?.bookmakers || [], game.playerName);
            if (!market) continue;

            const line = market.selected.line;
            const edgeYards = model.projection - line;
            const side:"OVER"|"UNDER" = edgeYards >= 0 ? "OVER" : "UNDER";
            const price = side === "OVER" ? market.selected.over_odds : market.selected.under_odds;
            const graded = gradeBet(side, line, game.rushYards, price);

            weekRows.push({
              week,
              event_id:event.id,
              commence_time:commence,
              snapshot_requested:snapshot,
              player:game.playerName,
              team:game.team,
              position:game.position,
              actual_rushing_yards:game.rushYards,
              actual_carries:game.carries,
              v5_projection:Number(model.projection.toFixed(1)),
              sportsbook:market.selected.sportsbook,
              sportsbook_key:market.selected.sportsbook_key,
              line,
              side,
              odds:price,
              edge_yards:Number(edgeYards.toFixed(1)),
              result:graded.result,
              profit_units:Number(graded.profit.toFixed(3)),
              prior_games:model.priorGames,
              v5_abs_error:Number(Math.abs(model.projection - game.rushYards).toFixed(1)),
              market_abs_error:Number(Math.abs(line - game.rushYards).toFixed(1)),
            });
          }
        }

        results.push(...weekRows);
        weekSummaries.push({
          week,
          nflverse_week_player_games:weekGames.length,
          historical_events_seen:eventsById.size,
          historical_event_odds_attempts:weekAttempts,
          historical_event_odds_calls:weekCalls,
          historical_event_odds_errors:historicalOddsErrors.filter(e => e.week === week).length,
          events_with_matched_prop_players:weekMatched,
          ...summarize(weekRows),
        });
      }

      // Add this completed week's results only AFTER all predictions for the week.
      for (const game of weekGames) addHistory(history, game);
    }

    const graded = results.filter(x => x.result !== "PUSH");
    const v5Mae = graded.length
      ? graded.reduce((s,x) => s + x.v5_abs_error, 0) / graded.length
      : null;
    const marketMae = graded.length
      ? graded.reduce((s,x) => s + x.market_abs_error, 0) / graded.length
      : null;

    return NextResponse.json({
      success:true,
      version:"3.0-rushing-v5-historical-multiweek-runner",
      purpose:"Run frozen Rushing V5 across multiple 2025 regular-season weeks using real pregame historical player_rush_yds lines.",
      model:"Frozen 5.0-rushing-v5-direct-yards",
      test_scope:{
        season:TEST_SEASON,
        start_week:START_WEEK,
        end_week:END_WEEK,
        snapshot_minutes_before_kickoff:SNAPSHOT_MINUTES_BEFORE_KICKOFF,
        market:MARKET,
        region:"us",
      },
      methodology:{
        chronological_history:true,
        same_week_results_added_after_predictions:true,
        sportsbook_selection:"balanced paired main line",
        stake:"1 unit risked per bet",
      },
      api_usage:lastUsage,
      diagnostics:{
        historical_event_odds_attempts:totalEventOddsAttempts,
        historical_event_odds_calls:totalEventOddsCalls,
        historical_event_odds_errors:historicalOddsErrors.length,
        events_with_matched_prop_players:totalEventsMatched,
        graded_bets:graded.length,
      },
      overall:summarize(results),
      edge_buckets:{
        edge_5_plus:bucket(results,5),
        edge_10_plus:bucket(results,10),
        edge_15_plus:bucket(results,15),
        edge_20_plus:bucket(results,20),
      },
      position_breakdown:{
        QB:breakdown(results,r => r.position === "QB"),
        RB:breakdown(results,r => r.position === "RB"),
        OTHER:breakdown(results,r => r.position !== "QB" && r.position !== "RB"),
      },
      side_breakdown:{
        OVER:breakdown(results,r => r.side === "OVER"),
        UNDER:breakdown(results,r => r.side === "UNDER"),
      },
      projection_accuracy:{
        matched_bets:graded.length,
        v5_mae:v5Mae === null ? null : Number(v5Mae.toFixed(2)),
        sportsbook_line_mae:marketMae === null ? null : Number(marketMae.toFixed(2)),
        v5_minus_market_mae:v5Mae === null || marketMae === null ? null : Number((v5Mae-marketMae).toFixed(2)),
      },
      weeks:weekSummaries,
      historical_odds_error_samples:historicalOddsErrors.slice(0,10),
      bets:results,
    });
  } catch (error:any) {
    return NextResponse.json({
      success:false,
      version:"3.0-rushing-v5-historical-multiweek-runner",
      error:error?.message || String(error),
    },{status:500});
  }
}
