import { NextResponse } from "next/server";

export async function GET() {
  try {
    const apiKey = process.env.ODDIZE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "ODDIZE_API_KEY is missing" },
        { status: 500 }
      );
    }

    // Get Hard Rock NFL odds directly from Oddize
    const oddsResponse = await fetch(
      "https://oddize.com/api/v1/odds/latest?sport=nfl&books=hrb",
      {
        headers: {
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      }
    );

    if (!oddsResponse.ok) {
      return NextResponse.json(
        {
          error: "Oddize request failed",
          status: oddsResponse.status,
        },
        { status: 500 }
      );
    }

    const oddsData = await oddsResponse.json();

    // Get NFL team stats directly from nflverse
    const statsResponse = await fetch(
      "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2026.csv",
      { cache: "no-store" }
    );

    if (!statsResponse.ok) {
      return NextResponse.json(
        {
          error: "NFL stats request failed",
          status: statsResponse.status,
        },
        { status: 500 }
      );
    }

    const statsCsv = await statsResponse.text();

    const lines = statsCsv.trim().split(/\r?\n/);
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
      if (!row.team) continue;

      if (!teamStats.has(row.team)) {
        teamStats.set(row.team, []);
      }

      teamStats.get(row.team)!.push(row);
    }

    const games = (oddsData.events ?? [])
      .map((event: any) => {
        const odds = event.odds ?? [];

        const moneyline = odds
          .filter((o: any) => o.market === "moneyline")
          .map((o: any) => ({
            team: o.team,
            odds: o.american_odds,
          }));

        const spread = odds
          .filter((o: any) => o.market === "spread")
          .map((o: any) => ({
            team: o.team,
            line: o.line,
            odds: o.american_odds,
          }));

        const total = odds
          .filter((o: any) => o.market === "total")
          .map((o: any) => ({
            side: o.team,
            line: o.line,
            odds: o.american_odds,
          }));

        const awayStats = teamStats.get(event.team1) ?? [];
        const homeStats = teamStats.get(event.team2) ?? [];

        return {
          event_id: event.event_id,
          start_date: event.start_date,
          away_team: event.team1,
          home_team: event.team2,
          moneyline,
          spread,
          total,

          stats_match: {
            away_games_found: awayStats.length,
            home_games_found: homeStats.length,
          },

          stats_connected:
            awayStats.length > 0 && homeStats.length > 0,
        };
      })
      .filter(
        (game: any) =>
          game.moneyline.length > 0 ||
          game.spread.length > 0 ||
          game.total.length > 0
      );

    return NextResponse.json({
      sportsbook: "Hard Rock Bet",
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
