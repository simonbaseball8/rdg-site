import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEASON = 2026;

/*
  RDG CFB CORE calibration

  Training:
  2022-2024 FBS games

  Evaluation:
  2025 FBS games

  Fitted formula:
  projected home margin =
  3.0229 + (0.8165 × CORE difference)

  IMPORTANT:
  Historical CORE ratings used for this
  calibration are retrospective ratings,
  so this is not an ATS profitability
  backtest or a win probability model.
*/

const CALIBRATED_INTERCEPT = 3.0229;
const CORE_TO_POINTS = 0.8165;

const ODDIZE_URL =
  "https://oddize.com/api/v1/odds/latest?sport=ncaaf&books=hrb";

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

function normalizeTeam(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/STATE/g, "ST")
    .replace(/UNIVERSITY/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function findCoreRating(
  oddizeTeam: string,
  ratings: CoreRating[]
): CoreRating | null {
  const target =
    normalizeTeam(oddizeTeam);

  const exact = ratings.find(
    (rating) =>
      normalizeTeam(rating.team) ===
      target
  );

  if (exact) return exact;

  const partial = ratings.find(
    (rating) => {
      const candidate =
        normalizeTeam(rating.team);

      return (
        candidate.includes(target) ||
        target.includes(candidate)
      );
    }
  );

  return partial ?? null;
}

function numberValue(
  value: unknown
): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function getSpread(
  odds: any[],
  team: string
) {
  return odds.find(
    (item: any) =>
      item.market === "spread" &&
      item.team === team
  );
}

function getMoneyline(
  odds: any[],
  team: string
) {
  return odds.find(
    (item: any) =>
      item.market === "moneyline" &&
      item.team === team
  );
}

function getTotal(
  odds: any[],
  side: string
) {
  return odds.find(
    (item: any) =>
      item.market === "total" &&
      String(
        item.team
      ).toLowerCase() ===
        side.toLowerCase()
  );
}

function impliedProbability(
  odds: string | number | null
): number | null {
  if (odds === null) {
    return null;
  }

  const value = Number(
    String(odds).replace("+", "")
  );

  if (
    !Number.isFinite(value) ||
    value === 0
  ) {
    return null;
  }

  if (value > 0) {
    return Number(
      (
        (100 / (value + 100)) *
        100
      ).toFixed(2)
    );
  }

  return Number(
    (
      (Math.abs(value) /
        (Math.abs(value) + 100)) *
      100
    ).toFixed(2)
  );
}

function calculateProjection(
  away: CoreRating,
  home: CoreRating
) {
  const ratingDifference =
    home.overall - away.overall;

  const coreMarginComponent =
    ratingDifference *
    CORE_TO_POINTS;

  const projectedHomeMargin =
    CALIBRATED_INTERCEPT +
    coreMarginComponent;

  return {
    ratingDifference:
      Number(
        ratingDifference.toFixed(2)
      ),

    coreMarginComponent:
      Number(
        coreMarginComponent.toFixed(2)
      ),

    projectedHomeMargin:
      Number(
        projectedHomeMargin.toFixed(2)
      ),
  };
}

export async function GET() {
  try {
    const oddizeKey =
      process.env.ODDIZE_API_KEY;

    const cfbdKey =
      process.env.CFBD_API_KEY;

    if (!oddizeKey) {
      throw new Error(
        "ODDIZE_API_KEY is missing"
      );
    }

    if (!cfbdKey) {
      throw new Error(
        "CFBD_API_KEY is missing"
      );
    }

    const [
      oddsResponse,
      coreResponse,
    ] = await Promise.all([
      fetch(ODDIZE_URL, {
        headers: {
          "X-API-Key": oddizeKey,
        },
        cache: "no-store",
      }),

      fetch(CFBD_CORE_URL, {
        headers: {
          Authorization:
            `Bearer ${cfbdKey}`,
        },
        cache: "no-store",
      }),
    ]);

    if (!oddsResponse.ok) {
      const text =
        await oddsResponse.text();

      throw new Error(
        `Oddize failed ${oddsResponse.status}: ${text}`
      );
    }

    if (!coreResponse.ok) {
      const text =
        await coreResponse.text();

      throw new Error(
        `CFBD failed ${coreResponse.status}: ${text}`
      );
    }

    const oddsData =
      await oddsResponse.json();

    const coreRatings:
      CoreRating[] =
      await coreResponse.json();

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
            event.odds ?? [];

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
                    awaySpread?.line
                  ),

                away_odds:
                  awaySpread
                    ?.american_odds ??
                  null,

                home_team:
                  homeTeam,

                home_line:
                  numberValue(
                    homeSpread?.line
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

          const projection =
            calculateProjection(
              awayCore,
              homeCore
            );

          let marketHomeMargin:
            number | null = null;

          if (
            homeSpread?.line !==
            undefined
          ) {
            marketHomeMargin =
              -Number(
                homeSpread.line
              );
          } else if (
            awaySpread?.line !==
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
                  ).toFixed(2)
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
            string | null = null;

          if (
            marketHomeMargin !== null
          ) {
            spreadLean =
              projection
                .projectedHomeMargin >
              marketHomeMargin
                ? homeTeam
                : awayTeam;
          }

          const edge =
            difference === null
              ? 0
              : Math.abs(
                  difference
                );

          /*
            Review labels remain
            descriptive model-vs-market
            differences.

            They are NOT probabilities
            and are NOT claims of
            profitability.
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

          const minimumSample =
            Math.min(
              awayCore.offensePlays,
              awayCore.defensePlays,
              homeCore.offensePlays,
              homeCore.defensePlays
            );

          const sampleStatus =
            minimumSample >= 150
              ? "Established"
              : minimumSample >= 75
              ? "Developing"
              : "Small Sample";

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

              calibration_intercept:
                CALIBRATED_INTERCEPT,

              core_to_points_factor:
                CORE_TO_POINTS,

              core_rating_difference:
                projection
                  .ratingDifference,

              core_margin_component:
                projection
                  .coreMarginComponent,

              market_implied_home_margin:
                marketHomeMargin,

              model_vs_market_difference:
                difference,

              spread_lean:
                spreadLean,

              signal,

              sample_status:
                sampleStatus,

              minimum_core_plays:
                minimumSample,
            },

            core: {
              through_week:
                Math.min(
                  awayCore.throughWeek,
                  homeCore.throughWeek
                ),

              model_version:
                homeCore.modelVersion,

              away: {
                team:
                  awayCore.team,

                conference:
                  awayCore.conference,

                overall:
                  awayCore.overall,

                offense:
                  awayCore.offense,

                defense:
                  awayCore.defense,

                offense_plays:
                  awayCore.offensePlays,

                defense_plays:
                  awayCore.defensePlays,
              },

              home: {
                team:
                  homeCore.team,

                conference:
                  homeCore.conference,

                overall:
                  homeCore.overall,

                offense:
                  homeCore.offense,

                defense:
                  homeCore.defense,

                offense_plays:
                  homeCore.offensePlays,

                defense_plays:
                  homeCore.defensePlays,
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
          game.rdg?.signal ===
          "Priority Review"
      );

    const strong =
      connected.filter(
        (game: any) =>
          game.rdg?.signal ===
          "Strong Review"
      );

    const watch =
      connected.filter(
        (game: any) =>
          game.rdg?.signal ===
          "Watch"
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
        "1.1-calibrated",

      model_status:
        "CORE Calibrated",

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

      methodology: {
        source:
          "CFBD CORE",

        description:
          "Live 2026 CFBD CORE ratings converted to projected scoring margin using RDG's historical CORE calibration, then compared with current Hard Rock Bet lines.",

        formula:
          "Projected home margin = 3.0229 + (0.8165 × (home CORE - away CORE))",

        calibration_intercept:
          CALIBRATED_INTERCEPT,

        core_to_points_factor:
          CORE_TO_POINTS,

        warning:
          "Historical CORE ratings used for calibration are retrospective season ratings rather than point-in-time pregame snapshots. Historical winner accuracy is not a wager win probability, ATS win rate, or evidence of profitability.",
      },

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
