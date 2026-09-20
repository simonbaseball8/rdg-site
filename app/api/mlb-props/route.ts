import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDIZE_URL = "https://oddize.com/api/v1/props/mlb";

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
          error: text.slice(0, 1000),
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
          raw: text.slice(0, 1000),
        },
        { status: 500 }
      );
    }

    /*
      For this diagnostic we intentionally return the
      complete Oddize response.

      We need to see the exact:
      - player field
      - market field
      - line
      - Over / Under structure
      - American odds
      - sportsbook structure
      - event ID

      Once confirmed, we'll normalize it and remove
      the large raw response.
    */

    return NextResponse.json({
      success: true,

      sport: "MLB",

      source: "Oddize league-wide MLB props",

      credits: {
        cost:
          response.headers.get("x-credits-cost") ||
          "unknown",

        remaining:
          response.headers.get(
            "x-credits-remaining"
          ) || "unknown",
      },

      oddize_response: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown MLB props error",
      },
      { status: 500 }
    );
  }
}
