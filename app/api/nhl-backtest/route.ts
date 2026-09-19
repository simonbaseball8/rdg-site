import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NHL_API = "https://api-web.nhle.com/v1";

const TRAINING_SEASONS = [
  {
    name: "2023-24",
    id: "20232024",
  },
  {
    name: "2024-25",
    id: "20242025",
  },
];

const EVALUATION_SEASON = {
  name: "2025-26",
  id: "20252026",
};

const MIN_PRIOR_GAMES = 10;

type HistoricalGame = {
  gameId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

type TeamState = {
  games: number;
  wins: number;
  losses: number;
  otLosses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

type ModelRow = {
  season: string;
  gameId: number;
  date: string;

  homeTeam: string;
  awayTeam: string;

  homeScore: number;
  awayScore: number;

  homeWin: number;

  homePointPct: number;
  awayPointPct: number;

  homeGoalDiffPerGame: number;
  awayGoalDiffPerGame: number;

  pointPctDiff: number;
  goalDiffPerGameDiff: number;
};

type Coefficients = {
  intercept: number;
  pointPct: number;
  goalDiffPerGame: number;
};

function logistic(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }

  const z = Math.exp(value);
  return z / (1 + z);
}

function clampProbability(
  probability: number
): number {
  return Math.min(
    0.999999,
    Math.max(
      0.000001,
      probability
    )
  );
}

function createTeamState(): TeamState {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    otLosses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };
}

function getPointPct(
  state: TeamState
): number {
  if (state.games === 0) {
    return 0.5;
  }

  return (
    state.points /
    (state.games * 2)
  );
}

function getGoalDiffPerGame(
  state: TeamState
): number {
  if (state.games === 0) {
    return 0;
  }

  return (
    state.goalsFor -
    state.goalsAgainst
  ) / state.games;
}

/*
  Small delay helper.

  If NHL temporarily returns 429,
  we wait before retrying.
*/

function sleep(
  milliseconds: number
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

async function fetchWithRetry(
  url: string
): Promise<Response> {
  let lastStatus = 0;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    const response =
      await fetch(url, {
        cache: "no-store",
      });

    lastStatus =
      response.status;

    if (response.ok) {
      return response;
    }

    if (
      response.status !== 429
    ) {
      throw new Error(
        `NHL request failed: ${response.status}`
      );
    }

    /*
      429 = rate limited.

      Wait longer after each
      failed attempt.
    */

    await sleep(
      attempt * 1500
    );
  }

  throw new Error(
    `NHL request failed after retries: ${lastStatus}`
  );
}

/*
  Get a team's complete season schedule.

  We use one team's schedule as an entry
  point, then gather all league games
  through every NHL team's schedule.

  Duplicate games are removed by game ID.
*/

async function fetchSeasonGames(
  seasonId: string
): Promise<HistoricalGame[]> {
  /*
    Current NHL team abbreviations.

    Using team season schedules greatly
    reduces the number of requests versus
    repeatedly requesting weekly schedules.
  */

  const teams = [
    "ANA",
    "BOS",
    "BUF",
    "CAR",
    "CBJ",
    "CGY",
    "CHI",
    "COL",
    "DAL",
    "DET",
    "EDM",
    "FLA",
    "LAK",
    "MIN",
    "MTL",
    "NJD",
    "NSH",
    "NYI",
    "NYR",
    "OTT",
    "PHI",
    "PIT",
    "SEA",
    "SJS",
    "STL",
    "TBL",
    "TOR",
    "UTA",
    "VAN",
    "VGK",
    "WPG",
    "WSH",
  ];

  const gameMap =
    new Map<
      number,
      HistoricalGame
    >();

  for (
    const abbreviation
    of teams
  ) {
    const url =
      `${NHL_API}/club-schedule-season/${abbreviation}/${seasonId}`;

    const response =
      await fetchWithRetry(url);

    const data: any =
      await response.json();

    const games =
      Array.isArray(
        data?.games
      )
        ? data.games
        : [];

    for (const game of games) {
      /*
        NHL gameType 2 =
        regular season.

        Excludes preseason and
        playoffs.
      */

      if (
        game?.gameType !== 2
      ) {
        continue;
      }

      const gameId =
        typeof game?.id ===
        "number"
          ? game.id
          : null;

      const date =
        typeof game?.gameDate ===
        "string"
          ? game.gameDate
          : null;

      const homeTeam =
        game?.homeTeam?.abbrev;

      const awayTeam =
        game?.awayTeam?.abbrev;

      const homeScore =
        game?.homeTeam?.score;

      const awayScore =
        game?.awayTeam?.score;

      if (
        gameId === null ||
        !date ||
        typeof homeTeam !==
          "string" ||
        typeof awayTeam !==
          "string" ||
        typeof homeScore !==
          "number" ||
        typeof awayScore !==
          "number"
      ) {
        continue;
      }

      if (
        homeScore ===
        awayScore
      ) {
        continue;
      }

      gameMap.set(
        gameId,
        {
          gameId,
          date,
          homeTeam,
          awayTeam,
          homeScore,
          awayScore,
        }
      );
    }

    /*
      Tiny pause between team
      requests to be polite to
      NHL's API.
    */

    await sleep(100);
  }

  return Array.from(
    gameMap.values()
  ).sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      ) ||
      a.gameId -
        b.gameId
  );
}

function buildPregameRows(
  seasonName: string,
  games: HistoricalGame[]
): ModelRow[] {
  const teams =
    new Map<
      string,
      TeamState
    >();

  const rows:
    ModelRow[] = [];

  function stateFor(
    abbreviation: string
  ): TeamState {
    const existing =
      teams.get(
        abbreviation
      );

    if (existing) {
      return existing;
    }

    const created =
      createTeamState();

    teams.set(
      abbreviation,
      created
    );

    return created;
  }

  for (const game of games) {
    const home =
      stateFor(
        game.homeTeam
      );

    const away =
      stateFor(
        game.awayTeam
      );

    /*
      IMPORTANT:

      Everything below is calculated
      BEFORE the current game's result
      is added.

      This prevents future-game leakage.
    */

    if (
      home.games >=
        MIN_PRIOR_GAMES &&
      away.games >=
        MIN_PRIOR_GAMES
    ) {
      const homePointPct =
        getPointPct(home);

      const awayPointPct =
        getPointPct(away);

      const homeGoalDiff =
        getGoalDiffPerGame(
          home
        );

      const awayGoalDiff =
        getGoalDiffPerGame(
          away
        );

      rows.push({
        season:
          seasonName,

        gameId:
          game.gameId,

        date:
          game.date,

        homeTeam:
          game.homeTeam,

        awayTeam:
          game.awayTeam,

        homeScore:
          game.homeScore,

        awayScore:
          game.awayScore,

        homeWin:
          game.homeScore >
          game.awayScore
            ? 1
            : 0,

        homePointPct,

        awayPointPct,

        homeGoalDiffPerGame:
          homeGoalDiff,

        awayGoalDiffPerGame:
          awayGoalDiff,

        pointPctDiff:
          homePointPct -
          awayPointPct,

        goalDiffPerGameDiff:
          homeGoalDiff -
          awayGoalDiff,
      });
    }

    /*
      Update AFTER capturing
      the pregame snapshot.
    */

    home.games++;
    away.games++;

    home.goalsFor +=
      game.homeScore;

    home.goalsAgainst +=
      game.awayScore;

    away.goalsFor +=
      game.awayScore;

    away.goalsAgainst +=
      game.homeScore;

    const homeWon =
      game.homeScore >
      game.awayScore;

    /*
      We only need standings strength
      here.

      Regulation/OT distinction is not
      available consistently from this
      schedule response, so winner gets
      2 points and loser gets 0.

      Goal differential remains fully
      chronological.

      This is a simplified points feature,
      not an exact reconstruction of NHL
      standings points.
    */

    if (homeWon) {
      home.wins++;
      home.points += 2;

      away.losses++;
    } else {
      away.wins++;
      away.points += 2;

      home.losses++;
    }
  }

  return rows;
}

function fitLogisticRegression(
  rows: ModelRow[]
): Coefficients {
  let intercept = 0;
  let pointPct = 0;
  let goalDiffPerGame = 0;

  const learningRate =
    0.08;

  const iterations =
    8000;

  for (
    let iteration = 0;
    iteration <
    iterations;
    iteration++
  ) {
    let gradientIntercept =
      0;

    let gradientPointPct =
      0;

    let gradientGoalDiff =
      0;

    for (const row of rows) {
      const logit =
        intercept +
        pointPct *
          row.pointPctDiff +
        goalDiffPerGame *
          row.goalDiffPerGameDiff;

      const probability =
        logistic(logit);

      const error =
        probability -
        row.homeWin;

      gradientIntercept +=
        error;

      gradientPointPct +=
        error *
        row.pointPctDiff;

      gradientGoalDiff +=
        error *
        row.goalDiffPerGameDiff;
    }

    const n =
      Math.max(
        1,
        rows.length
      );

    intercept -=
      learningRate *
      (gradientIntercept /
        n);

    pointPct -=
      learningRate *
      (gradientPointPct /
        n);

    goalDiffPerGame -=
      learningRate *
      (gradientGoalDiff /
        n);
  }

  return {
    intercept,
    pointPct,
    goalDiffPerGame,
  };
}

function predict(
  row: ModelRow,
  coefficients: Coefficients
): number {
  const logit =
    coefficients.intercept +
    coefficients.pointPct *
      row.pointPctDiff +
    coefficients.goalDiffPerGame *
      row.goalDiffPerGameDiff;

  return logistic(logit);
}

function evaluate(
  rows: ModelRow[],
  coefficients: Coefficients
) {
  let correct = 0;

  let brierTotal = 0;

  let logLossTotal = 0;

  const buckets = {
    "50-54": {
      games: 0,
      correct: 0,
    },

    "55-59": {
      games: 0,
      correct: 0,
    },

    "60-64": {
      games: 0,
      correct: 0,
    },

    "65-69": {
      games: 0,
      correct: 0,
    },

    "70+": {
      games: 0,
      correct: 0,
    },
  };

  for (const row of rows) {
    const homeProbability =
      clampProbability(
        predict(
          row,
          coefficients
        )
      );

    const predictedHome =
      homeProbability >= 0.5;

    const actualHome =
      row.homeWin === 1;

    if (
      predictedHome ===
      actualHome
    ) {
      correct++;
    }

    const error =
      homeProbability -
      row.homeWin;

    brierTotal +=
      error * error;

    logLossTotal +=
      -(
        row.homeWin *
          Math.log(
            homeProbability
          ) +
        (1 -
          row.homeWin) *
          Math.log(
            1 -
              homeProbability
          )
      );

    const confidence =
      Math.max(
        homeProbability,
        1 -
          homeProbability
      ) * 100;

    let bucket:
      | "50-54"
      | "55-59"
      | "60-64"
      | "65-69"
      | "70+";

    if (
      confidence < 55
    ) {
      bucket =
        "50-54";
    } else if (
      confidence < 60
    ) {
      bucket =
        "55-59";
    } else if (
      confidence < 65
    ) {
      bucket =
        "60-64";
    } else if (
      confidence < 70
    ) {
      bucket =
        "65-69";
    } else {
      bucket =
        "70+";
    }

    buckets[bucket]
      .games++;

    if (
      predictedHome ===
      actualHome
    ) {
      buckets[bucket]
        .correct++;
    }
  }

  const probabilityBuckets =
    Object.entries(
      buckets
    ).map(
      ([bucket, value]) => ({
        bucket,

        games:
          value.games,

        correct:
          value.correct,

        accuracy:
          value.games > 0
            ? Number(
                (
                  (value.correct /
                    value.games) *
                  100
                ).toFixed(2)
              )
            : null,
      })
    );

  return {
    games:
      rows.length,

    correct,

    winner_accuracy:
      rows.length > 0
        ? Number(
            (
              (correct /
                rows.length) *
              100
            ).toFixed(2)
          )
        : null,

    brier_score:
      rows.length > 0
        ? Number(
            (
              brierTotal /
              rows.length
            ).toFixed(4)
          )
        : null,

    log_loss:
      rows.length > 0
        ? Number(
            (
              logLossTotal /
              rows.length
            ).toFixed(4)
          )
        : null,

    probability_buckets:
      probabilityBuckets,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const trainingRows:
      ModelRow[] = [];

    const seasonDetails:
      any[] = [];

    /*
      Fetch each season sequentially
      to avoid hammering NHL's API.
    */

    for (
      const season
      of TRAINING_SEASONS
    ) {
      const games =
        await fetchSeasonGames(
          season.id
        );

      const rows =
        buildPregameRows(
          season.name,
          games
        );

      trainingRows.push(
        ...rows
      );

      seasonDetails.push({
        season:
          season.name,

        regular_season_games_downloaded:
          games.length,

        usable_pregame_games:
          rows.length,
      });

      await sleep(500);
    }

    const evaluationGames =
      await fetchSeasonGames(
        EVALUATION_SEASON.id
      );

    const evaluationRows =
      buildPregameRows(
        EVALUATION_SEASON.name,
        evaluationGames
      );

    if (
      trainingRows.length === 0
    ) {
      throw new Error(
        "No NHL training games were available."
      );
    }

    if (
      evaluationRows.length === 0
    ) {
      throw new Error(
        "No NHL evaluation games were available."
      );
    }

    const coefficients =
      fitLogisticRegression(
        trainingRows
      );

    const trainingResults =
      evaluate(
        trainingRows,
        coefficients
      );

    const heldOutResults =
      evaluate(
        evaluationRows,
        coefficients
      );

    const equalTeamHomeProbability =
      logistic(
        coefficients.intercept
      );

    return NextResponse.json({
      success: true,

      sport:
        "NHL",

      version:
        "1.1-low-request-chronological",

      methodology: {
        training_seasons:
          TRAINING_SEASONS.map(
            (season) =>
              season.name
          ),

        held_out_evaluation_season:
          EVALUATION_SEASON.name,

        minimum_prior_games:
          MIN_PRIOR_GAMES,

        game_type:
          "Regular season only",

        features: [
          "Pregame simplified points percentage difference",
          "Pregame goal differential per game difference",
          "Learned home-ice advantage",
        ],

        leakage_control:
          "Each team's strength is calculated only from games completed before the game being predicted.",

        standings_note:
          "Historical schedule data does not reconstruct overtime loser points here, so the points-percentage feature is simplified. Goal differential remains chronological.",

        goalie_model:
          "Not included in historical calibration.",

        betting_note:
          "Historical sportsbook prices are not included. Results measure winner prediction and probability calibration, not betting win rate, ROI, or profitability.",
      },

      season_details:
        seasonDetails,

      evaluation_season: {
        season:
          EVALUATION_SEASON.name,

        regular_season_games_downloaded:
          evaluationGames.length,

        usable_pregame_games:
          evaluationRows.length,
      },

      fitted_model: {
        intercept:
          Number(
            coefficients.intercept.toFixed(
              6
            )
          ),

        point_pct_difference_coefficient:
          Number(
            coefficients.pointPct.toFixed(
              6
            )
          ),

        goal_diff_per_game_difference_coefficient:
          Number(
            coefficients.goalDiffPerGame.toFixed(
              6
            )
          ),

        equal_team_home_win_probability:
          Number(
            (
              equalTeamHomeProbability *
              100
            ).toFixed(2)
          ),
      },

      training_results:
        trainingResults,

      held_out_results:
        heldOutResults,

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "NHL BACKTEST ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown NHL backtest error";

    return NextResponse.json(
      {
        success: false,

        sport:
          "NHL",

        error:
          message,

        generated_at:
          new Date().toISOString(),
      },
      {
        status: 500,
      }
    );
  }
}
