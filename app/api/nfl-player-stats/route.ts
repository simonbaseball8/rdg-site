import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEASON = 2026;

const NFLVERSE_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${SEASON}.csv`;

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseCSVLine(line: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCSV(text: string) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (!lines.length) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });

    return row;
  });
}

export async function GET() {
  try {
    const response = await fetch(NFLVERSE_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          source_url: NFLVERSE_URL,
          status: response.status,
          error: `nflverse returned ${response.status}`,
        },
        { status: 500 }
      );
    }

    const csv = await response.text();
    const rows = parseCSV(csv);

    const regularSeason = rows.filter(
      (row: any) =>
        Number(row.season) === SEASON &&
        String(row.season_type).toUpperCase() === "REG"
    );

    const players = regularSeason.map((row: any) => ({
      player_id: row.player_id ?? null,

      player_name:
        row.player_display_name ||
        row.player_name ||
        null,

      position: row.position ?? null,

      team:
        row.recent_team ||
        row.team ||
        null,

      week: num(row.week),

      passing: {
        attempts: num(row.attempts),
        completions: num(row.completions),
        yards: num(row.passing_yards),
        touchdowns: num(row.passing_tds),
        interceptions: num(row.interceptions),
      },

      rushing: {
        attempts: num(row.carries),
        yards: num(row.rushing_yards),
        touchdowns: num(row.rushing_tds),
      },

      receiving: {
        targets: num(row.targets),
        receptions: num(row.receptions),
        yards: num(row.receiving_yards),
        touchdowns: num(row.receiving_tds),
      },
    }));

    const quarterbacks = players
      .filter(
        (p: any) =>
          p.position === "QB" ||
          p.passing.attempts > 0
      )
      .sort(
        (a: any, b: any) =>
          b.week - a.week ||
          b.passing.yards - a.passing.yards
      );

    const rushers = players
      .filter((p: any) => p.rushing.attempts > 0)
      .sort(
        (a: any, b: any) =>
          b.week - a.week ||
          b.rushing.yards - a.rushing.yards
      );

    const receivers = players
      .filter((p: any) => p.receiving.targets > 0)
      .sort(
        (a: any, b: any) =>
          b.week - a.week ||
          b.receiving.yards - a.receiving.yards
      );

    return NextResponse.json({
      success: true,

      version: "1.1-nflverse-current-player-stats",

      season: SEASON,

      source: "nflverse stats_player",

      source_url: NFLVERSE_URL,

      model_status:
        "Player statistics only — no RDG prop probabilities calculated",

      raw_rows_found: rows.length,

      regular_season_rows: regularSeason.length,

      quarterbacks_found: quarterbacks.length,

      rushers_found: rushers.length,

      receivers_found: receivers.length,

      quarterbacks,

      rushers,

      receivers,

      sample_columns:
        rows.length > 0 ? Object.keys(rows[0]) : [],

      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL player stats error",
      },
      { status: 500 }
    );
  }
}
