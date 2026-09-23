import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NFLMETA_BASE = "https://nflmeta.org/api/v1";
const VERSION = "1.3-all-32-teams-injury-feed";

const NFL_TEAMS = [
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE",
  "DAL","DEN","DET","GB","HOU","IND","JAX","KC",
  "LV","LAC","LA","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS",
] as const;

type RawInjury = Record<string, any>;

type Injury = {
  season_year: number | null;
  week: number | null;
  season_type: string;
  player_name: string;
  player_key: string | null;
  player_id: string | number | null;
  team: string;
  team_name: string | null;
  position: string;
  injury: string;
  primary_injury: string | null;
  secondary_injury: string | null;
  rest_related: boolean;
  game_status: string;
  practice_status: string;
  current_injury: boolean;
  severity: number;
  unavailable: boolean;
  high_risk: boolean;
  monitor: boolean;
  practice_concern: boolean;
  importance_score: number | null;
  importance_tier: string | null;
  source: "weekly_report" | "current_reserve";
  raw: RawInjury;
};

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function upper(v: unknown): string {
  return text(v).toUpperCase();
}

function isRestOnly(value: string): boolean {
  const x = value.toUpperCase();
  return (
    x.includes("NIR") ||
    x.includes("REST") ||
    x.includes("NOT INJURY RELATED")
  );
}

function normalizePractice(v: unknown): string {
  const x = upper(v);
  if (!x) return "";
  if (x === "DNP" || x.includes("DID NOT")) return "DNP";
  if (x === "LP" || x.includes("LIMITED")) return "LIMITED";
  if (x === "FP" || x.includes("FULL")) return "FULL";
  return x;
}

function normalizeGameStatus(row: RawInjury, reserve = false): string {
  if (reserve) return "OUT";

  const candidates = [
    row.game_status,
    row.report_status,
    row.status,
    row.designation,
  ];

  for (const c of candidates) {
    const x = upper(c);
    if (!x) continue;
    if (x.includes("INACTIVE")) return "OUT";
    if (x.includes("OUT")) return "OUT";
    if (x.includes("DOUBT")) return "DOUBTFUL";
    if (x.includes("QUESTION")) return "QUESTIONABLE";
    if (x.includes("PROBABLE")) return "PROBABLE";
  }

  return "NO_DESIGNATION";
}

function severityFor(status: string, practice: string, reserve: boolean): number {
  if (reserve || status === "OUT") return 4;
  if (status === "DOUBTFUL") return 3;
  if (status === "QUESTIONABLE") return 2;
  if (practice === "DNP") return 1;
  if (practice === "LIMITED") return 1;
  return 0;
}

function normalizeRow(
  row: RawInjury,
  fallbackTeam: string,
  source: "weekly_report" | "current_reserve",
): Injury {
  const reserve = source === "current_reserve";
  const team =
    upper(row.team_abbr) ||
    upper(row.team) ||
    fallbackTeam;

  const primary =
    text(row.report_primary_injury) ||
    text(row.practice_primary_injury) ||
    text(row.primary_injury) ||
    text(row.injury) ||
    (reserve ? "Reserve / unavailable" : "");

  const secondary =
    text(row.report_secondary_injury) ||
    text(row.practice_secondary_injury) ||
    text(row.secondary_injury) ||
    null;

  const injury = [primary, secondary].filter(Boolean).join(" / ");
  const practice = normalizePractice(row.practice_status);
  const gameStatus = normalizeGameStatus(row, reserve);
  const restRelated = isRestOnly(injury);
  const severity = severityFor(gameStatus, practice, reserve);

  const currentInjury =
    reserve ||
    gameStatus === "OUT" ||
    gameStatus === "DOUBTFUL" ||
    gameStatus === "QUESTIONABLE" ||
    (!restRelated && (practice === "DNP" || practice === "LIMITED"));

  return {
    season_year:
      Number.isFinite(Number(row.season_year)) ? Number(row.season_year) : null,
    week:
      Number.isFinite(Number(row.week)) ? Number(row.week) : null,
    season_type: text(row.season_type) || "REG",
    player_name:
      text(row.display_name) ||
      text(row.player_name) ||
      text(row.name) ||
      text(row.player_key) ||
      "Unknown",
    player_key: text(row.player_key) || null,
    player_id: row.player_id ?? null,
    team,
    team_name: text(row.team_name) || null,
    position: upper(row.position),
    injury: injury || (reserve ? "Reserve / unavailable" : "Injury report"),
    primary_injury: primary || null,
    secondary_injury: secondary,
    rest_related: restRelated,
    game_status: gameStatus,
    practice_status: practice,
    current_injury: currentInjury,
    severity,
    unavailable: reserve || gameStatus === "OUT",
    high_risk:
      reserve ||
      gameStatus === "OUT" ||
      gameStatus === "DOUBTFUL",
    monitor:
      gameStatus === "QUESTIONABLE" ||
      (!restRelated && (practice === "DNP" || practice === "LIMITED")),
    practice_concern:
      !restRelated && (practice === "DNP" || practice === "LIMITED"),
    importance_score: null,
    importance_tier: null,
    source,
    raw: row,
  };
}

function getRows(payload: any): RawInjury[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.injuries)) return payload.injuries;
  if (Array.isArray(payload?.reports)) return payload.reports;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function getReserves(payload: any): RawInjury[] {
  const candidates = [
    payload?.current_reserves,
    payload?.meta?.current_reserves,
    payload?.data?.current_reserves,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

async function nflmeta(path: string, apiKey: string) {
  const response = await fetch(`${NFLMETA_BASE}${path}`, {
    headers: {
      "X-NFLMeta-Key": apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`NFLMeta ${path} returned ${response.status}: ${body.slice(0, 300)}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`NFLMeta ${path} returned invalid JSON.`);
  }
}

function dedupe(rows: Injury[]): Injury[] {
  const map = new Map<string, Injury>();

  for (const row of rows) {
    const key =
      `${row.team}|${row.player_key || row.player_name.toLowerCase()}`;

    const previous = map.get(key);

    if (!previous) {
      map.set(key, row);
      continue;
    }

    // Current reserve / OUT beats a weaker weekly practice row.
    const previousScore =
      (previous.source === "current_reserve" ? 100 : 0) +
      previous.severity * 10;
    const newScore =
      (row.source === "current_reserve" ? 100 : 0) +
      row.severity * 10;

    if (newScore > previousScore) map.set(key, row);
  }

  return [...map.values()];
}

export async function GET(request: Request) {
  try {
    const apiKey =
      process.env.NFLMETA_API_KEY ||
      process.env.NFL_META_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "NFLMETA_API_KEY is missing.",
        },
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const requestedTeam = upper(url.searchParams.get("team"));

    const teams =
      requestedTeam && NFL_TEAMS.includes(requestedTeam as any)
        ? [requestedTeam]
        : [...NFL_TEAMS];

    /*
      IMPORTANT:
      We intentionally query the TEAM injury endpoint for every club.
      The old league-wide request returned exactly 100 rows and stopped
      alphabetically after ~14 teams. This guarantees all 32 teams are
      checked instead of trusting that capped league response.
    */
    const results = await Promise.allSettled(
      teams.map(async (team) => {
        const payload = await nflmeta(
          `/teams/${encodeURIComponent(team)}/injuries`,
          apiKey,
        );

        const weekly = getRows(payload).map((row) =>
          normalizeRow(row, team, "weekly_report"),
        );

        const reserves = getReserves(payload).map((row) =>
          normalizeRow(row, team, "current_reserve"),
        );

        return {
          team,
          weekly,
          reserves,
          meta: payload?.meta ?? null,
        };
      }),
    );

    const successfulTeams: string[] = [];
    const failedTeams: Array<{ team: string; error: string }> = [];
    const allRows: Injury[] = [];

    results.forEach((result, index) => {
      const team = teams[index];

      if (result.status === "fulfilled") {
        successfulTeams.push(team);
        allRows.push(...result.value.weekly, ...result.value.reserves);
      } else {
        failedTeams.push({
          team,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });

    const injuries = dedupe(allRows)
      .filter((x) => x.team)
      .sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        if (a.team !== b.team) return a.team.localeCompare(b.team);
        return a.player_name.localeCompare(b.player_name);
      });

    const currentInjuries = injuries.filter((x) => x.current_injury);

    const out = currentInjuries.filter((x) => x.game_status === "OUT");
    const doubtful = currentInjuries.filter((x) => x.game_status === "DOUBTFUL");
    const questionable = currentInjuries.filter(
      (x) => x.game_status === "QUESTIONABLE",
    );

    const teamsWithCurrentReports = [
      ...new Set(currentInjuries.map((x) => x.team)),
    ].sort();

    return NextResponse.json({
      success: true,
      version: VERSION,
      provider: "NFLMeta",
      coverage: {
        requested_teams: teams.length,
        successful_teams: successfulTeams.length,
        failed_teams: failedTeams.length,
        all_32_checked: !requestedTeam && successfulTeams.length === 32,
        teams_with_current_injuries: teamsWithCurrentReports.length,
      },
      summary: {
        total_records: injuries.length,
        current_injuries: currentInjuries.length,
        out: out.length,
        doubtful: doubtful.length,
        questionable: questionable.length,
        current_reserve_records: injuries.filter(
          (x) => x.source === "current_reserve",
        ).length,
      },
      teams: teamsWithCurrentReports,
      current_injuries: currentInjuries,
      injuries,
      game_designations: {
        out,
        doubtful,
        questionable,
      },
      diagnostics: {
        successful_teams: successfulTeams,
        failed_teams: failedTeams,
        note:
          "Each NFL team injury endpoint is queried directly so the feed is not truncated by the league-wide 100-row result window.",
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL injury route error.",
      },
      { status: 500 },
    );
  }
}

