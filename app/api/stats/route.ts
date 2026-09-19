import { NextResponse } from "next/server";

export async function GET() {
  try {
    const season = 2026;

    const url =
      `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "NFL stats request failed",
          status: response.status,
        },
        { status: response.status }
      );
    }

    const csv = await response.text();

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Server error",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
