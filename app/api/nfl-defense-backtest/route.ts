import { NextResponse } from "next/server";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as readline from "node:readline";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/*
  RDG NFL DEFENSE BACKTEST V1.0

  PURPOSE:
  Test whether opponent pass-defense information improves
  quarterback passing-yard projections.

  IMPORTANT:
  - Defense is calculated chronologically.
  - A game's defensive metrics use ONLY games played BEFORE it.
  - No full-season defensive totals are used to predict earlier games.
  - This route does NOT change the live RDG model.
  - Passing V2 remains frozen.
*/

const TRAIN_SEASON = 2024;
const TEST_SEASON = 2025;

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
  interception: number;
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

type DefenseHistory = {
  games: number;

  passAttempts: number;
  passYards: number;

  sacks: number;
  interceptions: number;
};

type QBHistory = {
  games: number;

  attempts: number;
  passingYards: number;

  recentAttempts: number[];
  recentYPA: number[];
};

type EvaluationRow = {
  season: number;
  week: number;

  player: string;
  team: string;
  opponent: string;

  actual: number;

  baselineProjection: number;

  defensePassYPA: number | null;
  defensePassYardsPerGame: number | null;
  defenseSacksPerGame: number | null;

  defenseYPAAdjustment: number;
  defenseYPGAdjustment: number;
  defenseSackAdjustment: number;
  combinedAdjustment: number;

  ypaProjection: number;
  ypgProjection: number;
  sackProjection: number;
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

function mean(
  values: number[]
): number {
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

function mae(
  actual: number[],
  projected: number[]
) {
  if (
    !actual.length ||
    actual.length !==
      projected.length
  ) {
    return null;
  }

  return mean(
    actual.map(
      (value, index) =>
        Math.abs(
          value -
            projected[index]
        )
    )
  );
}

function rmse(
  actual: number[],
  projected: number[]
) {
  if (
    !actual.length ||
    actual.length !==
      projected.length
  ) {
    return null;
  }

  return Math.sqrt(
    mean(
      actual.map(
        (value, index) => {
          const error =
            value -
            projected[index];

          return error * error;
        }
      )
    )
  );
}

function meanError(
  actual: number[],
  projected: number[]
) {
  if (
    !actual.length ||
    actual.length !==
      projected.length
  ) {
    return null;
  }

  return mean(
    actual.map(
      (value, index) =>
        projected[index] -
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
/* LOAD QB GAME DATA                                  */
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

  const stream =
    Readable.fromWeb(
      response.body as any
    );

  const gunzip =
    createGunzip();

  stream.pipe(gunzip);

  const reader =
    readline.createInterface({
      input: gunzip,
      crlfDelay: Infinity,
    });

  let indexes:
    | RowIndexes
    | null = null;

  let headers: string[] = [];

  let firstLine = true;

  /*
    gameId + passerId
  */

  const qbGames =
    new Map<
      string,
      QBGame
    >();

  let rowsRead = 0;
  let passRows = 0;

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

        interception:
          indexOf(
            "interception"
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
          `${season} PBP is missing required columns.`
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

    /*
      QB passing yards:
      only official pass attempts,
      sacks excluded.
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
      !qbGames.has(key)
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

    /*
      passing_yards is normally
      populated on pass attempts.

      yards_gained is fallback only.
    */

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

  const games =
    Array.from(
      qbGames.values()
    );

  return {
    games,

    diagnostics: {
      season,

      rows_read:
        rowsRead,

      pass_rows:
        passRows,

      qb_game_rows:
        games.length,

      columns:
        headers.length,
    },
  };
}

/* -------------------------------------------------- */
/* DEFENSE STATE                                      */
/* -------------------------------------------------- */

function emptyDefense():
  DefenseHistory {
  return {
    games: 0,

    passAttempts: 0,
    passYards: 0,

    sacks: 0,
    interceptions: 0,
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

    passYPA:
      defense.passAttempts > 0
        ? defense.passYards /
          defense.passAttempts
        : null,

    passYPG:
      defense.passYards /
      defense.games,

    sacksPG:
      defense.sacks /
      defense.games,
  };
}

/* -------------------------------------------------- */
/* QB STATE                                           */
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
/* FROZEN V2-LIKE BASELINE                            */
/* -------------------------------------------------- */

/*
  This reproduces the established RDG V2 structure:

  expected attempts × expected YPA

  with:
  - career/current history
  - recent workload
  - small-sample regression

  This backtest does NOT modify the live route.
*/

function baselineProjection(
  history: QBHistory
) {
  if (
    history.games < 3 ||
    history.attempts <= 0
  ) {
    return null;
  }

  const careerAttemptsPerGame =
    history.attempts /
    history.games;

  const careerYPA =
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

  /*
    Workload:
    65% historical
    35% recent
  */

  const expectedAttempts =
    recentAttempts !== null
      ? careerAttemptsPerGame *
          0.65 +
        recentAttempts *
          0.35
      : careerAttemptsPerGame;

  /*
    Efficiency:
    historical base + mild recent form.
  */

  let expectedYPA =
    recentYPA !== null
      ? careerYPA *
          0.8 +
        recentYPA *
          0.2
      : careerYPA;

  /*
    Small sample regression.
  */

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

  /*
    Mild overall regression toward
    an NFL starting-QB baseline.
  */

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
/* BUILD CHRONOLOGICAL DATA                           */
/* -------------------------------------------------- */

function buildEvaluation(
  games: QBGame[],
  coefficients: {
    ypa: number;
    ypg: number;
    sack: number;
  },
  collectTrainingFeatures = false
) {
  /*
    Sort strictly chronologically.
  */

  const sorted =
    [...games].sort(
      (a, b) => {
        if (
          a.season !==
          b.season
        ) {
          return (
            a.season -
            b.season
          );
        }

        if (
          a.week !==
          b.week
        ) {
          return (
            a.week -
            b.week
          );
        }

        return a.gameId.localeCompare(
          b.gameId
        );
      }
    );

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

  const evaluation:
    EvaluationRow[] = [];

  const trainingFeatures: Array<{
    residual: number;
    ypaDifference: number;
    ypgDifference: number;
    sackDifference: number;
  }> = [];

  /*
    League defense history used to compare
    each defense against league average.
  */

  const leagueDefense:
    DefenseHistory =
      emptyDefense();

  /*
    IMPORTANT:
    Process one week as a batch.

    This prevents games from the same week
    influencing other games in that week.
  */

  const byWeek =
    new Map<
      string,
      QBGame[]
    >();

  for (const game of sorted) {
    const key =
      `${game.season}|${game.week}`;

    if (
      !byWeek.has(key)
    ) {
      byWeek.set(
        key,
        []
      );
    }

    byWeek.get(
      key
    )!.push(game);
  }

  const weekKeys =
    Array.from(
      byWeek.keys()
    ).sort(
      (a, b) => {
        const [
          seasonA,
          weekA,
        ] =
          a.split("|").map(
            Number
          );

        const [
          seasonB,
          weekB,
        ] =
          b.split("|").map(
            Number
          );

        return (
          seasonA -
            seasonB ||
          weekA -
            weekB
        );
      }
    );

  for (const weekKey of weekKeys) {
    const weekGames =
      byWeek.get(
        weekKey
      )!;

    /*
      PREDICT FIRST
    */

    for (const game of weekGames) {
      /*
        Filter out trick-play / backup
        tiny passing samples.
      */

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

      /*
        Require at least 3 prior defensive games.
      */

      const usableDefense =
        defense &&
        defense.games >= 3 &&
        league;

      let ypaDifference = 0;
      let ypgDifference = 0;
      let sackDifference = 0;

      if (
        usableDefense &&
        defense.passYPA !== null &&
        league.passYPA !== null
      ) {
        /*
          Positive = defense allows MORE
          than league average.

          Negative = stronger pass defense.
        */

        ypaDifference =
          defense.passYPA -
          league.passYPA;
      }

      if (
        usableDefense &&
        defense.passYPG !== null &&
        league.passYPG !== null
      ) {
        ypgDifference =
          defense.passYPG -
          league.passYPG;
      }

      if (
        usableDefense &&
        defense.sacksPG !== null &&
        league.sacksPG !== null
      ) {
        /*
          Positive = defense generates
          more sacks than average.

          More sacks should normally reduce
          passing production, so fitted
          coefficient may be negative.
        */

        sackDifference =
          defense.sacksPG -
          league.sacksPG;
      }

      const ypaAdjustment =
        ypaDifference *
        coefficients.ypa;

      const ypgAdjustment =
        ypgDifference *
        coefficients.ypg;

      const sackAdjustment =
        sackDifference *
        coefficients.sack;

      const combinedAdjustment =
        ypaAdjustment +
        ypgAdjustment +
        sackAdjustment;

      evaluation.push({
        season:
          game.season,

        week:
          game.week,

        player:
          game.playerName,

        team:
          game.team,

        opponent:
          game.opponent,

        actual:
          game.passingYards,

        baselineProjection:
          baseline,

        defensePassYPA:
          defense?.passYPA ??
          null,

        defensePassYardsPerGame:
          defense?.passYPG ??
          null,

        defenseSacksPerGame:
          defense?.sacksPG ??
          null,

        defenseYPAAdjustment:
          ypaAdjustment,

        defenseYPGAdjustment:
          ypgAdjustment,

        defenseSackAdjustment:
          sackAdjustment,

        combinedAdjustment,

        ypaProjection:
          clamp(
            baseline +
              ypaAdjustment,
            80,
            450
          ),

        ypgProjection:
          clamp(
            baseline +
              ypgAdjustment,
            80,
            450
          ),

        sackProjection:
          clamp(
            baseline +
              sackAdjustment,
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

      if (
        collectTrainingFeatures &&
        usableDefense
      ) {
        trainingFeatures.push({
          residual:
            game.passingYards -
            baseline,

          ypaDifference,

          ypgDifference,

          sackDifference,
        });
      }
    }

    /*
      UPDATE HISTORY AFTER THE WEEK
    */

    for (const game of weekGames) {
      if (
        game.attempts <= 0
      ) {
        continue;
      }

      /*
        QB history
      */

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

      /*
        Defense history

        QBGame represents pass-attempt data,
        so defense receives passing stats here.
      */

      if (
        !defenseHistory.has(
          game.opponent
        )
      ) {
        defenseHistory.set(
          game.opponent,
          emptyDefense()
        );
      }

      const defense =
        defenseHistory.get(
          game.opponent
        )!;

      /*
        Count each defense/game once.

        Since there can be multiple passers,
        we cannot simply increment games here
        for every QB.
      */
    }

    /*
      Aggregate defense by actual NFL game.
    */

    const defenseGameMap =
      new Map<
        string,
        {
          opponent: string;
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
        !defenseGameMap.has(
          key
        )
      ) {
        defenseGameMap.set(
          key,
          {
            opponent:
              game.opponent,

            attempts: 0,
            yards: 0,
          }
        );
      }

      const aggregate =
        defenseGameMap.get(
          key
        )!;

      aggregate.attempts +=
        game.attempts;

      aggregate.yards +=
        game.passingYards;
    }

    for (
      const aggregate of
      defenseGameMap.values()
    ) {
      if (
        !defenseHistory.has(
          aggregate.opponent
        )
      ) {
        defenseHistory.set(
          aggregate.opponent,
          emptyDefense()
        );
      }

      const defense =
        defenseHistory.get(
          aggregate.opponent
        )!;

      defense.games++;

      defense.passAttempts +=
        aggregate.attempts;

      defense.passYards +=
        aggregate.yards;

      /*
        This first version intentionally leaves
        sacks at zero because our QB game object
        only contains official pass attempts.

        We will test YPA and YPG first.

        Sack effects remain 0 until a later
        PBP-specific sack aggregation is added.
      */

      leagueDefense.games++;

      leagueDefense.passAttempts +=
        aggregate.attempts;

      leagueDefense.passYards +=
        aggregate.yards;
    }
  }

  return {
    evaluation,
    trainingFeatures,
  };
}

/* -------------------------------------------------- */
/* SIMPLE ONE-VARIABLE COEFFICIENT                    */
/* -------------------------------------------------- */

function fitCoefficient(
  rows: Array<{
    x: number;
    y: number;
  }>
) {
  if (
    rows.length < 20
  ) {
    return 0;
  }

  const xMean =
    mean(
      rows.map(
        (row) => row.x
      )
    );

  const yMean =
    mean(
      rows.map(
        (row) => row.y
      )
    );

  let numerator = 0;
  let denominator = 0;

  for (const row of rows) {
    const dx =
      row.x - xMean;

    const dy =
      row.y - yMean;

    numerator +=
      dx * dy;

    denominator +=
      dx * dx;
  }

  if (
    denominator === 0
  ) {
    return 0;
  }

  return (
    numerator /
    denominator
  );
}

/* -------------------------------------------------- */
/* SCORE MODEL                                        */
/* -------------------------------------------------- */

function score(
  rows: EvaluationRow[],
  field:
    | "baselineProjection"
    | "ypaProjection"
    | "ypgProjection"
    | "combinedProjection"
) {
  const actual =
    rows.map(
      (row) =>
        row.actual
    );

  const projected =
    rows.map(
      (row) =>
        row[field]
    );

  return {
    observations:
      rows.length,

    mae:
      round(
        mae(
          actual,
          projected
        )
      ),

    rmse:
      round(
        rmse(
          actual,
          projected
        )
      ),

    mean_error:
      round(
        meanError(
          actual,
          projected
        )
      ),
  };
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    /*
      Load seasons sequentially to keep
      Vercel memory usage lower.
    */

    const trainData =
      await loadSeason(
        TRAIN_SEASON
      );

    const testData =
      await loadSeason(
        TEST_SEASON
      );

    /*
      TRAINING

      Fit defense coefficients using 2024 only.
    */

    const training =
      buildEvaluation(
        trainData.games,
        {
          ypa: 0,
          ypg: 0,
          sack: 0,
        },
        true
      );

    const ypaCoefficient =
      fitCoefficient(
        training.trainingFeatures.map(
          (row) => ({
            x:
              row.ypaDifference,

            y:
              row.residual,
          })
        )
      );

    const ypgCoefficient =
      fitCoefficient(
        training.trainingFeatures.map(
          (row) => ({
            x:
              row.ypgDifference,

            y:
              row.residual,
          })
        )
      );

    /*
      Conservative coefficient caps.

      These prevent one noisy training season
      from creating absurd live adjustments.
    */

    const cappedYPA =
      clamp(
        ypaCoefficient,
        -30,
        30
      );

    const cappedYPG =
      clamp(
        ypgCoefficient,
        -0.5,
        0.5
      );

    /*
      Sacks intentionally disabled in V1
      until we aggregate them independently.
    */

    const sackCoefficient =
      0;

    /*
      TEST

      Evaluate ONLY on 2025.
    */

    const testing =
      buildEvaluation(
        testData.games,
        {
          ypa:
            cappedYPA,

          ypg:
            cappedYPG,

          sack:
            sackCoefficient,
        }
      );

    const rows =
      testing.evaluation;

    const baseline =
      score(
        rows,
        "baselineProjection"
      );

    const ypaModel =
      score(
        rows,
        "ypaProjection"
      );

    const ypgModel =
      score(
        rows,
        "ypgProjection"
      );

    const combinedModel =
      score(
        rows,
        "combinedProjection"
      );

    const baselineMAE =
      baseline.mae ?? 0;

    const combinedMAE =
      combinedModel.mae ??
      0;

    const improvement =
      baselineMAE -
      combinedMAE;

    const improvementPct =
      baselineMAE > 0
        ? (
            improvement /
            baselineMAE
          ) * 100
        : 0;

    /*
      Approval is deliberately conservative.

      Defense should not enter live Passing V2
      unless it actually improves held-out data.
    */

    const approved =
      improvement >= 0.25 &&
      improvementPct >= 0.4;

    return NextResponse.json({
      success: true,

      version:
        "1.0-defense-passing-backtest",

      purpose:
        "Test whether chronological opponent pass-defense information improves RDG quarterback passing-yard projections.",

      seasons: {
        coefficient_training:
          TRAIN_SEASON,

        held_out_test:
          TEST_SEASON,
      },

      leakage_protection: {
        chronological:
          true,

        same_week_updates:
          false,

        full_season_defense_used_for_prior_games:
          false,

        future_games_used:
          false,

        message:
          "Opponent defense for each prediction is calculated only from games completed before that week.",
      },

      diagnostics: {
        training:
          trainData.diagnostics,

        testing:
          testData.diagnostics,

        training_feature_rows:
          training.trainingFeatures.length,

        held_out_predictions:
          rows.length,
      },

      fitted_defense_coefficients: {
        pass_ypa_raw:
          round(
            ypaCoefficient,
            4
          ),

        pass_ypa_used:
          round(
            cappedYPA,
            4
          ),

        pass_yards_per_game_raw:
          round(
            ypgCoefficient,
            4
          ),

        pass_yards_per_game_used:
          round(
            cappedYPG,
            4
          ),

        sacks_used:
          0,

        note:
          "Sack adjustment is intentionally disabled in V1 until sacks are independently aggregated from PBP.",
      },

      held_out_2025_results: {
        baseline,

        defense_ypa_only:
          ypaModel,

        defense_yards_per_game_only:
          ypgModel,

        defense_combined:
          combinedModel,

        combined_mae_improvement_yards:
          round(
            improvement
          ),

        combined_mae_improvement_pct:
          round(
            improvementPct
          ),
      },

      decision: {
        defense_adjustment_approved:
          approved,

        live_model_changed:
          false,

        passing_v2_remains_frozen:
          true,

        message:
          approved
            ? "Opponent pass-defense features improved the held-out test enough to justify further validation. Do not activate live yet; run secondary validation first."
            : "Opponent pass-defense features did not improve the held-out test enough. Keep frozen Passing V2 unchanged.",
      },

      sample_predictions:
        rows
          .slice(-10)
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
                  row.baselineProjection,
                  1
                ),

              defense_adjusted:
                round(
                  row.combinedProjection,
                  1
                ),

              adjustment:
                round(
                  row.combinedAdjustment,
                  1
                ),
            })
          ),

      next_step:
        approved
          ? "Run secondary validation before allowing defense to affect live RDG Passing V2."
          : "Do not add this defensive adjustment to the live model. Test alternative defensive features separately.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense backtest error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.0-defense-passing-backtest",

        error:
          error?.message ||
          "Unable to run NFL defense backtest.",
      },
      {
        status: 500,
      }
    );
  }
}
