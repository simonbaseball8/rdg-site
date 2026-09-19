import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MLB_API = "https://statsapi.mlb.com/api/v1";

const TRAINING_SEASONS = [2023, 2024];
const EVALUATION_SEASON = 2025;

type TeamState = {
  games: number;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
};

type ModelGame = {
  season: number;
  date: string;
  gamePk: number;
  awayTeam: string;
  homeTeam: string;
  awayId: number;
  homeId: number;
  awayStrength: number;
  homeStrength: number;
  strengthDifference: number;
  homeWon: boolean;
  actualMargin: number;
};

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `MLB API ${response.status}: ${text.slice(0, 300)}`
    );
  }

  return response.json();
}

function createState(): TeamState {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  };
}

function teamStrength(state: TeamState) {
  if (state.games === 0) {
    return 0;
  }

  const winPct =
    state.wins / state.games;

  const runDiffPerGame =
    (state.runsScored - state.runsAllowed) /
    state.games;

  const winComponent =
    (winPct - 0.5) * 5;

  const runComponent =
    runDiffPerGame * 0.8;

  return winComponent + runComponent;
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function clamp(
  value: number,
  minimum: number,
  maximum: number
) {
  return Math.min(
    maximum,
    Math.max(minimum, value)
  );
}

function logit(probability: number) {
  const p = clamp(
    probability,
    0.0001,
    0.9999
  );

  return Math.log(p / (1 - p));
}

async function loadSeason(
  season: number
): Promise<ModelGame[]> {
  const url =
    `${MLB_API}/schedule` +
    `?sportId=1` +
    `&season=${season}` +
    `&startDate=${season}-03-01` +
    `&endDate=${season}-10-15` +
    `&gameType=R`;

  const data = await fetchJson(url);

  const rawGames: any[] = [];

  for (const dateBlock of data.dates ?? []) {
    for (const game of dateBlock.games ?? []) {
      if (
        game.status?.abstractGameState !==
        "Final"
      ) {
        continue;
      }

      const awayScore =
        Number(
          game.teams?.away?.score
        );

      const homeScore =
        Number(
          game.teams?.home?.score
        );

      const awayId =
        Number(
          game.teams?.away?.team?.id
        );

      const homeId =
        Number(
          game.teams?.home?.team?.id
        );

      if (
        !Number.isFinite(awayScore) ||
        !Number.isFinite(homeScore) ||
        !Number.isFinite(awayId) ||
        !Number.isFinite(homeId)
      ) {
        continue;
      }

      rawGames.push({
        season,
        date:
          game.officialDate ??
          String(game.gameDate).slice(0, 10),

        gamePk:
          game.gamePk,

        awayId,
        homeId,

        awayTeam:
          game.teams?.away?.team?.name ??
          String(awayId),

        homeTeam:
          game.teams?.home?.team?.name ??
          String(homeId),

        awayScore,
        homeScore,
      });
    }
  }

  rawGames.sort((a, b) => {
    const dateCompare =
      a.date.localeCompare(b.date);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return a.gamePk - b.gamePk;
  });

  const states =
    new Map<number, TeamState>();

  const modelGames: ModelGame[] = [];

  function getState(teamId: number) {
    if (!states.has(teamId)) {
      states.set(
        teamId,
        createState()
      );
    }

    return states.get(teamId)!;
  }

  /*
    IMPORTANT:

    Strength is calculated BEFORE
    updating the teams with the
    current game's result.

    That means each prediction only
    uses information available before
    that game was played.
  */

  for (const game of rawGames) {
    const awayState =
      getState(game.awayId);

    const homeState =
      getState(game.homeId);

    /*
      Skip the very beginning of the
      season. Ten prior games gives us
      at least a small real sample.
    */

    if (
      awayState.games >= 10 &&
      homeState.games >= 10
    ) {
      const awayStrength =
        teamStrength(awayState);

      const homeStrength =
        teamStrength(homeState);

      modelGames.push({
        season,

        date:
          game.date,

        gamePk:
          game.gamePk,

        awayTeam:
          game.awayTeam,

        homeTeam:
          game.homeTeam,

        awayId:
          game.awayId,

        homeId:
          game.homeId,

        awayStrength,

        homeStrength,

        strengthDifference:
          homeStrength -
          awayStrength,

        homeWon:
          game.homeScore >
          game.awayScore,

        actualMargin:
          game.homeScore -
          game.awayScore,
      });
    }

    awayState.games += 1;
    homeState.games += 1;

    awayState.runsScored +=
      game.awayScore;

    awayState.runsAllowed +=
      game.homeScore;

    homeState.runsScored +=
      game.homeScore;

    homeState.runsAllowed +=
      game.awayScore;

    if (
      game.homeScore >
      game.awayScore
    ) {
      homeState.wins += 1;
      awayState.losses += 1;
    } else {
      awayState.wins += 1;
      homeState.losses += 1;
    }
  }

  return modelGames;
}

/*
  Simple logistic regression with
  gradient descent.

  y = home team won

  x = home strength - away strength
*/

function fitLogisticRegression(
  games: ModelGame[]
) {
  let intercept = 0;
  let slope = 1;

  const learningRate = 0.05;
  const iterations = 4000;

  for (
    let iteration = 0;
    iteration < iterations;
    iteration++
  ) {
    let interceptGradient = 0;
    let slopeGradient = 0;

    for (const game of games) {
      const prediction =
        logistic(
          intercept +
          slope *
            game.strengthDifference
        );

      const actual =
        game.homeWon ? 1 : 0;

      const error =
        prediction - actual;

      interceptGradient +=
        error;

      slopeGradient +=
        error *
        game.strengthDifference;
    }

    intercept -=
      learningRate *
      (interceptGradient /
        games.length);

    slope -=
      learningRate *
      (slopeGradient /
        games.length);
  }

  return {
    intercept,
    slope,
  };
}

function evaluate(
  games: ModelGame[],
  intercept: number,
  slope: number
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

  for (const game of games) {
    const homeProbability =
      logistic(
        intercept +
        slope *
          game.strengthDifference
      );

    const actual =
      game.homeWon ? 1 : 0;

    const predictedHome =
      homeProbability >= 0.5;

    const wasCorrect =
      predictedHome ===
      game.homeWon;

    if (wasCorrect) {
      correct += 1;
    }

    brierTotal +=
      Math.pow(
        homeProbability -
          actual,
        2
      );

    const safeProbability =
      clamp(
        homeProbability,
        0.0001,
        0.9999
      );

    logLossTotal +=
      -(
        actual *
          Math.log(
            safeProbability
          ) +
        (1 - actual) *
          Math.log(
            1 -
              safeProbability
          )
      );

    const favoriteProbability =
      Math.max(
        homeProbability,
        1 - homeProbability
      );

    const pct =
      favoriteProbability * 100;

    let bucket:
      keyof typeof buckets;

    if (pct >= 70) {
      bucket = "70+";
    } else if (pct >= 65) {
      bucket = "65-69";
    } else if (pct >= 60) {
      bucket = "60-64";
    } else if (pct >= 55) {
      bucket = "55-59";
    } else {
      bucket = "50-54";
    }

    buckets[bucket].games += 1;

    if (wasCorrect) {
      buckets[bucket].correct += 1;
    }
  }

  const bucketResults =
    Object.fromEntries(
      Object.entries(
        buckets
      ).map(
        ([bucket, result]) => [
          bucket,
          {
            games:
              result.games,

            correct:
              result.correct,

            accuracy:
              result.games > 0
                ? Number(
                    (
                      (result.correct /
                        result.games) *
                      100
                    ).toFixed(2)
                  )
                : null,
          },
        ]
      )
    );

  return {
    games:
      games.length,

    correct,

    winner_accuracy:
      Number(
        (
          (correct /
            games.length) *
          100
        ).toFixed(2)
      ),

    brier_score:
      Number(
        (
          brierTotal /
          games.length
        ).toFixed(4)
      ),

    log_loss:
      Number(
        (
          logLossTotal /
          games.length
        ).toFixed(4)
      ),

    probability_buckets:
      bucketResults,
  };
}

export async function GET() {
  try {
    /*
      2023 + 2024 = training

      2025 = completely held-out
      evaluation season
    */

    const seasons =
      await Promise.all([
        ...TRAINING_SEASONS.map(
          loadSeason
        ),

        loadSeason(
          EVALUATION_SEASON
        ),
      ]);

    const trainingGames =
      seasons
        .slice(
          0,
          TRAINING_SEASONS.length
        )
        .flat();

    const evaluationGames =
      seasons[
        seasons.length - 1
      ];

    if (
      trainingGames.length === 0 ||
      evaluationGames.length === 0
    ) {
      throw new Error(
        "Historical MLB games were not returned."
      );
    }

    const fitted =
      fitLogisticRegression(
        trainingGames
      );

    const training =
      evaluate(
        trainingGames,
        fitted.intercept,
        fitted.slope
      );

    const evaluation =
      evaluate(
        evaluationGames,
        fitted.intercept,
        fitted.slope
      );

    /*
      Translate fitted home advantage
      into probability for two equally
      rated teams.
    */

    const neutralHomeWinProbability =
      logistic(
        fitted.intercept
      );

    /*
      Compare the old v1.0 probability
      conversion on the SAME 2025
      evaluation games.

      Old model:
      logistic(
        (strengthDifference + 0.20)
        / 2.5
      )
    */

    const oldModelGames =
      evaluationGames.map(
        (game) => ({
          ...game,

          strengthDifference:
            (
              game.strengthDifference +
              0.20
            ) / 2.5,
        })
      );

    const oldModelEvaluation =
      evaluate(
        oldModelGames,
        0,
        1
      );

    return NextResponse.json({
      sport:
        "MLB",

      model:
        "RDG MLB",

      version:
        "1.1-calibration-test",

      status:
        "Completed",

      methodology: {
        training_seasons:
          TRAINING_SEASONS,

        evaluation_season:
          EVALUATION_SEASON,

        minimum_prior_games:
          10,

        features: [
          "Pregame winning percentage",
          "Pregame run differential per game",
          "Home field learned from training data",
        ],

        important:
          "Every historical team-strength value is calculated before the current game result is added, preventing current-game/future-game leakage.",

        pitcher_note:
          "Starting-pitcher season statistics are intentionally excluded from this first calibration because final full-season pitcher stats would leak future information into earlier games.",

        market_note:
          "This endpoint evaluates winner prediction and probability calibration only. It does not test historical Hard Rock prices, ATS/run-line performance, ROI, or profitability.",
      },

      samples: {
        training_games:
          trainingGames.length,

        evaluation_games:
          evaluationGames.length,
      },

      fitted_model: {
        formula:
          "homeWinProbability = logistic(intercept + slope * (homeStrength - awayStrength))",

        intercept:
          Number(
            fitted.intercept.toFixed(
              6
            )
          ),

        strength_slope:
          Number(
            fitted.slope.toFixed(
              6
            )
          ),

        equal_team_home_win_probability:
          Number(
            (
              neutralHomeWinProbability *
              100
            ).toFixed(2)
          ),
      },

      training_results:
        training,

      evaluation_2025:
        evaluation,

      old_v1_same_2025_sample:
        oldModelEvaluation,

      interpretation: {
        winner_accuracy:
          "Percentage of games where the side above 50% won.",

        brier_score:
          "Probability accuracy metric. Lower is better.",

        log_loss:
          "Probability accuracy metric that penalizes overconfidence. Lower is better.",

        next_step:
          "Use the held-out 2025 results to decide whether the fitted intercept and slope should replace the heuristic probability conversion in the live MLB model.",
      },
    });
  } catch (error) {
    console.error(
      "RDG MLB Backtest Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG MLB backtest failed",

        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
