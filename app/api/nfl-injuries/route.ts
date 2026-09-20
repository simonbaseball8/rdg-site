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

/*
  IMPORTANT:

  Game designation and practice participation are DIFFERENT.

  A player missing practice does NOT automatically mean:
  OUT
  DOUBTFUL
  QUESTIONABLE

  We only use an actual game/report designation for that.
*/

function normalizeGameStatus(value: any) {
  const status = clean(value)?.toUpperCase();

  if (!status) return "NO_DESIGNATION";

  if (
    status === "OUT" ||
    status.includes("INJURED RESERVE") ||
    status === "IR"
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
  const reason = clean(value)?.toUpperCase() || "";

  return (
    reason.includes("NIR") ||
    reason.includes("NOT INJURY") ||
    reason.includes("NOT INJURY-RELATED") ||
    reason.includes("NOT INJURY RELATED") ||
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
  /*
    NFLMeta gives us report_status and game_status.

    We intentionally DO NOT fall back to practice_status here.
  */

  const rawGameStatus =
    clean(row?.game_status) ??
    clean(row?.report_status) ??
    clean(row?.status) ??
    clean(row?.injury_status) ??
    clean(row?.designation);

  const gameStatus = normalizeGameStatus(rawGameStatus);

  const rawPracticeStatus =
    clean(row?.practice_status) ??
    clean(row?.practice) ??
    clean(row?.participation);

  const practiceStatus =
    normalizePracticeStatus(rawPracticeStatus);

  /*
    Fix player names.

    NFLMeta uses display_name.
  */

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

  /*
    Fix injury field.

    NFLMeta uses report_primary_injury.
  */

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

  const restRelated = isRestReason(primaryInjury);

  /*
    A DNP because of rest should NEVER automatically
    become an injury designation.
  */

  const actualInjury =
    primaryInjury && !restRelated
      ? primaryInjury
      : practicePrimaryInjury &&
          !isRestReason(practicePrimaryInjury)
        ? practicePrimaryInjury
        : null;

  const noGameDesignation =
    Boolean(row?.no_game_designation) ||
    gameStatus === "NO_DESIGNATION";

  /*
    Model flags.

    These are classifications only.

    They STILL DO NOT modify projections.
  */

  const unavailable = gameStatus === "OUT";

  const highRisk =
    gameStatus === "OUT" ||
    gameStatus === "DOUBTFUL";

  const monitor =
    gameStatus === "QUESTIONABLE";

  const practiceConcern =
    !restRelated &&
    actualInjury !== null &&
    (practiceStatus === "DNP" ||
      practiceStatus === "LIMITED");

  return {
    season_year: row?.season_year ?? null,
    week: row?.week ?? null,
    season_type: clean(row?.season_type),

    player_name: playerName,
    player_key: playerKey,
    player_id: playerId,

    team,
    team_name: teamName,

    position,

    injury: actualInjury,
    primary_injury: primaryInjury,
    secondary_injury: secondaryInjury,

    rest_related: restRelated,

    game_status: gameStatus,
    raw_game_status: rawGameStatus,

    practice_status: practiceStatus,
    raw_practice_status: rawPracticeStatus,

    no_game_designation: noGameDesignation,

    severity: gameSeverity(gameStatus),

    unavailable: unavailable,

    high_risk: highRisk,

    monitor: monitor,

    practice_concern: practiceConcern,

    /*
      IMPORTANT FOR THE FUTURE MODEL:

      false = do not automatically adjust model.

      Later we will calculate this using:
      - game status
      - player importance
      - depth chart
      - historical usage
      - historical injury impact
    */

    model_adjustment_active: false,

    headshot_url:
      clean(row?.headshot_url),

    raw: row,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const team =
      searchParams.get("team")?.toUpperCase() || null;

    const endpoint = team
      ? `/teams/${encodeURIComponent(team)}/injuries`
      : "/injuries";

    const rawData =
      await nflMetaFetch(endpoint);

    const rows =
      normalizeArray(rawData);

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
        if (b.severity !== a.severity) {
          return b.severity - a.severity;
        }

        if (
          a.practice_concern !==
          b.practice_concern
        ) {
          return a.practice_concern ? -1 : 1;
        }

        return (
          a.player_name || ""
        ).localeCompare(
          b.player_name || ""
        );
      });

    /*
      ACTUAL GAME DESIGNATIONS
    */

    const out = injuries.filter(
      (x) => x.game_status === "OUT"
    );

    const doubtful = injuries.filter(
      (x) => x.game_status === "DOUBTFUL"
    );

    const questionable = injuries.filter(
      (x) => x.game_status === "QUESTIONABLE"
    );

    const probable = injuries.filter(
      (x) => x.game_status === "PROBABLE"
    );

    /*
      Practice concerns are separate.

      Example:

      Player has hamstring injury
      DNP Wednesday
      but NO game designation yet.

      He belongs here — NOT automatically in Doubtful.
    */

    const practiceConcerns = injuries.filter(
      (x) =>
        x.practice_concern &&
        x.game_status === "NO_DESIGNATION"
    );

    /*
      Rest/NIR players are tracked separately.

      These should not create an injury penalty simply
      because the player received a veteran rest day.
    */

    const restOnly = injuries.filter(
      (x) =>
        x.rest_related &&
        x.game_status === "NO_DESIGNATION"
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

      version:
        "1.1-game-status-practice-separated",

      provider: "NFLMeta",

      team_filter: team,

      summary: {
        total_records: injuries.length,

        game_designations: {
          out: out.length,
          doubtful: doubtful.length,
          questionable: questionable.length,
          probable: probable.length,
        },

        practice_concerns_without_game_designation:
          practiceConcerns.length,

        rest_nir_without_game_designation:
          restOnly.length,

        teams_with_reports:
          teams.length,
      },

      teams,

      /*
        These are the players that matter most
        when we eventually calculate model impact.
      */

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

      injuries,

      model_status: {
        injury_feed_connected: true,

        game_designation_separated_from_practice:
          true,

        rest_days_filtered:
          true,

        injury_adjustments_active:
          false,

        next_step:
          "Connect player importance, depth chart role, historical usage and historical injury impact before changing RDG projections.",

        message:
          "Injury information is classified but does not yet modify RDG projections.",
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
