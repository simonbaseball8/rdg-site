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
      const error = await response.text();

      return NextResponse.json(
        {
          error: "Oddize request failed",
          status: response.status,
          details: error,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: String(error) },
      { status: 500 }
    );
  }
}
