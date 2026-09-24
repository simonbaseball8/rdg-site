import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const VERSION = "3.1-official-nfl-clean-parser";
const NFL_URL = "https://www.nfl.com/injuries/";

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
  source: "NFL.com";
};

const TEAM_NAMES: Record<string, string> = {
  Cardinals: "ARI", Falcons: "ATL", Ravens: "BAL", Bills: "BUF",
  Panthers: "CAR", Bears: "CHI", Bengals: "CIN", Browns: "CLE",
  Cowboys: "DAL", Broncos: "DEN", Lions: "DET", Packers: "GB",
  Texans: "HOU", Colts: "IND", Jaguars: "JAX", Chiefs: "KC",
  Raiders: "LV", Chargers: "LAC", Rams: "LA", Dolphins: "MIA",
  Vikings: "MIN", Patriots: "NE", Saints: "NO", Giants: "NYG",
  Jets: "NYJ", Eagles: "PHI", Steelers: "PIT", "49ers": "SF",
  Seahawks: "SEA", Buccaneers: "TB", Titans: "TEN", Commanders: "WAS",
};

function cleanText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function decodeCell(value: string): string {
  return cleanText(value);
}

function normalizeStatus(value: string): string {
  const x = value.trim().toUpperCase();
  if (x.includes("OUT")) return "OUT";
  if (x.includes("DOUBT")) return "DOUBTFUL";
  if (x.includes("QUESTION")) return "QUESTIONABLE";
  if (x.includes("PROBABLE")) return "PROBABLE";
  return "NO_DESIGNATION";
}

function normalizePractice(value: string): string {
  const x = value.trim().toUpperCase();
  if (x.includes("DID NOT")) return "DNP";
  if (x.includes("LIMITED")) return "LIMITED";
  if (x.includes("FULL")) return "FULL";
  return value.trim();
}

function importance(position: string, status: string, practice: string) {
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

  if (practice === "DNP") score += 8;
  else if (practice === "LIMITED") score += 4;

  return {
    score,
    tier:
      score >= 85 ? "CRITICAL" :
      score >= 60 ? "HIGH" :
      score >= 35 ? "MEDIUM" :
      "LOW",
  };
}

function parseOfficialNFL(html: string): Injury[] {
  const rows: Injury[] = [];

  /*
    NFL.com's page renders team injury tables in HTML.
    We scan headings/team labels and then parse table rows beneath them.
    This avoids private APIs and requires no API key.
  */
  const teamPattern = Object.keys(TEAM_NAMES)
    .sort((a, b) => b.length - a.length)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const sectionRegex = new RegExp(
    `(?:<[^>]+>\\s*)*(${teamPattern})(?:\\s*</[^>]+>)+([\\s\\S]*?)(?=(?:<[^>]+>\\s*)*(?:${teamPattern})(?:\\s*</[^>]+>)+|$)`,
    "gi",
  );

  let sectionMatch: RegExpExecArray | null;

  while ((sectionMatch = sectionRegex.exec(html)) !== null) {
    const teamName = sectionMatch[1];
    const team = TEAM_NAMES[teamName];
    const section = sectionMatch[2];

    if (!team) continue;

    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trRegex.exec(section)) !== null) {
      const rowHtml = trMatch[1];

      const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((m) => decodeCell(m[1]));

      if (cells.length < 4) continue;

      const joined = cells.join(" | ").toLowerCase();
      if (
        joined.includes("player") &&
        joined.includes("position") &&
        joined.includes("practice")
      ) {
        continue;
      }

      // NFL table columns:
      // Player | Position | Injuries | Practice Status | Game Status
      const playerName = cells[0]?.trim() || "";
      const position = (cells[1] || "").trim().toUpperCase();
      const injury = (cells[2] || "").trim();
      const practice = normalizePractice(cells[3] || "");
      const gameStatus = normalizeStatus(cells[4] || "");

      if (!playerName || !position) continue;

      const hasGameDesignation =
        gameStatus === "OUT" ||
        gameStatus === "DOUBTFUL" ||
        gameStatus === "QUESTIONABLE";

      const hasNamedInjury = injury.length > 0;
      const hasPracticeConcern =
        practice === "DNP" || practice === "LIMITED";

      // A DNP/LIMITED row with a blank injury and no game designation can be
      // rest, maintenance, or another non-injury reason. Do not tell RDG it is
      // an injury unless NFL.com actually supplies an injury or designation.
      const current =
        hasGameDesignation || (hasNamedInjury && hasPracticeConcern);

      if (!current) continue;

      const imp = importance(position, gameStatus, practice);

      rows.push({
        player_name: playerName,
        team,
        position,
        injury,
        game_status: gameStatus,
        practice_status: practice,
        current_injury: true,
        importance_score: imp.score,
        importance_tier: imp.tier,
        source: "NFL.com",
      });
    }
  }

  return rows;
}

function dedupe(rows: Injury[]) {
  const map = new Map<string, Injury>();

  const statusRank: Record<string, number> = {
    OUT: 4,
    DOUBTFUL: 3,
    QUESTIONABLE: 2,
    PROBABLE: 1,
    NO_DESIGNATION: 0,
  };

  for (const row of rows) {
    const key = `${row.team}|${row.player_name.toLowerCase()}`;
    const old = map.get(key);

    if (!old) {
      map.set(key, row);
      continue;
    }

    const oldRank = statusRank[old.game_status] || 0;
    const newRank = statusRank[row.game_status] || 0;

    if (
      newRank > oldRank ||
      (newRank === oldRank &&
        Number(row.importance_score || 0) > Number(old.importance_score || 0))
    ) {
      map.set(key, row);
    }
  }

  return [...map.values()];
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const teamFilter = (url.searchParams.get("team") || "")
      .trim()
      .toUpperCase();

    const response = await fetch(NFL_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (compatible; RDG-Injury-Research/1.0; +https://vercel.app)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`NFL.com returned HTTP ${response.status}.`);
    }

    const html = await response.text();

    let injuries = dedupe(parseOfficialNFL(html));

    if (teamFilter) {
      injuries = injuries.filter((x) => x.team === teamFilter);
    }

    const statusRank: Record<string, number> = {
      OUT: 4,
      DOUBTFUL: 3,
      QUESTIONABLE: 2,
      PROBABLE: 1,
      NO_DESIGNATION: 0,
    };

    injuries.sort((a, b) => {
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

    const teams = [
      ...new Set(injuries.map((x) => x.team)),
    ].sort();

    /*
      Important safety check:
      An HTTP 200 with zero parsed rows is not accepted as a healthy feed.
      That prevents RDG from silently treating a changed/blocked NFL page
      as "no injuries".
    */
    if (!teamFilter && injuries.length === 0) {
      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          provider: "NFL.com",
          requires_api_key: false,
          error:
            "NFL.com loaded, but no injury rows could be parsed. RDG will not treat this as a clean injury report.",
          generated_at: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      version: VERSION,
      provider: "NFL.com",
      requires_api_key: false,
      team_filter: teamFilter || null,
      summary: {
        current_injuries: injuries.length,
        out: out.length,
        doubtful: doubtful.length,
        questionable: questionable.length,
        teams_with_current_injuries: teams.length,
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
        source: NFL_URL,
        parsed_html: true,
        fail_closed: true,
        note:
          "Current concerns require an NFL game designation, or a named injury plus DNP/LIMITED practice status. Blank-injury maintenance/rest rows are excluded.",
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        provider: "NFL.com",
        requires_api_key: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL injury route error.",
        generated_at: new Date().toISOString(),
      },
      { status: 502 },
    );
  }
}
