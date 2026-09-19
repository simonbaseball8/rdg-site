import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CoreRating = {
  year: number;
  throughSeasonType: string;
  throughWeek: number;
  team: string;
  conference: string | null;
  overall: number;
  offense: number;
  defense: number;
  offensePlays: number;
  defensePlays: number;
  modelVersion: string;
};

type Game = {
  id: number;
  season: number;
  week: number;
  seasonType: string;
  completed: boolean;
  neutralSite: boolean;
  homeTeam: string;
  awayTeam: string;
  homeClassification: string | null;
  awayClassification: string | null;
  homePoints: number | null;
  awayPoints: number | null;
};

type CalibrationRow = {
  season: number;
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  coreDifference: number;
  actualHomeMargin: number;
};

const TRAINING_SEASONS = [2022, 2023, 2024];
const TEST_SEASON = 2025;

function normalizeTeam(name: string) {
  return name
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/\bSTATE\b/g, "ST")
    .replace(/\bUNIVERSITY\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

async function cfbdFetch<T>(
  path: string,
  apiKey: string
): Promise<T> {
  const response = await fetch(
    `https://api.collegefootballdata.com${path}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `CFBD request failed (${response.status}): ${body.slice(
        0,
        300
      )}`
    );
  }

  return response.json();
}

function linearRegression(
  rows: CalibrationRow[]
) {
  if (rows.length < 2) {
    return {
      intercept: 0,
      slope: 0,
    };
  }

  const meanX =
    rows.reduce(
      (sum, row) =>
        sum + row.coreDifference,
      0
    ) / rows.length;

  const meanY =
    rows.reduce(
      (sum, row) =>
        sum + row.actualHomeMargin,
      0
    ) / rows.length;

  let numerator = 0;
  let denominator = 0;

  for (const row of rows) {
    const xDifference =
      row.coreDifference - meanX;

    numerator +=
      xDifference *
      (row.actualHomeMargin - meanY);

    denominator +=
      xDifference * xDifference;
  }

  const slope =
    denominator === 0
      ? 0
      : numerator / denominator;

  const intercept =
    meanY - slope * meanX;

  return {
    intercept,
    slope,
  };
}

function evaluate(
  rows: CalibrationRow[],
  intercept: number,
  slope: number
) {
  if (rows.length === 0) {
    return {
      games: 0,
      winner_correct: 0,
      winner_accuracy: 0,
      margin_mae: 0,
    };
  }

  let winnerCorrect = 0;
  let absoluteError = 0;

  for (const row of rows) {
    const projectedMargin =
      intercept +
      slope * row.coreDifference;

    const actualMargin =
      row.actualHomeMargin;

    const projectedWinner =
      projectedMargin > 0
        ? "home"
        : projectedMargin < 0
          ? "away"
          : "push";

    const actualWinner =
      actualMargin > 0
        ? "home"
        : actualMargin < 0
          ? "away"
          : "push";

    if (projectedWinner === actualWinner) {
      winnerCorrect++;
    }

    absoluteError += Math.abs(
      projectedMargin - actualMargin
    );
  }

  return {
    games: rows.length,

    winner_correct:
      winnerCorrect,

    winner_accuracy: Number(
      (
        (winnerCorrect / rows.length) *
        100
      ).toFixed(2)
    ),

    margin_mae: Number(
      (
        absoluteError / rows.length
      ).toFixed(2)
    ),
  };
}

async function loadSeason(
  season: number,
  apiKey: string
): Promise<CalibrationRow[]> {
  const [ratings, games] =
    await Promise.all([
      cfbdFetch<CoreRating[]>(
        `/ratings/core?year=${season}`,
        apiKey
      ),

      cfbdFetch<Game[]>(
        `/games?year=${season}&seasonType=regular&classification=fbs`,
        apiKey
      ),
    ]);

  const ratingsByTeam =
    new Map<string, CoreRating>();

  for (const rating of ratings) {
    ratingsByTeam.set(
      normalizeTeam(rating.team),
      rating
    );
  }

  const rows: CalibrationRow[] = [];

  for (const game of games) {
    if (!game.completed) {
      continue;
    }

    if (
      game.homePoints === null ||
      game.awayPoints === null
    ) {
      continue;
    }

    // CORE is based on FBS-vs-FBS play.
    if (
      game.homeClassification !== "fbs" ||
      game.awayClassification !== "fbs"
    ) {
      continue;
    }

    const homeRating =
      ratingsByTeam.get(
        normalizeTeam(game.homeTeam)
      );

    const awayRating =
      ratingsByTeam.get(
        normalizeTeam(game.awayTeam)
      );

    if (!homeRating || !awayRating) {
      continue;
    }

    /*
      CORE overall:
      offense minus defense.
      Higher = stronger.

      We start with:
      home CORE - away CORE.

      We intentionally DO NOT manually
      add home-field advantage here.

      The regression intercept will learn
      the average home-field effect from
      the training data.
    */

    const coreDifference =
      homeRating.overall -
      awayRating.overall;

    const actualHomeMargin =
      game.homePoints -
      game.awayPoints;

    rows.push({
      season,
      gameId: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      neutralSite: game.neutralSite,
      coreDifference,
      actualHomeMargin,
    });
  }

  return rows;
}

export async function GET() {
  try {
    const apiKey =
      process.env.CFBD_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "CFBD_API_KEY is not configured.",
        },
        {
          status: 500,
        }
      );
    }

    const seasons = [
      ...TRAINING_SEASONS,
      TEST_SEASON,
    ];

    /*
      Load sequentially instead of firing
      every CFBD request at once.
      This is friendlier to API limits.
    */

    const rowsBySeason: Record<
      number,
      CalibrationRow[]
    > = {};

    for (const season of seasons) {
      rowsBySeason[season] =
        await loadSeason(
          season,
          apiKey
        );
    }

    const trainingRows =
      TRAINING_SEASONS.flatMap(
        (season) =>
          rowsBySeason[season] || []
      );

    const testRows =
      rowsBySeason[TEST_SEASON] || [];

    const regression =
      linearRegression(trainingRows);

    const trainingResults =
      evaluate(
        trainingRows,
        regression.intercept,
        regression.slope
      );

    const testResults =
      evaluate(
        testRows,
        regression.intercept,
        regression.slope
      );

    const seasonCounts =
      seasons.map((season) => ({
        season,
        games_used:
          rowsBySeason[season]?.length ||
          0,
      }));

    return NextResponse.json({
      model:
        "RDG CFB CORE Calibration",

      version: "1.0",

      methodology: {
        rating_source:
          "CollegeFootballData CORE",

        training_seasons:
          TRAINING_SEASONS,

        evaluation_season:
          TEST_SEASON,

        target:
          "Final home scoring margin",

        formula:
          "Projected home margin = intercept + (slope × CORE difference)",

        core_difference:
          "Home CORE overall - Away CORE overall",

        neutral_sites:
          "Included. No explicit home-field variable is fitted in v1.",

        important_limitation:
          "Historical CORE ratings are retrospective season ratings, not point-in-time pregame snapshots. This endpoint is therefore a CORE-to-scoring-margin calibration test, not a true historical betting backtest.",
      },

      games_by_season:
        seasonCounts,

      samples: {
        training:
          trainingRows.length,

        evaluation:
          testRows.length,
      },

      fitted_model: {
        intercept: Number(
          regression.intercept.toFixed(
            4
          )
        ),

        core_to_points_factor:
          Number(
            regression.slope.toFixed(4)
          ),
      },

      training_results:
        trainingResults,

      out_of_sample_2025_results:
        testResults,

      interpretation: {
        intercept:
          "Average home-margin component learned from the training games.",

        core_to_points_factor:
          "Estimated number of scoring-margin points associated with a one-point difference in CORE overall.",

        winner_accuracy:
          "How often the sign of the projected scoring margin matched the actual straight-up winner.",

        margin_mae:
          "Average absolute difference between projected scoring margin and actual scoring margin.",

        warning:
          "These results do not measure ATS win rate, betting profitability, or the probability that a future wager wins.",
      },
    });
  } catch (error) {
    console.error(
      "RDG CFB Backtest Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG CFB backtest failed",

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
