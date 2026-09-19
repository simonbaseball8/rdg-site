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

    const response = await fetch(
      "https://oddize.com/api/v1/odds/latest?sport=nfl&books=hrb",
      {
        headers: {
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Oddize request failed", status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();

    const games = (data.events ?? [])
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

        return {
          event_id: event.event_id,
          sport: event.sport,
          start_date: event.start_date,
          away_team: event.team1,
          home_team: event.team2,
          moneyline,
          spread,
          total,
        };
      })
      .filter(
        (game: any) =>
          game.moneyline.length > 0 ||
          game.spread.length > 0 ||
          game.total.length > 0
      )
      .sort(
        (a: any, b: any) =>
          new Date(a.start_date).getTime() -
          new Date(b.start_date).getTime()
      );

    return NextResponse.json({
      sportsbook: "Hard Rock Bet",
      sport: "NFL",
      count: games.length,
      updated_at: new Date().toISOString(),
      games,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
