import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const baseUrl = new URL(request.url).origin;

    const [oddsResponse, statsResponse] = await Promise.all([
      fetch(`${baseUrl}/api/odds`, { cache: "no-store" }),
      fetch(`${baseUrl}/api/stats`, { cache: "no-store" }),
    ]);

    if (!oddsResponse.ok || !statsResponse.ok) {
      return NextResponse.json(
        {
          error: "Failed to load odds or NFL stats",
          odds_status: oddsResponse.status,
          stats_status: statsResponse.status,
        },
        { status: 500 }
      );
    }

    const oddsData = await oddsResponse.json();
    const statsCsv = await statsResponse.text();

    const lines = statsCsv.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());

    const stats = lines.slice(1).map((line) => {
      const values = line.split(",");

      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() ?? "";
      });

      return row;
    });

    const teamStats = new Map<string, Record<string, string>[]>();

    for (const row of stats) {
      const team = row.team;

      if (!team) continue;

      if (!teamStats.has(team)) {
        teamStats.set(team, []);
      }

      teamStats.get(team)!.push(row);
    }

    const games = (oddsData.games ?? []).map((game: any) => {
      const awayStats = teamStats.get(game.away_team) ?? [];
      const homeStats = teamStats.get(game.home_team) ?? [];

      return {
        ...game,

        stats_match: {
          away_team: game.away_team,
          away_games_found: awayStats.length,

          home_team: game.home_team,
          home_games_found: homeStats.length,
        },

        stats_connected:
          awayStats.length > 0 && homeStats.length > 0,
      };
    });

    return NextResponse.json({
      sportsbook: oddsData.sportsbook,
      sport: "NFL",
      games_found: games.length,
      games_with_stats: games.filter(
        (game: any) => game.stats_connected
      ).length,
      games,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Analysis route failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
