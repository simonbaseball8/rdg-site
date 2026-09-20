import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEASON = 2026;

const ODDIZE_URL =
  "https://oddize.com/api/v1/odds/latest?sport=mlb&books=hrb";

const MLB_API = "https://statsapi.mlb.com/api/v1";

/*
  RDG MLB v1.1

  TEAM MODEL CALIBRATION
  Training: 2023-2024
  Held-out evaluation: 2025

  Fitted:
  logit(P(home win)) =
    0.099339
    + 0.155029 * teamStrengthDifference

  Starting-pitcher adjustment remains experimental
  and is intentionally kept much smaller than v1.0.
*/

const TEAM_INTERCEPT = 0.099339;
const TEAM_SLOPE = 0.155029;

/*
  Pitcher score coefficient has NOT yet been
  historically calibrated.

  Keep it conservative so pitcher information
  can influence the projection without allowing
  it to overwhelm the validated team component.
*/
const PITCHER_WEIGHT = 0.12;

type PitcherStats = {
  era: number | null;
  whip: number | null;
  innings: number | null;
  strikeouts: number | null;
  walks: number | null;
  gamesStarted: number | null;
};

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isPregame(startDate: string | null | undefined) {
  if (!startDate) return false;
  const start = new Date(startDate).getTime();
  if (!Number.isFinite(start)) return false;

  // Do not compare a pregame RDG projection against live/in-game prices.
  // A 5-minute cushion also avoids markets flipping while the game begins.
  return start > Date.now() + 5 * 60 * 1000;
}

function isReasonablePregameMarket(
  awayOdds: string | number | null,
  homeOdds: string | number | null
) {
  const away = Number(String(awayOdds ?? "").replace("+", ""));
  const home = Number(String(homeOdds ?? "").replace("+", ""));

  if (!Number.isFinite(away) || !Number.isFinite(home)) return false;

  // Extreme MLB moneylines such as +900/-1800 are commonly live/stale or
  // otherwise unsuitable for this pregame value model.
  return Math.abs(away) <= 600 && Math.abs(home) <= 600;
}

async function fetchJson(
  url: string,
  headers?: Record<string, string>
) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `${response.status}: ${text}`
    );
  }

  return response.json();
}

function normalizeTeam(value: string) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const TEAM_ALIASES: Record<string, string[]> = {
  ATH: ["ATHLETICS", "OAKLANDATHLETICS"],
  ARI: ["ARIZONADIAMONDBACKS"],
  ATL: ["ATLANTABRAVES"],
  BAL: ["BALTIMOREORIOLES"],
  BOS: ["BOSTONREDSOX"],
  CHC: ["CHICAGOCUBS"],
  CHW: ["CHICAGOWHITESOX"],
  CIN: ["CINCINNATIREDS"],
  CLE: ["CLEVELANDGUARDIANS"],
  COL: ["COLORADOROCKIES"],
  DET: ["DETROITTIGERS"],
  HOU: ["HOUSTONASTROS"],
  KCR: ["KANSASCITYROYALS"],
  LAA: ["LOSANGELESANGELS"],
  LAD: ["LOSANGELESDODGERS"],
  MIA: ["MIAMIMARLINS"],
  MIL: ["MILWAUKEEBREWERS"],
  MIN: ["MINNESOTATWINS"],
  NYM: ["NEWYORKMETS"],
  NYY: ["NEWYORKYANKEES"],
  PHI: ["PHILADELPHIAPHILLIES"],
  PIT: ["PITTSBURGHPIRATES"],
  SDP: ["SANDIEGOPADRES"],
  SEA: ["SEATTLEMARINERS"],
  SFG: ["SANFRANCISCOGIANTS"],
  STL: ["STLOUISCARDINALS"],
  TBR: ["TAMPABAYRAYS"],
  TEX: ["TEXASRANGERS"],
  TOR: ["TORONTOBLUEJAYS"],
  WSN: ["WASHINGTONNATIONALS"],
};

function teamsMatch(
  oddizeTeam: string,
  mlbTeam: string
) {
  const oddize = normalizeTeam(oddizeTeam);
  const mlb = normalizeTeam(mlbTeam);

  if (oddize === mlb) return true;

  return (
    TEAM_ALIASES[oddize]?.includes(mlb) ??
    false
  );
}

function numberValue(
  value: unknown
): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function americanToProbability(
  odds: string | number | null
) {
  if (odds === null || odds === undefined) {
    return null;
  }

  const value = Number(
    String(odds).replace("+", "")
  );

  if (!Number.isFinite(value) || value === 0) {
    return null;
  }

  if (value > 0) {
    return 100 / (value + 100);
  }

  return (
    Math.abs(value) /
    (Math.abs(value) + 100)
  );
}

function removeVig(
  awayOdds: string | number | null,
  homeOdds: string | number | null
) {
  const away =
    americanToProbability(awayOdds);

  const home =
    americanToProbability(homeOdds);

  if (away === null || home === null) {
    return null;
  }

  const total = away + home;

  return {
    away: away / total,
    home: home / total,
  };
}

function findMarket(
  odds: any[],
  market: string,
  team: string
) {
  return odds.find(
    (item: any) =>
      String(item.market).toLowerCase() ===
        market.toLowerCase() &&
      item.team === team
  );
}

function findTotal(
  odds: any[],
  side: string
) {
  return odds.find(
    (item: any) =>
      String(item.market).toLowerCase() ===
        "total" &&
      String(item.team).toLowerCase() ===
        side.toLowerCase()
  );
}

async function getPitcherStats(
  pitcherId: number | null
): Promise<PitcherStats | null> {
  if (!pitcherId) return null;

  try {
    const url =
      `${MLB_API}/people/${pitcherId}/stats` +
      `?stats=season` +
      `&group=pitching` +
      `&season=${SEASON}`;

    const data =
      await fetchJson(url);

    const stat =
      data.stats?.[0]?.splits?.[0]?.stat;

    if (!stat) return null;

    return {
      era: numberValue(stat.era),
      whip: numberValue(stat.whip),
      innings: numberValue(
        stat.inningsPitched
      ),
      strikeouts: numberValue(
        stat.strikeOuts
      ),
      walks: numberValue(
        stat.baseOnBalls
      ),
      gamesStarted: numberValue(
        stat.gamesStarted
      ),
    };
  } catch {
    return null;
  }
}

function pitcherScore(
  stats: PitcherStats | null
) {
  if (!stats || stats.era === null) {
    return 0;
  }

  let score =
    (4.25 - stats.era) * 0.7;

  if (stats.whip !== null) {
    score +=
      (1.3 - stats.whip) * 1.5;
  }

  const innings =
    stats.innings ?? 0;

  let sampleWeight = 1;

  if (innings < 30) {
    sampleWeight = 0.35;
  } else if (innings < 60) {
    sampleWeight = 0.6;
  } else if (innings < 100) {
    sampleWeight = 0.8;
  }

  return score * sampleWeight;
}

function teamStrength(
  wins: number,
  losses: number,
  runDifferential: number
) {
  const games = wins + losses;

  if (games === 0) {
    return 0;
  }

  const winPct =
    wins / games;

  const winComponent =
    (winPct - 0.5) * 5;

  const runDiffPerGame =
    runDifferential / games;

  const runComponent =
    runDiffPerGame * 0.8;

  return (
    winComponent +
    runComponent
  );
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function getSignal(edge: number) {
  const absolute = Math.abs(edge);

  /*
    More conservative thresholds than v1.0.

    These are review labels, NOT claims of
    historical profitability.
  */

  if (absolute >= 0.07) {
    return "Priority Review";
  }

  if (absolute >= 0.05) {
    return "Strong Review";
  }

  if (absolute >= 0.03) {
    return "Watch";
  }

  return "Pass";
}

export async function GET() {
  try {
    const oddizeKey =
      process.env.ODDIZE_API_KEY;

    if (!oddizeKey) {
      throw new Error(
        "ODDIZE_API_KEY is missing"
      );
    }

    const date = todayET();

    const scheduleUrl =
      `${MLB_API}/schedule` +
      `?sportId=1` +
      `&date=${date}` +
      `&hydrate=probablePitcher`;

    const standingsUrl =
      `${MLB_API}/standings` +
      `?leagueId=103,104` +
      `&season=${SEASON}` +
      `&standingsTypes=regularSeason`;

    const [
      oddsData,
      scheduleData,
      standingsData,
    ] = await Promise.all([
      fetchJson(ODDIZE_URL, {
        "X-API-Key": oddizeKey,
      }),
      fetchJson(scheduleUrl),
      fetchJson(standingsUrl),
    ]);

    const records =
      new Map<number, any>();

    for (
      const group of
      standingsData.records ?? []
    ) {
      for (
        const team of
        group.teamRecords ?? []
      ) {
        const id = team.team?.id;

        if (!id) continue;

        const wins =
          Number(team.wins ?? 0);

        const losses =
          Number(team.losses ?? 0);

        const runsScored =
          Number(team.runsScored ?? 0);

        const runsAllowed =
          Number(team.runsAllowed ?? 0);

        records.set(id, {
          wins,
          losses,

          winning_percentage:
            Number(
              team.winningPercentage ?? 0
            ),

          runs_scored:
            runsScored,

          runs_allowed:
            runsAllowed,

          run_differential:
            runsScored - runsAllowed,
        });
      }
    }

    const mlbGames: any[] = [];

    for (
      const dateBlock of
      scheduleData.dates ?? []
    ) {
      for (
        const game of
        dateBlock.games ?? []
      ) {
        mlbGames.push(game);
      }
    }

    const oddsEvents =
      oddsData.events ?? [];

    // Oddize can return more than one event record for the same MLB matchup.
    // Keep one Hard Rock event per actual MLB game so the board does not duplicate games.
    const matchedOddsByGamePk =
      new Map<number, any>();

    for (const event of oddsEvents) {
      const matchedGame =
        mlbGames.find(
          (game: any) =>
            teamsMatch(
              event.team1,
              game.teams?.away?.team?.name
            ) &&
            teamsMatch(
              event.team2,
              game.teams?.home?.team?.name
            )
        );

      if (!matchedGame?.gamePk) continue;

      const existing =
        matchedOddsByGamePk.get(
          matchedGame.gamePk
        );

      if (
        !existing ||
        (event.odds?.length ?? 0) >
          (existing.odds?.length ?? 0)
      ) {
        matchedOddsByGamePk.set(
          matchedGame.gamePk,
          event
        );
      }
    }

    const todaysOddsEvents =
      [...matchedOddsByGamePk.values()];

    const pitcherIds =
      new Set<number>();

    for (const game of mlbGames) {
      const awayId =
        game.teams?.away
          ?.probablePitcher?.id;

      const homeId =
        game.teams?.home
          ?.probablePitcher?.id;

      if (awayId) pitcherIds.add(awayId);
      if (homeId) pitcherIds.add(homeId);
    }

    const pitcherStatsMap =
      new Map<
        number,
        PitcherStats | null
      >();

    await Promise.all(
      [...pitcherIds].map(
        async (id) => {
          pitcherStatsMap.set(
            id,
            await getPitcherStats(id)
          );
        }
      )
    );

    const games =
      todaysOddsEvents
        .map((event: any) => {
          const awayTeam =
            event.team1;

          const homeTeam =
            event.team2;

          const odds =
            event.odds ?? [];

          const mlbGame =
            mlbGames.find(
              (game: any) =>
                teamsMatch(
                  awayTeam,
                  game.teams?.away?.team?.name
                ) &&
                teamsMatch(
                  homeTeam,
                  game.teams?.home?.team?.name
                )
            );

          if (!mlbGame) return null;

          const awayMlb =
            mlbGame.teams?.away;

          const homeMlb =
            mlbGame.teams?.home;

          const awayRecord =
            records.get(
              awayMlb?.team?.id
            );

          const homeRecord =
            records.get(
              homeMlb?.team?.id
            );

          if (!awayRecord || !homeRecord) {
            return null;
          }

          const awayPitcher =
            awayMlb?.probablePitcher ??
            null;

          const homePitcher =
            homeMlb?.probablePitcher ??
            null;

          const awayPitcherStats =
            awayPitcher?.id
              ? pitcherStatsMap.get(
                  awayPitcher.id
                ) ?? null
              : null;

          const homePitcherStats =
            homePitcher?.id
              ? pitcherStatsMap.get(
                  homePitcher.id
                ) ?? null
              : null;

          const awayMoneyline =
            findMarket(
              odds,
              "moneyline",
              awayTeam
            );

          const homeMoneyline =
            findMarket(
              odds,
              "moneyline",
              homeTeam
            );

          const awayRunLine =
            findMarket(
              odds,
              "spread",
              awayTeam
            );

          const homeRunLine =
            findMarket(
              odds,
              "spread",
              homeTeam
            );

          const over =
            findTotal(odds, "Over");

          const under =
            findTotal(odds, "Under");

          const awayMlOdds =
            awayMoneyline?.american_odds ?? null;

          const homeMlOdds =
            homeMoneyline?.american_odds ?? null;

          // RDG MLB v1.2 is a PRE-GAME model. Never compare its projection
          // with live/in-game moneylines.
          if (!isPregame(event.start_date)) {
            return null;
          }

          // Reject obviously extreme/stale market snapshots from the value board.
          if (!isReasonablePregameMarket(awayMlOdds, homeMlOdds)) {
            return null;
          }

          const market =
            removeVig(
              awayMlOdds,
              homeMlOdds
            );

          const awayTeamScore =
            teamStrength(
              awayRecord.wins,
              awayRecord.losses,
              awayRecord.run_differential
            );

          const homeTeamScore =
            teamStrength(
              homeRecord.wins,
              homeRecord.losses,
              homeRecord.run_differential
            );

          const awayStarterScore =
            pitcherScore(
              awayPitcherStats
            );

          const homeStarterScore =
            pitcherScore(
              homePitcherStats
            );

          const teamDifference =
            homeTeamScore -
            awayTeamScore;

          /*
            Historically calibrated TEAM logit.
          */

          const calibratedTeamLogit =
            TEAM_INTERCEPT +
            TEAM_SLOPE *
              teamDifference;

          const teamOnlyHomeProbability =
            logistic(
              calibratedTeamLogit
            );

          /*
            Experimental pitcher adjustment.

            Positive = advantage to home starter.
            Negative = advantage to away starter.
          */

          const pitcherDifference =
            homeStarterScore -
            awayStarterScore;

          const pitcherAdjustment =
            PITCHER_WEIGHT *
            pitcherDifference;

          const finalLogit =
            calibratedTeamLogit +
            pitcherAdjustment;

          const modelHomeProbability =
            logistic(finalLogit);

          const modelAwayProbability =
            1 -
            modelHomeProbability;

          const homeMarket =
            market?.home ?? null;

          const awayMarket =
            market?.away ?? null;

          const homeEdge =
            homeMarket !== null
              ? modelHomeProbability -
                homeMarket
              : null;

          const awayEdge =
            awayMarket !== null
              ? modelAwayProbability -
                awayMarket
              : null;

          let lean:
            string | null = null;

          let edge:
            number | null = null;

          if (
            homeEdge !== null &&
            awayEdge !== null
          ) {
            if (homeEdge > awayEdge) {
              lean = homeTeam;
              edge = homeEdge;
            } else {
              lean = awayTeam;
              edge = awayEdge;
            }
          }

          const signal =
            edge !== null
              ? getSignal(edge)
              : "Pass";

          return {
            event_id:
              event.event_id,

            game_pk:
              mlbGame.gamePk,

            start_date:
              event.start_date,

            away_team:
              awayTeam,

            home_team:
              homeTeam,

            venue:
              mlbGame.venue?.name ??
              null,

            hard_rock: {
              moneyline: {
                away_odds:
                  awayMlOdds,

                home_odds:
                  homeMlOdds,

                no_vig_away_probability:
                  awayMarket !== null
                    ? Number(
                        (
                          awayMarket *
                          100
                        ).toFixed(2)
                      )
                    : null,

                no_vig_home_probability:
                  homeMarket !== null
                    ? Number(
                        (
                          homeMarket *
                          100
                        ).toFixed(2)
                      )
                    : null,
              },

              run_line: {
                away_line:
                  numberValue(
                    awayRunLine?.line
                  ),

                away_odds:
                  awayRunLine
                    ?.american_odds ??
                  null,

                home_line:
                  numberValue(
                    homeRunLine?.line
                  ),

                home_odds:
                  homeRunLine
                    ?.american_odds ??
                  null,
              },

              total: {
                over:
                  numberValue(
                    over?.line
                  ),

                over_odds:
                  over?.american_odds ??
                  null,

                under:
                  numberValue(
                    under?.line
                  ),

                under_odds:
                  under?.american_odds ??
                  null,
              },
            },

            team_stats: {
              away: {
                ...awayRecord,

                strength_score:
                  Number(
                    awayTeamScore.toFixed(
                      3
                    )
                  ),
              },

              home: {
                ...homeRecord,

                strength_score:
                  Number(
                    homeTeamScore.toFixed(
                      3
                    )
                  ),
              },
            },

            starting_pitchers: {
              away: {
                id:
                  awayPitcher?.id ??
                  null,

                name:
                  awayPitcher
                    ?.fullName ??
                  null,

                stats:
                  awayPitcherStats,

                pitcher_score:
                  Number(
                    awayStarterScore.toFixed(
                      3
                    )
                  ),
              },

              home: {
                id:
                  homePitcher?.id ??
                  null,

                name:
                  homePitcher
                    ?.fullName ??
                  null,

                stats:
                  homePitcherStats,

                pitcher_score:
                  Number(
                    homeStarterScore.toFixed(
                      3
                    )
                  ),
              },
            },

            rdg: {
              calibrated_team_home_probability:
                Number(
                  (
                    teamOnlyHomeProbability *
                    100
                  ).toFixed(2)
                ),

              pitcher_adjustment_logit:
                Number(
                  pitcherAdjustment.toFixed(
                    4
                  )
                ),

              model_home_probability:
                Number(
                  (
                    modelHomeProbability *
                    100
                  ).toFixed(2)
                ),

              model_away_probability:
                Number(
                  (
                    modelAwayProbability *
                    100
                  ).toFixed(2)
                ),

              projected_winner:
                modelHomeProbability >= 0.5
                  ? homeTeam
                  : awayTeam,

              moneyline_lean:
                lean,

              model_market_edge:
                edge !== null
                  ? Number(
                      (
                        edge * 100
                      ).toFixed(2)
                    )
                  : null,

              signal,
            },
          };
        })
        .filter(Boolean);

    const priority =
      games.filter(
        (game: any) =>
          game.rdg?.signal ===
          "Priority Review"
      );

    const strong =
      games.filter(
        (game: any) =>
          game.rdg?.signal ===
          "Strong Review"
      );

    const watch =
      games.filter(
        (game: any) =>
          game.rdg?.signal ===
          "Watch"
      );

    return NextResponse.json({
      sportsbook:
        "Hard Rock Bet",

      sport:
        "MLB",

      season:
        SEASON,

      model:
        "RDG MLB",

      version:
        "1.2-pregame-only",

      model_status:
        "Pregame Team Model Calibrated / Pitcher Adjustment Experimental",

      games_found:
        games.length,

      priority_reviews:
        priority.length,

      strong_reviews:
        strong.length,

      watch_reviews:
        watch.length,

      calibration: {
        training_seasons:
          [2023, 2024],

        evaluation_season:
          2025,

        evaluation_games:
          2280,

        evaluation_winner_accuracy:
          55.22,

        evaluation_brier_score:
          0.245,

        evaluation_log_loss:
          0.6828,

        fitted_intercept:
          TEAM_INTERCEPT,

        fitted_strength_slope:
          TEAM_SLOPE,

        equal_team_home_probability:
          52.48,
      },

      methodology: {
        team_model:
          "Calibrated using chronological pregame team records and run differential.",

        starting_pitching:
          "ERA and WHIP with sample-size adjustment. Pitcher coefficient remains experimental and intentionally conservative.",

        market:
          "Pregame Hard Rock moneyline probabilities with sportsbook vig removed. Started games and extreme/stale market snapshots are excluded.",

        warning:
          "The 55.22% held-out result applies to the calibrated team model on the 2025 evaluation sample. It is not a betting win rate and does not establish profitability. The live pitcher-adjusted probabilities have not yet been historically validated.",
      },

      updated_at:
        new Date().toISOString(),

      games,
    });
  } catch (error) {
    console.error(
      "RDG MLB Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG MLB analysis failed",

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
