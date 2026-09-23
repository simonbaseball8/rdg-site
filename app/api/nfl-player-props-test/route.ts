import { NextResponse } from "next/server";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as readline from "node:readline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "1.0-rushing-v1-backtest";
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

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadSeason(season: number): Promise<PlayerGame[]> {
  // nflverse weekly player stats are compact and ideal for player-prop backtests.
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv`;

  const res = await fetch(url, {
    headers: { "User-Agent": "RDG-NFL-Rushing-Backtest/1.0" },
    next: { revalidate: 3600 },
  });

  if (!res.ok || !res.body) {
    throw new Error(`nflverse player stats failed: ${res.status}`);
  }

  // The release is plain CSV. Stream it so Vercel does not hold the whole file twice.
  const stream = Readable.fromWeb(res.body as any);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  const rows: PlayerGame[] = [];

  for await (const line of rl) {
    if (!headers) {
      headers = csvSplit(line);
      continue;
    }
    if (!line.trim()) continue;

    const values = csvSplit(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = values[i] ?? "";

    if (n(row.season) !== season) continue;
    if ((row.season_type || "").toUpperCase() !== "REG") continue;

    const playerId = row.player_id || row.player_display_name || row.player_name;
    const playerName = row.player_display_name || row.player_name || playerId;
    const carries = n(row.carries);
    const rushYards = n(row.rushing_yards);

    if (!playerId || carries < MIN_CARRIES) continue;

    rows.push({
      season,
      week: n(row.week),
      gameId: row.game_id || `${season}-${row.week}-${row.recent_team}-${playerId}`,
      playerId,
      playerName,
      team: row.recent_team || row.team || "",
      carries,
      rushYards,
    });
  }

  return rows.sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
}

function updateHistory(map: Map<string, History>, g: PlayerGame) {
  const h = map.get(g.playerId) ?? { games: 0, carries: 0, yards: 0 };
  h.games += 1;
  h.carries += g.carries;
  h.yards += g.rushYards;
  map.set(g.playerId, h);
}

function metrics(errors: number[]) {
  if (!errors.length) return { n: 0, mae: null, rmse: null, mean_error: null };
  const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
  const mse = errors.reduce((s, e) => s + e * e, 0) / errors.length;
  const mean = errors.reduce((s, e) => s + e, 0) / errors.length;

  return {
    n: errors.length,
    mae: Number(mae.toFixed(2)),
    rmse: Number(Math.sqrt(mse).toFixed(2)),
    mean_error: Number(mean.toFixed(2)),
  };
}

export async function GET() {
  try {
    const [train2024, test2025] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
    ]);

    // Baseline: player's historical rushing yards/game.
    // V1: expected carries * historical yards/carry.
    // All 2025 predictions use only information available BEFORE that game.
    const history = new Map<string, History>();

    for (const g of train2024) updateHistory(history, g);

    const baselineErrors: number[] = [];
    const v1Errors: number[] = [];
    const predictions: any[] = [];

    const weeks = [...new Set(test2025.map((g) => g.week))].sort((a, b) => a - b);

    let skippedNoHistory = 0;

    for (const week of weeks) {
      const games = test2025.filter((g) => g.week === week);

      // Predict entire week before adding that week's results.
      for (const g of games) {
        const h = history.get(g.playerId);

        if (!h || h.games < MIN_PRIOR_GAMES || h.carries <= 0) {
          skippedNoHistory++;
          continue;
        }

        const histYardsPerGame = h.yards / h.games;
        const histCarriesPerGame = h.carries / h.games;
        const histYardsPerCarry = h.yards / h.carries;

        const baselineProjection = histYardsPerGame;
        const v1Projection = histCarriesPerGame * histYardsPerCarry;

        const baselineError = baselineProjection - g.rushYards;
        const v1Error = v1Projection - g.rushYards;

        baselineErrors.push(baselineError);
        v1Errors.push(v1Error);

        predictions.push({
          week,
          player: g.playerName,
          team: g.team,
          actual_rushing_yards: g.rushYards,
          actual_carries: g.carries,
          prior_games: h.games,
          prior_carries_per_game: Number(histCarriesPerGame.toFixed(2)),
          prior_yards_per_carry: Number(histYardsPerCarry.toFixed(2)),
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
        "Initial leakage-safe NFL rushing-yards projection backtest. 2024 initializes player history; 2025 is held out and processed chronologically.",
      model_status: "TEST ONLY — NOT LIVE",
      data_source: "nflverse weekly player stats",
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
          "Positive means Rushing V1 beat the baseline. This first test does not use sportsbook lines and is not a betting win-rate test.",
      },
      methodology: {
        leakage_control:
          "2024 is prior history. During 2025, every week is predicted before that week's results are added.",
        next_step:
          "If the model is useful, improve the rushing projection with recent workload, role stability and matchup features, then validate separately on 2026 before enabling live PropLine rushing props.",
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
