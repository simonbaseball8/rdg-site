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

  const result = String(value).trim();

  return result.length ? result : null;
}

function normalizeGameStatus(value: any) {
  const status = clean(value)?.toUpperCase();

  if (!status) return "NO_DESIGNATION";

  if (
    status === "OUT" ||
    status === "IR" ||
    status.includes("INJURED RESERVE")
  ) {
    return "OUT";
  }

  if (status.includes("DOUBTFUL")) {
    return "DOUBTFUL";
  }

  if (status.includes("QUESTIONABLE")) {
    return "QUESTIONABLE";
  }

  if (status.includes("PROBABLE")) {
    return "PROBABLE";
  }

  return "NO_DESIGNATION";
}

function getBestGameDesignation(row: any) {
  /*
    NFLMeta can return:

    report_status: "Out"
    game_status: "Inactive"

    "Inactive" tells us the player didn't play,
    but "Out" tells us WHY they were unavailable.

    Therefore:
    1. Use recognized report_status first.
    2. Then recognized game_status.
    3. Never convert "Inactive" into a fake designation.
  */

  const reportStatus = clean(row?.report_status);
  const gameStatus = clean(row?.game_status);

  const normalizedReport =
    normalizeGameStatus(reportStatus);

  const normalizedGame =
    normalizeGameStatus(gameStatus);

  if (normalizedReport !== "NO_DESIGNATION") {
    return {
      status: normalizedReport,
      source: "report_status",
      raw_status: reportStatus,
    };
  }

  if (normalizedGame !== "NO_DESIGNATION") {
    return {
      status: normalizedGame,
      source: "game_status",
      raw_status: gameStatus,
    };
  }

  const fallbackValues = [
    ["status", row?.status],
    ["injury_status", row?.injury_status],
    ["designation", row?.designation],
  ];

  for (const [source, value] of fallbackValues) {
    const normalized =
      normalizeGameStatus(value);

    if (normalized !== "NO_DESIGNATION") {
      return {
        status: normalized,
        source,
        raw_status: clean(value),
      };
    }
  }

  return {
    status: "NO_DESIGNATION",
    source: null,
    raw_status: null,
  };
}

function normalizePracticeStatus(value: any) {
  const status = clean(value)?.toUpperCase();

  if (!status) return "UNKNOWN";

  if (
    status.includes("DID NOT PARTICIPATE") ||
    status === "DNP"
  ) {
    return "DNP";
  }

  if (
    status.includes("LIMITED PARTICIPATION") ||
    status.includes("LIMITED")
  ) {
    return "LIMITED";
  }

  if (
    status.includes("FULL PARTICIPATION") ||
    status === "FULL"
  ) {
    return "FULL";
  }

  return status;
}

function isRestReason(value: any) {
  const reason =
    clean(value)?.toUpperCase() || "";

  return (
    reason.includes("NIR") ||
    reason.includes("NOT INJURY") ||
    reason.includes("NOT INJURY-RELATED") ||
    reason.includes("NOT INJURY RELATED") ||
    reason.includes("NON-INJURY") ||
    reason.includes("RESTING PLAYER") ||
    reason === "REST" ||
    reason.includes("(REST)")
  );
}

function gameSeverity(status: string) {
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
  const designation =
    getBestGameDesignation(row);

  const gameStatus =
    designation.status;

  const rawPracticeStatus =
    clean(row?.practice_status) ??
    clean(row?.practice) ??
    clean(row?.participation);

  const practiceStatus =
    normalizePracticeStatus(
      rawPracticeStatus
    );

  const playerName =
    clean(row?.display_name) ??
    clean(row?.player_name) ??
    clean(row?.name) ??
    clean(row?.full_name) ??
    clean(row?.player?.display_name) ??
    clean(row?.player?.name) ??
    clean(row?.player?.full_name);

  const playerKey =
    clean(row?.player_key) ??
    clean(row?.gsis_id) ??
    clean(row?.player?.key) ??
    clean(row?.player?.id) ??
    clean(row?.player_id);

  const playerId =
    clean(row?.player_id) ??
    clean(row?.player?.id);

  const team =
    clean(row?.team_abbr) ??
    clean(row?.team) ??
    clean(row?.team_code) ??
    clean(row?.team?.abbr);

  const teamName =
    clean(row?.team_name) ??
    clean(row?.team?.name);

  const position =
    clean(row?.position) ??
    clean(row?.pos) ??
    clean(row?.player?.position);

  const primaryInjury =
    clean(row?.report_primary_injury) ??
    clean(row?.injury) ??
    clean(row?.injury_type) ??
    clean(row?.body_part) ??
    clean(row?.description);

  const secondaryInjury =
    clean(row?.report_secondary_injury);

  const practicePrimaryInjury =
    clean(row?.practice_primary_injury);

  const restRelated =
    isRestReason(primaryInjury);

  const actualInjury =
    primaryInjury && !restRelated
      ? primaryInjury
      : practicePrimaryInjury &&
          !isRestReason(practicePrimaryInjury)
        ? practicePrimaryInjury
        : null;

  const unavailable =
    gameStatus === "OUT";

  const highRisk =
    gameStatus === "OUT" ||
    gameStatus === "DOUBTFUL";

  const monitor =
    gameStatus === "QUESTIONABLE";

  const practiceConcern =
    !restRelated &&
    actualInjury !== null &&
    (
      practiceStatus === "DNP" ||
      practiceStatus === "LIMITED"
    );

  /*
    Preserve raw inactive status separately.

    We DO NOT use this alone to determine
    whether the player should affect a future game.
  */

  const inactive =
    clean(row?.game_status)
      ?.toUpperCase() === "INACTIVE";

  return {
    season_year:
      row?.season_year ?? null,

    week:
      row?.week ?? null,

    season_type:
      clean(row?.season_type),

    player_name:
      playerName,

    player_key:
      playerKey,

    player_id:
      playerId,

    team,

    team_name:
      teamName,

    position,

    injury:
      actualInjury,

    primary_injury:
      primaryInjury,

    secondary_injury:
      secondaryInjury,

    rest_related:
      restRelated,

    game_status:
      gameStatus,

    designation_source:
      designation.source,

    raw_game_designation:
      designation.raw_status,

    nflmeta_game_status:
      clean(row?.game_status),

    nflmeta_report_status:
      clean(row?.report_status),

    inactive,

    practice_status:
      practiceStatus,

    raw_practice_status:
      rawPracticeStatus,

    severity:
      gameSeverity(gameStatus),

    unavailable,

    high_risk:
      highRisk,

    monitor,

    practice_concern:
      practiceConcern,

    /*
      Still OFF.

      We are not allowing injuries to change
      RDG projections until the importance +
      historical-impact layer is built.
    */

    model_adjustment_active:
      false,

    headshot_url:
      clean(row?.headshot_url),

    raw:
      row,
  };
}

export async function GET(
  request: Request
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const team =
      searchParams
        .get("team")
        ?.toUpperCase() || null;

    const endpoint =
      team
        ? `/teams/${encodeURIComponent(
            team
          )}/injuries`
        : "/injuries";

    const rawData =
      await nflMetaFetch(endpoint);

    const rows =
      normalizeArray(rawData);

    const injuries =
      rows
        .map(normalizeInjury)
        .filter((injury) => {
          return (
            injury.player_name ||
            injury.player_key ||
            injury.team
          );
        })
        .sort((a, b) => {
          if (
            b.severity !==
            a.severity
          ) {
            return (
              b.severity -
              a.severity
            );
          }

          if (
            a.practice_concern !==
            b.practice_concern
          ) {
            return a.practice_concern
              ? -1
              : 1;
          }

          return (
            a.player_name || ""
          ).localeCompare(
            b.player_name || ""
          );
        });

    const out =
      injuries.filter(
        (x) =>
          x.game_status === "OUT"
      );

    const doubtful =
      injuries.filter(
        (x) =>
          x.game_status ===
          "DOUBTFUL"
      );

    const questionable =
      injuries.filter(
        (x) =>
          x.game_status ===
          "QUESTIONABLE"
      );

    const probable =
      injuries.filter(
        (x) =>
          x.game_status ===
          "PROBABLE"
      );

    const practiceConcerns =
      injuries.filter(
        (x) =>
          x.practice_concern &&
          x.game_status ===
            "NO_DESIGNATION"
      );

    const restOnly =
      injuries.filter(
        (x) =>
          x.rest_related &&
          x.game_status ===
            "NO_DESIGNATION"
      );

    const inactiveWithDesignation =
      injuries.filter(
        (x) =>
          x.inactive &&
          x.game_status !==
            "NO_DESIGNATION"
      );

    const teams =
      Array.from(
        new Set(
          injuries
            .map((x) => x.team)
            .filter(Boolean)
        )
      ).sort();

    return NextResponse.json({
      success: true,

      version:
        "1.2-report-status-priority",

      provider:
        "NFLMeta",

      team_filter:
        team,

      summary: {
        total_records:
          injuries.length,

        game_designations: {
          out:
            out.length,

          doubtful:
            doubtful.length,

          questionable:
            questionable.length,

          probable:
            probable.length,
        },

        practice_concerns_without_game_designation:
          practiceConcerns.length,

        rest_nir_without_game_designation:
          restOnly.length,

        inactive_with_report_designation:
          inactiveWithDesignation.length,

        teams_with_reports:
          teams.length,
      },

      teams,

      game_designations: {
        out,
        doubtful,
        questionable,
        probable,
      },

      practice_concerns:
        practiceConcerns,

      rest_nir:
        restOnly,

      inactive_with_designation:
        inactiveWithDesignation,

      injuries,

      model_status: {
        injury_feed_connected:
          true,

        report_status_priority:
          true,

        inactive_status_handled:
          true,

        practice_separated:
          true,

        rest_days_filtered:
          true,

        injury_adjustments_active:
          false,

        next_step:
          "Calculate player importance using position, depth-chart role and historical usage before injuries modify RDG projections.",

        message:
          "RDG now preserves official injury designations even when NFLMeta game_status is Inactive. Injury adjustments remain disabled.",
      },

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL injury route error:",
      error
    );

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
