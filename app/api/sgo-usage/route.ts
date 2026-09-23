import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SGO_USAGE_URL =
  "https://api.sportsgameodds.com/v2/account/usage";

export async function GET() {
  const apiKey =
    process.env.SPORTSGAMEODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "SPORTSGAMEODDS_API_KEY is missing.",
      },
      {
        status: 500,
      }
    );
  }

  try {
    const response = await fetch(
      SGO_USAGE_URL,
      {
        headers: {
          "x-api-key": apiKey,
        },
        cache: "no-store",
      }
    );

    const text =
      await response.text();

    let data: unknown;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json(
      {
        success: response.ok,
        provider: "SportsGameOdds",
        provider_status:
          response.status,
        usage: data,
        checked_at:
          new Date().toISOString(),
      },
      {
        status: response.ok
          ? 200
          : response.status,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "SportsGameOdds",
        error:
          error instanceof Error
            ? error.message
            : "Unknown SportsGameOdds usage error",
      },
      {
        status: 500,
      }
    );
  }
}
