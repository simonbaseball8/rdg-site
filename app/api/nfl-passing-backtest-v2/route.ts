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
  completions: number;
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

function weightedAverage(
  values: Array<{ value: number; weight: number }>
): number | null {
  const valid = values.filter(
    (x) =>
      Number.isFinite(x.value) &&
      Number.isFinite(x.weight) &&
      x.weight > 0
  );

  if (!valid.length) return null;

  const weight = valid.reduce(
    (sum, x) => sum + x.weight,
    0
  );

  if (!weight) return null;

  return (
    valid.reduce(
      (sum, x) => sum + x.value * x.weight,
      0
    ) / weight
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

async function fetchSeason(
  season: number
): Promise<Game[]> {
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
      completions: num(row.completions),
      yards: num(row.passing_yards),
    }))
    .sort(
      (a, b) =>
        a.week - b.week ||
        a.player_id.localeCompare(b.player_id)
    );
}

function yardsPerAttempt(game: Game): number {
  if (game.attempts <= 0) return 0;

  return game.yards / game.attempts;
}

/*
  Recency weighted average.

  Newer games receive more weight, but
  the weighting is intentionally mild.
*/
function recencyWeighted(
  games: Game[],
  selector: (game: Game) => number
): number | null {
  if (!games.length) return null;

  const selected = games.slice(-8);

  const values = selected.map((game, index) => ({
    value: selector(game),
    weight: index + 1,
  }));

  return weightedAverage(values);
}

/*
  V2 PROJECTION

  Passing yards are broken into:

      expected attempts
             ×
      expected yards per attempt

  This is preferable to simply predicting
  yards directly because passing volume and
  passing efficiency behave differently.
*/
function projectV2(history: Game[]): number | null {
  if (history.length < 3) {
    return null;
  }

  const latestSeason =
    history[history.length - 1].season;

  const currentSeasonGames = history.filter(
    (game) => game.season === latestSeason
  );

  const priorSeasonGames = history
    .filter(
      (game) => game.season < latestSeason
    )
    .slice(-17);

  const careerWindow = history.slice(-20);

  /*
    ATTEMPT PROJECTION
  */

  const priorAttempts = average(
    priorSeasonGames.map(
      (game) => game.attempts
    )
  );

  const currentAttempts = average(
    currentSeasonGames.map(
      (game) => game.attempts
    )
  );

  const recentAttempts = recencyWeighted(
    careerWindow,
    (game) => game.attempts
  );

  let currentWeight = 0;

  if (currentSeasonGames.length === 1) {
    currentWeight = 0.15;
  } else if (currentSeasonGames.length === 2) {
    currentWeight = 0.25;
  } else if (currentSeasonGames.length === 3) {
    currentWeight = 0.35;
  } else if (currentSeasonGames.length === 4) {
    currentWeight = 0.45;
  } else if (currentSeasonGames.length >= 5) {
    currentWeight = 0.55;
  }

  let expectedAttempts: number | null = null;

  if (
    priorAttempts !== null &&
    currentAttempts !== null
  ) {
    expectedAttempts =
      priorAttempts * (1 - currentWeight) +
      currentAttempts * currentWeight;
  } else {
    expectedAttempts =
      currentAttempts ??
      priorAttempts ??
      recentAttempts;
  }

  if (
    expectedAttempts !== null &&
    recentAttempts !== null
  ) {
    expectedAttempts =
      expectedAttempts * 0.8 +
      recentAttempts * 0.2;
  }

  /*
    YARDS PER ATTEMPT PROJECTION

    Efficiency is noisier than attempts,
    so current-season results receive even
    less early-season weight.
  */

  const priorYPA = average(
    priorSeasonGames.map(yardsPerAttempt)
  );

  const currentYPA = average(
    currentSeasonGames.map(yardsPerAttempt)
  );

  const recentYPA = recencyWeighted(
    careerWindow,
    yardsPerAttempt
  );

  let efficiencyWeight = 0;

  if (currentSeasonGames.length === 1) {
    efficiencyWeight = 0.1;
  } else if (currentSeasonGames.length === 2) {
    efficiencyWeight = 0.18;
  } else if (currentSeasonGames.length === 3) {
    efficiencyWeight = 0.25;
  } else if (currentSeasonGames.length === 4) {
    efficiencyWeight = 0.32;
  } else if (currentSeasonGames.length >= 5) {
    efficiencyWeight = 0.4;
  }

  let expectedYPA: number | null = null;

  if (
    priorYPA !== null &&
    currentYPA !== null
  ) {
    expectedYPA =
      priorYPA * (1 - efficiencyWeight) +
      currentYPA * efficiencyWeight;
  } else {
    expectedYPA =
      currentYPA ??
      priorYPA ??
      recentYPA;
  }

  if (
    expectedYPA !== null &&
    recentYPA !== null
  ) {
    expectedYPA =
      expectedYPA * 0.85 +
      recentYPA * 0.15;
  }

  if (
    expectedAttempts === null ||
    expectedYPA === null
  ) {
    return null;
  }

  /*
    Guardrails prevent a tiny sample from
    generating unrealistic volume/efficiency.
  */

  expectedAttempts = Math.min(
    45,
    Math.max(20, expectedAttempts)
  );

  expectedYPA = Math.min(
    9.5,
    Math.max(5, expectedYPA)
  );

  let projection =
    expectedAttempts * expectedYPA;

  /*
    Small-sample shrinkage.

    QBs with very little history are pulled
    toward a broad league-level passing
    baseline rather than trusting 3 games.
  */

  const LEAGUE_BASELINE = 225;

  if (history.length <= 5) {
    projection =
      projection * 0.65 +
      LEAGUE_BASELINE * 0.35;
  } else if (history.length <= 10) {
    projection =
      projection * 0.8 +
      LEAGUE_BASELINE * 0.2;
  }

  return projection;
}

function projectSimpleBaseline(
  history: Game[]
): number | null {
  if (history.length < 3) {
    return null;
  }

  return average(
    history
      .slice(-17)
      .map((game) => game.yards)
  );
}

function runBacktest(
  games: Game[],
  evaluateSeason: number,
  projector: (history: Game[]) => number | null
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
    if (!game.player_id) continue;

    const previous =
      history.get(game.player_id) ?? [];

    if (game.season === evaluateSeason) {
      const projection =
        projector(previous);

      if (projection !== null) {
        const error =
          game.yards - projection;

        results.push({
          season: game.season,
          week: game.week,

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

  const mae =
    results.reduce(
      (sum, result) =>
        sum +
        result.absolute_error,
      0
    ) / results.length;

  const mse =
    results.reduce(
      (sum, result) =>
        sum +
        result.error *
          result.error,
      0
    ) / results.length;

  const meanError =
    results.reduce(
      (sum, result) =>
        sum + result.error,
      0
    ) / results.length;

  return {
    games: results.length,

    mae: round(mae),

    rmse: round(
      Math.sqrt(mse)
    ),

    mean_error:
      round(meanError),
  };
}

function sampleBreakdown(
  results: Result[]
) {
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
      sample:
        group.label,

      ...summarize(subset),
    };
  });
}

function errorDistribution(
  results: Result[]
) {
  return [10, 20, 30, 40, 50].map(
    (yards) => {
      const count =
        results.filter(
          (result) =>
            result.absolute_error <=
            yards
        ).length;

      return {
        within_yards:
          yards,

        games:
          count,

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
    }
  );
}

function weekBreakdown(
  results: Result[]
) {
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
    const subset =
      results.filter(
        (result) =>
          result.week === week
      );

    return {
      week,
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
        seasons.map(
          fetchSeason
        )
      );

    const allGames =
      seasonData.flat();

    const v2Results =
      runBacktest(
        allGames,
        TEST_SEASON,
        projectV2
      );

    const baselineResults =
      runBacktest(
        allGames,
        TEST_SEASON,
        projectSimpleBaseline
      );

    /*
      Compare only matching games so the
      evaluation is strictly apples-to-apples.
    */

    const v2Keys =
      new Set(
        v2Results.map(
          (result) =>
            `${result.player_id}-${result.season}-${result.week}`
        )
      );

    const baselineMatched =
      baselineResults.filter(
        (result) =>
          v2Keys.has(
            `${result.player_id}-${result.season}-${result.week}`
          )
      );

    const baselineKeys =
      new Set(
        baselineMatched.map(
          (result) =>
            `${result.player_id}-${result.season}-${result.week}`
        )
      );

    const v2Matched =
      v2Results.filter(
        (result) =>
          baselineKeys.has(
            `${result.player_id}-${result.season}-${result.week}`
          )
      );

    const v2Summary =
      summarize(v2Matched);

    const baselineSummary =
      summarize(
        baselineMatched
      );

    const improvement =
      v2Summary.mae !== null &&
      baselineSummary.mae !== null
        ? round(
            baselineSummary.mae -
              v2Summary.mae
          )
        : null;

    const improvementPct =
      improvement !== null &&
      baselineSummary.mae !== null &&
      baselineSummary.mae > 0
        ? round(
            (improvement /
              baselineSummary.mae) *
              100,
            2
          )
        : null;

    return NextResponse.json({
      success: true,

      version:
        "2.0-rdg-passing-yards-backtest",

      market:
        "NFL Passing Yards",

      model_status:
        "Held-Out Historical Projection Backtest",

      methodology: {
        development_seasons:
          TRAIN_SEASONS,

        held_out_season:
          TEST_SEASON,

        minimum_prior_games:
          3,

        leakage_control:
          "Every 2025 projection uses only player games that occurred before the evaluated game.",

        v2_model:
          "Projects passing attempts and yards per attempt separately, uses mild recency weighting, prior-season shrinkage and small-sample regression toward a league baseline.",

        baseline:
          "Average passing yards over up to the previous 17 qualifying QB games.",

        important:
          "No sportsbook prop lines or odds are used. This evaluates yardage projection accuracy only, not betting accuracy, ROI or profitability.",
      },

      evaluation: {
        games:
          v2Matched.length,

        rdg_v2:
          v2Summary,

        simple_baseline:
          baselineSummary,

        comparison: {
          mae_improvement_yards:
            improvement,

          mae_improvement_percent:
            improvementPct,

          rdg_v2_better:
            v2Summary.mae !== null &&
            baselineSummary.mae !== null
              ? v2Summary.mae <
                baselineSummary.mae
              : null,
        },
      },

      v2_error_distribution:
        errorDistribution(
          v2Matched
        ),

      v2_by_prior_sample:
        sampleBreakdown(
          v2Matched
        ),

      v2_by_week:
        weekBreakdown(
          v2Matched
        ),

      largest_v2_misses:
        v2Matched
          .slice()
          .sort(
            (a, b) =>
              b.absolute_error -
              a.absolute_error
          )
          .slice(0, 15)
          .map((result) => ({
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
            : "Unknown NFL passing v2 backtest error",
      },
      { status: 500 }
    );
  }
}
