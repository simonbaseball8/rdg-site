import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEASON = 2026;

// nflverse weekly player stats
const NFLVERSE_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv`;

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeName(name: string) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseCSVLine(line: string) {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
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
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);

    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
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
          error: `nflverse returned ${response.status}`,
        },
        { status: 500 }
      );
    }

    const csv = await response.text();

    const rows = parseCSV(csv);

    const seasonRows = rows.filter(
      (row: any) =>
        Number(row.season) === SEASON &&
        String(row.season_type).toUpperCase() === "REG"
    );

    const playerMap = new Map<string, any>();

    for (const row of seasonRows) {
      const playerId =
        row.player_id ||
        row.player_display_name ||
        row.player_name;

      if (!playerId) continue;

      if (!playerMap.has(playerId)) {
        playerMap.set(playerId, {
          player_id: row.player_id ?? null,

          player_name:
            row.player_display_name ||
            row.player_name ||
            null,

          normalized_name: normalizeName(
            row.player_display_name ||
              row.player_name ||
              ""
          ),

          position:
            row.position ??
            row.position_group ??
            null,

          team:
            row.recent_team ??
            row.team ??
            null,

          games: 0,

          passing_attempts: 0,
          completions: 0,
          passing_yards: 0,
          passing_tds: 0,
          interceptions: 0,

          rushing_attempts: 0,
          rushing_yards: 0,
          rushing_tds: 0,

          targets: 0,
          receptions: 0,
          receiving_yards: 0,
          receiving_tds: 0,

          weekly: [],
        });
      }

      const player = playerMap.get(playerId);

      const passingAttempts = num(row.attempts);
      const passingYards = num(row.passing_yards);

      const rushingAttempts = num(row.carries);
      const rushingYards = num(row.rushing_yards);

      const targets = num(row.targets);
      const receptions = num(row.receptions);
      const receivingYards = num(row.receiving_yards);

      const activeGame =
        passingAttempts > 0 ||
        rushingAttempts > 0 ||
        targets > 0 ||
        receptions > 0;

      if (activeGame) {
        player.games += 1;
      }

      player.passing_attempts += passingAttempts;
      player.completions += num(row.completions);
      player.passing_yards += passingYards;
      player.passing_tds += num(row.passing_tds);
      player.interceptions += num(row.interceptions);

      player.rushing_attempts += rushingAttempts;
      player.rushing_yards += rushingYards;
      player.rushing_tds += num(row.rushing_tds);

      player.targets += targets;
      player.receptions += receptions;
      player.receiving_yards += receivingYards;
      player.receiving_tds += num(row.receiving_tds);

      if (activeGame) {
        player.weekly.push({
          week: num(row.week),

          passing_attempts: passingAttempts,
          completions: num(row.completions),
          passing_yards: passingYards,

          rushing_attempts: rushingAttempts,
          rushing_yards: rushingYards,

          targets,
          receptions,
          receiving_yards: receivingYards,
        });
      }
    }

    const players = Array.from(playerMap.values()).map(
      (player: any) => {
        const games = Math.max(player.games, 1);

        const recent = [...player.weekly]
          .sort((a, b) => b.week - a.week)
          .slice(0, 3);

        const recentGames = Math.max(recent.length, 1);

        const recentPassing =
          recent.reduce(
            (sum, game) => sum + game.passing_yards,
            0
          ) / recentGames;

        const recentRushing =
          recent.reduce(
            (sum, game) => sum + game.rushing_yards,
            0
          ) / recentGames;

        const recentReceiving =
          recent.reduce(
            (sum, game) => sum + game.receiving_yards,
            0
          ) / recentGames;

        return {
          ...player,

          averages: {
            passing_yards_per_game:
              player.passing_yards / games,

            passing_attempts_per_game:
              player.passing_attempts / games,

            rushing_yards_per_game:
              player.rushing_yards / games,

            rushing_attempts_per_game:
              player.rushing_attempts / games,

            receiving_yards_per_game:
              player.receiving_yards / games,

            receptions_per_game:
              player.receptions / games,

            targets_per_game:
              player.targets / games,
          },

          recent_form: {
            games: recent.length,

            passing_yards_per_game:
              recentPassing,

            rushing_yards_per_game:
              recentRushing,

            receiving_yards_per_game:
              recentReceiving,
          },
        };
      }
    );

    const quarterbacks = players
      .filter(
        (player: any) =>
          player.position === "QB" ||
          player.passing_attempts > 0
      )
      .sort(
        (a: any, b: any) =>
          b.passing_yards - a.passing_yards
      );

    const rushers = players
      .filter(
        (player: any) =>
          player.rushing_attempts > 0
      )
      .sort(
        (a: any, b: any) =>
          b.rushing_yards - a.rushing_yards
      );

    const receivers = players
      .filter(
        (player: any) =>
          player.targets > 0
      )
      .sort(
        (a: any, b: any) =>
          b.receiving_yards - a.receiving_yards
      );

    return NextResponse.json({
      success: true,

      version: "1.0-nflverse-player-stats",

      season: SEASON,

      source: "nflverse",

      model_status:
        "Player statistics only — no RDG prop probabilities calculated",

      players_found: players.length,

      quarterbacks_found: quarterbacks.length,
      rushers_found: rushers.length,
      receivers_found: receivers.length,

      quarterbacks,

      rushers,

      receivers,

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
