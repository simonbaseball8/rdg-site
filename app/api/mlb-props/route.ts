import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDIZE_URL =
  "https://oddize.com/api/v1/offer-types";

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
          error: text.slice(0, 2000),
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
          raw: text.slice(0, 2000),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,

      purpose:
        "Find the exact Oddize prop_type codes for MLB player props.",

      looking_for: [
        "Pitcher Strikeouts",
        "Batter Hits",
        "Total Bases",
        "Home Runs",
        "RBIs",
        "Runs",
      ],

      offer_types: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown Oddize error",
      },
      { status: 500 }
    );
  }
}
