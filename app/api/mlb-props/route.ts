import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "baseball_mlb";

const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "pitcher_strikeouts",
];

type OddsEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
};

type OddsOutcome = {
  name: string;
  description?: string;
  price?: number;
  point?: number;
};

type OddsMarket = {
  key: string;
  last_update?: string;
  outcomes?: OddsOutcome[];
};

type OddsBookmaker = {
  key: string;
  title: string;
  last_update?: string;
  markets?: OddsMarket[];
};

type EventOdds = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsBookmaker[];
};

function usageHeaders(response: Response) {
  return {
    last:
      response.headers.get("x-requests-last") ??
      "unknown",

    used:
      response.headers.get("x-requests-used") ??
      "unknown",

    remaining:
      response.headers.get("x-requests-remaining") ??
      "unknown",
  };
}

export async function GET() {
  try {
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing ODDS_API_KEY",
        },
        { status: 500 }
      );
    }

    /*
      ------------------------------------------------
      STEP 1
      Fetch upcoming MLB events.

      The Odds API does not charge usage credits for
      the events endpoint.
      ------------------------------------------------
    */

    const eventsUrl =
      `${ODDS_API_BASE}/sports/${SPORT_KEY}/events` +
      `?apiKey=${encodeURIComponent(apiKey)}` +
      `&dateFormat=iso`;

    const eventsResponse = await fetch(eventsUrl, {
      cache: "no-store",
    });

    const eventsUsage = usageHeaders(eventsResponse);

    const eventsText = await eventsResponse.text();

    if (!eventsResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          stage: "events",
          status: eventsResponse.status,
          error: eventsText.slice(0, 1500),
          usage: eventsUsage,
        },
        { status: eventsResponse.status }
      );
    }

    let events: OddsEvent[];

    try {
      events = JSON.parse(eventsText);
    } catch {
      return NextResponse.json(
        {
          success: false,
          stage: "events",
          error: "The Odds API returned invalid event JSON.",
        },
        { status: 500 }
      );
    }

    if (!Array.isArray(events)) {
      return NextResponse.json(
        {
          success: false,
          stage: "events",
          error: "Unexpected events response structure.",
        },
        { status: 500 }
      );
    }

    /*
      ------------------------------------------------
      Only use future games.
      ------------------------------------------------
    */

    const now = Date.now();

    const upcomingEvents = events
      .filter((event) => {
        const start = new Date(
          event.commence_time
        ).getTime();

        return (
          Number.isFinite(start) &&
          start > now
        );
      })
      .sort(
        (a, b) =>
          new Date(a.commence_time).getTime() -
          new Date(b.commence_time).getTime()
      );

    /*
      ------------------------------------------------
      IMPORTANT

      Phase 1 only checks ONE game.

      We do NOT want to burn credits checking every
      MLB game until we verify the prop structure.
      ------------------------------------------------
    */

    const selectedEvent =
      upcomingEvents[0] ?? null;

    if (!selectedEvent) {
      return NextResponse.json({
        success: true,

        version:
          "1.0-mlb-player-props-odds-api-diagnostic",

        sport: "MLB",

        provider: "The Odds API",

        message:
          "No upcoming MLB events were returned.",

        events_found: events.length,

        future_events_found:
          upcomingEvents.length,

        usage: {
          events_request: eventsUsage,
          props_request: null,
        },
      });
    }

    /*
      ------------------------------------------------
      STEP 2
      Request our three MLB player prop markets
      for the NEXT upcoming game only.
      ------------------------------------------------
    */

    const propsUrl =
      `${ODDS_API_BASE}/sports/${SPORT_KEY}` +
      `/events/${selectedEvent.id}/odds` +
      `?apiKey=${encodeURIComponent(apiKey)}` +
      `&regions=us` +
      `&markets=${encodeURIComponent(
        MARKETS.join(",")
      )}` +
      `&oddsFormat=american` +
      `&dateFormat=iso`;

    const propsResponse = await fetch(propsUrl, {
      cache: "no-store",
    });

    const propsUsage =
      usageHeaders(propsResponse);

    const propsText =
      await propsResponse.text();

    if (!propsResponse.ok) {
      return NextResponse.json(
        {
          success: false,

          version:
            "1.0-mlb-player-props-odds-api-diagnostic",

          stage: "player_props",

          selected_event: {
            event_id: selectedEvent.id,
            commence_time:
              selectedEvent.commence_time,
            away_team:
              selectedEvent.away_team,
            home_team:
              selectedEvent.home_team,
          },

          requested_markets: MARKETS,

          status: propsResponse.status,

          error:
            propsText.slice(0, 2000),

          usage: {
            events_request: eventsUsage,
            props_request: propsUsage,
          },
        },
        { status: propsResponse.status }
      );
    }

    let propsData: EventOdds;

    try {
      propsData =
        JSON.parse(propsText);
    } catch {
      return NextResponse.json(
        {
          success: false,
          stage: "player_props",
          error:
            "The Odds API returned invalid player-prop JSON.",
          usage: {
            events_request: eventsUsage,
            props_request: propsUsage,
          },
        },
        { status: 500 }
      );
    }

    /*
      ------------------------------------------------
      Build diagnostics.

      Keep the RAW sportsbook/player information
      because we need to inspect exactly how MLB
      props are structured before building RDG V1.
      ------------------------------------------------
    */

    const bookmakers =
      Array.isArray(propsData.bookmakers)
        ? propsData.bookmakers
        : [];

    const marketSummary: Record<
      string,
      {
        sportsbooks: number;
        outcomes: number;
        players: number;
      }
    > = {};

    for (const market of MARKETS) {
      marketSummary[market] = {
        sportsbooks: 0,
        outcomes: 0,
        players: 0,
      };
    }

    const playersByMarket: Record<
      string,
      Set<string>
    > = {};

    for (const market of MARKETS) {
      playersByMarket[market] =
        new Set<string>();
    }

    const sportsbookData =
      bookmakers.map((bookmaker) => {
        const markets =
          Array.isArray(bookmaker.markets)
            ? bookmaker.markets
            : [];

        const relevantMarkets =
          markets
            .filter((market) =>
              MARKETS.includes(market.key)
            )
            .map((market) => {
              const outcomes =
                Array.isArray(market.outcomes)
                  ? market.outcomes
                  : [];

              if (
                marketSummary[market.key]
              ) {
                marketSummary[
                  market.key
                ].sportsbooks += 1;

                marketSummary[
                  market.key
                ].outcomes +=
                  outcomes.length;
              }

              for (
                const outcome of outcomes
              ) {
                const player =
                  outcome.description?.trim();

                if (
                  player &&
                  playersByMarket[
                    market.key
                  ]
                ) {
                  playersByMarket[
                    market.key
                  ].add(player);
                }
              }

              return {
                market: market.key,

                last_update:
                  market.last_update ??
                  bookmaker.last_update ??
                  null,

                outcome_count:
                  outcomes.length,

                outcomes:
                  outcomes.map(
                    (outcome) => ({
                      side:
                        outcome.name ??
                        null,

                      player:
                        outcome.description ??
                        null,

                      line:
                        outcome.point ??
                        null,

                      odds:
                        outcome.price ??
                        null,
                    })
                  ),
              };
            });

        return {
          sportsbook_key:
            bookmaker.key,

          sportsbook:
            bookmaker.title,

          last_update:
            bookmaker.last_update ??
            null,

          markets:
            relevantMarkets,
        };
      });

    for (const market of MARKETS) {
      marketSummary[market].players =
        playersByMarket[market].size;
    }

    /*
      ------------------------------------------------
      Return everything needed for our first test.
      ------------------------------------------------
    */

    return NextResponse.json({
      success: true,

      version:
        "1.0-mlb-player-props-odds-api-diagnostic",

      sport: "MLB",

      provider: "The Odds API",

      purpose:
        "Phase 1 diagnostic for RDG MLB player props. Verify live sportsbook/player/line structure before building projections.",

      requested_markets: MARKETS,

      events: {
        returned:
          events.length,

        future:
          upcomingEvents.length,

        tested:
          1,
      },

      selected_event: {
        event_id:
          selectedEvent.id,

        commence_time:
          selectedEvent.commence_time,

        away_team:
          selectedEvent.away_team,

        home_team:
          selectedEvent.home_team,
      },

      summary: {
        sportsbooks_returned:
          bookmakers.length,

        markets:
          marketSummary,
      },

      usage: {
        events_request: {
          expected_cost: 0,
          ...eventsUsage,
        },

        props_request: {
          ...propsUsage,
        },
      },

      sportsbooks:
        sportsbookData,

      next_step:
        bookmakers.length > 0
          ? "Verify players, lines, prices, sportsbook coverage and market structure. Then connect MLB player history and build RDG projections."
          : "No sportsbooks returned props for this game. Check another upcoming event before building the projection model.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        version:
          "1.0-mlb-player-props-odds-api-diagnostic",

        error:
          error instanceof Error
            ? error.message
            : "Unknown MLB player-props diagnostic error",
      },
      { status: 500 }
    );
  }
}
