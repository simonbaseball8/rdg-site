import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NHL_API = "https://api-web.nhle.com/v1";

type TeamStats = {
  abbreviation: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  pointPct: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifferential: number;
  goalDifferentialPerGame: number;
};

function numberValue(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : 0;
}

function teamName(team: any): string {
  return (
    team?.commonName?.default ||
    team?.placeName?.default ||
    team?.name?.default ||
    team?.abbrev ||
    "Unknown"
  );
}

async function getStandings(): Promise<
  Map<string, TeamStats>
> {
  const response = await fetch(
    `${NHL_API}/standings/now`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `NHL standings request failed: ${response.status}`
    );
  }

  const data: any = await response.json();

  const standings = Array.isArray(
    data?.standings
  )
    ? data.standings
    : [];

  const map = new Map<
    string,
    TeamStats
  >();

  for (const team of standings) {
    const abbreviation =
      team?.teamAbbrev?.default ||
      team?.teamAbbrev ||
      "";

    if (!abbreviation) {
      continue;
    }

    const gamesPlayed =
      numberValue(team.gamesPlayed);

    const wins =
      numberValue(team.wins);

    const losses =
      numberValue(team.losses);

    const otLosses =
      numberValue(team.otLosses);

    const points =
      numberValue(team.points);

    const goalsFor =
      numberValue(team.goalFor);

    const goalsAgainst =
      numberValue(team.goalAgainst);

    const goalDifferential =
      goalsFor - goalsAgainst;

    /*
      NHL standings points percentage:

      points earned /
      maximum possible points
    */

    const pointPct =
      gamesPlayed > 0
        ? points /
          (gamesPlayed * 2)
        : 0;

    const goalDifferentialPerGame =
      gamesPlayed > 0
        ? goalDifferential /
          gamesPlayed
        : 0;

    map.set(abbreviation, {
      abbreviation,

      name:
        team?.teamName?.default ||
        team?.teamCommonName?.default ||
        abbreviation,

      gamesPlayed,

      wins,

      losses,

      otLosses,

      points,

      pointPct:
        Number(
          pointPct.toFixed(4)
        ),

      goalsFor,

      goalsAgainst,

      goalDifferential,

      goalDifferentialPerGame:
        Number(
          goalDifferentialPerGame.toFixed(
            3
          )
        ),
    });
  }

  return map;
}

async function getGoalieInfo(
  abbreviation: string
): Promise<any> {
  try {
    const response = await fetch(
      `${NHL_API}/club-stats/${abbreviation}/now`,
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return null;
    }

    const data: any =
      await response.json();

    const goalies =
      Array.isArray(data?.goalies)
        ? data.goalies
        : [];

    if (goalies.length === 0) {
      return null;
    }

    /*
      We are NOT claiming this goalie
      is confirmed to start.

      For now, use the goalie with the
      most games played as the team's
      primary goalie reference.
    */

    const sorted = [...goalies].sort(
      (a: any, b: any) =>
        numberValue(b.gamesPlayed) -
        numberValue(a.gamesPlayed)
    );

    const goalie = sorted[0];

    const firstName =
      goalie?.firstName?.default || "";

    const lastName =
      goalie?.lastName?.default || "";

    return {
      player_id:
        goalie?.playerId ?? null,

      name:
        `${firstName} ${lastName}`.trim(),

      games_played:
        numberValue(
          goalie?.gamesPlayed
        ),

      wins:
        numberValue(goalie?.wins),

      losses:
        numberValue(goalie?.losses),

      save_percentage:
        typeof goalie?.savePctg ===
        "number"
          ? Number(
              goalie.savePctg.toFixed(3)
            )
          : null,

      goals_against_average:
        typeof goalie
          ?.goalsAgainstAverage ===
        "number"
          ? Number(
              goalie.goalsAgainstAverage.toFixed(
                2
              )
            )
          : null,

      shutouts:
        numberValue(
          goalie?.shutouts
        ),

      status:
        "Primary goalie reference - not confirmed starter",
    };
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    /*
      NHL schedule endpoint centered
      around today's date.
    */

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    const [
      scheduleResponse,
      standings,
    ] = await Promise.all([
      fetch(
        `${NHL_API}/schedule/${today}`,
        {
          cache: "no-store",
        }
      ),

      getStandings(),
    ]);

    if (!scheduleResponse.ok) {
      throw new Error(
        `NHL schedule request failed: ${scheduleResponse.status}`
      );
    }

    const schedule: any =
      await scheduleResponse.json();

    const gameWeeks =
      Array.isArray(
        schedule?.gameWeek
      )
        ? schedule.gameWeek
        : [];

    /*
      Find today's NHL games.
    */

    const todayBlock =
      gameWeeks.find(
        (day: any) =>
          day?.date === today
      );

    const rawGames =
      Array.isArray(
        todayBlock?.games
      )
        ? todayBlock.games
        : [];

    /*
      Get goalie references only for
      teams actually playing today.
    */

    const teamAbbreviations =
      new Set<string>();

    for (const game of rawGames) {
      const home =
        game?.homeTeam?.abbrev;

      const away =
        game?.awayTeam?.abbrev;

      if (home) {
        teamAbbreviations.add(home);
      }

      if (away) {
        teamAbbreviations.add(away);
      }
    }

    const goalieMap =
      new Map<string, any>();

    await Promise.all(
      Array.from(
        teamAbbreviations
      ).map(
        async (abbreviation) => {
          const goalie =
            await getGoalieInfo(
              abbreviation
            );

          goalieMap.set(
            abbreviation,
            goalie
          );
        }
      )
    );

    const games =
      rawGames.map(
        (game: any) => {
          const homeAbbreviation =
            game?.homeTeam?.abbrev ||
            "";

          const awayAbbreviation =
            game?.awayTeam?.abbrev ||
            "";

          const homeStats =
            standings.get(
              homeAbbreviation
            ) ?? null;

          const awayStats =
            standings.get(
              awayAbbreviation
            ) ?? null;

          return {
            game_id:
              game?.id ?? null,

            season:
              game?.season ?? null,

            game_type:
              game?.gameType ?? null,

            start_time_utc:
              game?.startTimeUTC ??
              null,

            venue:
              game?.venue?.default ??
              null,

            game_state:
              game?.gameState ??
              null,

            away_team: {
              abbreviation:
                awayAbbreviation,

              name:
                teamName(
                  game?.awayTeam
                ),

              record:
                awayStats,

              primary_goalie:
                goalieMap.get(
                  awayAbbreviation
                ) ?? null,
            },

            home_team: {
              abbreviation:
                homeAbbreviation,

              name:
                teamName(
                  game?.homeTeam
                ),

              record:
                homeStats,

              primary_goalie:
                goalieMap.get(
                  homeAbbreviation
                ) ?? null,
            },
          };
        }
      );

    return NextResponse.json({
      success: true,

      sport:
        "NHL",

      date:
        today,

      source:
        "NHL",

      games_found:
        games.length,

      teams_with_standings:
        standings.size,

      goalie_note:
        "Goalie shown is the team primary goalie by games played, not a confirmed starter.",

      games,

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "NHL STATS ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown NHL stats error";

    return NextResponse.json(
      {
        success: false,
        sport: "NHL",
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
