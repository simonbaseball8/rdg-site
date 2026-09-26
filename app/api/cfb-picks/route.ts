import { loadOddsMarket } from "../../../lib/odds-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEASON = 2026;

/*
  RDG CFB CORE MODEL — v1.2

  Historical calibration:
  Training seasons: 2022, 2023, 2024
  Evaluation season: 2025

  Base calibrated formula:

  Projected home margin =
  3.0229 +
  (0.8165 × CORE difference)

  SAMPLE-SIZE PROTECTION

  150+ minimum CORE plays:
  100% CORE influence

  75-149 minimum CORE plays:
  75% CORE influence

  Under 75 minimum CORE plays:
  45% CORE influence

  Small Sample games are also prevented
  from receiving Priority Review status.

  IMPORTANT:
  Historical CORE ratings used during
  calibration were retrospective ratings.

  Therefore this model is NOT yet a true
  historical pregame ATS backtest and the
  review labels are NOT win probabilities.
*/

const CALIBRATED_INTERCEPT = 3.0229;
const CORE_TO_POINTS = 0.8165;

const ESTABLISHED_WEIGHT = 1.0;
const DEVELOPING_WEIGHT = 0.75;
const SMALL_SAMPLE_WEIGHT = 0.45;


const CFBD_CORE_URL =
  `https://api.collegefootballdata.com/ratings/core?year=${SEASON}`;

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

function normalizeTeam(
  value: string
): string {
  return value
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/STATE/g, "ST")
    .replace(/UNIVERSITY/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function findCoreRating(
  providerTeam: string,
  ratings: CoreRating[]
): CoreRating | null {
  const target =
    normalizeTeam(providerTeam);

  const exact =
    ratings.find(
      (rating) =>
        normalizeTeam(
          rating.team
        ) === target
    );

  if (exact) {
    return exact;
  }

  const partial =
    [...ratings].sort((a,b) => normalizeTeam(b.team).length - normalizeTeam(a.team).length).find(
      (rating) => {
        const candidate =
          normalizeTeam(
            rating.team
          );

        return (
          candidate.includes(
            target
          ) ||
          target.includes(
            candidate
          )
        );
      }
    );

  return partial ?? null;
}

function numberValue(
  value: unknown
): number | null {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}

function getSpread(
  odds: any[],
  team: string
) {
  return odds.find(
    (item: any) =>
      item.market ===
        "spread" &&
      item.team === team
  );
}

function getMoneyline(
  odds: any[],
  team: string
) {
  return odds.find(
    (item: any) =>
      item.market ===
        "moneyline" &&
      item.team === team
  );
}

function getTotal(
  odds: any[],
  side: string
) {
  return odds.find(
    (item: any) =>
      item.market ===
        "total" &&
      String(
        item.team
      ).toLowerCase() ===
        side.toLowerCase()
  );
}

function impliedProbability(
  odds:
    | string
    | number
    | null
): number | null {
  if (odds === null) {
    return null;
  }

  const value =
    Number(
      String(
        odds
      ).replace(
        "+",
        ""
      )
    );

  if (
    !Number.isFinite(
      value
    ) ||
    value === 0
  ) {
    return null;
  }

  if (value > 0) {
    return Number(
      (
        (100 /
          (value +
            100)) *
        100
      ).toFixed(2)
    );
  }

  return Number(
    (
      (Math.abs(
        value
      ) /
        (Math.abs(
          value
        ) +
          100)) *
      100
    ).toFixed(2)
  );
}

function getMinimumSample(
  away: CoreRating,
  home: CoreRating
) {
  return Math.min(
    away.offensePlays,
    away.defensePlays,
    home.offensePlays,
    home.defensePlays
  );
}

function getSampleInfo(
  minimumSample: number
) {
  if (
    minimumSample >= 150
  ) {
    return {
      status:
        "Established",
      weight:
        ESTABLISHED_WEIGHT,
    };
  }

  if (
    minimumSample >= 75
  ) {
    return {
      status:
        "Developing",
      weight:
        DEVELOPING_WEIGHT,
    };
  }

  return {
    status:
      "Small Sample",
    weight:
      SMALL_SAMPLE_WEIGHT,
  };
}

function calculateProjection(
  away: CoreRating,
  home: CoreRating,
  sampleWeight: number
) {
  const ratingDifference =
    home.overall -
    away.overall;

  /*
    First calculate the CORE
    scoring-margin component using
    the historical calibration.
  */

  const rawCoreComponent =
    ratingDifference *
    CORE_TO_POINTS;

  /*
    Then reduce CORE's influence
    when the current-season sample
    is still developing.

    We do NOT change the calibrated
    intercept.

    This shrinks uncertain early
    CORE differences toward the
    learned average home-margin
    component.
  */

  const weightedCoreComponent =
    rawCoreComponent *
    sampleWeight;

  const rawProjectedHomeMargin =
    CALIBRATED_INTERCEPT +
    rawCoreComponent;

  const projectedHomeMargin =
    CALIBRATED_INTERCEPT +
    weightedCoreComponent;

  return {
    ratingDifference:
      Number(
        ratingDifference.toFixed(
          2
        )
      ),

    rawCoreComponent:
      Number(
        rawCoreComponent.toFixed(
          2
        )
      ),

    weightedCoreComponent:
      Number(
        weightedCoreComponent.toFixed(
          2
        )
      ),

    rawProjectedHomeMargin:
      Number(
        rawProjectedHomeMargin.toFixed(
          2
        )
      ),

    projectedHomeMargin:
      Number(
        projectedHomeMargin.toFixed(
          2
        )
      ),
  };
}

export async function GET() {
  try {
    const cfbdKey = process.env.CFBD_API_KEY;
    const [oddsData, coreResult] = await Promise.all([
      loadOddsMarket("CFB"),
      cfbdKey ? fetch(CFBD_CORE_URL, { headers: { Authorization: `Bearer ${cfbdKey}` }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(20000) })
        .then(async response => response.ok ? { ratings: await response.json() as CoreRating[], warning: null } : { ratings: [] as CoreRating[], warning: "College football statistics are temporarily unavailable." })
        .catch(() => ({ ratings: [] as CoreRating[], warning: "College football statistics are temporarily unavailable." }))
        : Promise.resolve({ ratings: [] as CoreRating[], warning: "College football events are connected. Team statistics are not connected, so model predictions are unavailable." }),
    ]);
    const coreRatings = coreResult.ratings;
    const rawEvents =
      oddsData.events ?? [];

    const analyzedGames =
      rawEvents.map(
        (event: any) => {
          const awayTeam =
            event.team1;

          const homeTeam =
            event.team2;

          const odds =
            event.odds ??
            [];

          const awayCore =
            findCoreRating(
              awayTeam,
              coreRatings
            );

          const homeCore =
            findCoreRating(
              homeTeam,
              coreRatings
            );

          const awaySpread =
            getSpread(
              odds,
              awayTeam
            );

          const homeSpread =
            getSpread(
              odds,
              homeTeam
            );

          const awayMoneyline =
            getMoneyline(
              odds,
              awayTeam
            );

          const homeMoneyline =
            getMoneyline(
              odds,
              homeTeam
            );

          const over =
            getTotal(
              odds,
              "Over"
            );

          const under =
            getTotal(
              odds,
              "Under"
            );

          const baseGame = {
            event_id:
              event.event_id,

            start_date:
              event.start_date,

            away_team:
              awayTeam,

            home_team:
              homeTeam,

            hard_rock: {
              spread: {
                away_team:
                  awayTeam,

                away_line:
                  numberValue(
                    awaySpread
                      ?.line
                  ),

                away_odds:
                  awaySpread
                    ?.american_odds ??
                  null,

                home_team:
                  homeTeam,

                home_line:
                  numberValue(
                    homeSpread
                      ?.line
                  ),

                home_odds:
                  homeSpread
                    ?.american_odds ??
                  null,
              },

              moneyline: {
                away_team:
                  awayTeam,

                away_odds:
                  awayMoneyline
                    ?.american_odds ??
                  null,

                away_implied_probability:
                  impliedProbability(
                    awayMoneyline
                      ?.american_odds ??
                      null
                  ),

                home_team:
                  homeTeam,

                home_odds:
                  homeMoneyline
                    ?.american_odds ??
                  null,

                home_implied_probability:
                  impliedProbability(
                    homeMoneyline
                      ?.american_odds ??
                      null
                  ),
              },

              total: {
                over:
                  numberValue(
                    over?.line
                  ),

                over_odds:
                  over
                    ?.american_odds ??
                  null,

                under:
                  numberValue(
                    under?.line
                  ),

                under_odds:
                  under
                    ?.american_odds ??
                  null,
              },
            },
          };

          if (
            !awayCore ||
            !homeCore
          ) {
            return {
              ...baseGame,

              stats_connected:
                false,

              missing_stats: {
                away:
                  !awayCore,

                home:
                  !homeCore,
              },

              rdg: null,
            };
          }

          /*
            Determine reliability
            BEFORE calculating the
            final projection.
          */

          const minimumSample =
            getMinimumSample(
              awayCore,
              homeCore
            );

          const sampleInfo =
            getSampleInfo(
              minimumSample
            );

          const projection =
            calculateProjection(
              awayCore,
              homeCore,
              sampleInfo.weight
            );

          let marketHomeMargin:
            number | null =
            null;

          if (
            homeSpread
              ?.line !==
            undefined
          ) {
            marketHomeMargin =
              -Number(
                homeSpread.line
              );
          } else if (
            awaySpread
              ?.line !==
            undefined
          ) {
            marketHomeMargin =
              Number(
                awaySpread.line
              );
          }

          const difference =
            marketHomeMargin ===
            null
              ? null
              : Number(
                  (
                    projection
                      .projectedHomeMargin -
                    marketHomeMargin
                  ).toFixed(
                    2
                  )
                );

          const projectedWinner =
            projection
              .projectedHomeMargin >=
            0
              ? homeTeam
              : awayTeam;

          const projectedMargin =
            Math.abs(
              projection
                .projectedHomeMargin
            );

          let spreadLean:
            | string
            | null =
            null;

          if (
            marketHomeMargin !==
            null
          ) {
            spreadLean =
              projection
                .projectedHomeMargin >
              marketHomeMargin
                ? homeTeam
                : awayTeam;
          }

          const edge =
            difference ===
            null
              ? 0
              : Math.abs(
                  difference
                );

          /*
            REVIEW SIGNALS

            Established:
            normal thresholds.

            Developing:
            projection already has
            reduced CORE influence.

            Small Sample:
            projection has heavy
            shrinkage and cannot
            receive Priority Review.
          */

          let signal =
            "Pass";

          if (edge >= 3) {
            signal =
              "Watch";
          }

          if (edge >= 5) {
            signal =
              "Strong Review";
          }

          if (edge >= 7) {
            signal =
              "Priority Review";
          }

          /*
            HARD SAFETY RULE:

            Under 75 minimum CORE
            plays cannot be labeled
            Priority Review.
          */

          if (
            sampleInfo.status ===
              "Small Sample" &&
            signal ===
              "Priority Review"
          ) {
            signal =
              "Strong Review";
          }

          return {
            ...baseGame,

            stats_connected:
              true,

            rdg: {
              projected_winner:
                projectedWinner,

              projected_margin:
                Number(
                  projectedMargin.toFixed(
                    2
                  )
                ),

              projected_home_margin:
                projection
                  .projectedHomeMargin,

              raw_projected_home_margin:
                projection
                  .rawProjectedHomeMargin,

              calibration_intercept:
                CALIBRATED_INTERCEPT,

              core_to_points_factor:
                CORE_TO_POINTS,

              core_rating_difference:
                projection
                  .ratingDifference,

              raw_core_margin_component:
                projection
                  .rawCoreComponent,

              weighted_core_margin_component:
                projection
                  .weightedCoreComponent,

              sample_weight:
                sampleInfo.weight,

              market_implied_home_margin:
                marketHomeMargin,

              model_vs_market_difference:
                difference,

              spread_lean:
                spreadLean,

              signal,

              sample_status:
                sampleInfo.status,

              minimum_core_plays:
                minimumSample,
            },

            core: {
              through_week:
                Math.min(
                  awayCore
                    .throughWeek,
                  homeCore
                    .throughWeek
                ),

              model_version:
                homeCore
                  .modelVersion,

              away: {
                team:
                  awayCore.team,

                conference:
                  awayCore
                    .conference,

                overall:
                  awayCore
                    .overall,

                offense:
                  awayCore
                    .offense,

                defense:
                  awayCore
                    .defense,

                offense_plays:
                  awayCore
                    .offensePlays,

                defense_plays:
                  awayCore
                    .defensePlays,
              },

              home: {
                team:
                  homeCore.team,

                conference:
                  homeCore
                    .conference,

                overall:
                  homeCore
                    .overall,

                offense:
                  homeCore
                    .offense,

                defense:
                  homeCore
                    .defense,

                offense_plays:
                  homeCore
                    .offensePlays,

                defense_plays:
                  homeCore
                    .defensePlays,
              },
            },
          };
        }
      );

    const connected =
      analyzedGames.filter(
        (game: any) =>
          game.stats_connected
      );

    const priority =
      connected.filter(
        (game: any) =>
          game.rdg
            ?.signal ===
          "Priority Review"
      );

    const strong =
      connected.filter(
        (game: any) =>
          game.rdg
            ?.signal ===
          "Strong Review"
      );

    const watch =
      connected.filter(
        (game: any) =>
          game.rdg
            ?.signal ===
          "Watch"
      );

    const established =
      connected.filter(
        (game: any) =>
          game.rdg
            ?.sample_status ===
          "Established"
      );

    const developing =
      connected.filter(
        (game: any) =>
          game.rdg
            ?.sample_status ===
          "Developing"
      );

    const smallSample =
      connected.filter(
        (game: any) =>
          game.rdg
            ?.sample_status ===
          "Small Sample"
      );

    return NextResponse.json({
      sportsbook:
        "Hard Rock Bet",

      sport:
        "College Football",

      season:
        SEASON,

      model:
        "RDG CFB CORE",

      version:
        "1.2-sample-adjusted",

      model_status:
        "CORE Calibrated + Sample Adjusted",

      games_found:
        analyzedGames.length,

      games_with_core:
        connected.length,

      games_missing_core:
        analyzedGames.length -
        connected.length,

      priority_reviews:
        priority.length,

      strong_reviews:
        strong.length,

      watch_reviews:
        watch.length,

      sample_breakdown: {
        established:
          established.length,

        developing:
          developing.length,

        small_sample:
          smallSample.length,
      },

      updated_at:
        new Date().toISOString(),

      calibration: {
        training_seasons: [
          2022,
          2023,
          2024,
        ],

        evaluation_season:
          2025,

        training_games:
          2236,

        evaluation_games:
          762,

        intercept:
          CALIBRATED_INTERCEPT,

        core_to_points_factor:
          CORE_TO_POINTS,

        evaluation_winner_accuracy:
          78.22,

        evaluation_margin_mae:
          10.9,
      },

      sample_adjustment: {
        established: {
          minimum_plays:
            150,

          core_weight:
            ESTABLISHED_WEIGHT,
        },

        developing: {
          minimum_plays:
            75,

          maximum_plays:
            149,

          core_weight:
            DEVELOPING_WEIGHT,
        },

        small_sample: {
          maximum_plays:
            74,

          core_weight:
            SMALL_SAMPLE_WEIGHT,

          priority_review_allowed:
            false,
        },
      },

      methodology: {
        source:
          "CFBD CORE",

        description:
          "Live 2026 CFBD CORE ratings converted to projected scoring margin using RDG historical CORE calibration. CORE influence is reduced when the current-season play sample is limited, then the projection is compared with current Hard Rock Bet lines.",

        base_formula:
          "Projected home margin = 3.0229 + (0.8165 × (home CORE - away CORE))",

        sample_adjusted_formula:
          "Projected home margin = 3.0229 + ((0.8165 × CORE difference) × sample weight)",

        calibration_intercept:
          CALIBRATED_INTERCEPT,

        core_to_points_factor:
          CORE_TO_POINTS,

        sample_weights: {
          established:
            ESTABLISHED_WEIGHT,

          developing:
            DEVELOPING_WEIGHT,

          small_sample:
            SMALL_SAMPLE_WEIGHT,
        },

        warning:
          "Historical CORE ratings used for calibration are retrospective season ratings rather than point-in-time pregame snapshots. The 78.22% historical straight-up evaluation result is not a wager win probability, ATS win rate, or evidence of profitability.",
      },

      stats_warning: coreResult.warning,
        games:
        analyzedGames,
    });
  } catch (error) {
    console.error(
      "RDG CFB Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG CFB analysis failed",

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
