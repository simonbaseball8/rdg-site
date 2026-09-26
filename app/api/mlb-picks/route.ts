import { loadOddsMarket } from "../../../lib/odds-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEASON = 2026;


const MLB_API = "https://statsapi.mlb.com/api/v1";

/*
  RDG MLB v1.4

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
  providerTeam: string,
  mlbTeam: string
) {
  const provider = normalizeTeam(providerTeam);
  const mlb = normalizeTeam(mlbTeam);

  if (provider === mlb) return true;

  return (
    TEAM_ALIASES[provider]?.includes(mlb) ??
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

  if (absolute >= 0.07) return "Priority Review";
  if (absolute >= 0.05) return "Strong Review";
  if (absolute >= 0.03) return "Watch";
  return "Pass";
}

/*
  MLB v1.5 conservative moneyline review filter.

  This does NOT change the calibrated model probability.
  It only makes the live betting-review layer more selective.
*/
function getMoneylineSignal(
  edge: number,
  modelProbability: number,
  americanOdds: number | null
) {
  if (!Number.isFinite(edge) || edge <= 0) return "Pass";
  if (!Number.isFinite(modelProbability)) return "Pass";
  if (americanOdds === null || !Number.isFinite(americanOdds)) return "Pass";

  const isUnderdog = americanOdds > 100;

  if (isUnderdog) {
    // Plus-money underdogs need a larger edge and stronger win probability.
    if (modelProbability < 0.42) return "Pass";
    if (edge >= 0.09 && modelProbability >= 0.47) return "Priority Review";
    if (edge >= 0.07 && modelProbability >= 0.45) return "Strong Review";
    if (edge >= 0.05 && modelProbability >= 0.42) return "Watch";
    return "Pass";
  }

  // Favorites / near pick'em.
  if (edge >= 0.065 && modelProbability >= 0.55) return "Priority Review";
  if (edge >= 0.045 && modelProbability >= 0.53) return "Strong Review";
  if (edge >= 0.03 && modelProbability >= 0.51) return "Watch";
  return "Pass";
}


// RDG MLB totals v1.4 calibration from the chronological 2023-2024
// training / 2025 held-out backtest.
const TOTAL_INTERCEPT = 3.019046;
const TOTAL_SLOPE = 0.664567;
const TOTAL_SIGMA = 4.56;

function normalCdf(x: number) {
  // Abramowitz-Stegun approximation. Accurate enough for model probabilities.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t) *
      Math.exp(-z * z);

  return 0.5 * (1 + sign * erf);
}

function totalProbabilities(projectedTotal: number, line: number) {
  /*
    v1.4 uses the held-out 2025 total-error RMSE (~4.56 runs) as a
    conservative predictive spread instead of a Poisson distribution.
    This prevents unrealistically confident Over/Under probabilities.
  */
  if (!Number.isFinite(projectedTotal) || !Number.isFinite(line)) return null;

  const z = (line - projectedTotal) / TOTAL_SIGMA;
  const under = normalCdf(z);
  const over = 1 - under;

  return { over, under };
}

function projectedGameTotal(
  awayRecord: any,
  homeRecord: any
) {
  const awayGames = Number(awayRecord.wins ?? 0) + Number(awayRecord.losses ?? 0);
  const homeGames = Number(homeRecord.wins ?? 0) + Number(homeRecord.losses ?? 0);

  if (awayGames <= 0 || homeGames <= 0) return null;

  const awayRunsFor = Number(awayRecord.runs_scored ?? 0) / awayGames;
  const awayRunsAgainst = Number(awayRecord.runs_allowed ?? 0) / awayGames;
  const homeRunsFor = Number(homeRecord.runs_scored ?? 0) / homeGames;
  const homeRunsAgainst = Number(homeRecord.runs_allowed ?? 0) / homeGames;

  // Chronological team-only baseline used by the totals backtest.
  const awayRaw = (awayRunsFor + homeRunsAgainst) / 2;
  const homeRaw = (homeRunsFor + awayRunsAgainst) / 2;
  const rawTotal = awayRaw + homeRaw;

  // Historical calibration learned on 2023-2024 and evaluated on 2025.
  const calibratedTotal = TOTAL_INTERCEPT + TOTAL_SLOPE * rawTotal;

  // Preserve a reasonable team split for display only. Betting probability
  // is driven by the historically calibrated GAME total above.
  const rawShare = rawTotal > 0 ? awayRaw / rawTotal : 0.5;
  const awayExpected = calibratedTotal * rawShare;
  const homeExpected = calibratedTotal - awayExpected;

  return {
    away_runs: awayExpected,
    home_runs: homeExpected,
    raw_total_runs: rawTotal,
    total_runs: calibratedTotal,
  };
}

export async function GET() {
  try {
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
      loadOddsMarket("MLB"),
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

    // Match each provider event to the scheduled game, including doubleheaders.
    // Keep one Hard Rock event per actual MLB game so the board does not duplicate games.
    const matchedOddsByGamePk =
      new Map<number, any>();

    for (const event of oddsEvents) {
      const matchedGame =
        mlbGames.find(
          (game: any) =>
            Math.abs(Date.parse(game.gameDate) - Date.parse(event.start_date)) < 90 * 60_000 &&
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
                Math.abs(Date.parse(game.gameDate) - Date.parse(event.start_date)) < 90 * 60_000 &&
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

          const leanModelProbability =
            lean === homeTeam
              ? modelHomeProbability
              : lean === awayTeam
                ? modelAwayProbability
                : null;

          const leanAmericanOdds =
            lean === homeTeam
              ? numberValue(homeMlOdds)
              : lean === awayTeam
                ? numberValue(awayMlOdds)
                : null;

          const signal =
            edge !== null &&
            leanModelProbability !== null
              ? getMoneylineSignal(
                  edge,
                  leanModelProbability,
                  leanAmericanOdds
                )
              : "Pass";

          const totalLine =
            numberValue(over?.line) ??
            numberValue(under?.line);

          const totalMarket =
            removeVig(
              over?.american_odds ?? null,
              under?.american_odds ?? null
            );

          const totalProjection =
            projectedGameTotal(
              awayRecord,
              homeRecord
            );

          const totalModel =
            totalLine !== null &&
            totalProjection !== null
              ? totalProbabilities(
                  totalProjection.total_runs,
                  totalLine
                )
              : null;

          const overModelProbability =
            totalModel?.over ?? null;

          const underModelProbability =
            totalModel?.under ?? null;

          // removeVig returns away/home keys; for totals we pass Over first,
          // Under second, so away = Over and home = Under.
          const overMarketProbability =
            totalMarket?.away ?? null;

          const underMarketProbability =
            totalMarket?.home ?? null;

          const overEdge =
            overModelProbability !== null &&
            overMarketProbability !== null
              ? overModelProbability -
                overMarketProbability
              : null;

          const underEdge =
            underModelProbability !== null &&
            underMarketProbability !== null
              ? underModelProbability -
                underMarketProbability
              : null;

          let totalLean:
            "Over" | "Under" | null = null;

          let totalEdge:
            number | null = null;

          if (
            overEdge !== null &&
            underEdge !== null
          ) {
            if (overEdge > underEdge) {
              totalLean = "Over";
              totalEdge = overEdge;
            } else {
              totalLean = "Under";
              totalEdge = underEdge;
            }
          }

          /*
            Totals are experimental and not historically calibrated yet.
            Require a larger discrepancy than the moneyline review board
            before surfacing them as candidates.
          */
          const totalSignal =
            totalEdge !== null &&
            Math.abs(totalEdge) >= 0.08
              ? "Experimental Review"
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

              review_filter: {
                selected_odds:
                  leanAmericanOdds,

                selected_model_probability:
                  leanModelProbability !== null
                    ? Number(
                        (
                          leanModelProbability * 100
                        ).toFixed(2)
                      )
                    : null,

                plus_money_underdog:
                  leanAmericanOdds !== null
                    ? leanAmericanOdds > 100
                    : null,

                rule:
                  "Underdogs require larger edge and minimum model probability; favorites/pick'em use conservative edge + probability thresholds.",
              },

              total_model: {
                status:
                  "Backtest-Calibrated Team Total / Conservative Probability",

                projected_away_runs:
                  totalProjection !== null
                    ? Number(
                        totalProjection.away_runs.toFixed(2)
                      )
                    : null,

                projected_home_runs:
                  totalProjection !== null
                    ? Number(
                        totalProjection.home_runs.toFixed(2)
                      )
                    : null,

                projected_total_runs:
                  totalProjection !== null
                    ? Number(
                        totalProjection.total_runs.toFixed(2)
                      )
                    : null,

                market_total:
                  totalLine,

                model_over_probability:
                  overModelProbability !== null
                    ? Number(
                        (
                          overModelProbability * 100
                        ).toFixed(2)
                      )
                    : null,

                model_under_probability:
                  underModelProbability !== null
                    ? Number(
                        (
                          underModelProbability * 100
                        ).toFixed(2)
                      )
                    : null,

                no_vig_over_probability:
                  overMarketProbability !== null
                    ? Number(
                        (
                          overMarketProbability * 100
                        ).toFixed(2)
                      )
                    : null,

                no_vig_under_probability:
                  underMarketProbability !== null
                    ? Number(
                        (
                          underMarketProbability * 100
                        ).toFixed(2)
                      )
                    : null,

                lean:
                  totalLean,

                edge:
                  totalEdge !== null
                    ? Number(
                        (
                          totalEdge * 100
                        ).toFixed(2)
                      )
                    : null,

                signal:
                  totalSignal,
              },
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
        "1.5-conservative-moneyline-review-plus-calibrated-totals",

      model_status:
        "Pregame Moneyline Model + Conservative Review Filter + Backtest-Calibrated Game Totals",

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
          "Pregame Hard Rock moneyline and game-total prices with sportsbook vig removed. Started games and extreme/stale moneyline snapshots are excluded.",

        totals_model:
          "Team-only game-total projection calibrated on 2023-2024 chronological pregame data and evaluated on 2025. Live Over/Under probabilities use the 2025 held-out RMSE (4.56 runs) as a conservative normal predictive spread. Starting-pitcher adjustments are intentionally excluded from totals because they were not part of the totals backtest.",

        warning:
          "The 55.22% held-out result applies only to the calibrated moneyline team model on the 2025 evaluation sample. The v1.5 moneyline review filter is intentionally more selective, especially for plus-money underdogs, but has NOT been historically validated against sportsbook closing lines because historical moneyline prices are not in this dataset. The totals projection was separately evaluated on 2025 with MAE 3.611 runs and RMSE 4.56 runs. Historical sportsbook total lines/prices were not available, so Over/Under selection accuracy, EV, and profitability are not validated. The live moneyline pitcher adjustment also remains experimental.",
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
