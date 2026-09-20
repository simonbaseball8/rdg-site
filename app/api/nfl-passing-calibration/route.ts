import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HISTORY_SEASONS = [2023, 2024];
const CALIBRATION_SEASON = 2025;

type Row = Record<string, string>;

type Game = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  attempts: number;
  yards: number;
};

type ProjectionResult = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  projection: number;
  actual: number;
  residual: number;
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
    (item) =>
      Number.isFinite(item.value) &&
      Number.isFinite(item.weight) &&
      item.weight > 0
  );

  if (!valid.length) return null;

  const totalWeight = valid.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, item) => sum + item.value * item.weight,
      0
    ) / totalWeight
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

      player_id:
        row.player_id ?? "",

      player_name:
        row.player_display_name ||
        row.player_name ||
        "",

      attempts:
        num(row.attempts),

      yards:
        num(row.passing_yards),
    }));
}

function yardsPerAttempt(game: Game): number {
  if (game.attempts <= 0) return 0;

  return game.yards / game.attempts;
}

function recencyWeighted(
  games: Game[],
  selector: (game: Game) => number,
  maxGames = 8
): number | null {
  const selected =
    games.slice(-maxGames);

  if (!selected.length) return null;

  return weightedAverage(
    selected.map((game, index) => ({
      value: selector(game),
      weight: index + 1,
    }))
  );
}

/*
  EXACT FROZEN V2 MODEL

  Keep this identical to the live V2 logic.
*/
function projectV2(
  history: Game[]
): number | null {
  if (history.length < 3) {
    return null;
  }

  const latestSeason =
    history[history.length - 1].season;

  const current =
    history.filter(
      (game) =>
        game.season === latestSeason
    );

  const prior =
    history
      .filter(
        (game) =>
          game.season < latestSeason
      )
      .slice(-17);

  const careerWindow =
    history.slice(-20);

  const priorAttempts =
    average(
      prior.map(
        (game) =>
          game.attempts
      )
    );

  const currentAttempts =
    average(
      current.map(
        (game) =>
          game.attempts
      )
    );

  const recentAttempts =
    recencyWeighted(
      careerWindow,
      (game) =>
        game.attempts
    );

  let currentWeight = 0;

  if (current.length === 1) {
    currentWeight = 0.15;
  } else if (current.length === 2) {
    currentWeight = 0.25;
  } else if (current.length === 3) {
    currentWeight = 0.35;
  } else if (current.length === 4) {
    currentWeight = 0.45;
  } else if (current.length >= 5) {
    currentWeight = 0.55;
  }

  let expectedAttempts: number | null;

  if (
    priorAttempts !== null &&
    currentAttempts !== null
  ) {
    expectedAttempts =
      priorAttempts *
        (1 - currentWeight) +
      currentAttempts *
        currentWeight;
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

  const priorYPA =
    average(
      prior.map(
        yardsPerAttempt
      )
    );

  const currentYPA =
    average(
      current.map(
        yardsPerAttempt
      )
    );

  const recentYPA =
    recencyWeighted(
      careerWindow,
      yardsPerAttempt
    );

  let efficiencyWeight = 0;

  if (current.length === 1) {
    efficiencyWeight = 0.1;
  } else if (current.length === 2) {
    efficiencyWeight = 0.18;
  } else if (current.length === 3) {
    efficiencyWeight = 0.25;
  } else if (current.length === 4) {
    efficiencyWeight = 0.32;
  } else if (current.length >= 5) {
    efficiencyWeight = 0.4;
  }

  let expectedYPA: number | null;

  if (
    priorYPA !== null &&
    currentYPA !== null
  ) {
    expectedYPA =
      priorYPA *
        (1 - efficiencyWeight) +
      currentYPA *
        efficiencyWeight;
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

  expectedAttempts =
    Math.min(
      45,
      Math.max(
        20,
        expectedAttempts
      )
    );

  expectedYPA =
    Math.min(
      9.5,
      Math.max(
        5,
        expectedYPA
      )
    );

  let projection =
    expectedAttempts *
    expectedYPA;

  if (history.length <= 5) {
    projection =
      projection * 0.65 +
      225 * 0.35;
  } else if (history.length <= 10) {
    projection =
      projection * 0.8 +
      225 * 0.2;
  }

  return projection;
}

function buildResiduals(
  games: Game[]
): ProjectionResult[] {
  const ordered =
    [...games].sort(
      (a, b) =>
        a.season - b.season ||
        a.week - b.week ||
        a.player_id.localeCompare(
          b.player_id
        )
    );

  const history =
    new Map<string, Game[]>();

  const results:
    ProjectionResult[] = [];

  for (const game of ordered) {
    if (!game.player_id) continue;

    const previous =
      history.get(
        game.player_id
      ) ?? [];

    if (
      game.season ===
        CALIBRATION_SEASON &&
      previous.length >= 3
    ) {
      const projection =
        projectV2(previous);

      if (projection !== null) {
        const residual =
          game.yards -
          projection;

        results.push({
          season:
            game.season,

          week:
            game.week,

          player_id:
            game.player_id,

          player_name:
            game.player_name,

          projection,

          actual:
            game.yards,

          residual,

          absolute_error:
            Math.abs(
              residual
            ),

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

function standardDeviation(
  values: number[]
): number | null {
  if (values.length < 2) {
    return null;
  }

  const mean =
    average(values);

  if (mean === null) {
    return null;
  }

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    (values.length - 1);

  return Math.sqrt(
    variance
  );
}

/*
  Empirical probability:

  Suppose RDG projects 20 yards ABOVE a line.

  For the OVER to win:

      actual > line

  Because:

      actual = projection + residual

  and:

      line = projection - difference

  OVER wins when:

      residual > -difference

  This lets us estimate probabilities directly from
  historical V2 residuals without assuming a normal
  distribution.
*/
function empiricalOverProbability(
  residuals: number[],
  projectionDifference: number
): number | null {
  if (!residuals.length) {
    return null;
  }

  const threshold =
    -projectionDifference;

  const wins =
    residuals.filter(
      (residual) =>
        residual > threshold
    ).length;

  return (
    wins /
    residuals.length
  );
}

function empiricalUnderProbability(
  residuals: number[],
  projectionDifference: number
): number | null {
  if (!residuals.length) {
    return null;
  }

  const threshold =
    -projectionDifference;

  const wins =
    residuals.filter(
      (residual) =>
        residual < threshold
    ).length;

  return (
    wins /
    residuals.length
  );
}

function probabilityTable(
  residuals: number[]
) {
  const differences = [
    -50,
    -40,
    -30,
    -25,
    -20,
    -15,
    -10,
    -5,
    0,
    5,
    10,
    15,
    20,
    25,
    30,
    40,
    50,
  ];

  return differences.map(
    (difference) => {
      const over =
        empiricalOverProbability(
          residuals,
          difference
        );

      const under =
        empiricalUnderProbability(
          residuals,
          difference
        );

      return {
        model_vs_line_yards:
          difference,

        over_probability:
          over !== null
            ? round(
                over * 100,
                1
              )
            : null,

        under_probability:
          under !== null
            ? round(
                under * 100,
                1
              )
            : null,
      };
    }
  );
}

function sampleBuckets(
  results: ProjectionResult[]
) {
  const groups = [
    {
      label:
        "3-5 prior games",
      min: 3,
      max: 5,
    },
    {
      label:
        "6-10 prior games",
      min: 6,
      max: 10,
    },
    {
      label:
        "11-17 prior games",
      min: 11,
      max: 17,
    },
    {
      label:
        "18+ prior games",
      min: 18,
      max: Infinity,
    },
  ];

  return groups.map(
    (group) => {
      const subset =
        results.filter(
          (result) =>
            result.prior_games >=
              group.min &&
            result.prior_games <=
              group.max
        );

      const residuals =
        subset.map(
          (result) =>
            result.residual
        );

      return {
        sample:
          group.label,

        games:
          subset.length,

        mean_error:
          residuals.length
            ? round(
                average(
                  residuals
                ) ?? 0
              )
            : null,

        residual_sd:
          residuals.length >= 2
            ? round(
                standardDeviation(
                  residuals
                ) ?? 0
              )
            : null,

        mae:
          subset.length
            ? round(
                subset.reduce(
                  (sum, result) =>
                    sum +
                    result.absolute_error,
                  0
                ) /
                  subset.length
              )
            : null,
      };
    }
  );
}

export async function GET() {
  try {
    const seasons = [
      ...HISTORY_SEASONS,
      CALIBRATION_SEASON,
    ];

    const seasonData =
      await Promise.all(
        seasons.map(
          fetchSeason
        )
      );

    const games =
      seasonData.flat();

    const results =
      buildResiduals(
        games
      );

    const residuals =
      results.map(
        (result) =>
          result.residual
      );

    const meanError =
      average(
        residuals
      );

    const residualSD =
      standardDeviation(
        residuals
      );

    const mae =
      results.length
        ? results.reduce(
            (sum, result) =>
              sum +
              result.absolute_error,
            0
          ) /
          results.length
        : null;

    const sortedResiduals =
      [...residuals].sort(
        (a, b) => a - b
      );

    function percentile(
      p: number
    ): number | null {
      if (
        !sortedResiduals.length
      ) {
        return null;
      }

      const index =
        (sortedResiduals.length -
          1) *
        p;

      const lower =
        Math.floor(index);

      const upper =
        Math.ceil(index);

      if (
        lower === upper
      ) {
        return sortedResiduals[
          lower
        ];
      }

      const weight =
        index - lower;

      return (
        sortedResiduals[
          lower
        ] *
          (1 - weight) +
        sortedResiduals[
          upper
        ] *
          weight
      );
    }

    return NextResponse.json({
      success: true,

      version:
        "1.0-rdg-passing-calibration",

      market:
        "NFL Passing Yards",

      model:
        "Frozen RDG V2",

      calibration_status:
        "Historical Residual Calibration",

      methodology: {
        history_seasons:
          HISTORY_SEASONS,

        calibration_season:
          CALIBRATION_SEASON,

        observations:
          results.length,

        leakage_control:
          "Every 2025 projection uses only player games completed before the game being evaluated.",

        probability_method:
          "Empirical distribution of out-of-sample V2 projection residuals.",

        residual_definition:
          "Actual passing yards minus RDG projected passing yards.",

        interpretation:
          "The table estimates how frequently an over or under would have cleared at hypothetical lines positioned a specified number of yards away from the RDG projection.",

        important:
          "Historical sportsbook prop lines are not included. These are residual-based model probabilities, not a historical sportsbook betting backtest or proof of profitability.",
      },

      residual_summary: {
        observations:
          results.length,

        mean_error:
          meanError !== null
            ? round(
                meanError
              )
            : null,

        mae:
          mae !== null
            ? round(mae)
            : null,

        residual_standard_deviation:
          residualSD !== null
            ? round(
                residualSD
              )
            : null,

        percentiles: {
          p10:
            percentile(0.1) !== null
              ? round(
                  percentile(
                    0.1
                  )!
                )
              : null,

          p25:
            percentile(0.25) !== null
              ? round(
                  percentile(
                    0.25
                  )!
                )
              : null,

          median:
            percentile(0.5) !== null
              ? round(
                  percentile(
                    0.5
                  )!
                )
              : null,

          p75:
            percentile(0.75) !== null
              ? round(
                  percentile(
                    0.75
                  )!
                )
              : null,

          p90:
            percentile(0.9) !== null
              ? round(
                  percentile(
                    0.9
                  )!
                )
              : null,
        },
      },

      probability_table:
        probabilityTable(
          residuals
        ),

      by_prior_sample:
        sampleBuckets(
          results
        ),

      note:
        "Positive model-vs-line means RDG projects more passing yards than the hypothetical line. Negative means RDG projects fewer.",

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
            : "Unknown NFL passing calibration error",
      },
      {
        status: 500,
      }
    );
  }
}
