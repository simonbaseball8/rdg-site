import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "1.0-propline-rushing-history-access-test";
const BASE = "https://api.prop-line.com/v1";
const SPORT = "football_nfl";
const MARKET = "player_rush_yds";

async function getJson(url: string, apiKey: string) {
  const res = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
      "User-Agent": "RDG-PropLine-History-Test/1.0",
    },
    cache: "no-store",
  });

  const text = await res.text();
  let body: any = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 1000) };
  }

  return {
    ok: res.ok,
    status: res.status,
    body,
  };
}

function arrayFrom(body: any, keys: string[]) {
  if (Array.isArray(body)) return body;

  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }

  return [];
}

export async function GET() {
  try {
    const apiKey = process.env.PROPLINE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          error: "Missing PROPLINE_API_KEY",
        },
        { status: 500 },
      );
    }

    // 1) Confirm NFL event access.
    const eventsResult = await getJson(
      `${BASE}/sports/${SPORT}/events`,
      apiKey,
    );

    const events = arrayFrom(eventsResult.body, [
      "events",
      "data",
      "results",
    ]);

    // 2) Try the Pro bulk resolved-props export.
    const exportUrl =
      `${BASE}/exports/resolved-props` +
      `?sport=${encodeURIComponent(SPORT)}` +
      `&market=${encodeURIComponent(MARKET)}`;

    const exportRes = await fetch(exportUrl, {
      headers: {
        "X-API-Key": apiKey,
        Accept: "text/csv,application/json",
        "User-Agent": "RDG-PropLine-History-Test/1.0",
      },
      cache: "no-store",
    });

    const exportContentType =
      exportRes.headers.get("content-type") || "";

    const exportText = await exportRes.text();

    let exportPreview: any;

    if (exportContentType.includes("json")) {
      try {
        exportPreview = JSON.parse(exportText);
      } catch {
        exportPreview = exportText.slice(0, 1500);
      }
    } else {
      const lines = exportText
        .split(/\r?\n/)
        .filter(Boolean);

      exportPreview = {
        line_count_received: lines.length,
        header: lines[0] || null,
        first_data_rows: lines.slice(1, 4),
      };
    }

    // 3) If we have an event, test per-event historical endpoints too.
    let eventTest: any = null;

    if (events.length) {
      const event =
        events.find((e: any) => e?.id) || events[0];

      const eventId = event?.id;

      if (eventId != null) {
        const historyResult = await getJson(
          `${BASE}/sports/${SPORT}/events/${eventId}/odds/history` +
            `?markets=${encodeURIComponent(MARKET)}`,
          apiKey,
        );

        const closingResult = await getJson(
          `${BASE}/sports/${SPORT}/events/${eventId}/odds/closing` +
            `?markets=${encodeURIComponent(MARKET)}`,
          apiKey,
        );

        const resultsResult = await getJson(
          `${BASE}/sports/${SPORT}/events/${eventId}/results` +
            `?markets=${encodeURIComponent(MARKET)}`,
          apiKey,
        );

        eventTest = {
          event: {
            id: eventId,
            commence_time:
              event?.commence_time || null,
            away_team:
              event?.away_team || null,
            home_team:
              event?.home_team || null,
          },

          odds_history: {
            status: historyResult.status,
            accessible: historyResult.ok,
            preview: historyResult.body,
          },

          closing_lines: {
            status: closingResult.status,
            accessible: closingResult.ok,
            preview: closingResult.body,
          },

          resolved_results: {
            status: resultsResult.status,
            accessible: resultsResult.ok,
            preview: resultsResult.body,
          },
        };
      }
    }

    const bulkAccessible =
      exportRes.ok &&
      !exportContentType.includes("json");

    return NextResponse.json({
      success: true,
      version: VERSION,

      purpose:
        "Check what historical NFL rushing-prop data the existing PropLine API key can access before building the RDG V5 sportsbook backtest.",

      nfl_events: {
        status: eventsResult.status,
        accessible: eventsResult.ok,
        events_found: events.length,
      },

      bulk_resolved_rushing_props: {
        endpoint: "/v1/exports/resolved-props",
        market: MARKET,
        status: exportRes.status,
        content_type: exportContentType,
        accessible_as_csv: bulkAccessible,
        preview: exportPreview,
      },

      event_history_test: eventTest,

      interpretation: {
        best_case:
          "If bulk_resolved_rushing_props.accessible_as_csv is true, we can build the historical V5 rushing-prop backtest directly from PropLine resolved props.",
        fallback:
          "If bulk export is unavailable but event results/closing lines are accessible, we can build the dataset event-by-event.",
        blocked:
          "If historical/results endpoints return a tier or upgrade error, the current PropLine plan does not provide enough historical sportsbook data for a legitimate backtest.",
      },

      model_note:
        "This route does not modify or retune frozen Rushing V5.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error: error?.message || String(error),
      },
      { status: 500 },
    );
  }
}
