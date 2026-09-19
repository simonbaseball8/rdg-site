import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MLB_API = "https://statsapi.mlb.com/api/v1";

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
      `MLB API failed ${response.status}: ${text}`
    );
  }

  return response.json();
}

export async function GET() {
  try {
    const date = todayET();

    /*
      1. Get today's MLB schedule.

      hydrate=probablePitcher gives us
      probable starters when MLB has
      officially listed them.
    */

    const scheduleUrl =
      `${MLB_API}/schedule` +
      `?sportId=1` +
      `&date=${date}` +
      `&hydrate=probablePitcher`;

    /*
      2. Get current MLB standings.

      We use league IDs:
      103 = American League
      104 = National League
    */

    const standingsUrl =
      `${MLB_API}/standings` +
      `?leagueId=103,104` +
      `&season=2026` +
      `&standingsTypes=regularSeason`;

    const [scheduleData, standingsData] =
      await Promise.all([
        fetchJson(scheduleUrl),
        fetchJson(standingsUrl),
      ]);

    /*
      Build team record lookup.
    */

    const teamRecords = new Map<
      number,
      {
        wins: number;
        losses: number;
        winning_percentage: number;
        runs_scored: number | null;
        runs_allowed: number | null;
        run_differential: number | null;
      }
    >();

    for (const recordGroup of standingsData.records ?? []) {
      for (const teamRecord of recordGroup.teamRecords ?? []) {
        const teamId =
          teamRecord.team?.id;

        if (!teamId) continue;

        const wins =
          Number(teamRecord.wins ?? 0);

        const losses =
          Number(teamRecord.losses ?? 0);

        const winningPercentage =
          Number(
            teamRecord.winningPercentage ?? 0
          );

        const runsScored =
          teamRecord.runsScored !== undefined
            ? Number(teamRecord.runsScored)
            : null;

        const runsAllowed =
          teamRecord.runsAllowed !== undefined
            ? Number(teamRecord.runsAllowed)
            : null;

        const runDifferential =
          runsScored !== null &&
          runsAllowed !== null
            ? runsScored - runsAllowed
            : null;

        teamRecords.set(teamId, {
          wins,
          losses,
          winning_percentage:
            winningPercentage,
          runs_scored:
            runsScored,
          runs_allowed:
            runsAllowed,
          run_differential:
            runDifferential,
        });
      }
    }

    /*
      Flatten today's schedule.
    */

    const games: any[] = [];

    for (const dateBlock of scheduleData.dates ?? []) {
      for (const game of dateBlock.games ?? []) {
        const away =
          game.teams?.away;

        const home =
          game.teams?.home;

        const awayId =
          away?.team?.id;

        const homeId =
          home?.team?.id;

        const awayRecord =
          awayId
            ? teamRecords.get(awayId)
            : null;

        const homeRecord =
          homeId
            ? teamRecords.get(homeId)
            : null;

        const awayPitcher =
          away?.probablePitcher ?? null;

        const homePitcher =
          home?.probablePitcher ?? null;

        games.push({
          game_pk:
            game.gamePk,

          game_date:
            game.gameDate,

          status:
            game.status?.detailedState ??
            null,

          venue:
            game.venue?.name ??
            null,

          away: {
            team_id:
              awayId ?? null,

            team:
              away?.team?.name ??
              null,

            abbreviation:
              away?.team?.abbreviation ??
              null,

            record:
              awayRecord ?? null,

            probable_pitcher: awayPitcher
              ? {
                  id:
                    awayPitcher.id ??
                    null,

                  name:
                    awayPitcher.fullName ??
                    null,
                }
              : null,
          },

          home: {
            team_id:
              homeId ?? null,

            team:
              home?.team?.name ??
              null,

            abbreviation:
              home?.team?.abbreviation ??
              null,

            record:
              homeRecord ?? null,

            probable_pitcher: homePitcher
              ? {
                  id:
                    homePitcher.id ??
                    null,

                  name:
                    homePitcher.fullName ??
                    null,
                }
              : null,
          },
        });
      }
    }

    return NextResponse.json({
      sport: "MLB",

      season: 2026,

      source:
        "MLB Stats API",

      version:
        "0.1-stats-connection",

      status:
        "Connected",

      date,

      games_found:
        games.length,

      games_with_both_probable_pitchers:
        games.filter(
          (game) =>
            game.away.probable_pitcher &&
            game.home.probable_pitcher
        ).length,

      games_with_team_records:
        games.filter(
          (game) =>
            game.away.record &&
            game.home.record
        ).length,

      updated_at:
        new Date().toISOString(),

      games,
    });
  } catch (error) {
    console.error(
      "RDG MLB Stats Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG MLB stats connection failed",

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
