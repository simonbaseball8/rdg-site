import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NFLMETA_BASE = "https://nflmeta.org/api/v1";

async function nflMetaFetch(path: string) {
  const apiKey = process.env.NFLMETA_KEY;

  if (!apiKey) {
    throw new Error("NFLMETA_KEY is missing from Vercel environment variables.");
  }

  const response = await fetch(`${NFLMETA_BASE}${path}`, {
    headers: {
      "X-NFLMeta-Key": apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `NFLMeta ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

function normalizeArray(data: any): any[] {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.injuries)) return data.injuries;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;

  return [];
}

function clean(value: any) {
  if (value === null || value === undefined) return null;
  return String(value).trim();
}

function normalizeStatus(value: any) {
  const status = clean(value)?.toUpperCase() || "UNKNOWN";

  if (
    status.includes("OUT") ||
    status.includes("IR") ||
    status.includes("INJURED RESERVE")
  ) {
    return "OUT";
  }

  if (
    status.includes("DOUBTFUL") ||
    status.includes("DNP") ||
    status.includes("DID NOT PARTICIPATE")
  ) {
    return "DOUBTFUL";
  }

  if (
    status.includes("QUESTIONABLE") ||
    status.includes("LIMITED")
  ) {
    return "QUESTIONABLE";
  }

  if (
    status.includes("PROBABLE") ||
    status.includes("FULL")
  ) {
    return "PROBABLE";
  }

  return status;
}

function statusSeverity(status: string) {
  switch (status) {
    case "OUT":
      return 4;
    case "DOUBTFUL":
      return 3;
    case "QUESTIONABLE":
      return 2;
    case "PROBABLE":
      return 1;
    default:
      return 0;
  }
}

function normalizeInjury(row: any) {
  const rawStatus =
    row?.game_status ??
    row?.status ??
    row?.injury_status ??
    row?.designation ??
    row?.practice_status ??
    row?.report_status;

  const status = normalizeStatus(rawStatus);

  const playerName =
    clean(row?.player_name) ??
    clean(row?.name) ??
    clean(row?.full_name) ??
    clean(row?.player?.name) ??
    clean(row?.player?.full_name);

  const playerKey =
    clean(row?.player_key) ??
    clean(row?.player_id) ??
    clean(row?.gsis_id) ??
    clean(row?.player?.key) ??
    clean(row?.player?.id);

  const team =
    clean(row?.team) ??
    clean(row?.team_abbr) ??
    clean(row?.team_code) ??
    clean(row?.team?.abbr);

  const position =
    clean(row?.position) ??
    clean(row?.pos) ??
    clean(row?.player?.position);

  const injury =
    clean(row?.injury) ??
    clean(row?.injury_type) ??
    clean(row?.body_part) ??
    clean(row?.description);

  const practiceStatus =
    clean(row?.practice_status) ??
    clean(row?.practice) ??
    clean(row?.participation);

  const reportDate =
    clean(row?.report_date) ??
    clean(row?.date) ??
    clean(row?.updated_at) ??
    clean(row?.last_updated);

  return {
    player_name: playerName,
    player_key: playerKey,
    team,
    position,

    injury,

    status,
    raw_status: clean(rawStatus),

    practice_status: practiceStatus,

    report_date: reportDate,

    severity: statusSeverity(status),

    // IMPORTANT:
    // These are classification flags only.
    // They do NOT yet alter RDG projections.
    unavailable: status === "OUT",

    high_risk:
      status === "OUT" ||
      status === "DOUBTFUL",

    monitor:
      status === "QUESTIONABLE",

    raw: row,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const team = searchParams.get("team")?.toUpperCase() || null;

    /*
      NFLMeta currently documents:

      GET /api/v1/injuries
      GET /api/v1/teams/{abbr}/injuries
      GET /api/v1/players/{player_key}/injuries

      For now this route pulls either:
      - all current injury data
      - one team's injury data

      Later RDG will combine this with:
      depth charts
      player stats
      snap/usage history
      game schedules
      and historical injury effects.
    */

    const endpoint = team
      ? `/teams/${encodeURIComponent(team)}/injuries`
      : "/injuries";

    const rawData = await nflMetaFetch(endpoint);

    const rows = normalizeArray(rawData);

    const injuries = rows
      .map(normalizeInjury)
      .filter((injury) => {
        return (
          injury.player_name ||
          injury.player_key ||
          injury.team
        );
      })
      .sort((a, b) => {
        return b.severity - a.severity;
      });

    const out = injuries.filter(
      (x) => x.status === "OUT"
    );

    const doubtful = injuries.filter(
      (x) => x.status === "DOUBTFUL"
    );

    const questionable = injuries.filter(
      (x) => x.status === "QUESTIONABLE"
    );

    const probable = injuries.filter(
      (x) => x.status === "PROBABLE"
    );

    const teams = Array.from(
      new Set(
        injuries
          .map((x) => x.team)
          .filter(Boolean)
      )
    ).sort();

    return NextResponse.json({
      success: true,

      version: "1.0-raw-injury-feed",

      provider: "NFLMeta",

      team_filter: team,

      summary: {
        total_injury_records: injuries.length,
        out: out.length,
        doubtful: doubtful.length,
        questionable: questionable.length,
        probable: probable.length,
        teams_with_reports: teams.length,
      },

      teams,

      out,

      doubtful,

      questionable,

      probable,

      injuries,

      model_status: {
        injury_feed_connected: true,

        injury_adjustments_active: false,

        message:
          "RDG is currently collecting and classifying injury information. Injuries are NOT yet changing model projections. Historical validation must be completed before injury adjustments are activated.",
      },

      generated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("NFL injury route error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to load NFL injury data.",
      },
      {
        status: 500,
      }
    );
  }
}
