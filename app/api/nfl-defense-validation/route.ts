import { NextResponse } from "next/server";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as readline from "node:readline";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/*
  RDG NFL DEFENSE VALIDATION V1.0

  GOAL
  ----------------------------------------------------
  Secondary validation of opponent pass-defense features.

  Previous backtest:
  - Fit defense coefficients on 2024
  - Tested on 2025
  - Pass YPG alone performed best:
      Baseline MAE: 59.07
      Defense YPG MAE: 58.36
      Improvement: 0.71 yards

  THIS ROUTE:
  - Keeps the 2024 coefficient FROZEN.
  - Does NOT refit using 2025 or 2026.
  - Tests the frozen adjustment on 2026.
  - Uses only defensive games completed BEFORE each week.
  - Does NOT modify the live RDG model.
*/

const VALIDATION_SEASON = 2026;

/*
  Frozen from the 2024 training backtest.
*/

const FROZEN_YPG_COEFFICIENT = 0.1693;
const FROZEN_YPA_COEFFICIENT = -2.7812;

const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

type RowIndexes = {
  game_id: number;
  week: number;
  season_type: number;
  posteam: number;
  defteam: number;
  passer_player_id: number;
  passer_player_name: number;
  pass_attempt: number;
  passing_yards: number;
  sack: number;
  yards_gained: number;
};

type QBGame = {
  season: number;
  week: number;
  gameId: string;

  playerId: string;
  playerName: string;

  team: string;
  opponent: string;

  attempts: number;
  passingYards: number;
};

type QBHistory = {
  games: number;

  attempts: number;
  passingYards: number;

  recentAttempts: number[];
  recentYPA: number[];
};

type DefenseHistory = {
  games: number;

  passAttempts: number;
  passYards: number;
};

type Prediction = {
  week: number;

  player: string;
  team: string;
  opponent: string;

  actual: number;

  baseline: number;

  defenseYPG: number | null;
  leagueYPG: number | null;

  defenseYPA: number | null;
  leagueYPA: number | null;

  ypgDifference: number;
  ypaDifference: number;

  ypgAdjustment: number;
  combinedAdjustment: number;

  ypgProjection: number;
  combinedProjection: number;
};

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

function txt(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}

function mean(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length
  );
}

function round(
  value: number | null,
  digits = 2
): number | null {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const multiplier =
    10 ** digits;

  return (
    Math.round(
      value * multiplier
    ) / multiplier
  );
}

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}

function normalizeTeam(
  value: unknown
) {
  const team =
    txt(value).toUpperCase();

  const aliases: Record<
    string,
    string
  > = {
    JAC: "JAX",

    SD: "LAC",
    SDG: "LAC",

    OAK: "LV",
    RAI: "LV",

    STL: "LA",
    LAR: "LA",
    RAM: "LA",

    KAN: "KC",
    CLT: "IND",
    CRD: "ARI",
  };

  return aliases[team] ?? team;
}

/* -------------------------------------------------- */
/* CSV                                                */
/* -------------------------------------------------- */

function parseCSVLine(
  line: string
): string[] {
  const values: string[] = [];

  let value = "";
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char =
      line[i];

    if (char === '"') {
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (
      char === "," &&
      !quoted
    ) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);

  return values;
}

/* -------------------------------------------------- */
/* LOAD PBP                                           */
/* -------------------------------------------------- */

async function loadSeason(
  season: number
) {
  const response =
    await fetch(
      PBP_URL(season),
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Unable to download ${season} PBP: ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error(
      `${season} PBP returned no body.`
    );
  }

  const nodeStream =
    Readable.fromWeb(
      response.body as any
    );

  const gunzip =
    createGunzip();

  nodeStream.pipe(
    gunzip
  );

  const reader =
    readline.createInterface({
      input: gunzip,
      crlfDelay: Infinity,
    });

  let headers: string[] = [];

  let indexes:
    | RowIndexes
    | null = null;

  let firstLine = true;

  let rowsRead = 0;
  let passRows = 0;

  const qbGames =
    new Map<
      string,
      QBGame
    >();

  function indexOf(
    name: string
  ) {
    return headers.indexOf(
      name
    );
  }

  function value(
    row: string[],
    index: number
  ) {
    if (index < 0) {
      return "";
    }

    return row[index] ?? "";
  }

  for await (
    const rawLine of reader
  ) {
    const line =
      String(rawLine);

    if (firstLine) {
      firstLine = false;

      headers =
        parseCSVLine(
          line
        ).map(
          (header) =>
            header
              .replace(
                /^\uFEFF/,
                ""
              )
              .trim()
        );

      indexes = {
        game_id:
          indexOf(
            "game_id"
          ),

        week:
          indexOf(
            "week"
          ),

        season_type:
          indexOf(
            "season_type"
          ),

        posteam:
          indexOf(
            "posteam"
          ),

        defteam:
          indexOf(
            "defteam"
          ),

        passer_player_id:
          indexOf(
            "passer_player_id"
          ),

        passer_player_name:
          indexOf(
            "passer_player_name"
          ),

        pass_attempt:
          indexOf(
            "pass_attempt"
          ),

        passing_yards:
          indexOf(
            "passing_yards"
          ),

        sack:
          indexOf(
            "sack"
          ),

        yards_gained:
          indexOf(
            "yards_gained"
          ),
      };

      if (
        indexes.game_id < 0 ||
        indexes.week < 0 ||
        indexes.posteam < 0 ||
        indexes.defteam < 0 ||
        indexes.passer_player_id < 0 ||
        indexes.pass_attempt < 0
      ) {
        throw new Error(
          `${season} PBP missing required columns.`
        );
      }

      continue;
    }

    if (
      !indexes ||
      !line
    ) {
      continue;
    }

    rowsRead++;

    const row =
      parseCSVLine(
        line
      );

    const seasonType =
      txt(
        value(
          row,
          indexes.season_type
        )
      ).toUpperCase();

    if (
      seasonType &&
      seasonType !== "REG"
    ) {
      continue;
    }

    const passAttempt =
      num(
        value(
          row,
          indexes.pass_attempt
        )
      ) === 1;

    const sack =
      num(
        value(
          row,
          indexes.sack
        )
      ) === 1;

    if (
      !passAttempt ||
      sack
    ) {
      continue;
    }

    const gameId =
      txt(
        value(
          row,
          indexes.game_id
        )
      );

    const week =
      num(
        value(
          row,
          indexes.week
        )
      );

    const team =
      normalizeTeam(
        value(
          row,
          indexes.posteam
        )
      );

    const opponent =
      normalizeTeam(
        value(
          row,
          indexes.defteam
        )
      );

    const playerId =
      txt(
        value(
          row,
          indexes.passer_player_id
        )
      );

    const playerName =
      txt(
        value(
          row,
          indexes.passer_player_name
        )
      );

    if (
      !gameId ||
      !week ||
      !team ||
      !opponent ||
      !playerId
    ) {
      continue;
    }

    passRows++;

    const key =
      `${gameId}|${playerId}`;

    if (
      !qbGames.has(
        key
      )
    ) {
      qbGames.set(
        key,
        {
          season,
          week,
          gameId,

          playerId,

          playerName:
            playerName ||
            playerId,

          team,
          opponent,

          attempts: 0,
          passingYards: 0,
        }
      );
    }

    const game =
      qbGames.get(
        key
      )!;

    game.attempts++;

    const passingYards =
      num(
        value(
          row,
          indexes.passing_yards
        )
      );

    const yardsGained =
      num(
        value(
          row,
          indexes.yards_gained
        )
      );

    game.passingYards +=
      passingYards !== 0
        ? passingYards
        : yardsGained;
  }

  return {
    games:
      Array.from(
        qbGames.values()
      ),

    diagnostics: {
      season,

      rows_read:
        rowsRead,

      pass_rows:
        passRows,

      qb_game_rows:
        qbGames.size,

      columns:
        headers.length,
    },
  };
}

/* -------------------------------------------------- */
/* QB HISTORY                                         */
/* -------------------------------------------------- */

function emptyQB():
  QBHistory {
  return {
    games: 0,

    attempts: 0,
    passingYards: 0,

    recentAttempts: [],
    recentYPA: [],
  };
}

function averageLast(
  values: number[],
  count: number
) {
  if (!values.length) {
    return null;
  }

  return mean(
    values.slice(
      -count
    )
  );
}

/* -------------------------------------------------- */
/* DEFENSE HISTORY                                    */
/* -------------------------------------------------- */

function emptyDefense():
  DefenseHistory {
  return {
    games: 0,

    passAttempts: 0,
    passYards: 0,
  };
}

function defenseMetrics(
  defense:
    | DefenseHistory
    | undefined
) {
  if (
    !defense ||
    defense.games <= 0
  ) {
    return null;
  }

  return {
    games:
      defense.games,

    passYPG:
      defense.passYards /
      defense.games,

    passYPA:
      defense.passAttempts > 0
        ? defense.passYards /
          defense.passAttempts
        : null,
  };
}

/* -------------------------------------------------- */
/* FROZEN PASSING BASELINE                            */
/* -------------------------------------------------- */

function baselineProjection(
  history: QBHistory
) {
  if (
    history.games < 3 ||
    history.attempts <= 0
  ) {
    return null;
  }

  const attemptsPerGame =
    history.attempts /
    history.games;

  const historicalYPA =
    history.passingYards /
    history.attempts;

  const recentAttempts =
    averageLast(
      history.recentAttempts,
      4
    );

  const recentYPA =
    averageLast(
      history.recentYPA,
      4
    );

  const expectedAttempts =
    recentAttempts !== null
      ? attemptsPerGame *
          0.65 +
        recentAttempts *
          0.35
      : attemptsPerGame;

  let expectedYPA =
    recentYPA !== null
      ? historicalYPA *
          0.8 +
        recentYPA *
          0.2
      : historicalYPA;

  const sampleWeight =
    history.games /
    (history.games + 4);

  expectedYPA =
    expectedYPA *
      sampleWeight +
    7.0 *
      (1 - sampleWeight);

  let projection =
    expectedAttempts *
    expectedYPA;

  const overallWeight =
    history.games /
    (history.games + 3);

  projection =
    projection *
      overallWeight +
    225 *
      (1 - overallWeight);

  return clamp(
    projection,
    80,
    450
  );
}

/* -------------------------------------------------- */
/* VALIDATION                                         */
/* -------------------------------------------------- */

function buildValidation(
  games: QBGame[]
) {
  const sorted =
    [...games].sort(
      (a, b) =>
        a.week -
          b.week ||
        a.gameId.localeCompare(
          b.gameId
        )
    );

  const byWeek =
    new Map<
      number,
      QBGame[]
    >();

  for (const game of sorted) {
    if (
      !byWeek.has(
        game.week
      )
    ) {
      byWeek.set(
        game.week,
        []
      );
    }

    byWeek.get(
      game.week
    )!.push(game);
  }

  const qbHistory =
    new Map<
      string,
      QBHistory
    >();

  const defenseHistory =
    new Map<
      string,
      DefenseHistory
    >();

  const leagueDefense =
    emptyDefense();

  const predictions:
    Prediction[] = [];

  const weeks =
    Array.from(
      byWeek.keys()
    ).sort(
      (a, b) =>
        a - b
    );

  for (const week of weeks) {
    const weekGames =
      byWeek.get(
        week
      )!;

    /*
      PREDICT BEFORE UPDATING WEEK
    */

    for (const game of weekGames) {
      if (
        game.attempts < 10
      ) {
        continue;
      }

      const qb =
        qbHistory.get(
          game.playerId
        );

      if (
        !qb ||
        qb.games < 3
      ) {
        continue;
      }

      const baseline =
        baselineProjection(
          qb
        );

      if (baseline === null) {
        continue;
      }

      const defense =
        defenseMetrics(
          defenseHistory.get(
            game.opponent
          )
        );

      const league =
        defenseMetrics(
          leagueDefense
        );

      let ypgDifference = 0;
      let ypaDifference = 0;

      /*
        Require 3 previous defensive games.
      */

      if (
        defense &&
        defense.games >= 3 &&
        league
      ) {
        if (
          defense.passYPG !== null &&
          league.passYPG !== null
        ) {
          ypgDifference =
            defense.passYPG -
            league.passYPG;
        }

        if (
          defense.passYPA !== null &&
          league.passYPA !== null
        ) {
          ypaDifference =
            defense.passYPA -
            league.passYPA;
        }
      }

      const ypgAdjustment =
        ypgDifference *
        FROZEN_YPG_COEFFICIENT;

      const ypaAdjustment =
        ypaDifference *
        FROZEN_YPA_COEFFICIENT;

      const combinedAdjustment =
        ypgAdjustment +
        ypaAdjustment;

      predictions.push({
        week,

        player:
          game.playerName,

        team:
          game.team,

        opponent:
          game.opponent,

        actual:
          game.passingYards,

        baseline,

        defenseYPG:
          defense?.passYPG ??
          null,

        leagueYPG:
          league?.passYPG ??
          null,

        defenseYPA:
          defense?.passYPA ??
          null,

        leagueYPA:
          league?.passYPA ??
          null,

        ypgDifference,

        ypaDifference,

        ypgAdjustment,

        combinedAdjustment,

        ypgProjection:
          clamp(
            baseline +
              ypgAdjustment,
            80,
            450
          ),

        combinedProjection:
          clamp(
            baseline +
              combinedAdjustment,
            80,
            450
          ),
      });
    }

    /*
      UPDATE QB HISTORY AFTER WEEK
    */

    for (const game of weekGames) {
      if (
        game.attempts <= 0
      ) {
        continue;
      }

      if (
        !qbHistory.has(
          game.playerId
        )
      ) {
        qbHistory.set(
          game.playerId,
          emptyQB()
        );
      }

      const qb =
        qbHistory.get(
          game.playerId
        )!;

      qb.games++;

      qb.attempts +=
        game.attempts;

      qb.passingYards +=
        game.passingYards;

      qb.recentAttempts.push(
        game.attempts
      );

      qb.recentYPA.push(
        game.passingYards /
          game.attempts
      );

      if (
        qb.recentAttempts.length >
        8
      ) {
        qb.recentAttempts.shift();
      }

      if (
        qb.recentYPA.length >
        8
      ) {
        qb.recentYPA.shift();
      }
    }

    /*
      UPDATE DEFENSE AFTER WEEK
    */

    const defenseGames =
      new Map<
        string,
        {
          defense: string;
          attempts: number;
          yards: number;
        }
      >();

    for (const game of weekGames) {
      if (
        game.attempts <= 0
      ) {
        continue;
      }

      const key =
        `${game.gameId}|${game.opponent}`;

      if (
        !defenseGames.has(
          key
        )
      ) {
        defenseGames.set(
          key,
          {
            defense:
              game.opponent,

            attempts: 0,
            yards: 0,
          }
        );
      }

      const aggregate =
        defenseGames.get(
          key
        )!;

      aggregate.attempts +=
        game.attempts;

      aggregate.yards +=
        game.passingYards;
    }

    for (
      const aggregate of
      defenseGames.values()
    ) {
      if (
        !defenseHistory.has(
          aggregate.defense
        )
      ) {
        defenseHistory.set(
          aggregate.defense,
          emptyDefense()
        );
      }

      const defense =
        defenseHistory.get(
          aggregate.defense
        )!;

      defense.games++;

      defense.passAttempts +=
        aggregate.attempts;

      defense.passYards +=
        aggregate.yards;

      leagueDefense.games++;

      leagueDefense.passAttempts +=
        aggregate.attempts;

      leagueDefense.passYards +=
        aggregate.yards;
    }
  }

  return predictions;
}

/* -------------------------------------------------- */
/* SCORING                                            */
/* -------------------------------------------------- */

function score(
  predictions: Prediction[],
  field:
    | "baseline"
    | "ypgProjection"
    | "combinedProjection"
) {
  if (!predictions.length) {
    return {
      observations: 0,
      mae: null,
      rmse: null,
      mean_error: null,
    };
  }

  let absoluteError = 0;
  let squaredError = 0;
  let error = 0;

  for (
    const prediction of
    predictions
  ) {
    const projected =
      prediction[field];

    const difference =
      projected -
      prediction.actual;

    absoluteError +=
      Math.abs(
        difference
      );

    squaredError +=
      difference *
      difference;

    error +=
      difference;
  }

  return {
    observations:
      predictions.length,

    mae:
      round(
        absoluteError /
          predictions.length
      ),

    rmse:
      round(
        Math.sqrt(
          squaredError /
            predictions.length
        )
      ),

    mean_error:
      round(
        error /
          predictions.length
      ),
  };
}

/* -------------------------------------------------- */
/* WEEK BREAKDOWN                                     */
/* -------------------------------------------------- */

function weekBreakdown(
  predictions: Prediction[]
) {
  const grouped =
    new Map<
      number,
      Prediction[]
    >();

  for (
    const prediction of
    predictions
  ) {
    if (
      !grouped.has(
        prediction.week
      )
    ) {
      grouped.set(
        prediction.week,
        []
      );
    }

    grouped.get(
      prediction.week
    )!.push(
      prediction
    );
  }

  return Array.from(
    grouped.entries()
  )
    .sort(
      (a, b) =>
        a[0] - b[0]
    )
    .map(
      ([week, rows]) => {
        const baseline =
          score(
            rows,
            "baseline"
          );

        const ypg =
          score(
            rows,
            "ypgProjection"
          );

        return {
          week,

          observations:
            rows.length,

          baseline_mae:
            baseline.mae,

          defense_ypg_mae:
            ypg.mae,

          improvement_yards:
            baseline.mae !== null &&
            ypg.mae !== null
              ? round(
                  baseline.mae -
                    ypg.mae
                )
              : null,
        };
      }
    );
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    const data =
      await loadSeason(
        VALIDATION_SEASON
      );

    const predictions =
      buildValidation(
        data.games
      );

    const baseline =
      score(
        predictions,
        "baseline"
      );

    const ypg =
      score(
        predictions,
        "ypgProjection"
      );

    const combined =
      score(
        predictions,
        "combinedProjection"
      );

    const ypgImprovement =
      baseline.mae !== null &&
      ypg.mae !== null
        ? baseline.mae -
          ypg.mae
        : 0;

    const ypgImprovementPct =
      baseline.mae &&
      baseline.mae > 0
        ? (
            ypgImprovement /
            baseline.mae
          ) * 100
        : 0;

    const combinedImprovement =
      baseline.mae !== null &&
      combined.mae !== null
        ? baseline.mae -
          combined.mae
        : 0;

    /*
      We are stricter here because 2026
      is the secondary confirmation test.

      We want:
      - positive MAE improvement
      - no material RMSE deterioration
      - reasonable sample
    */

    const ypgValidated =
      predictions.length >= 40 &&
      ypgImprovement > 0 &&
      (
        ypg.rmse === null ||
        baseline.rmse === null ||
        ypg.rmse <=
          baseline.rmse + 0.25
      );

    return NextResponse.json({
      success: true,

      version:
        "1.0-defense-secondary-validation",

      purpose:
        "Validate the frozen 2024 opponent pass-defense coefficients on 2026 data without refitting.",

      validation_season:
        VALIDATION_SEASON,

      frozen_coefficients: {
        pass_yards_per_game:
          FROZEN_YPG_COEFFICIENT,

        pass_ypa:
          FROZEN_YPA_COEFFICIENT,

        fitted_on:
          2024,

        changed_using_2025:
          false,

        changed_using_2026:
          false,
      },

      leakage_protection: {
        chronological:
          true,

        same_week_updates:
          false,

        defense_requires_prior_games:
          3,

        future_defensive_data_used:
          false,

        full_season_defense_used_for_earlier_games:
          false,
      },

      diagnostics: {
        ...data.diagnostics,

        validation_predictions:
          predictions.length,
      },

      validation_results: {
        baseline,

        defense_ypg_only:
          ypg,

        defense_ypa_plus_ypg:
          combined,

        ypg_mae_improvement_yards:
          round(
            ypgImprovement
          ),

        ypg_mae_improvement_pct:
          round(
            ypgImprovementPct
          ),

        combined_mae_improvement_yards:
          round(
            combinedImprovement
          ),
      },

      week_breakdown:
        weekBreakdown(
          predictions
        ),

      decision: {
        defense_ypg_validated:
          ypgValidated,

        live_model_changed:
          false,

        passing_v2_remains_frozen:
          true,

        message:
          ypgValidated
            ? "The frozen pass-yards-allowed-per-game adjustment also improved the 2026 validation sample. This supports testing a conservative defense-adjusted Passing V2. Do not activate it live until the implementation is compared directly with the existing live V2 route."
            : "The frozen pass-yards-allowed-per-game adjustment did not confirm strongly enough in 2026. Keep defense out of the live Passing V2 model.",
      },

      sample_predictions:
        predictions
          .slice(-12)
          .map(
            (row) => ({
              week:
                row.week,

              player:
                row.player,

              team:
                row.team,

              opponent:
                row.opponent,

              actual:
                row.actual,

              baseline:
                round(
                  row.baseline,
                  1
                ),

              opponent_pass_ypg:
                round(
                  row.defenseYPG,
                  1
                ),

              league_pass_ypg:
                round(
                  row.leagueYPG,
                  1
                ),

              ypg_adjustment:
                round(
                  row.ypgAdjustment,
                  1
                ),

              defense_ypg_projection:
                round(
                  row.ypgProjection,
                  1
                ),
            })
          ),

      next_step:
        ypgValidated
          ? "Build a conservative defense-aware Passing V2 candidate and compare it side-by-side with the current live Passing V2 before activation."
          : "Keep current Passing V2 unchanged and do not activate the defense adjustment.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense validation error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.0-defense-secondary-validation",

        error:
          error?.message ||
          "Unable to run defense secondary validation.",
      },
      {
        status: 500,
      }
    );
  }
}
