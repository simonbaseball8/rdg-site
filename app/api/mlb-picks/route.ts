import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ODDIZE_URL =
  "https://oddize.com/api/v1/odds/latest?sport=mlb&books=hrb";

function numberValue(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function impliedProbability(
  odds: string | number | null
): number | null {
  if (odds === null || odds === undefined) {
    return null;
  }

  const value = Number(
    String(odds).replace("+", "")
  );

  if (!Number.isFinite(value) || value === 0) {
    return null;
  }

  if (value > 0) {
    return Number(
      ((100 / (value + 100)) * 100).toFixed(2)
    );
  }

  return Number(
    (
      (Math.abs(value) /
        (Math.abs(value) + 100)) *
      100
    ).toFixed(2)
  );
}

function findMarket(
  odds: any[],
  market: string,
  team: string
) {
  return odds.find(
    (item: any) =>
      String(item.market).toLowerCase() ===
        market.toLowerCase() &&
      item.team === team
  );
}

function findTotal(
  odds: any[],
  side: "Over" | "Under"
) {
  return odds.find(
    (item: any) =>
      String(item.market).toLowerCase() ===
        "total" &&
      String(item.team).toLowerCase() ===
        side.toLowerCase()
  );
}

export async function GET() {
  try {
    const oddizeKey =
      process.env.ODDIZE_API_KEY;

    if (!oddizeKey) {
      throw new Error(
        "ODDIZE_API_KEY is missing"
      );
    }

    const response = await fetch(
      ODDIZE_URL,
      {
        headers: {
          "X-API-Key": oddizeKey,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `Oddize failed ${response.status}: ${text}`
      );
    }

    const data =
      await response.json();

    const events =
      data.events ?? [];

    const games = events.map(
      (event: any) => {
        const awayTeam =
          event.team1;

        const homeTeam =
          event.team2;

        const odds =
          event.odds ?? [];

        const awayMoneyline =
          findMarket(
            odds,
            "moneyline",
            awayTeam
          );

        const homeMoneyline =
          findMarket(
            odds,
            "moneyline",
            homeTeam
          );

        const awayRunLine =
          findMarket(
            odds,
            "spread",
            awayTeam
          );

        const homeRunLine =
          findMarket(
            odds,
            "spread",
            homeTeam
          );

        const over =
          findTotal(
            odds,
            "Over"
          );

        const under =
          findTotal(
            odds,
            "Under"
          );

        return {
          event_id:
            event.event_id,

          start_date:
            event.start_date,

          away_team:
            awayTeam,

          home_team:
            homeTeam,

          hard_rock: {
            moneyline: {
              away_team:
                awayTeam,

              away_odds:
                awayMoneyline?.american_odds ??
                null,

              away_implied_probability:
                impliedProbability(
                  awayMoneyline?.american_odds ??
                    null
                ),

              home_team:
                homeTeam,

              home_odds:
                homeMoneyline?.american_odds ??
                null,

              home_implied_probability:
                impliedProbability(
                  homeMoneyline?.american_odds ??
                    null
                ),
            },

            run_line: {
              away_team:
                awayTeam,

              away_line:
                numberValue(
                  awayRunLine?.line
                ),

              away_odds:
                awayRunLine?.american_odds ??
                null,

              home_team:
                homeTeam,

              home_line:
                numberValue(
                  homeRunLine?.line
                ),

              home_odds:
                homeRunLine?.american_odds ??
                null,
            },

            total: {
              over:
                numberValue(
                  over?.line
                ),

              over_odds:
                over?.american_odds ??
                null,

              under:
                numberValue(
                  under?.line
                ),

              under_odds:
                under?.american_odds ??
                null,
            },
          },
        };
      }
    );

    return NextResponse.json({
      sportsbook:
        "Hard Rock Bet",

      sport:
        "MLB",

      model:
        "RDG MLB",

      version:
        "0.1-odds-connection",

      model_status:
        "Odds Connection Test",

      games_found:
        games.length,

      updated_at:
        new Date().toISOString(),

      markets: {
        moneyline: true,
        run_line: true,
        total: true,
      },

      games,
    });
  } catch (error) {
    console.error(
      "RDG MLB Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG MLB odds connection failed",

        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
