import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.SPORTSGAMEODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "SPORTSGAMEODDS_API_KEY is missing.",
      },
      { status: 500 }
    );
  }

  try {
    const url =
      "https://api.sportsgameodds.com/v2/events?" +
      new URLSearchParams({
        leagueID: "NFL",
        oddsAvailable: "true",
        limit: "10",
      }).toString();

    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
      },
      cache: "no-store",
    });

    const text = await response.text();

    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw_response: text,
      };
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          provider: "SportsGameOdds",
          status: response.status,
          response: data,
        },
        { status: response.status }
      );
    }

    const events = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.events)
        ? data.events
        : [];

    const summary = events.map((event: any) => {
      const odds =
        event?.odds && typeof event.odds === "object"
          ? Object.values(event.odds)
          : [];

      const playerOdds = odds.filter((odd: any) => {
        const betType = String(
          odd?.betTypeID ??
            odd?.betType ??
            odd?.marketName ??
            odd?.statID ??
            ""
        ).toLowerCase();

        const player =
          odd?.playerID ??
          odd?.playerName ??
          odd?.participantID ??
          odd?.participantName;

        return (
          Boolean(player) ||
          betType.includes("passing") ||
          betType.includes("rushing") ||
          betType.includes("receiving") ||
          betType.includes("touchdown") ||
          betType.includes("reception")
        );
      });

      return {
        event_id: event?.eventID ?? event?.id ?? null,
        status: event?.status ?? null,
        start_time:
          event?.startsAt ??
          event?.startTime ??
          event?.startDate ??
          null,

        teams: event?.teams ?? null,

        total_odds_records: odds.length,
        possible_player_prop_records: playerOdds.length,

        player_prop_sample: playerOdds.slice(0, 10),
      };
    });

    return NextResponse.json({
      success: true,

      provider: "SportsGameOdds",

      purpose:
        "Diagnostic test for NFL player prop availability. No RDG projections or betting probabilities are calculated.",

      events_found: events.length,

      events_with_possible_player_props: summary.filter(
        (event: any) => event.possible_player_prop_records > 0
      ).length,

      events: summary,

      raw_first_event: events[0] ?? null,

      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "SportsGameOdds",
        error:
          error instanceof Error
            ? error.message
            : "Unknown SportsGameOdds error",
      },
      { status: 500 }
    );
  }
}
