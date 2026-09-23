import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "7.0-odds-api-market-data-test";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT = "americanfootball_nfl";
const MARKET = "player_rush_yds";
const REGION = "us";

// Test a completed 2025 NFL Sunday.
// Historical events lookup itself does not consume quota.
const SNAPSHOT_DATE = "2025-09-07T16:00:00Z";

async function getJson(url: string) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RDG-V7-OddsAPI-Test/7.0",
    },
    cache: "no-store",
  });

  const text = await res.text();

  let body: any = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 3000) };
  }

  return {
    ok: res.ok,
    status: res.status,
    body,

    quota: {
      requests_remaining:
        res.headers.get("x-requests-remaining"),
      requests_used:
        res.headers.get("x-requests-used"),
      requests_last:
        res.headers.get("x-requests-last"),
    },
  };
}

function getData(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

export async function GET() {
  try {
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          error: "Missing ODDS_API_KEY environment variable.",
        },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------------
    // STEP 1
    // Historical events lookup.
    //
    // According to The Odds API documentation this endpoint does not
    // consume betting-market credits.
    // ------------------------------------------------------------------

    const eventsUrl =
      `${BASE}/historical/sports/${SPORT}/events` +
      `?apiKey=${encodeURIComponent(apiKey)}` +
      `&date=${encodeURIComponent(SNAPSHOT_DATE)}` +
      `&dateFormat=iso`;

    const eventsResult = await getJson(eventsUrl);

    if (!eventsResult.ok) {
      return NextResponse.json({
        success: false,
        version: VERSION,

        stage: "historical_events",

        status: eventsResult.status,
        response: eventsResult.body,
        quota: eventsResult.quota,

        message:
          "Historical NFL event lookup failed. Stop here before making any player-prop request.",
      });
    }

    const events = getData(eventsResult.body);

    if (!events.length) {
      return NextResponse.json({
        success: false,
        version: VERSION,

        stage: "historical_events",

        historical_snapshot:
          eventsResult.body?.timestamp || SNAPSHOT_DATE,

        events_found: 0,

        quota: eventsResult.quota,

        message:
          "Historical endpoint worked, but no NFL events were returned for this snapshot.",
      });
    }

    // ------------------------------------------------------------------
    // Pick ONE event only.
    //
    // We intentionally do NOT loop through every NFL game because
    // historical player-prop requests consume quota.
    // ------------------------------------------------------------------

    const sortedEvents = [...events].sort(
      (a: any, b: any) =>
        new Date(a.commence_time).getTime() -
        new Date(b.commence_time).getTime()
    );

    const event =
      sortedEvents.find(
        (e: any) =>
          e?.id &&
          e?.commence_time &&
          new Date(e.commence_time).getTime() >
            new Date(SNAPSHOT_DATE).getTime()
      ) || sortedEvents.find((e: any) => e?.id);

    if (!event?.id) {
      return NextResponse.json({
        success: false,
        version: VERSION,

        stage: "select_event",

        events_found: events.length,

        sample_events: events.slice(0, 10),

        message:
          "Historical events were returned but no usable event ID was found.",
      });
    }

    // ------------------------------------------------------------------
    // STEP 2
    // Request ONE historical player_rush_yds market.
    //
    // One market + one region = controlled historical API cost.
    // ------------------------------------------------------------------

    // Request the snapshot shortly before the game's scheduled kickoff.
    // Subtract five minutes so we're looking for a near-closing market
    // while remaining before commencement.
    const kickoff = new Date(event.commence_time);

    const requestedMarketSnapshot = new Date(
      kickoff.getTime() - 5 * 60 * 1000
    ).toISOString();

    const oddsUrl =
      `${BASE}/historical/sports/${SPORT}` +
      `/events/${encodeURIComponent(event.id)}/odds` +
      `?apiKey=${encodeURIComponent(apiKey)}` +
      `&regions=${encodeURIComponent(REGION)}` +
      `&markets=${encodeURIComponent(MARKET)}` +
      `&oddsFormat=american` +
      `&dateFormat=iso` +
      `&date=${encodeURIComponent(requestedMarketSnapshot)}`;

    const oddsResult = await getJson(oddsUrl);

    if (!oddsResult.ok) {
      return NextResponse.json({
        success: false,
        version: VERSION,

        stage: "historical_player_props",

        tested_event: {
          id: event.id,
          away_team: event.away_team,
          home_team: event.home_team,
          commence_time: event.commence_time,
        },

        requested_snapshot: requestedMarketSnapshot,

        market: MARKET,
        region: REGION,

        status: oddsResult.status,
        response: oddsResult.body,

        quota: oddsResult.quota,

        message:
          "Historical event was found, but the player rushing market request failed. Do not repeatedly rerun this endpoint until we inspect this response.",
      });
    }

    const oddsEvent = oddsResult.body?.data || {};

    const bookmakers = Array.isArray(oddsEvent?.bookmakers)
      ? oddsEvent.bookmakers
      : [];

    const extractedLines: any[] = [];

    // ------------------------------------------------------------------
    // Extract rushing props into a simple RDG-friendly structure.
    // ------------------------------------------------------------------

    for (const bookmaker of bookmakers) {
      const markets = Array.isArray(bookmaker?.markets)
        ? bookmaker.markets
        : [];

      const rushingMarket = markets.find(
        (m: any) => m?.key === MARKET
      );

      if (!rushingMarket) continue;

      const outcomes = Array.isArray(rushingMarket?.outcomes)
        ? rushingMarket.outcomes
        : [];

      for (const outcome of outcomes) {
        extractedLines.push({
          bookmaker_key: bookmaker.key || null,
          bookmaker: bookmaker.title || null,

          bookmaker_last_update:
            bookmaker.last_update || null,

          market_last_update:
            rushingMarket.last_update || null,

          player:
            outcome.description ||
            outcome.player ||
            null,

          side:
            outcome.name || null,

          line:
            typeof outcome.point === "number"
              ? outcome.point
              : null,

          price:
            typeof outcome.price === "number"
              ? outcome.price
              : null,
        });
      }
    }

    const players = [
      ...new Set(
        extractedLines
          .map((x) => x.player)
          .filter(Boolean)
      ),
    ];

    const sportsbookNames = [
      ...new Set(
        extractedLines
          .map((x) => x.bookmaker)
          .filter(Boolean)
      ),
    ];

    const sportsbookKeys = [
      ...new Set(
        extractedLines
          .map((x) => x.bookmaker_key)
          .filter(Boolean)
      ),
    ];

    const linesAvailable =
      extractedLines.filter(
        (x) => typeof x.line === "number"
      );

    return NextResponse.json({
      success: true,

      version: VERSION,

      purpose:
        "Validate The Odds API historical NFL rushing-yard player props before building RDG Rushing V7.",

      model_status:
        "DATA CONNECTION TEST ONLY — V5/V6 UNCHANGED",

      historical_event_lookup: {
        requested_snapshot: SNAPSHOT_DATE,

        returned_snapshot:
          eventsResult.body?.timestamp || null,

        events_found: events.length,

        quota: eventsResult.quota,
      },

      tested_event: {
        id: event.id,
        away_team: event.away_team,
        home_team: event.home_team,
        commence_time: event.commence_time,
      },

      historical_prop_request: {
        requested_snapshot: requestedMarketSnapshot,

        returned_snapshot:
          oddsResult.body?.timestamp || null,

        previous_snapshot:
          oddsResult.body?.previous_timestamp || null,

        next_snapshot:
          oddsResult.body?.next_timestamp || null,

        market: MARKET,
        region: REGION,

        quota: oddsResult.quota,
      },

      coverage: {
        bookmakers_found: bookmakers.length,

        sportsbook_names: sportsbookNames,

        sportsbook_keys: sportsbookKeys,

        unique_players: players.length,

        player_names: players,

        total_outcomes: extractedLines.length,

        outcomes_with_numeric_line:
          linesAvailable.length,
      },

      join_test: {
        event_identity_available:
          Boolean(
            event.id &&
            event.home_team &&
            event.away_team &&
            event.commence_time
          ),

        player_identity_available:
          players.length > 0,

        sportsbook_identity_available:
          sportsbookKeys.length > 0,

        rushing_line_available:
          linesAvailable.length > 0,

        ready_for_v7_backtest:
          Boolean(
            event.id &&
            players.length &&
            linesAvailable.length
          ),
      },

      extracted_rushing_lines:
        extractedLines.slice(0, 100),

      raw_bookmaker_sample:
        bookmakers.slice(0, 2),

      next_step:
        linesAvailable.length > 0
          ? "PASS — historical rushing lines are available. Next build the controlled 2025 Market vs V5 vs V7 backtest."
          : "PARTIAL — API connection works, but this snapshot returned no usable player rushing lines. Inspect bookmaker/market coverage before another paid request.",

      important:
        "This route intentionally tests only one historical NFL event to limit Odds API usage.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error: error?.message || String(error),

        message:
          "Unexpected V7 market-data test failure. Do not repeatedly rerun until the error is reviewed.",
      },
      { status: 500 }
    );
  }
}
