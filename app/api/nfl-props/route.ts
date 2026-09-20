import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROP_TYPES = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
];

export async function GET() {
  const apiKey = process.env.ODDIZE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "ODDIZE_API_KEY is missing.",
      },
      { status: 500 }
    );
  }

  try {
    const results = [];

    for (const propType of PROP_TYPES) {
      const url =
        `https://oddize.com/api/v1/props/nfl` +
        `?prop_type=${encodeURIComponent(propType)}` +
        `&books=hrb`;

      const response = await fetch(url, {
        headers: {
          "X-API-Key": apiKey,
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

      results.push({
        prop_type: propType,
        status: response.status,
        ok: response.ok,
        response: data,
      });
    }

    return NextResponse.json({
      success: true,

      purpose:
        "NFL player prop diagnostic. No RDG model probabilities are calculated here.",

      sportsbook: "Hard Rock Bet",
      sportsbook_code: "hrb",

      markets_tested: PROP_TYPES.length,

      markets: results,

      note:
        "This route only checks whether Oddize is currently returning NFL player prop data for Hard Rock Bet.",

      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL props diagnostic error",
      },
      { status: 500 }
    );
  }
}
