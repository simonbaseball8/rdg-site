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

    const games = (data.events ?? []).map((event: any) => {
      const odds = event.odds ?? [];

      const moneylines = odds.filter(
        (odd: any) => odd.market === "moneyline"
      );

      const spreads = odds.filter(
        (odd: any) => odd.market === "spread"
      );

      const totals = odds.filter(
        (odd: any) => odd.market === "total"
      );

      return {
        event_id: event.event_id,
        sport: event.sport,
        start_date: event.start_date,
        away_team: event.team1,
        home_team: event.team2,

        moneyline: moneylines.map((odd: any) => ({
          team: odd.team,
          odds: odd.american_odds,
        })),

        spread: spreads.map((odd: any) => ({
          team: odd.team,
          line: odd.line,
          odds: odd.american_odds,
        })),

        total: totals.map((odd: any) => ({
          side: odd.team,
          line: odd.line,
          odds: odd.american_odds,
        })),
      };
    });

    return NextResponse.json({
      sportsbook: "Hard Rock Bet",
      sport: "NFL",
      count: games.length,
      games,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
