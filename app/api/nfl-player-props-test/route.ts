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

export async function GET() {
  try {
    /*
      IMPORTANT:
      V5 is another 2024 -> 2025 DEVELOPMENT experiment.
      2026 is intentionally not loaded or used.
    */
    const [season2024, season2025] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
    ]);

    const history = new Map<string, History>();

    for (const game of season2024) {
      addHistory(history, game);
    }

    const baselineErrors: number[] = [];
    const v5Errors: number[] = [];
    const predictions: any[] = [];

    let skippedNoHistory = 0;

    const weeks = [
      ...new Set(season2025.map((game) => game.week)),
    ].sort((a, b) => a - b);

    for (const week of weeks) {
      const weekGames = season2025.filter(
        (game) => game.week === week,
      );

      /*
        Predict the entire week before adding any results from
        that week. This prevents same-week leakage.
      */
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
        const lastTwo = all.slice(-2);

        const careerYpg = avg(
          all.map((g) => g.rushYards),
        );

        const recentYpg = avg(
          recent.map((g) => g.rushYards),
        );

        const lastTwoYpg = avg(
          lastTwo.map((g) => g.rushYards),
        );

        const careerCarries = avg(
          all.map((g) => g.carries),
        );

        const recentCarries = avg(
          recent.map((g) => g.carries),
        );

        /*
          Workload trend is used as a SMALL modifier to direct
          rushing-yard history rather than being multiplied by YPC.
        */
        const rawCarryTrend =
          careerCarries > 0
            ? recentCarries / careerCarries
            : 1;

        const carryTrend = clamp(
          rawCarryTrend,
          0.80,
          1.20,
        );

        const position =
          game.position || "UNKNOWN";

        const isQB = position === "QB";

        /*
          V5 DIRECT-YARDS MODEL

          RB / non-QB:
            65% established yards/game
            25% recent 4-game yards/game
            10% last-two yards/game

          QB:
            80% established yards/game
            15% recent
             5% last-two

          Then apply only a small capped workload modifier.

          This avoids V4's problem where a workload error was
          multiplied directly by volatile YPC.
        */
        let directYards = isQB
          ? (
              0.80 * careerYpg +
              0.15 * recentYpg +
              0.05 * lastTwoYpg
            )
          : (
              0.65 * careerYpg +
              0.25 * recentYpg +
              0.10 * lastTwoYpg
            );

        const workloadModifier = isQB
          ? 1 + 0.10 * (carryTrend - 1)
          : 1 + 0.20 * (carryTrend - 1);

        directYards *= workloadModifier;

        /*
          Final regression guardrail:
          keep the projection from moving too far from the
          established player production level.
        */
        const maxMove = isQB ? 0.20 : 0.30;

        const lower =
          careerYpg * (1 - maxMove);

        const upper =
          careerYpg * (1 + maxMove);

        const v5Projection = clamp(
          directYards,
          lower,
          upper,
        );

        const baselineProjection = careerYpg;

        baselineErrors.push(
          baselineProjection - game.rushYards,
        );

        v5Errors.push(
          v5Projection - game.rushYards,
        );

        predictions.push({
          week,
          player: game.playerName,
          team: game.team,
          position,

          actual_rushing_yards:
            game.rushYards,

          actual_carries:
            game.carries,

          prior_games:
            all.length,

          recent_games:
            recent.length,

          career_yards_per_game:
            Number(careerYpg.toFixed(1)),

          recent_4_yards_per_game:
            Number(recentYpg.toFixed(1)),

          last_2_yards_per_game:
            Number(lastTwoYpg.toFixed(1)),

          career_carries_per_game:
            Number(careerCarries.toFixed(2)),

          recent_carries_per_game:
            Number(recentCarries.toFixed(2)),

          workload_trend:
            Number(carryTrend.toFixed(3)),

          workload_modifier:
            Number(workloadModifier.toFixed(3)),

          baseline_projection:
            Number(
              baselineProjection.toFixed(1),
            ),

          rushing_v5_projection:
            Number(
              v5Projection.toFixed(1),
            ),
        });
      }

      for (const game of weekGames) {
        addHistory(history, game);
      }
    }

    const baseline =
      metrics(baselineErrors);

    const rushingV5 =
      metrics(v5Errors);

    const improvement =
      baseline.mae !== null &&
      rushingV5.mae !== null
        ? Number(
            (
              baseline.mae -
              rushingV5.mae
            ).toFixed(2),
          )
        : null;

    const improvementPercent =
      baseline.mae &&
      improvement !== null
        ? Number(
            (
              (improvement /
                baseline.mae) *
              100
            ).toFixed(2),
          )
        : null;

    return NextResponse.json({
      success: true,

      version: VERSION,

      purpose:
        "Test a direct rushing-yards projection that blends established and recent production while using workload only as a small modifier.",

      model_status:
        "DEVELOPMENT TEST ONLY — NOT LIVE",

      development_guardrail:
        "2026 data is intentionally not loaded or used anywhere in V5.",

      samples: {
        training_2024_player_games:
          season2024.length,

        testing_2025_player_games:
          season2025.length,

        held_out_predictions:
          predictions.length,

        skipped_no_prior_history:
          skippedNoHistory,
      },

      baseline: {
        description:
          "All prior rushing yards per game",

        ...baseline,
      },

      rushing_v5: {
        description:
          "Direct yards model: established production + recent production + small capped workload adjustment",

        recent_window_games:
          RECENT_GAMES,

        ...rushingV5,
      },

      comparison: {
        mae_improvement_yards:
          improvement,

        mae_improvement_percent:
          improvementPercent,

        v5_beats_baseline_mae:
          improvement !== null
            ? improvement > 0
            : false,

        v5_beats_baseline_rmse:
          rushingV5.rmse !== null &&
          baseline.rmse !== null
            ? rushingV5.rmse <
              baseline.rmse
            : false,

        v5_beats_v2_mae:
          rushingV5.mae !== null
            ? rushingV5.mae < 24.61
            : false,

        v2_reference_mae: 24.61,
      },

      methodology: {
        direct_projection:
          "V5 predicts rushing yards directly rather than multiplying expected carries by expected yards per carry.",

        rb_weights:
          "65% established rushing yards/game + 25% recent four-game yards/game + 10% last-two yards/game.",

        qb_weights:
          "80% established rushing yards/game + 15% recent four-game yards/game + 5% last-two yards/game.",

        workload:
          "Recent carries versus established carries are used only as a small capped modifier.",

        regression_guardrail:
          "RB/non-QB projections are limited to ±30% of established yards/game; QB projections are limited to ±20%.",

        leakage_control:
          "2024 initializes history. Every 2025 week is predicted before that week's results are added.",

        important:
          "This remains a development projection test. It is not a sportsbook rushing-prop backtest and does not establish betting win rate or expected value.",
      },

      sample_predictions:
        predictions.slice(0, 30),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error:
          error?.message ||
          String(error),
      },
      { status: 500 },
    );
  }
}
