import { NextResponse } from "next/server";

import {
  analyzeCfbGame,
  type CfbGame,
  type CfbTeamProfile,
} from "../../../lib/rdg-cfb";

export const dynamic = "force-dynamic";

const ODDIZE_URL =
  "https://oddize.com/api/v1/odds/latest?sport=ncaaf&books=hrb";

const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80";

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function americanToImplied(
  odds: string | number | null | undefined
): number | null {
  if (odds === null || odds === undefined) return null;

  const value = Number(
    String(odds).replace("+", "")
  );

  if (!Number.isFinite(value) || value === 0) {
    return null;
  }

  if (value > 0) {
    return Number(
      (100 / (value + 100) * 100).toFixed(2)
    );
  }

  return Number(
    (Math.abs(value) /
      (Math.abs(value) + 100) *
      100
    ).toFixed(2)
  );
}

function makeProfile(
  team: string,
  recent: any[]
): CfbTeamProfile {
  const games = recent.filter(
    (g) =>
      g.home === team ||
      g.away === team
  );

  if (!games.length) {
    return {
      team,
      games: 0,
      offense: {
        pointsPerGame: 0,
        yardsPerGame: 0,
        passingYardsPerGame: 0,
        rushingYardsPerGame: 0,
        turnoversPerGame: 0,
      },
      defense: {
        pointsAllowedPerGame: 0,
        yardsAllowedPerGame: 0,
        passingYardsAllowedPerGame: 0,
        rushingYardsAllowedPerGame: 0,
        takeawaysPerGame: 0,
      },
    };
  }

  let pointsFor = 0;
  let pointsAgainst = 0;

  for (const game of games) {
    if (game.home === team) {
      pointsFor += game.homeScore;
      pointsAgainst += game.awayScore;
    } else {
      pointsFor += game.awayScore;
      pointsAgainst += game.homeScore;
    }
  }

  const ppg =
    pointsFor / games.length;

  const papg =
    pointsAgainst / games.length;

  /*
   * CFB has very different levels of competition,
   * so early-season data is intentionally conservative.
   *
   * The current model uses scoring strength as the
   * foundation until a dedicated historical CFB
   * statistics dataset is connected.
   */

  return {
    team,
    games: games.length,

    offense: {
      pointsPerGame: ppg,
      yardsPerGame: ppg * 6,
      passingYardsPerGame: ppg * 3.5,
      rushingYardsPerGame: ppg * 2.5,
      turnoversPerGame: 1,
    },

    defense: {
      pointsAllowedPerGame: papg,
      yardsAllowedPerGame: papg * 6,
      passingYardsAllowedPerGame: papg * 3.5,
      rushingYardsAllowedPerGame: papg * 2.5,
      takeawaysPerGame: 1,
    },
  };
}

function parseEspnGames(data: any) {
  const results: any[] = [];

  for (const event of data?.events ?? []) {
    const competition =
      event?.competitions?.[0];

    if (!competition) continue;

    const competitors =
      competition.competitors ?? [];

    const home =
      competitors.find(
        (c: any) =>
          c.homeAway === "home"
      );

    const away =
      competitors.find(
        (c: any) =>
          c.homeAway === "away"
      );

    if (!home || !away) continue;

    const homeScore =
      num(home.score);

    const awayScore =
      num(away.score);

    const completed =
      competition.status?.type?.completed ===
      true;

    if (!completed) continue;

    results.push({
      home:
        home.team?.displayName ??
        home.team?.abbreviation,

      away:
        away.team?.displayName ??
        away.team?.abbreviation,

      homeScore,
      awayScore,
    });
  }

  return results;
}

function findEspnTeam(
  name: string,
  games: any[]
): string {
  const normalized =
    name.toLowerCase();

  for (const game of games) {
    for (const team of [
      game.home,
      game.away,
    ]) {
      if (
        String(team)
          .toLowerCase()
          .includes(normalized) ||
        normalized.includes(
          String(team).toLowerCase()
        )
      ) {
        return team;
      }
    }
  }

  return name;
}

export async function GET() {
  try {
    const apiKey =
      process.env.ODDIZE_API_KEY;

    if (!apiKey) {
      throw new Error(
        "ODDIZE_API_KEY is missing"
      );
    }

    const [
      oddsResponse,
      espnResponse,
    ] = await Promise.all([
      fetch(ODDIZE_URL, {
        headers: {
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      }),

      fetch(ESPN_URL, {
        cache: "no-store",
      }),
    ]);

    if (!oddsResponse.ok) {
      throw new Error(
        `Oddize CFB request failed: ${oddsResponse.status}`
      );
    }

    if (!espnResponse.ok) {
      throw new Error(
        `ESPN CFB request failed: ${espnResponse.status}`
      );
    }

    const oddsData =
      await oddsResponse.json();

    const espnData =
      await espnResponse.json();

    const completedGames =
      parseEspnGames(espnData);

    const games: CfbGame[] =
      (oddsData.events ?? [])
        .map((event: any) => {
          const odds =
            event.odds ?? [];

          const moneyline =
            odds
              .filter(
                (o: any) =>
                  o.market ===
                  "moneyline"
              )
              .map((o: any) => ({
                team: o.team,
                odds: String(
                  o.american_odds
                ),
              }));

          const spread =
            odds
              .filter(
                (o: any) =>
                  o.market ===
                  "spread"
              )
              .map((o: any) => ({
                team: o.team,
                line: num(o.line),
                odds: String(
                  o.american_odds
                ),
              }));

          const total =
            odds
              .filter(
                (o: any) =>
                  o.market ===
                  "total"
              )
              .map((o: any) => ({
                side: o.team,
                line: num(o.line),
                odds: String(
                  o.american_odds
                ),
              }));

          return {
            event_id:
              event.event_id,

            start_date:
              event.start_date,

            away_team:
              event.team1,

            home_team:
              event.team2,

            moneyline,
            spread,
            total,
          };
        })
        .filter(
          (game: CfbGame) =>
            game.spread &&
            game.spread.length >= 2
        );

    const analyzed =
      games.map((game) => {
        const awayName =
          findEspnTeam(
            game.away_team,
            completedGames
          );

        const homeName =
          findEspnTeam(
            game.home_team,
            completedGames
          );

        const awayProfile =
          makeProfile(
            awayName,
            completedGames
          );

        const homeProfile =
          makeProfile(
            homeName,
            completedGames
          );

        const analysis =
          analyzeCfbGame(
            game,
            awayProfile,
            homeProfile
          );

        const edge =
          Math.abs(
            analysis.market_analysis
              .model_vs_market_difference ??
              0
          );

        let signal =
          "Pass";

        if (edge >= 2) {
          signal = "Watch";
        }

        if (edge >= 3.5) {
          signal = "Strong Review";
        }

        if (edge >= 5) {
          signal = "Priority Review";
        }

        return {
          ...game,

          stats_connected:
            awayProfile.games > 0 &&
            homeProfile.games > 0,

          rdg: {
            ...analysis,
            market_analysis: {
              ...analysis.market_analysis,

              signal,

              hard_rock_spread: {
                away_team:
                  game.away_team,

                away_line:
                  game.spread?.find(
                    (s) =>
                      s.team ===
                      game.away_team
                  )?.line ?? null,

                away_odds:
                  game.spread?.find(
                    (s) =>
                      s.team ===
                      game.away_team
                  )?.odds ?? null,

                home_team:
                  game.home_team,

                home_line:
                  game.spread?.find(
                    (s) =>
                      s.team ===
                      game.home_team
                  )?.line ?? null,

                home_odds:
                  game.spread?.find(
                    (s) =>
                      s.team ===
                      game.home_team
                  )?.odds ?? null,
              },

              hard_rock_moneyline: {
                away_team:
                  game.away_team,

                away_odds:
                  game.moneyline?.find(
                    (m) =>
                      m.team ===
                      game.away_team
                  )?.odds ?? null,

                away_implied_probability:
                  americanToImplied(
                    game.moneyline?.find(
                      (m) =>
                        m.team ===
                        game.away_team
                    )?.odds
                  ),

                home_team:
                  game.home_team,

                home_odds:
                  game.moneyline?.find(
                    (m) =>
                      m.team ===
                      game.home_team
                  )?.odds ?? null,

                home_implied_probability:
                  americanToImplied(
                    game.moneyline?.find(
                      (m) =>
                        m.team ===
                        game.home_team
                    )?.odds
                  ),
              },
            },
          },

          profiles: {
            away: awayProfile,
            home: homeProfile,
          },
        };
      });

    const priorityReviews =
      analyzed.filter(
        (game) =>
          game.rdg.market_analysis
            .signal ===
          "Priority Review"
      );

    const strongReviews =
      analyzed.filter(
        (game) =>
          game.rdg.market_analysis
            .signal ===
          "Strong Review"
      );

    return NextResponse.json({
      sportsbook:
        "Hard Rock Bet",

      sport:
        "College Football",

      model:
        "RDG CFB",

      version:
        "1.0",

      model_status:
        "Early-Season",

      games_found:
        analyzed.length,

      games_with_stats:
        analyzed.filter(
          (g) =>
            g.stats_connected
        ).length,

      priority_reviews:
        priorityReviews.length,

      strong_reviews:
        strongReviews.length,

      updated_at:
        new Date().toISOString(),

      note:
        "CFB model currently uses completed-game scoring data plus Hard Rock market lines. Historical calibration will be added after sufficient CFB samples are collected.",

      games: analyzed,
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
