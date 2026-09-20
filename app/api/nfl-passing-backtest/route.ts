import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TRAIN_SEASONS = [2023, 2024];
const TEST_SEASON = 2025;

type Row = Record<string, string>;

type Game = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  team: string;
  attempts: number;
  yards: number;
};

type Result = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  actual: number;
  projection: number;
  error: number;
  absolute_error: number;
  prior_games: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (!values.length) return null;

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result;
}

function parseCSV(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (!lines.length) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);

    const row: Row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

async function fetchSeason(season: number): Promise<Game[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `nflverse returned ${response.status} for ${season}`
    );
  }

  const rows = parseCSV(await response.text());

  return rows
    .filter(
      (row) =>
        num(row.season) === season &&
        String(row.season_type).toUpperCase() === "REG" &&
        String(row.position).toUpperCase() === "QB" &&
        num(row.attempts) >= 10
    )
    .map((row) => ({
      season,
      week: num(row.week),

      player_id: row.player_id ?? "",

      player_name:
        row.player_display_name ||
        row.player_name ||
        "",

      team:
        row.recent_team ||
        row.team ||
        "",

      attempts: num(row.attempts),
      yards: num(row.passing_yards),
    }))
    .sort(
      (a, b) =>
        a.week - b.week ||
        a.player_id.localeCompare(b.player_id)
    );
}

function projectFromHistory(history: Game[]): number | null {
  if (history.length < 3) {
    return null;
  }

  const currentSeason =
    history[history.length - 1].season;

  const currentGames = history.filter(
    (game) => game.season === currentSeason
  );

  const olderGames = history.filter(
    (game) => game.season < currentSeason
  );

  const currentAverage = average(
    currentGames.map((game) => game.yards)
  );

  const priorAverage = average(
    olderGames.slice(-17).map((game) => game.yards)
  );

  const recentAverage = average(
    history.slice(-5).map((game) => game.yards)
  );

  const currentAttemptAverage = average(
    currentGames.map((game) => game.attempts)
  );

  const priorAttemptAverage = average(
    olderGames.slice(-17).map((game) => game.attempts)
  );

  let currentWeight = 0;

  if (currentGames.length === 1) {
    currentWeight = 0.2;
  } else if (currentGames.length === 2) {
    currentWeight = 0.35;
  } else if (currentGames.length === 3) {
    currentWeight = 0.5;
  } else if (currentGames.length === 4) {
    currentWeight = 0.6;
  } else if (currentGames.length >= 5) {
    currentWeight = 0.7;
  }

  if (!olderGames.length) {
    currentWeight = 1;
  }

  let baseline: number | null = null;

  if (
    currentAverage !== null &&
    priorAverage !== null
  ) {
    baseline =
      currentAverage * currentWeight +
      priorAverage * (1 - currentWeight);
  } else {
    baseline =
      currentAverage ??
      priorAverage ??
      recentAverage;
  }

  if (baseline === null) {
    return null;
  }

  if (recentAverage !== null) {
    baseline =
      baseline * 0.75 +
      recentAverage * 0.25;
  }

  if (
    currentAttemptAverage !== null &&
    priorAttemptAverage !== null &&
    priorAttemptAverage >= 20
  ) {
    const ratio =
      currentAttemptAverage /
      priorAttemptAverage;

    const cappedRatio = Math.min(
      1.15,
      Math.max(0.85, ratio)
    );

    baseline *=
      1 + (cappedRatio - 1) * 0.25;
  }

  return baseline;
}

function runChronologicalBacktest(
  games: Game[],
  evaluateSeason: number
): Result[] {
  const history =
    new Map<string, Game[]>();

  const results: Result[] = [];

  const ordered = [...games].sort(
    (a, b) =>
      a.season - b.season ||
      a.week - b.week ||
      a.player_id.localeCompare(b.player_id)
  );

  for (const game of ordered) {
    if (!game.player_id) {
      continue;
    }

    const previous =
      history.get(game.player_id) ?? [];

    if (game.season === evaluateSeason) {
      const projection =
        projectFromHistory(previous);

      if (projection !== null) {
        const error =
          game.yards - projection;

        results.push({
          season: game.season,
          week: game.week,

          player_id: game.player_id,
          player_name: game.player_name,

          actual: game.yards,
          projection,

          error,

          absolute_error:
            Math.abs(error),

          prior_games:
            previous.length,
        });
      }
    }

    previous.push(game);

    history.set(
      game.player_id,
      previous
    );
  }

  return results;
}

function summarize(results: Result[]) {
  if (!results.length) {
    return {
      games: 0,
      mae: null,
      rmse: null,
      mean_error: null,
    };
  }

  const errors =
    results.map((result) => result.error);

  const absoluteErrors =
    results.map(
      (result) =>
        result.absolute_error
    );

  const mae =
    absoluteErrors.reduce(
      (sum, value) => sum + value,
      0
    ) / results.length;

  const mse =
    errors.reduce(
      (sum, value) =>
        sum + value * value,
      0
    ) / results.length;

  const meanError =
    errors.reduce(
      (sum, value) => sum + value,
      0
    ) / results.length;

  return {
    games: results.length,
    mae: round(mae),
    rmse: round(Math.sqrt(mse)),
    mean_error: round(meanError),
  };
}

function errorBuckets(results: Result[]) {
  const buckets = [
    {
      label: "Within 10 yards",
      max: 10,
    },
    {
      label: "Within 20 yards",
      max: 20,
    },
    {
      label: "Within 30 yards",
      max: 30,
    },
    {
      label: "Within 40 yards",
      max: 40,
    },
    {
      label: "Within 50 yards",
      max: 50,
    },
  ];

  return buckets.map((bucket) => {
    const count =
      results.filter(
        (result) =>
          result.absolute_error <=
          bucket.max
      ).length;

    return {
      label: bucket.label,
      games: count,

      percentage:
        results.length
          ? round(
              (count /
                results.length) *
                100,
              1
            )
          : 0,
    };
  });
}

function weekBreakdown(results: Result[]) {
  const weeks =
    Array.from(
      new Set(
        results.map(
          (result) =>
            result.week
        )
      )
    ).sort((a, b) => a - b);

  return weeks.map((week) => {
    const weekResults =
      results.filter(
        (result) =>
          result.week === week
      );

    return {
      week,
      ...summarize(weekResults),
    };
  });
}

function sampleBreakdown(results: Result[]) {
  const groups = [
    {
      label: "3-5 prior games",
      min: 3,
      max: 5,
    },
    {
      label: "6-10 prior games",
      min: 6,
      max: 10,
    },
    {
      label: "11-17 prior games",
      min: 11,
      max: 17,
    },
    {
      label: "18+ prior games",
      min: 18,
      max: Infinity,
    },
  ];

  return groups.map((group) => {
    const subset =
      results.filter(
        (result) =>
          result.prior_games >=
            group.min &&
          result.prior_games <=
            group.max
      );

    return {
      sample: group.label,
      ...summarize(subset),
    };
  });
}

export async function GET() {
  try {
    const seasons =
      Array.from(
        new Set([
          ...TRAIN_SEASONS,
          TEST_SEASON,
        ])
      );

    const seasonData =
      await Promise.all(
        seasons.map(fetchSeason)
      );

    const allGames =
      seasonData.flat();

    /*
      Main held-out test:
      2023 + 2024 become historical information.
      2025 is evaluated chronologically.

      During 2025, each completed week is added
      to history before later weeks are projected.
    */

    const testResults =
      runChronologicalBacktest(
        allGames,
        TEST_SEASON
      );

    /*
      Simple comparison baseline:
      predict the QB's average passing yards
      from all prior available games.

      This tells us whether our weighted RDG
      projection is actually improving on a
      very basic historical-average model.
    */

    const baselineHistory =
      new Map<string, Game[]>();

    const baselineResults: Result[] = [];

    const ordered =
      [...allGames].sort(
        (a, b) =>
          a.season - b.season ||
          a.week - b.week ||
          a.player_id.localeCompare(
            b.player_id
          )
      );

    for (const game of ordered) {
      const previous =
        baselineHistory.get(
          game.player_id
        ) ?? [];

      if (
        game.season ===
          TEST_SEASON &&
        previous.length >= 3
      ) {
        const recentHistory =
          previous.slice(-17);

        const projection =
          average(
            recentHistory.map(
              (item) =>
                item.yards
            )
          );

        if (projection !== null) {
          const error =
            game.yards -
            projection;

          baselineResults.push({
            season:
              game.season,

            week:
              game.week,

            player_id:
              game.player_id,

            player_name:
              game.player_name,

            actual:
              game.yards,

            projection,

            error,

            absolute_error:
              Math.abs(error),

            prior_games:
              previous.length,
          });
        }
      }

      previous.push(game);

      baselineHistory.set(
        game.player_id,
        previous
      );
    }

    const rdgSummary =
      summarize(testResults);

    const baselineSummary =
      summarize(
        baselineResults
      );

    const maeImprovement =
      rdgSummary.mae !== null &&
      baselineSummary.mae !== null
        ? round(
            baselineSummary.mae -
              rdgSummary.mae
          )
        : null;

    return NextResponse.json({
      success: true,

      version:
        "1.0-rdg-passing-yards-backtest",

      market:
        "NFL Passing Yards",

      model_status:
        "Historical Projection Backtest",

      methodology: {
        historical_seasons:
          TRAIN_SEASONS,

        held_out_season:
          TEST_SEASON,

        minimum_prior_games:
          3,

        leakage_control:
          "Every projection uses only player games occurring before the game being evaluated.",

        rdg_projection:
          "Blends prior-season history, current-season performance, recent form and a capped passing-attempt adjustment.",

        baseline:
          "Average passing yards from up to the player's previous 17 qualifying games.",

        important:
          "This backtest measures passing-yard projection accuracy. It does not test sportsbook prop lines, odds, betting ROI or profitability.",
      },

      data: {
        total_player_games:
          allGames.length,

        seasons_loaded:
          seasons,

        qualifying_test_games:
          testResults.length,
      },

      rdg_model:
        rdgSummary,

      simple_baseline:
        baselineSummary,

      comparison: {
        mae_improvement_yards:
          maeImprovement,

        rdg_better_mae:
          rdgSummary.mae !== null &&
          baselineSummary.mae !== null
            ? rdgSummary.mae <
              baselineSummary.mae
            : null,
      },

      error_distribution:
        errorBuckets(
          testResults
        ),

      by_prior_sample:
        sampleBreakdown(
          testResults
        ),

      by_week:
        weekBreakdown(
          testResults
        ),

      sample_results:
        testResults
          .slice()
          .sort(
            (a, b) =>
              b.absolute_error -
              a.absolute_error
          )
          .slice(0, 20)
          .map((result) => ({
            season:
              result.season,

            week:
              result.week,

            player:
              result.player_name,

            projection:
              round(
                result.projection,
                1
              ),

            actual:
              result.actual,

            error:
              round(
                result.error,
                1
              ),

            absolute_error:
              round(
                result.absolute_error,
                1
              ),

            prior_games:
              result.prior_games,
          })),

      updated_at:
        new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL passing backtest error",
      },
      { status: 500 }
    );
  }
}
