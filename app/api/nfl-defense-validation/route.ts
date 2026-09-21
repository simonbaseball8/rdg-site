import { NextResponse } from "next/server";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as readline from "node:readline";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/*
  RDG NFL DEFENSE VALIDATION V1.1

  PURPOSE
  --------------------------------------------------
  Validate the frozen defense adjustment on 2026.

  IMPORTANT:
  - 2025 is PRIOR HISTORY ONLY.
  - 2025 is NOT scored.
  - 2026 is the validation sample.
  - 2026 games are processed chronologically.
  - Each 2026 prediction uses only information
    available BEFORE that week's games.
  - Defense coefficient remains frozen from 2024.
  - Live Passing V2 is NOT changed.
*/

const PRIOR_SEASON = 2025;
const VALIDATION_SEASON = 2026;

/*
  Frozen coefficients learned from 2024.
*/

const FROZEN_YPG_COEFFICIENT = 0.1693;
const FROZEN_YPA_COEFFICIENT = -2.7812;

const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

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

  opponentPassYPG: number | null;
  leaguePassYPG: number | null;

  opponentPassYPA: number | null;
  leaguePassYPA: number | null;

  ypgDifference: number;
  ypaDifference: number;

  ypgAdjustment: number;
  ypaAdjustment: number;

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
  return Number.isFinite(n) ? n : 0;
}

function mean(values: number[]) {
  if (!values.length) return 0;

  return (
    values.reduce(
      (sum, value) => sum + value,
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

  const multiplier = 10 ** digits;

  return (
    Math.round(value * multiplier) /
    multiplier
  );
}

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function normalizeTeam(value: unknown) {
  const team = txt(value).toUpperCase();

  const aliases: Record<string, string> = {
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

function parseCSVLine(line: string): string[] {
  const values: string[] = [];

  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

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
/* LOAD SEASON                                        */
/* -------------------------------------------------- */

async function loadSeason(season: number) {
  const response = await fetch(
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

  const nodeStream = Readable.fromWeb(
    response.body as any
  );

  const gunzip = createGunzip();

  nodeStream.pipe(gunzip);

  const reader = readline.createInterface({
    input: gunzip,
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let firstLine = true;

  let rowsRead = 0;
  let passRows = 0;

  let gameIdIndex = -1;
  let weekIndex = -1;
  let seasonTypeIndex = -1;

  let offenseIndex = -1;
  let defenseIndex = -1;

  let passerIdIndex = -1;
  let passerNameIndex = -1;

  let passAttemptIndex = -1;
  let passingYardsIndex = -1;
  let sackIndex = -1;
  let yardsGainedIndex = -1;

  const qbGames =
    new Map<string, QBGame>();

  function value(
    row: string[],
    index: number
  ) {
    if (index < 0) return "";
    return row[index] ?? "";
  }

  for await (const rawLine of reader) {
    const line = String(rawLine);

    if (firstLine) {
      firstLine = false;

      headers = parseCSVLine(line).map(
        (header) =>
          header
            .replace(/^\uFEFF/, "")
            .trim()
      );

      gameIdIndex =
        headers.indexOf("game_id");

      weekIndex =
        headers.indexOf("week");

      seasonTypeIndex =
        headers.indexOf("season_type");

      offenseIndex =
        headers.indexOf("posteam");

      defenseIndex =
        headers.indexOf("defteam");

      passerIdIndex =
        headers.indexOf(
          "passer_player_id"
        );

      passerNameIndex =
        headers.indexOf(
          "passer_player_name"
        );

      passAttemptIndex =
        headers.indexOf(
          "pass_attempt"
        );

      passingYardsIndex =
        headers.indexOf(
          "passing_yards"
        );

      sackIndex =
        headers.indexOf("sack");

      yardsGainedIndex =
        headers.indexOf(
          "yards_gained"
        );

      if (
        gameIdIndex < 0 ||
        weekIndex < 0 ||
        offenseIndex < 0 ||
        defenseIndex < 0 ||
        passerIdIndex < 0 ||
        passAttemptIndex < 0
      ) {
        throw new Error(
          `${season} PBP missing required columns.`
        );
      }

      continue;
    }

    if (!line) continue;

    rowsRead++;

    const row = parseCSVLine(line);

    const seasonType =
      txt(
        value(
          row,
          seasonTypeIndex
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
          passAttemptIndex
        )
      ) === 1;

    const sack =
      num(
        value(
          row,
          sackIndex
        )
      ) === 1;

    /*
      Official passing attempts only.
      Sacks are excluded.
    */

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
          gameIdIndex
        )
      );

    const week =
      num(
        value(
          row,
          weekIndex
        )
      );

    const team =
      normalizeTeam(
        value(
          row,
          offenseIndex
        )
      );

    const opponent =
      normalizeTeam(
        value(
          row,
          defenseIndex
        )
      );

    const playerId =
      txt(
        value(
          row,
          passerIdIndex
        )
      );

    const playerName =
      txt(
        value(
          row,
          passerNameIndex
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

    if (!qbGames.has(key)) {
      qbGames.set(key, {
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
      });
    }

    const game =
      qbGames.get(key)!;

    game.attempts++;

    const passingYards =
      num(
        value(
          row,
          passingYardsIndex
        )
      );

    const yardsGained =
      num(
        value(
          row,
          yardsGainedIndex
        )
      );

    /*
      Do NOT use `a || b` here because
      a legitimate 0-yard pass is valid.

      If passing_yards column exists,
      use it directly.
    */

    if (passingYardsIndex >= 0) {
      game.passingYards +=
        passingYards;
    } else {
      game.passingYards +=
        yardsGained;
    }
  }

  return {
    games: Array.from(
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
/* HISTORY                                            */
/* -------------------------------------------------- */

function emptyQB(): QBHistory {
  return {
    games: 0,

    attempts: 0,
    passingYards: 0,

    recentAttempts: [],
    recentYPA: [],
  };
}

function emptyDefense(): DefenseHistory {
  return {
    games: 0,

    passAttempts: 0,
    passYards: 0,
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
    values.slice(-count)
  );
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
/* FROZEN BASELINE                                    */
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
/* UPDATE QB HISTORY                                  */
/* -------------------------------------------------- */

function updateQBHistory(
  qbHistory:
    Map<string, QBHistory>,
  games: QBGame[]
) {
  for (const game of games) {
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

    /*
      Keep enough recent history
      for rolling calculations.
    */

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
}

/* -------------------------------------------------- */
/* UPDATE DEFENSE HISTORY                             */
/* -------------------------------------------------- */

function updateDefenseHistory(
  defenseHistory:
    Map<string, DefenseHistory>,

  leagueDefense:
    DefenseHistory,

  games: QBGame[]
) {
  /*
    Multiple passers can appear for one offense.

    Aggregate them into one defensive game
    before increasing defense.games.
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

  for (const game of games) {
    if (
      game.attempts <= 0
    ) {
      continue;
    }

    const key =
      `${game.gameId}|${game.opponent}`;

    if (
      !defenseGames.has(key)
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
      defenseGames.get(key)!;

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

/* -------------------------------------------------- */
/* INITIALIZE WITH 2025                               */
/* -------------------------------------------------- */

function initializePriorHistory(
  priorGames: QBGame[]
) {
  const qbHistory =
    new Map<string, QBHistory>();

  const defenseHistory =
    new Map<
      string,
      DefenseHistory
    >();

  const leagueDefense =
    emptyDefense();

  /*
    Use the completed 2025 regular season
    only as prior history.

    No 2025 observations are scored here.
  */

  const sorted =
    [...priorGames].sort(
      (a, b) =>
        a.week - b.week ||
        a.gameId.localeCompare(
          b.gameId
        )
    );

  updateQBHistory(
    qbHistory,
    sorted
  );

  updateDefenseHistory(
    defenseHistory,
    leagueDefense,
    sorted
  );

  return {
    qbHistory,
    defenseHistory,
    leagueDefense,
  };
}

/* -------------------------------------------------- */
/* VALIDATE 2026                                      */
/* -------------------------------------------------- */

function validate2026(
  validationGames: QBGame[],
  qbHistory:
    Map<string, QBHistory>,
  defenseHistory:
    Map<string, DefenseHistory>,
  leagueDefense:
    DefenseHistory
) {
  const byWeek =
    new Map<
      number,
      QBGame[]
    >();

  for (
    const game of
    validationGames
  ) {
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

  const weeks =
    Array.from(
      byWeek.keys()
    ).sort(
      (a, b) => a - b
    );

  const predictions:
    Prediction[] = [];

  let skippedLowAttempts = 0;
  let skippedNoQBHistory = 0;
  let defenseAvailable = 0;

  for (const week of weeks) {
    const games =
      byWeek.get(week)!;

    /*
      PREDICT ENTIRE WEEK FIRST.

      Nothing from this week's games
      is added until predictions are complete.
    */

    for (const game of games) {
      if (
        game.attempts < 10
      ) {
        skippedLowAttempts++;
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
        skippedNoQBHistory++;
        continue;
      }

      const baseline =
        baselineProjection(qb);

      if (baseline === null) {
        skippedNoQBHistory++;
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
        Because 2025 was preloaded,
        established defenses should already
        have a meaningful sample.

        Still require at least 3 games.
      */

      if (
        defense &&
        defense.games >= 3 &&
        league
      ) {
        defenseAvailable++;

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

      const ypgProjection =
        clamp(
          baseline +
            ypgAdjustment,
          80,
          450
        );

      const combinedProjection =
        clamp(
          baseline +
            ypgAdjustment +
            ypaAdjustment,
          80,
          450
        );

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

        opponentPassYPG:
          defense?.passYPG ??
          null,

        leaguePassYPG:
          league?.passYPG ??
          null,

        opponentPassYPA:
          defense?.passYPA ??
          null,

        leaguePassYPA:
          league?.passYPA ??
          null,

        ypgDifference,

        ypaDifference,

        ypgAdjustment,

        ypaAdjustment,

        ypgProjection,

        combinedProjection,
      });
    }

    /*
      AFTER predictions:
      add this week's information.
    */

    updateQBHistory(
      qbHistory,
      games
    );

    updateDefenseHistory(
      defenseHistory,
      leagueDefense,
      games
    );
  }

  return {
    predictions,

    diagnostics: {
      skipped_low_attempts:
        skippedLowAttempts,

      skipped_no_prior_qb_history:
        skippedNoQBHistory,

      predictions_with_defense_history:
        defenseAvailable,
    },
  };
}

/* -------------------------------------------------- */
/* SCORE                                              */
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
  let totalError = 0;

  for (
    const prediction of
    predictions
  ) {
    const projected =
      prediction[field];

    const error =
      projected -
      prediction.actual;

    absoluteError +=
      Math.abs(error);

    squaredError +=
      error * error;

    totalError +=
      error;
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
        totalError /
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

        const improvement =
          baseline.mae !== null &&
          ypg.mae !== null
            ? baseline.mae -
              ypg.mae
            : null;

        return {
          week,

          observations:
            rows.length,

          baseline_mae:
            baseline.mae,

          defense_ypg_mae:
            ypg.mae,

          improvement_yards:
            improvement === null
              ? null
              : round(
                  improvement
                ),
        };
      }
    );
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    /*
      Sequential loading keeps memory lower.
    */

    const priorData =
      await loadSeason(
        PRIOR_SEASON
      );

    const validationData =
      await loadSeason(
        VALIDATION_SEASON
      );

    /*
      2025 establishes prior QB and
      defensive history.
    */

    const history =
      initializePriorHistory(
        priorData.games
      );

    const initialQBCount =
      history.qbHistory.size;

    const initialDefenseCount =
      history.defenseHistory.size;

    const validation =
      validate2026(
        validationData.games,
        history.qbHistory,
        history.defenseHistory,
        history.leagueDefense
      );

    const predictions =
      validation.predictions;

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
      baseline.mae !== null &&
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
      Secondary-validation rule.

      Because 2026 is still a small sample,
      this does NOT automatically activate
      anything live.

      It only determines whether the feature
      deserves integration testing.
    */

    const ypgValidated =
      predictions.length >= 25 &&
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
        "1.1-defense-secondary-validation-prior-history",

      purpose:
        "Validate frozen opponent pass-defense coefficients on 2026 after initializing quarterback and defense history with completed 2025 data.",

      seasons: {
        prior_history:
          PRIOR_SEASON,

        validation:
          VALIDATION_SEASON,

        coefficient_training:
          2024,
      },

      frozen_coefficients: {
        pass_yards_per_game:
          FROZEN_YPG_COEFFICIENT,

        pass_ypa:
          FROZEN_YPA_COEFFICIENT,

        refit_on_2025:
          false,

        refit_on_2026:
          false,
      },

      leakage_protection: {
        prior_2025_used_as_history:
          true,

        prior_2025_scored:
          false,

        validation_2026_scored:
          true,

        chronological_2026:
          true,

        same_week_updates:
          false,

        future_2026_data_used:
          false,

        coefficient_changed:
          false,
      },

      diagnostics: {
        prior_2025:
          priorData.diagnostics,

        validation_2026:
          validationData.diagnostics,

        initial_qbs_from_2025:
          initialQBCount,

        initial_defenses_from_2025:
          initialDefenseCount,

        validation_predictions:
          predictions.length,

        ...validation.diagnostics,
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
            ? "The frozen pass-yards-allowed-per-game defense adjustment improved the 2026 secondary validation sample. It is eligible for conservative live-model integration testing, but has not been activated."
            : "The frozen pass-yards-allowed-per-game adjustment did not improve the 2026 validation sample enough. Keep defense out of live Passing V2.",
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
                  row.opponentPassYPG,
                  1
                ),

              league_pass_ypg:
                round(
                  row.leaguePassYPG,
                  1
                ),

              ypg_difference:
                round(
                  row.ypgDifference,
                  1
                ),

              defense_adjustment:
                round(
                  row.ypgAdjustment,
                  1
                ),

              defense_projection:
                round(
                  row.ypgProjection,
                  1
                ),
            })
          ),

      next_step:
        ypgValidated
          ? "Build the defense-aware Passing V2 candidate and compare its live projections side-by-side with current frozen Passing V2 before activating it."
          : "Leave live Passing V2 unchanged and continue collecting 2026 data before reconsidering the defense adjustment.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense validation v1.1 error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.1-defense-secondary-validation-prior-history",

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
