import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDIZE_BASE = "https://oddize.com/api/v1";

const PROP_TYPES = [
  { code: "pitcher_k", name: "Pitcher Strikeouts" },
  { code: "batter_h", name: "Batter Hits" },
  { code: "batter_tb", name: "Batter Total Bases" },
  { code: "batter_hr", name: "Batter Home Runs" },
  { code: "batter_rbi", name: "Batter RBIs" },
  { code: "batter_r", name: "Batter Runs" },
];

export async function GET() {
  try {
    const apiKey = process.env.ODDIZE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing ODDIZE_API_KEY",
        },
        { status: 500 }
      );
    }

    const results = [];

    let totalCreditsUsed = 0;
    let creditsRemaining: string | null = null;

    for (const prop of PROP_TYPES) {
      const url =
        `${ODDIZE_BASE}/props/mlb` +
        `?prop_type=${prop.code}` +
        `&limit=100`;

      const response = await fetch(url, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const text = await response.text();

      const creditCost = Number(
        response.headers.get("x-credits-cost") ?? 0
      );

      totalCreditsUsed += Number.isFinite(creditCost)
        ? creditCost
        : 0;

      creditsRemaining =
        response.headers.get("x-credits-remaining") ??
        creditsRemaining;

      if (!response.ok) {
        results.push({
          prop_type: prop.code,
          name: prop.name,
          success: false,
          status: response.status,
          error: text.slice(0, 1000),
        });

        continue;
      }

      let data: any;

      try {
        data = JSON.parse(text);
      } catch {
        results.push({
          prop_type: prop.code,
          name: prop.name,
          success: false,
          error: "Oddize returned invalid JSON.",
        });

        continue;
      }

      const events = Array.isArray(data?.events)
        ? data.events
        : [];

      let eventsWithPlayers = 0;
      let totalPlayers = 0;

      const populatedEvents: any[] = [];

      for (const event of events) {
        const players = Array.isArray(event?.players)
          ? event.players
          : [];

        if (players.length === 0) {
          continue;
        }

        eventsWithPlayers++;
        totalPlayers += players.length;

        populatedEvents.push({
          event_id: event?.event_id ?? null,
          start_date: event?.start_date ?? null,
          away_team: event?.team1 ?? null,
          home_team: event?.team2 ?? null,
          player_count: players.length,

          // Keep actual player data so we can inspect
          // the Oddize structure if props are available.
          players,
        });
      }

      results.push({
        prop_type: prop.code,
        name: prop.name,
        success: true,
        events_returned: events.length,
        events_with_players: eventsWithPlayers,
        total_players: totalPlayers,

        market_available:
          totalPlayers > 0,

        // Only return populated games.
        populated_events: populatedEvents,
      });
    }

    const availableMarkets = results
      .filter(
        (result: any) =>
          result.success &&
          result.total_players > 0
      )
      .map((result: any) => ({
        prop_type: result.prop_type,
        name: result.name,
        total_players: result.total_players,
        events_with_players:
          result.events_with_players,
      }));

    return NextResponse.json({
      success: true,

      sport: "MLB",

      purpose:
        "Check all supported Oddize MLB player-prop markets for currently available data.",

      sportsbook_target:
        "Hard Rock will be isolated after confirming populated prop data.",

      credits: {
        estimated_used_this_request:
          totalCreditsUsed,

        remaining:
          creditsRemaining ?? "unknown",
      },

      summary: {
        prop_markets_checked:
          PROP_TYPES.length,

        markets_with_data:
          availableMarkets.length,

        markets_without_data:
          PROP_TYPES.length -
          availableMarkets.length,

        available_markets:
          availableMarkets,
      },

      markets: results,

      next_step:
        availableMarkets.length > 0
          ? "Inspect populated player data and identify the exact Hard Rock sportsbook structure."
          : "Oddize currently returned no MLB player props. Do not build the RDG prop odds integration until the feed contains player data.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown MLB props diagnostic error",
      },
      { status: 500 }
    );
  }
}
