import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDIZE_BASE = "https://oddize.com/api/v1";
const SPORT = "mlb";
const BOOK = "hrb";

type AnyRecord = Record<string, any>;

function apiKey() {
  const key = process.env.ODDIZE_API_KEY;
  if (!key) throw new Error("Missing ODDIZE_API_KEY");
  return key;
}

async function oddizeFetch(url: string) {
  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey(),
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Oddize ${response.status}: ${text.slice(0, 500)}`
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Oddize returned non-JSON data.");
  }

  return {
    data,
    creditsCost: response.headers.get("x-credits-cost"),
    creditsRemaining: response.headers.get("x-credits-remaining"),
  };
}

function eventsFrom(data: any): AnyRecord[] {
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data)) return data;
  return [];
}

function rowsFrom(data: any): AnyRecord[] {
  if (Array.isArray(data?.props)) return data.props;
  if (Array.isArray(data?.odds)) return data.odds;
  if (Array.isArray(data?.offers)) return data.offers;
  if (Array.isArray(data?.markets)) return data.markets;
  if (Array.isArray(data)) return data;

  // Preserve an unfamiliar response shape rather than throwing it away.
  return [];
}

function isHardRock(row: AnyRecord) {
  const book = String(
    row?.book ??
      row?.book_code ??
      row?.sportsbook ??
      row?.sportsbook_code ??
      ""
  ).toLowerCase();

  const name = String(
    row?.book_name ??
      row?.sportsbook_name ??
      ""
  ).toLowerCase();

  return (
    book === "hrb" ||
    book.includes("hardrock") ||
    book.includes("hard_rock") ||
    name.includes("hard rock")
  );
}

function propName(row: AnyRecord) {
  return String(
    row?.market ??
      row?.prop_type ??
      row?.offer_type ??
      row?.market_name ??
      row?.name ??
      ""
  );
}

function playerName(row: AnyRecord) {
  return (
    row?.player ??
    row?.player_name ??
    row?.participant ??
    row?.athlete ??
    row?.name ??
    null
  );
}

function normalizeProp(row: AnyRecord) {
  return {
    book:
      row?.book ??
      row?.book_code ??
      row?.sportsbook ??
      null,
    book_name:
      row?.book_name ??
      row?.sportsbook_name ??
      null,
    market: propName(row) || null,
    player: playerName(row),
    team:
      row?.team ??
      row?.team_code ??
      null,
    side:
      row?.side ??
      row?.outcome ??
      row?.selection ??
      null,
    line:
      row?.line ??
      row?.point ??
      row?.total ??
      null,
    american_odds:
      row?.american_odds ??
      row?.odds ??
      row?.price ??
      null,
    timestamp:
      row?.timestamp ??
      row?.updated_at ??
      null,

    // Keep the raw row temporarily so we can learn Oddize's exact prop schema.
    raw: row,
  };
}

export async function GET() {
  try {
    /*
      1) Pull the current MLB event list.
      This costs 1 Oddize credit.
    */
    const latest = await oddizeFetch(
      `${ODDIZE_BASE}/odds/latest?sport=${SPORT}&books=${BOOK}`
    );

    const now = Date.now();

    const upcoming = eventsFrom(latest.data)
      .filter((event) => {
        const start = Date.parse(String(event?.start_date ?? ""));
        return Number.isFinite(start) && start > now;
      })
      .sort(
        (a, b) =>
          Date.parse(String(a.start_date)) -
          Date.parse(String(b.start_date))
      );

    /*
      Keep this first diagnostic deliberately cheap:
      inspect only the next 3 MLB games = max 6 prop credits,
      plus 1 credit for the event list.

      Once we confirm the exact JSON shape, the production route can
      request the full slate intelligently.
    */
    const eventsToInspect = upcoming.slice(0, 3);

    const results: AnyRecord[] = [];
    let propCreditsUsed = 0;
    let creditsRemaining: string | null =
      latest.creditsRemaining;

    for (const event of eventsToInspect) {
      const eventId = String(event?.event_id ?? "");
      if (!eventId) continue;

      try {
        const propsResponse = await oddizeFetch(
          `${ODDIZE_BASE}/events/${SPORT}/${encodeURIComponent(
            eventId
          )}/props`
        );

        const allRows = rowsFrom(propsResponse.data);
        const hardRockRows = allRows.filter(isHardRock);

        const normalized = (
          hardRockRows.length > 0 ? hardRockRows : allRows
        ).map(normalizeProp);

        propCreditsUsed += Number(
          propsResponse.creditsCost ?? 2
        );
        creditsRemaining =
          propsResponse.creditsRemaining ??
          creditsRemaining;

        results.push({
          event_id: eventId,
          start_date: event?.start_date ?? null,
          away_team:
            event?.team1 ??
            event?.away_team ??
            null,
          home_team:
            event?.team2 ??
            event?.home_team ??
            null,
          hard_rock_rows_found: hardRockRows.length,
          total_prop_rows_found: allRows.length,
          props: normalized,
          raw_response:
            allRows.length === 0
              ? propsResponse.data
              : undefined,
        });
      } catch (error) {
        results.push({
          event_id: eventId,
          start_date: event?.start_date ?? null,
          away_team:
            event?.team1 ??
            event?.away_team ??
            null,
          home_team:
            event?.team2 ??
            event?.home_team ??
            null,
          error:
            error instanceof Error
              ? error.message
              : "Unknown prop error",
        });
      }
    }

    const markets = Array.from(
      new Set(
        results.flatMap((event) =>
          Array.isArray(event.props)
            ? event.props
                .map((prop: AnyRecord) => prop.market)
                .filter(Boolean)
            : []
        )
      )
    ).sort();

    return NextResponse.json({
      success: true,
      sport: "MLB",
      sportsbook_requested: "Hard Rock",
      purpose:
        "Temporary RDG prop-schema diagnostic before building the player-prop model.",
      upcoming_games_found: upcoming.length,
      games_inspected: eventsToInspect.length,
      markets_found: markets,
      credit_usage: {
        latest_odds_call: Number(
          latest.creditsCost ?? 1
        ),
        prop_calls: propCreditsUsed,
        estimated_total:
          Number(latest.creditsCost ?? 1) +
          propCreditsUsed,
        credits_remaining:
          creditsRemaining,
      },
      events: results,
      next_step:
        "Once this endpoint returns real prop rows, use the observed market/player/line/odds fields to build the RDG Pitcher Strikeouts model.",
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
