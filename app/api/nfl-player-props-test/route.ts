import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "2.1-rushing-v2-2026-validation";
const MIN_CARRIES = 5;
const MIN_PRIOR_GAMES = 3;
const RECENT_GAMES = 4;

// FROZEN from the 2025 Rushing V2 test. Do not tune on 2026.
const RECENT_CARRIES_WEIGHT = 0.65;
const LONG_CARRIES_WEIGHT = 0.35;
const RECENT_YPC_WEIGHT = 0.30;
const LONG_YPC_WEIGHT = 0.70;

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
  games: PlayerGame[];
};

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 0;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  function split(line: string): string[] {
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

  const headers = split(lines[0]);

  return lines.slice(1).map((line) => {
    const values = split(line);
    const row: Record<string, string> = {};

    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });

    return row;
  });
}

async function loadSeason(season: number): Promise<PlayerGame[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "RDG-NFL-Rushing-V2-Validation/2.1",
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(
      `nflverse ${season} weekly player stats failed: ${res.status}`,
    );
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

  return games.sort(
    (a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId),
  );
}

function addHistory(map: Map<string, History>, game: PlayerGame) {
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

  const mae = avg(errors.map((e) => Math.abs(e)));
  const rmse = Math.sqrt(avg(errors.map((e) => e * e)));
  const meanError = avg(errors);

  return {
    n: errors.length,
    mae: Number(mae.toFixed(2)),
    rmse: Number(rmse.toFixed(2)),
    mean_error: Number(meanError.toFixed(2)),
  };
}

export async function GET() {
  try {
    const [season2024, season2025, season2026] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
      loadSeason(2026),
    ]);

    if (!season2026.length) {
      throw new Error("No 2026 rushing player-game data was found.");
    }

    // 2024 + 2025 are PRIOR HISTORY ONLY.
    // Nothing from them is being scored in this validation.
    const history = new Map<string, History>();

    for (const game of season2024) addHistory(history, game);
    for (const game of season2025) addHistory(history, game);

    const initialPlayersWithHistory = history.size;

    const baselineErrors: number[] = [];
    const v2Errors: number[] = [];
    const predictions: any[] = [];

    let skippedNoHistory = 0;

    const weeks = [...new Set(season2026.map((g) => g.week))].sort(
      (a, b) => a - b,
    );

    const weeklyResults: any[] = [];

    for (const week of weeks) {
      const weekGames = season2026.filter((g) => g.week === week);

      const weekBaselineErrors: number[] = [];
      const weekV2Errors: number[] = [];

      // Score the entire week before updating history.
      for (const game of weekGames) {
        const playerHistory = history.get(game.playerId);

        if (
          !playerHistory ||
          playerHistory.games.length < MIN_PRIOR_GAMES
        ) {
          skippedNoHistory++;
          continue;
        }

        const all = playerHistory.games;
        const recent = all.slice(-RECENT_GAMES);

        const longYpg = avg(all.map((g) => g.rushYards));
        const longCarries = avg(all.map((g) => g.carries));

        const totalLongCarries = all.reduce(
          (sum, g) => sum + g.carries,
          0,
        );
        const totalLongYards = all.reduce(
          (sum, g) => sum + g.rushYards,
          0,
        );

        const longYpc =
          totalLongYards / Math.max(1, totalLongCarries);

        const recentCarries = avg(recent.map((g) => g.carries));

        const totalRecentCarries = recent.reduce(
          (sum, g) => sum + g.carries,
          0,
        );
        const totalRecentYards = recent.reduce(
          (sum, g) => sum + g.rushYards,
          0,
        );

        const recentYpc =
          totalRecentYards / Math.max(1, totalRecentCarries);

        const expectedCarries =
          RECENT_CARRIES_WEIGHT * recentCarries +
          LONG_CARRIES_WEIGHT * longCarries;

        const expectedYpc =
          RECENT_YPC_WEIGHT * recentYpc +
          LONG_YPC_WEIGHT * longYpc;

        const baselineProjection = longYpg;
        const v2Projection = expectedCarries * expectedYpc;

        const baselineError =
          baselineProjection - game.rushYards;
        const v2Error =
          v2Projection - game.rushYards;

        baselineErrors.push(baselineError);
        v2Errors.push(v2Error);

        weekBaselineErrors.push(baselineError);
        weekV2Errors.push(v2Error);

        predictions.push({
          week,
          player: game.playerName,
          team: game.team,

          actual_rushing_yards: game.rushYards,
          actual_carries: game.carries,

          prior_games: all.length,
          recent_games: recent.length,

          long_term_yards_per_game: Number(
            longYpg.toFixed(1),
          ),
          long_term_carries_per_game: Number(
            longCarries.toFixed(2),
          ),
          long_term_yards_per_carry: Number(
            longYpc.toFixed(2),
          ),

          recent_carries_per_game: Number(
            recentCarries.toFixed(2),
          ),
          recent_yards_per_carry: Number(
            recentYpc.toFixed(2),
          ),

          expected_carries: Number(
            expectedCarries.toFixed(2),
          ),
          expected_yards_per_carry: Number(
            expectedYpc.toFixed(2),
          ),

          baseline_projection: Number(
            baselineProjection.toFixed(1),
          ),
          rushing_v2_projection: Number(
            v2Projection.toFixed(1),
          ),
        });
      }

      weeklyResults.push({
        week,
        player_games: weekGames.length,
        predictions: weekV2Errors.length,
        baseline: metrics(weekBaselineErrors),
        rushing_v2: metrics(weekV2Errors),
      });

      // Only after the whole week is scored do we update history.
      for (const game of weekGames) {
        addHistory(history, game);
      }
    }

    const baseline = metrics(baselineErrors);
    const rushingV2 = metrics(v2Errors);

    const maeImprovement =
      baseline.mae !== null && rushingV2.mae !== null
        ? Number(
            (baseline.mae - rushingV2.mae).toFixed(2),
          )
        : null;

    const maeImprovementPercent =
      baseline.mae &&
      maeImprovement !== null
        ? Number(
            (
              (maeImprovement / baseline.mae) *
              100
            ).toFixed(2),
          )
        : null;

    const validated =
      maeImprovement !== null &&
      maeImprovement > 0 &&
      rushingV2.rmse !== null &&
      baseline.rmse !== null &&
      rushingV2.rmse <= baseline.rmse;

    return NextResponse.json({
      success: true,
      version: VERSION,

      purpose:
        "Untouched 2026 validation of the frozen Rushing V2 formula that improved the held-out 2025 test.",

      model_status:
        "VALIDATION ONLY — NOT LIVE",

      frozen_v2_formula: {
        recent_window_games: RECENT_GAMES,
        expected_carries:
          "65% recent carries/game + 35% long-term carries/game",
        expected_yards_per_carry:
          "30% recent YPC + 70% long-term YPC",
        important:
          "These weights are frozen from the prior 2025 test and are not tuned using 2026 results.",
      },

      data_source: {
        provider: "nflverse",
        prior_history_seasons: [2024, 2025],
        validation_season: 2026,
      },

      samples: {
        prior_2024_player_games: season2024.length,
        prior_2025_player_games: season2025.length,
        validation_2026_player_games: season2026.length,
        initial_players_with_history:
          initialPlayersWithHistory,
        validation_predictions: predictions.length,
        skipped_no_prior_history: skippedNoHistory,
      },

      baseline: {
        description:
          "All prior rushing yards per game",
        ...baseline,
      },

      rushing_v2: {
        description:
          "Frozen recent-workload / long-term-efficiency Rushing V2",
        ...rushingV2,
      },

      comparison: {
        mae_improvement_yards: maeImprovement,
        mae_improvement_percent:
          maeImprovementPercent,
        v2_beats_baseline_mae:
          maeImprovement !== null
            ? maeImprovement > 0
            : false,
        v2_beats_or_ties_baseline_rmse:
          rushingV2.rmse !== null &&
          baseline.rmse !== null
            ? rushingV2.rmse <= baseline.rmse
            : false,
        rushing_v2_validated: validated,
      },

      methodology: {
        leakage_control:
          "2024 and 2025 are loaded as prior history. Each 2026 week is predicted in full before that week's results are added.",
        decision_rule:
          "For this validation screen, V2 must improve MAE and not worsen RMSE. The sample size and magnitude of improvement still matter before any live-model decision.",
        important:
          "This validates rushing-yard projection accuracy only. It is not a sportsbook prop backtest and does not establish betting win rate or expected value.",
      },

      weekly_results: weeklyResults,
      sample_predictions: predictions.slice(0, 30),
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
