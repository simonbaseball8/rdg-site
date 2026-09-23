import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const VERSION = "2.0-free-espn-current-injuries";
const ESPN_INJURIES =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";

type AnyRecord = Record<string, any>;

type Injury = {
  player_name: string;
  team: string;
  position: string;
  injury: string;
  game_status: string;
  practice_status: string;
  current_injury: boolean;
  importance_score: number | null;
  importance_tier: string | null;
  source: "ESPN";
  source_status: string | null;
  source_date: string | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function upper(value: unknown): string {
  return str(value).toUpperCase();
}

function normalizeTeam(value: unknown): string {
  const raw = upper(value);
  const aliases: Record<string, string> = {
    ARZ: "ARI",
    JAC: "JAX",
    KAN: "KC",
    LAR: "LA",
    LOSANGELESRAMS: "LA",
    NEP: "NE",
    NOR: "NO",
    OAK: "LV",
    SFO: "SF",
    TAM: "TB",
    WSH: "WAS",
  };
  return aliases[raw.replace(/[^A-Z]/g, "")] || raw;
}

function statusText(item: AnyRecord): string {
  return (
    str(item.status) ||
    str(item.type?.description) ||
    str(item.type?.name) ||
    str(item.type?.abbreviation) ||
    str(item.details?.status) ||
    str(item.shortComment) ||
    str(item.longComment)
  );
}

function normalizeGameStatus(value: unknown): string {
  const x = upper(value);

  if (!x) return "NO_DESIGNATION";
  if (
    x.includes("INJURED RESERVE") ||
    x.includes("RESERVE/INJURED") ||
    x === "IR" ||
    x.includes("OUT")
  ) return "OUT";
  if (x.includes("DOUBT")) return "DOUBTFUL";
  if (x.includes("QUESTION")) return "QUESTIONABLE";
  if (x.includes("PROBABLE")) return "PROBABLE";
  if (x.includes("DAY-TO-DAY") || x.includes("DAY TO DAY")) return "QUESTIONABLE";

  return "NO_DESIGNATION";
}

function injuryDescription(item: AnyRecord): string {
  const candidates = [
    item.details?.type,
    item.details?.detail,
    item.details?.location,
    item.type?.description,
    item.longComment,
    item.shortComment,
  ]
    .map(str)
    .filter(Boolean);

  // Prefer a concise body-part description when ESPN supplies one.
  const bodyPart = str(item.details?.location) || str(item.details?.type);
  if (bodyPart) return bodyPart;

  const comment = candidates.find(
    (x) =>
      !/^(out|questionable|doubtful|probable|injured reserve|ir)$/i.test(x),
  );

  return comment || "Injury";
}

function practiceStatus(item: AnyRecord): string {
  const x =
    str(item.practiceStatus) ||
    str(item.practice_status) ||
    str(item.details?.practiceStatus) ||
    str(item.details?.practice_status);

  const u = upper(x);
  if (!u) return "";
  if (u === "DNP" || u.includes("DID NOT")) return "DNP";
  if (u === "LP" || u.includes("LIMITED")) return "LIMITED";
  if (u === "FP" || u.includes("FULL")) return "FULL";
  return x;
}

function importance(position: string, status: string): {
  score: number | null;
  tier: string | null;
} {
  let score = 0;

  if (position === "QB") score += 70;
  else if (["WR", "RB", "TE"].includes(position)) score += 35;
  else if (["T", "OT", "G", "C", "OL"].includes(position)) score += 28;
  else if (["DE", "DT", "DL", "LB", "OLB", "ILB", "CB", "S"].includes(position))
    score += 20;
  else score += 10;

  if (status === "OUT") score += 30;
  else if (status === "DOUBTFUL") score += 22;
  else if (status === "QUESTIONABLE") score += 12;

  const tier =
    score >= 85 ? "CRITICAL" :
    score >= 60 ? "HIGH" :
    score >= 35 ? "MEDIUM" :
    "LOW";

  return { score, tier };
}

function extractTeam(group: AnyRecord): string {
  return normalizeTeam(
    group.team?.abbreviation ||
    group.team?.shortDisplayName ||
    group.abbreviation ||
    group.teamAbbreviation ||
    group.team,
  );
}

function normalizeItem(item: AnyRecord, fallbackTeam: string): Injury | null {
  const athlete = item.athlete || item.player || {};
  const playerName =
    str(athlete.displayName) ||
    str(athlete.fullName) ||
    str(item.displayName) ||
    str(item.player_name) ||
    str(item.name);

  if (!playerName) return null;

  const team = normalizeTeam(
    athlete.team?.abbreviation ||
    item.team?.abbreviation ||
    item.teamAbbreviation ||
    item.team ||
    fallbackTeam,
  );

  const position = upper(
    athlete.position?.abbreviation ||
    athlete.position?.name ||
    item.position?.abbreviation ||
    item.position,
  );

  const rawStatus = statusText(item);
  const gameStatus = normalizeGameStatus(rawStatus);
  const practice = practiceStatus(item);
  const injury = injuryDescription(item);

  // ESPN's injuries endpoint is already a current-injury feed. Keep all
  // returned players, even when the exact Sunday designation has not yet
  // been posted.
  const current = true;
  const imp = importance(position, gameStatus);

  return {
    player_name: playerName,
    team,
    position,
    injury,
    game_status: gameStatus,
    practice_status: practice,
    current_injury: current,
    importance_score: imp.score,
    importance_tier: imp.tier,
    source: "ESPN",
    source_status: rawStatus || null,
    source_date: str(item.date) || null,
  };
}

function collectFromPayload(payload: AnyRecord): Injury[] {
  const output: Injury[] = [];

  // Common ESPN site-api shape:
  // { injuries: [{ team: {...}, injuries: [...] }, ...] }
  if (Array.isArray(payload.injuries)) {
    for (const group of payload.injuries) {
      if (!group || typeof group !== "object") continue;

      const fallbackTeam = extractTeam(group);
      const items =
        Array.isArray(group.injuries) ? group.injuries :
        Array.isArray(group.items) ? group.items :
        [];

      if (items.length) {
        for (const item of items) {
          const normalized = normalizeItem(item, fallbackTeam);
          if (normalized) output.push(normalized);
        }
      } else {
        const normalized = normalizeItem(group, fallbackTeam);
        if (normalized) output.push(normalized);
      }
    }
  }

  // Alternate shape used by some ESPN endpoints:
  // { teams: [{ team: {...}, injuries: [...] }] }
  if (Array.isArray(payload.teams)) {
    for (const group of payload.teams) {
      const fallbackTeam = extractTeam(group);
      const items =
        Array.isArray(group.injuries) ? group.injuries :
        Array.isArray(group.items) ? group.items :
        [];

      for (const item of items) {
        const normalized = normalizeItem(item, fallbackTeam);
        if (normalized) output.push(normalized);
      }
    }
  }

  // Flat fallback.
  if (!output.length && Array.isArray(payload.items)) {
    for (const item of payload.items) {
      const normalized = normalizeItem(item, "");
      if (normalized) output.push(normalized);
    }
  }

  return output;
}

function dedupe(rows: Injury[]): Injury[] {
  const map = new Map<string, Injury>();

  for (const row of rows) {
    const key = `${row.team}|${row.player_name.toLowerCase()}`;
    const old = map.get(key);

    if (!old) {
      map.set(key, row);
      continue;
    }

    const rank = (x: Injury) => {
      const statusRank: Record<string, number> = {
        OUT: 4,
        DOUBTFUL: 3,
        QUESTIONABLE: 2,
        PROBABLE: 1,
        NO_DESIGNATION: 0,
      };
      return statusRank[x.game_status] || 0;
    };

    if (rank(row) > rank(old)) map.set(key, row);
  }

  return [...map.values()];
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const teamFilter = normalizeTeam(url.searchParams.get("team"));

    const response = await fetch(ESPN_INJURIES, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RDG/2.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `ESPN injury feed returned ${response.status}: ${body.slice(0, 250)}`,
      );
    }

    const payload = await response.json();
    let injuries = dedupe(collectFromPayload(payload));

    if (teamFilter) {
      injuries = injuries.filter((x) => x.team === teamFilter);
    }

    injuries.sort((a, b) => {
      const statusRank: Record<string, number> = {
        OUT: 4,
        DOUBTFUL: 3,
        QUESTIONABLE: 2,
        PROBABLE: 1,
        NO_DESIGNATION: 0,
      };

      const sr =
        (statusRank[b.game_status] || 0) -
        (statusRank[a.game_status] || 0);

      if (sr !== 0) return sr;

      const ir =
        Number(b.importance_score || 0) -
        Number(a.importance_score || 0);

      if (ir !== 0) return ir;
      if (a.team !== b.team) return a.team.localeCompare(b.team);
      return a.player_name.localeCompare(b.player_name);
    });

    const out = injuries.filter((x) => x.game_status === "OUT");
    const doubtful = injuries.filter((x) => x.game_status === "DOUBTFUL");
    const questionable = injuries.filter(
      (x) => x.game_status === "QUESTIONABLE",
    );

    const teams = [...new Set(injuries.map((x) => x.team).filter(Boolean))].sort();

    return NextResponse.json({
      success: true,
      version: VERSION,
      provider: "ESPN",
      requires_api_key: false,
      team_filter: teamFilter || null,
      summary: {
        total_current_injuries: injuries.length,
        out: out.length,
        doubtful: doubtful.length,
        questionable: questionable.length,
        teams_with_injuries: teams.length,
      },
      teams,
      current_injuries: injuries,
      injuries,
      game_designations: {
        out,
        doubtful,
        questionable,
      },
      diagnostics: {
        source_url: ESPN_INJURIES,
        note:
          "Free current ESPN NFL injury feed. No NFLMeta or Odds API key is required.",
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        provider: "ESPN",
        requires_api_key: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL injury route error.",
      },
      { status: 500 },
    );
  }
}
