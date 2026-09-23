import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
const TEST_WEEK = 1;
const SNAPSHOT_MINUTES_BEFORE_KICKOFF = 30;

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
  return new Date(new Date(iso).getTime() - minutes * 60000).toISOString();
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

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success:false, error:"ODDS_API_KEY is missing." }, { status:500 });
  }

  try {
    const [season2024, season2025] = await Promise.all([loadSeason(2024), loadSeason(2025)]);
    const history = new Map<string, History>();
    for (const game of season2024) addHistory(history, game);

    // First-run safety: test only 2025 Week 1.
    const weekGames = season2025.filter(g => g.week === TEST_WEEK);
    const gameIds = [...new Set(weekGames.map(g => g.gameId))];

    // NFLverse game IDs contain the date, so query historical events near each game's date.
    const eventsById = new Map<string, any>();
    let lastUsage:any = null;
    const eventQueryDates = [...new Set(gameIds.map(id => {
      const m = id.match(/^2025_(\d{2})(\d{2})_/);
      if (!m) return null;
      return `2025-${m[1]}-${m[2]}T12:00:00Z`;
    }).filter(Boolean))] as string[];

    for (const date of eventQueryDates) {
      const r = await oddsJson(`${ODDS_BASE}/historical/sports/${SPORT}/events?date=${encodeURIComponent(date)}`, apiKey);
      lastUsage = r.usage;
      const events = Array.isArray(r.data?.data) ? r.data.data : [];
      for (const e of events) eventsById.set(e.id, e);
    }

    const eventList = [...eventsById.values()];
    const results:any[] = [];
    let historicalOddsCalls = 0;
    let eventsMatched = 0;

    function teamNorm(s:string){return String(s||"").toLowerCase().replace(/[^a-z]/g,"");}

    // Match each nflverse game to Odds API by date/team abbreviations is unreliable,
    // so player matching is performed inside all Week-1 NFL events returned around those dates.
    for (const event of eventList) {
      const commence = String(event.commence_time || "");
      if (!commence.startsWith("2025-09-")) continue;
      const snapshot = isoMinusMinutes(commence, SNAPSHOT_MINUTES_BEFORE_KICKOFF);

      let odds:any;
      try {
        const r = await oddsJson(
          `${ODDS_BASE}/historical/sports/${SPORT}/events/${event.id}/odds?regions=us&markets=${MARKET}&oddsFormat=american&dateFormat=iso&date=${encodeURIComponent(snapshot)}`,
          apiKey
        );
        lastUsage = r.usage;
        odds = r.data?.data ?? r.data;
        historicalOddsCalls++;
      } catch {
        continue;
      }

      const marketPlayers = new Set<string>();
      for (const book of odds?.bookmakers || [])
        for (const market of book.markets || [])
          if (market.key === MARKET)
            for (const o of market.outcomes || [])
              if (o.description) marketPlayers.add(normalizeName(o.description));

      const candidates = weekGames.filter(g => marketPlayers.has(normalizeName(g.playerName)));
      if (!candidates.length) continue;
      eventsMatched++;

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

        results.push({
          week: TEST_WEEK,
          event_id: event.id,
          commence_time: commence,
          snapshot_requested: snapshot,
          player: game.playerName,
          team: game.team,
          position: game.position,
          actual_rushing_yards: game.rushYards,
          actual_carries: game.carries,
          v5_projection: Number(model.projection.toFixed(1)),
          sportsbook: market.selected.sportsbook,
          sportsbook_key: market.selected.sportsbook_key,
          line,
          side,
          odds: price,
          edge_yards: Number(edgeYards.toFixed(1)),
          result: graded.result,
          profit_units: Number(graded.profit.toFixed(3)),
          prior_games: model.priorGames,
        });
      }
    }

    const graded = results.filter(x => x.result !== "PUSH");
    const wins = graded.filter(x => x.result === "WIN").length;
    const losses = graded.filter(x => x.result === "LOSS").length;
    const profit = results.reduce((s,x) => s + x.profit_units, 0);
    const roi = graded.length ? profit / graded.length * 100 : 0;

    function bucket(min:number){
      const x = results.filter(r => Math.abs(r.edge_yards) >= min && r.result !== "PUSH");
      const w = x.filter(r => r.result === "WIN").length;
      const p = x.reduce((s,r)=>s+r.profit_units,0);
      return {
        bets:x.length,
        wins:w,
        losses:x.length-w,
        win_rate:x.length?Number((w/x.length*100).toFixed(2)):null,
        profit_units:Number(p.toFixed(3)),
        roi_percent:x.length?Number((p/x.length*100).toFixed(2)):null
      };
    }

    return NextResponse.json({
      success:true,
      version:"1.0-rushing-v5-historical-sportsbook-week1-test",
      purpose:"Verify frozen Rushing V5 against real pregame 2025 historical player_rush_yds lines before running a full-season sportsbook backtest.",
      model:"Frozen 5.0-rushing-v5-direct-yards",
      test_scope:{season:TEST_SEASON,week:TEST_WEEK,snapshot_minutes_before_kickoff:SNAPSHOT_MINUTES_BEFORE_KICKOFF,market:MARKET,region:"us"},
      important:"This first run intentionally tests only Week 1 to verify historical event matching, player matching, grading, and API usage before spending credits on the full season.",
      api_usage:lastUsage,
      diagnostics:{nflverse_week_player_games:weekGames.length,historical_events_seen:eventList.length,events_with_matched_prop_players:eventsMatched,historical_event_odds_calls:historicalOddsCalls,graded_bets:graded.length},
      overall:{bets:graded.length,wins,losses,win_rate:graded.length?Number((wins/graded.length*100).toFixed(2)):null,profit_units:Number(profit.toFixed(3)),roi_percent:graded.length?Number(roi.toFixed(2)):null},
      edge_buckets:{edge_5_plus:bucket(5),edge_10_plus:bucket(10),edge_15_plus:bucket(15),edge_20_plus:bucket(20)},
      bets:results
    });
  } catch (error:any) {
    return NextResponse.json({success:false,version:"1.0-rushing-v5-historical-sportsbook-week1-test",error:error?.message||String(error)},{status:500});
  }
}
