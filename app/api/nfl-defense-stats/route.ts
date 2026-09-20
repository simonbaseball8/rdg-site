import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

type Row = Record<string, string>;

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

function text(value: any): string {
  return String(value ?? "").trim();
}

/* -------------------------------------------------- */
/* CSV PARSER                                         */
/* -------------------------------------------------- */

function parseCSV(input: string): {
  headers: string[];
  rows: Row[];
} {
  const rawRows: string[][] = [];

  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (
      (char === "\n" || char === "\r") &&
      !quoted
    ) {
      if (
        char === "\r" &&
        input[i + 1] === "\n"
      ) {
        i++;
      }

      row.push(value);

      if (row.some((x) => x.length > 0)) {
        rawRows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rawRows.push(row);
  }

  if (!rawRows.length) {
    return {
      headers: [],
      rows: [],
    };
  }

  const headers = rawRows[0].map((header) =>
    header.trim()
  );

  const rows = rawRows
    .slice(1)
    .map((values) => {
      const output: Row = {};

      headers.forEach((header, index) => {
        output[header] =
          values[index] ?? "";
      });

      return output;
    });

  return {
    headers,
    rows,
  };
}

/* -------------------------------------------------- */
/* LOAD PBP                                           */
/* -------------------------------------------------- */

async function loadPBP(season: number) {
  const response = await fetch(PBP_URL(season), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Unable to load ${season} nflverse PBP: ${response.status}`
    );
  }

  const body = await response.text();

  const parsed = parseCSV(body);

  return {
    season,
    url: PBP_URL(season),
    contentType:
      response.headers.get("content-type"),
    contentEncoding:
      response.headers.get("content-encoding"),
    bodyLength: body.length,
    headers: parsed.headers,
    rows: parsed.rows,
  };
}

/* -------------------------------------------------- */
/* FIND LIKELY COLUMNS                                */
/* -------------------------------------------------- */

function findColumns(
  headers: string[],
  terms: string[]
) {
  return headers.filter((header) => {
    const normalized =
      header.toLowerCase();

    return terms.some((term) =>
      normalized.includes(
        term.toLowerCase()
      )
    );
  });
}

/* -------------------------------------------------- */
/* CLEAN SAMPLE ROW                                   */
/* -------------------------------------------------- */

function sampleImportantFields(
  row: Row | undefined
) {
  if (!row) return null;

  const output: Record<
    string,
    string
  > = {};

  const interestingTerms = [
    "game",
    "season",
    "week",
    "posteam",
    "defteam",
    "home",
    "away",
    "play_type",
    "pass",
    "rush",
    "yard",
    "sack",
    "interception",
    "fumble",
  ];

  for (const [
    key,
    value,
  ] of Object.entries(row)) {
    const lower =
      key.toLowerCase();

    if (
      interestingTerms.some(
        (term) =>
          lower.includes(term)
      )
    ) {
      output[key] = value;
    }
  }

  return output;
}

/* -------------------------------------------------- */
/* FIND FIRST ROW WITH TEAM-LIKE DATA                 */
/* -------------------------------------------------- */

function findUsefulSample(
  rows: Row[],
  headers: string[]
) {
  const teamColumns =
    findColumns(headers, [
      "defteam",
      "posteam",
      "home_team",
      "away_team",
      "defensive",
      "offensive",
    ]);

  for (
    let i = 0;
    i < Math.min(rows.length, 500);
    i++
  ) {
    const row = rows[i];

    const hasTeamData =
      teamColumns.some(
        (column) =>
          text(row[column]).length > 0
      );

    if (hasTeamData) {
      return {
        row_number: i + 2,
        important_fields:
          sampleImportantFields(
            row
          ),
      };
    }
  }

  return {
    row_number: null,
    important_fields:
      sampleImportantFields(
        rows[0]
      ),
  };
}

/* -------------------------------------------------- */
/* COLUMN DIAGNOSTICS                                 */
/* -------------------------------------------------- */

function diagnostics(
  data: Awaited<
    ReturnType<typeof loadPBP>
  >
) {
  const headers =
    data.headers;

  return {
    season:
      data.season,

    rows:
      data.rows.length,

    body_length:
      data.bodyLength,

    content_type:
      data.contentType,

    content_encoding:
      data.contentEncoding,

    total_columns:
      headers.length,

    first_25_columns:
      headers.slice(0, 25),

    team_columns:
      findColumns(headers, [
        "team",
        "posteam",
        "defteam",
        "offense",
        "defense",
      ]),

    game_columns:
      findColumns(headers, [
        "game",
      ]),

    season_columns:
      findColumns(headers, [
        "season",
      ]),

    play_columns:
      findColumns(headers, [
        "play_type",
        "pass_attempt",
        "rush_attempt",
      ]),

    passing_columns:
      findColumns(headers, [
        "pass",
        "passing",
      ]),

    rushing_columns:
      findColumns(headers, [
        "rush",
        "rushing",
      ]),

    yard_columns:
      findColumns(headers, [
        "yard",
      ]),

    sack_columns:
      findColumns(headers, [
        "sack",
      ]),

    turnover_columns:
      findColumns(headers, [
        "interception",
        "fumble",
      ]),

    exact_column_checks: {
      game_id:
        headers.includes(
          "game_id"
        ),

      season:
        headers.includes(
          "season"
        ),

      season_type:
        headers.includes(
          "season_type"
        ),

      week:
        headers.includes(
          "week"
        ),

      posteam:
        headers.includes(
          "posteam"
        ),

      defteam:
        headers.includes(
          "defteam"
        ),

      play_type:
        headers.includes(
          "play_type"
        ),

      pass_attempt:
        headers.includes(
          "pass_attempt"
        ),

      rush_attempt:
        headers.includes(
          "rush_attempt"
        ),

      passing_yards:
        headers.includes(
          "passing_yards"
        ),

      rushing_yards:
        headers.includes(
          "rushing_yards"
        ),

      yards_gained:
        headers.includes(
          "yards_gained"
        ),

      sack:
        headers.includes(
          "sack"
        ),

      interception:
        headers.includes(
          "interception"
        ),

      fumble_lost:
        headers.includes(
          "fumble_lost"
        ),
    },

    sample:
      findUsefulSample(
        data.rows,
        headers
      ),
  };
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    const [
      current,
      prior,
    ] = await Promise.all([
      loadPBP(
        CURRENT_SEASON
      ),

      loadPBP(
        PRIOR_SEASON
      ),
    ]);

    const currentDiagnostics =
      diagnostics(current);

    const priorDiagnostics =
      diagnostics(prior);

    return NextResponse.json({
      success: true,

      version:
        "1.3-pbp-column-diagnostic",

      purpose:
        "Identify the exact nflverse PBP column names received by Vercel before rebuilding the RDG defensive model.",

      current_2026:
        currentDiagnostics,

      prior_2025:
        priorDiagnostics,

      comparison: {
        same_column_count:
          current.headers.length ===
          prior.headers.length,

        current_columns:
          current.headers.length,

        prior_columns:
          prior.headers.length,

        current_rows:
          current.rows.length,

        prior_rows:
          prior.rows.length,
      },

      model_status: {
        defense_adjustment_active:
          false,

        passing_v2_changed:
          false,

        injury_adjustment_active:
          false,
      },

      next_step:
        "Use these exact columns to build the production defense-stats route. Do not activate defensive adjustments until they pass held-out backtesting.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense diagnostic error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.3-pbp-column-diagnostic",

        error:
          error?.message ||
          "Unable to inspect nflverse PBP data.",
      },
      {
        status: 500,
      }
    );
  }
}
