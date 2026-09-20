import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDIZE_URL =
  "https://oddize.com/api/v1/props/mlb?prop_type=pitcher_k&limit=100";

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

    const response = await fetch(ODDIZE_URL, {
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          status: response.status,
          error: text.slice(0, 3000),
        },
        { status: response.status }
      );
    }

    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Oddize returned non-JSON data.",
          raw: text.slice(0, 3000),
        },
        { status: 500 }
      );
    }

    /*
      TEMPORARY DIAGNOSTIC

      We are requesting the league-wide MLB
      Pitcher Strikeouts market:

      prop_type = pitcher_k

      We intentionally return the full Oddize response
      so we can inspect the exact structure for:

      - Pitcher name
      - Team
      - Event ID
      - Main strikeout line
      - Over odds
      - Under odds
      - Hard Rock sportsbook identifier
      - Alternate lines
      - All available sportsbook prices

      After confirming the structure, this route will
      be converted into the production RDG prop feed.
    */

    const games =
      data?.events ??
      data?.games ??
      data?.data ??
      data?.props ??
      [];

    return NextResponse.json({
      success: true,

      sport: "MLB",

      prop_market: {
        name: "Pitcher Strikeouts",
        code: "pitcher_k",
      },

      sportsbook_target: "Hard Rock",

      diagnostic: true,

      credits: {
        cost:
          response.headers.get("x-credits-cost") ??
          "unknown",

        remaining:
          response.headers.get("x-credits-remaining") ??
          "unknown",
      },

      games_returned: Array.isArray(games)
        ? games.length
        : null,

      oddize_response: data,

      next_step:
        "Inspect the exact pitcher_k response structure, identify Hard Rock prices, then build the RDG Pitcher Strikeouts model.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown MLB pitcher props error",
      },
      { status: 500 }
    );
  }
}
