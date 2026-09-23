import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "1.2-rushing-v1-backtest";
const MIN_CARRIES = 5;
const MIN_PRIOR_GAMES = 2;

type PlayerGame = {
  season: number;
  week: number;
  gameId: string;
  playerId: string;
  playerName: string;
  team: string;
  carries: number;
  rushYards: number;
};

type History = {
  games: number;
  carries: number;
  yards: number;
};

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  function split(line: string) {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

async function loadSeason(season: number): Promise<PlayerGame[]> {
  // nflverse changed the player-stats release layout before the 2025 season.
  // Use the season-specific weekly file instead of the old combined player_stats.csv.
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const res = await fetch(url, {
    headers: { "User-Agent": "RDG-NFL-Rushing-Backtest/1.2" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`nflverse ${season} weekly player stats failed: ${res.status}`);
  }

  const rows = parseCSV(await res.text());
  const games: PlayerGame[] = [];

  for (const row of rows) {
    const seasonType = (row.season_type || "").toUpperCase();
    if (seasonType && seasonType !== "REG") continue;

    const carries = num(row.carries);
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
      team: row.recent_team || row.team || "",
      carries,
      rushYards: num(row.rushing_yards),
    });
  }

  return games.sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
}

function updateHistory(map: Map<string, History>, g: PlayerGame) {
  const h = map.get(g.playerId) ?? { games: 0, carries: 0, yards: 0 };
  h.games += 1;
  h.carries += g.carries;
  h.yards += g.rushYards;
  map.set(g.playerId, h);
}

function metrics(errors: number[]) {
  if (!errors.length) {
    return { n: 0, mae: null, rmse: null, mean_error: null };
  }

  const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
  const rmse = Math.sqrt(
    errors.reduce((s, e) => s + e * e, 0) / errors.length,
  );
  const mean = errors.reduce((s, e) => s + e, 0) / errors.length;

  return {
    n: errors.length,
    mae: Number(mae.toFixed(2)),
    rmse: Number(rmse.toFixed(2)),
    mean_error: Number(mean.toFixed(2)),
  };
}

export async function GET() {
  try {
    const [train2024, test2025] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
    ]);

    if (!train2024.length || !test2025.length) {
      throw new Error(
        `Missing player-game data: 2024=${train2024.length}, 2025=${test2025.length}`,
      );
    }

    const history = new Map<string, History>();
    for (const g of train2024) updateHistory(history, g);

    const baselineErrors: number[] = [];
    const v1Errors: number[] = [];
    const predictions: any[] = [];
    let skippedNoHistory = 0;

    const weeks = [...new Set(test2025.map((g) => g.week))].sort((a, b) => a - b);

    for (const week of weeks) {
      const games = test2025.filter((g) => g.week === week);

      // Predict the full week before adding that week's results.
      for (const g of games) {
        const h = history.get(g.playerId);

        if (!h || h.games < MIN_PRIOR_GAMES || h.carries <= 0) {
          skippedNoHistory++;
          continue;
        }

        const yardsPerGame = h.yards / h.games;
        const carriesPerGame = h.carries / h.games;
        const yardsPerCarry = h.yards / h.carries;

        const baselineProjection = yardsPerGame;
        const v1Projection = carriesPerGame * yardsPerCarry;

        baselineErrors.push(baselineProjection - g.rushYards);
        v1Errors.push(v1Projection - g.rushYards);

        predictions.push({
          week,
          player: g.playerName,
          team: g.team,
          actual_rushing_yards: g.rushYards,
          actual_carries: g.carries,
          prior_games: h.games,
          prior_carries_per_game: Number(carriesPerGame.toFixed(2)),
          prior_yards_per_carry: Number(yardsPerCarry.toFixed(2)),
          baseline_projection: Number(baselineProjection.toFixed(1)),
          rushing_v1_projection: Number(v1Projection.toFixed(1)),
        });
      }

      for (const g of games) updateHistory(history, g);
    }

    const baseline = metrics(baselineErrors);
    const rushingV1 = metrics(v1Errors);

    const improvement =
      baseline.mae !== null && rushingV1.mae !== null
        ? Number((baseline.mae - rushingV1.mae).toFixed(2))
        : null;

    return NextResponse.json({
      success: true,
      version: VERSION,
      purpose:
        "Leakage-safe NFL rushing-yards projection backtest. 2024 initializes history; 2025 is held out and processed chronologically.",
      model_status: "TEST ONLY — NOT LIVE",
      data_source: {
        provider: "nflverse",
        files: [
          "stats_player_week_2024.csv",
          "stats_player_week_2025.csv",
        ],
      },
      filters: {
        season_type: "REG",
        minimum_game_carries: MIN_CARRIES,
        minimum_prior_games: MIN_PRIOR_GAMES,
      },
      samples: {
        training_2024_player_games: train2024.length,
        testing_2025_player_games: test2025.length,
        held_out_predictions: predictions.length,
        skipped_no_prior_history: skippedNoHistory,
      },
      baseline: {
        description: "Prior rushing yards per game",
        ...baseline,
      },
      rushing_v1: {
        description: "Prior carries/game × prior yards/carry",
        ...rushingV1,
      },
      comparison: {
        mae_improvement_yards: improvement,
        note:
          "Positive means Rushing V1 beat the baseline. This is a projection backtest, not a sportsbook betting win-rate test.",
      },
      methodology: {
        leakage_control:
          "2024 supplies prior history. Every 2025 week is predicted before that week's results are added.",
        next_step:
          "Use these results to decide whether workload/recency features are needed before separate 2026 validation and live PropLine integration.",
      },
      sample_predictions: predictions.slice(0, 25),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error: error?.message || String(error),
      },
      { status: 500 },
    );
  }
}
