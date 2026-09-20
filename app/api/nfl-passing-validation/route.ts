import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HISTORY_SEASONS = [2023, 2024, 2025];
const VALIDATION_SEASON = 2026;

type Row = Record<string, string>;

type PlayerGame = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  team: string;
  opponent: string;
  attempts: number;
  yards: number;
};

type TeamGame = {
  season: number;
  week: number;
  team: string;
  passing_yards_allowed: number;
  passing_attempts_allowed: number;
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
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
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

  const totalWeight = valid.reduce(
    (sum, x) => sum + x.weight,
    0
  );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, x) => sum + x.value * x.weight,
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
): Promise<PlayerGame[]> {
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

      opponent:
        row.opponent_team ||
        row.opponent ||
        "",

      attempts: num(row.attempts),
      yards: num(row.passing_yards),
    }));
}

function yardsPerAttempt(game: PlayerGame): number {
  if (game.attempts <= 0) return 0;
  return game.yards / game.attempts;
}

function recencyWeighted(
  games: PlayerGame[],
  selector: (game: PlayerGame) => number,
  maxGames = 8
): number | null {
  const selected = games.slice(-maxGames);

  if (!selected.length) return null;

  return weightedAverage(
    selected.map((game, index) => ({
      value: selector(game),
      weight: index + 1,
    }))
  );
}

function teamRecencyWeighted(
  games: TeamGame[],
  selector: (game: TeamGame) => number,
  maxGames = 8
): number | null {
  const selected = games.slice(-maxGames);

  if (!selected.length) return null;

  return weightedAverage(
    selected.map((game, index) => ({
      value: selector(game),
      weight: index + 1,
    }))
  );
}

/*
  FROZEN V2 MODEL
*/
function projectV2(
  history: PlayerGame[]
): number | null {
  if (history.length < 3) return null;

  const latestSeason =
    history[history.length - 1].season;

  const current = history.filter(
    (g) => g.season === latestSeason
  );

  const prior = history
    .filter((g) => g.season < latestSeason)
    .slice(-17);

  const careerWindow = history.slice(-20);

  const priorAttempts = average(
    prior.map((g) => g.attempts)
  );

  const currentAttempts = average(
    current.map((g) => g.attempts)
  );

  const recentAttempts = recencyWeighted(
    careerWindow,
    (g) => g.attempts
  );

  let currentWeight = 0;

  if (current.length === 1) currentWeight = 0.15;
  else if (current.length === 2) currentWeight = 0.25;
  else if (current.length === 3) currentWeight = 0.35;
  else if (current.length === 4) currentWeight = 0.45;
  else if (current.length >= 5) currentWeight = 0.55;

  let expectedAttempts: number | null;

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

  const priorYPA = average(
    prior.map(yardsPerAttempt)
  );

  const currentYPA = average(
    current.map(yardsPerAttempt)
  );

  const recentYPA = recencyWeighted(
    careerWindow,
    yardsPerAttempt
  );

  let efficiencyWeight = 0;

  if (current.length === 1) efficiencyWeight = 0.1;
  else if (current.length === 2) efficiencyWeight = 0.18;
  else if (current.length === 3) efficiencyWeight = 0.25;
  else if (current.length === 4) efficiencyWeight = 0.32;
  else if (current.length >= 5) efficiencyWeight = 0.4;

  let expectedYPA: number | null;

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

/*
  FROZEN V3 MODEL

  Starts with V2 and adds the exact same
  conservative recent-volume and opponent
  adjustments used in the 2025 backtest.
*/
function projectV3(
  playerHistory: PlayerGame[],
  defenseHistory: TeamGame[]
): number | null {
  const base =
    projectV2(playerHistory);

  if (base === null) return null;

  let projection = base;

  const longAttempts = average(
    playerHistory
      .slice(-12)
      .map((g) => g.attempts)
  );

  const recentAttempts = average(
    playerHistory
      .slice(-3)
      .map((g) => g.attempts)
  );

  if (
    longAttempts !== null &&
    recentAttempts !== null &&
    longAttempts >= 20
  ) {
    const ratio =
      recentAttempts /
      longAttempts;

    const capped = Math.min(
      1.12,
      Math.max(0.88, ratio)
    );

    projection *=
      1 +
      (capped - 1) * 0.25;
  }

  if (defenseHistory.length >= 3) {
    const defenseYards =
      teamRecencyWeighted(
        defenseHistory,
        (g) =>
          g.passing_yards_allowed,
        8
      );

    const defenseAttempts =
      teamRecencyWeighted(
        defenseHistory,
        (g) =>
          g.passing_attempts_allowed,
        8
      );

    if (defenseYards !== null) {
      const ratio =
        defenseYards / 225;

      const capped = Math.min(
        1.12,
        Math.max(0.88, ratio)
      );

      projection *=
        1 +
        (capped - 1) * 0.2;
    }

    if (
      defenseAttempts !== null
    ) {
      const ratio =
        defenseAttempts / 33;

      const capped = Math.min(
        1.1,
        Math.max(0.9, ratio)
      );

      projection *=
        1 +
        (capped - 1) * 0.15;
    }
  }

  projection = Math.min(
    base + 30,
    Math.max(
      base - 30,
      projection
    )
  );

  return projection;
}

function projectBaseline(
  history: PlayerGame[]
): number | null {
  if (history.length < 3) return null;

  return average(
    history
      .slice(-17)
      .map((g) => g.yards)
  );
}

function summarize(
  results: Result[]
) {
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
      (sum, r) =>
        sum + r.absolute_error,
      0
    ) / results.length;

  const mse =
    results.reduce(
      (sum, r) =>
        sum +
        r.error * r.error,
      0
    ) / results.length;

  const meanError =
    results.reduce(
      (sum, r) =>
        sum + r.error,
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

function makeResult(
  game: PlayerGame,
  projection: number,
  priorGames: number
): Result {
  const error =
    game.yards - projection;

  return {
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
      priorGames,
  };
}

function runValidation(
  games: PlayerGame[]
) {
  const ordered =
    [...games].sort(
      (a, b) =>
        a.season - b.season ||
        a.week - b.week ||
        a.player_id.localeCompare(
          b.player_id
        )
    );

  const playerHistory =
    new Map<
      string,
      PlayerGame[]
    >();

  const defenseHistory =
    new Map<
      string,
      TeamGame[]
    >();

  const v3: Result[] = [];
  const v2: Result[] = [];
  const baseline: Result[] = [];

  for (const game of ordered) {
    const previous =
      playerHistory.get(
        game.player_id
      ) ?? [];

    const defensePrevious =
      game.opponent
        ? defenseHistory.get(
            game.opponent
          ) ?? []
        : [];

    if (
      game.season ===
        VALIDATION_SEASON &&
      previous.length >= 3
    ) {
      const v3Projection =
        projectV3(
          previous,
          defensePrevious
        );

      const v2Projection =
        projectV2(previous);

      const baselineProjection =
        projectBaseline(previous);

      if (
        v3Projection !== null &&
        v2Projection !== null &&
        baselineProjection !== null
      ) {
        v3.push(
          makeResult(
            game,
            v3Projection,
            previous.length
          )
        );

        v2.push(
          makeResult(
            game,
            v2Projection,
            previous.length
          )
        );

        baseline.push(
          makeResult(
            game,
            baselineProjection,
            previous.length
          )
        );
      }
    }

    previous.push(game);

    playerHistory.set(
      game.player_id,
      previous
    );

    if (game.opponent) {
      const defensiveGame: TeamGame = {
        season:
          game.season,

        week:
          game.week,

        team:
          game.opponent,

        passing_yards_allowed:
          game.yards,

        passing_attempts_allowed:
          game.attempts,
      };

      const priorDefense =
        defenseHistory.get(
          game.opponent
        ) ?? [];

      priorDefense.push(
        defensiveGame
      );

      defenseHistory.set(
        game.opponent,
        priorDefense
      );
    }
  }

  return {
    v3,
    v2,
    baseline,
  };
}

function byWeek(
  results: Result[]
) {
  const weeks =
    Array.from(
      new Set(
        results.map(
          (r) => r.week
        )
      )
    ).sort(
      (a, b) => a - b
    );

  return weeks.map(
    (week) => ({
      week,
      ...summarize(
        results.filter(
          (r) =>
            r.week === week
        )
      ),
    })
  );
}

function bySample(
  results: Result[]
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
          (r) =>
            r.prior_games >=
              group.min &&
            r.prior_games <=
              group.max
        );

      return {
        sample:
          group.label,

        ...summarize(
          subset
        ),
      };
    }
  );
}

export async function GET() {
  try {
    const seasons = [
      ...HISTORY_SEASONS,
      VALIDATION_SEASON,
    ];

    const seasonData =
      await Promise.all(
        seasons.map(
          fetchSeason
        )
      );

    const games =
      seasonData.flat();

    const validation =
      runValidation(games);

    const v3Summary =
      summarize(
        validation.v3
      );

    const v2Summary =
      summarize(
        validation.v2
      );

    const baselineSummary =
      summarize(
        validation.baseline
      );

    const v3VsV2 =
      v3Summary.mae !== null &&
      v2Summary.mae !== null
        ? round(
            v2Summary.mae -
              v3Summary.mae
          )
        : null;

    const v3VsBaseline =
      v3Summary.mae !== null &&
      baselineSummary.mae !== null
        ? round(
            baselineSummary.mae -
              v3Summary.mae
          )
        : null;

    return NextResponse.json({
      success: true,

      version:
        "1.0-rdg-passing-2026-validation",

      market:
        "NFL Passing Yards",

      model_status:
        "Frozen Out-of-Sample 2026 Validation",

      methodology: {
        historical_seasons:
          HISTORY_SEASONS,

        validation_season:
          VALIDATION_SEASON,

        minimum_prior_games:
          3,

        frozen_model:
          "V2 and V3 formulas are unchanged from the 2025 development backtests.",

        leakage_control:
          "Every 2026 projection uses only games completed before the evaluated game.",

        important:
          "2026 is being used as a validation sample, not to tune model weights. This measures yardage projection accuracy, not sportsbook betting performance.",
      },

      validation: {
        games:
          validation.v3.length,

        rdg_v3:
          v3Summary,

        rdg_v2:
          v2Summary,

        simple_baseline:
          baselineSummary,

        comparison: {
          v3_mae_improvement_vs_v2_yards:
            v3VsV2,

          v3_mae_improvement_vs_baseline_yards:
            v3VsBaseline,

          v3_beats_v2:
            v3Summary.mae !==
              null &&
            v2Summary.mae !==
              null
              ? v3Summary.mae <
                v2Summary.mae
              : null,

          v3_beats_baseline:
            v3Summary.mae !==
              null &&
            baselineSummary.mae !==
              null
              ? v3Summary.mae <
                baselineSummary.mae
              : null,
        },
      },

      v3_by_week:
        byWeek(
          validation.v3
        ),

      v3_by_prior_sample:
        bySample(
          validation.v3
        ),

      individual_results:
        validation.v3.map(
          (r) => ({
            week:
              r.week,

            player:
              r.player_name,

            projection:
              round(
                r.projection,
                1
              ),

            actual:
              r.actual,

            error:
              round(
                r.error,
                1
              ),

            absolute_error:
              round(
                r.absolute_error,
                1
              ),

            prior_games:
              r.prior_games,
          })
        ),

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
            : "Unknown 2026 validation error",
      },
      {
        status: 500,
      }
    );
  }
}
