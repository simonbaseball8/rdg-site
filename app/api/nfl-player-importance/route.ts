import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SEASON = 2026;

const PLAYER_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${SEASON}.csv`;

const NFLMETA_BASE = "https://nflmeta.org/api/v1";

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------

function clean(value: any): string | null {
  if (value === null || value === undefined) return null;

  const result = String(value).trim();

  return result.length ? result : null;
}

function num(value: any): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeName(value: any): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\bjr\b/g, "")
    .replace(/\bsr\b/g, "")
    .replace(/\bii\b/g, "")
    .replace(/\biii\b/g, "")
    .replace(/\biv\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizePosition(value: any): string {
  const position = String(value || "").toUpperCase();

  if (position === "HB" || position === "FB") return "RB";

  if (
    position === "LT" ||
    position === "RT" ||
    position === "G" ||
    position === "C" ||
    position === "T"
  ) {
    return "OL";
  }

  if (
    position === "ILB" ||
    position === "OLB" ||
    position === "EDGE"
  ) {
    return "LB";
  }

  if (
    position === "DE" ||
    position === "DT" ||
    position === "NT"
  ) {
    return "DL";
  }

  return position;
}

// ----------------------------------------------------
// SIMPLE CSV PARSER
// ----------------------------------------------------

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];

  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }

      row.push(value);

      if (row.some((x) => x.length > 0)) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((x) => x.trim());

  return rows.slice(1).map((values) => {
    const result: Record<string, string> = {};

    headers.forEach((header, index) => {
      result[header] = values[index] ?? "";
    });

    return result;
  });
}

// ----------------------------------------------------
// NFLMETA
// ----------------------------------------------------

async function nflMetaFetch(path: string) {
  const apiKey = process.env.NFLMETA_KEY;

  if (!apiKey) {
    throw new Error(
      "NFLMETA_KEY is missing from Vercel environment variables."
    );
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
        typeof data === "string"
          ? data
          : JSON.stringify(data)
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

function normalizeGameStatus(row: any) {
  const candidates = [
    row?.report_status,
    row?.game_status,
    row?.status,
    row?.injury_status,
    row?.designation,
  ];

  for (const candidate of candidates) {
    const status = String(candidate || "").toUpperCase();

    if (!status) continue;

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
  }

  return "NO_DESIGNATION";
}

// ----------------------------------------------------
// LOAD NFLVERSE
// ----------------------------------------------------

async function loadPlayerStats() {
  const response = await fetch(PLAYER_STATS_URL, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Unable to load nflverse stats: ${response.status}`
    );
  }

  return parseCSV(await response.text());
}

// ----------------------------------------------------
// AGGREGATE PLAYER STATS
// ----------------------------------------------------

function aggregatePlayers(rows: Record<string, string>[]) {
  const players = new Map<string, any>();

  for (const row of rows) {
    if (row.season_type && row.season_type !== "REG") {
      continue;
    }

    const playerId =
      clean(row.player_id) ??
      clean(row.gsis_id);

    const playerName =
      clean(row.player_display_name) ??
      clean(row.player_name);

    const team = clean(row.team);

    if (!playerName || !team) continue;

    const key =
      playerId ||
      `${normalizeName(playerName)}-${team}`;

    if (!players.has(key)) {
      players.set(key, {
        player_id: playerId,
        player_name: playerName,
        team,
        position: normalizePosition(row.position),

        games: new Set<number>(),

        attempts: 0,
        completions: 0,
        passing_yards: 0,
        passing_tds: 0,

        carries: 0,
        rushing_yards: 0,
        rushing_tds: 0,

        targets: 0,
        receptions: 0,
        receiving_yards: 0,
        receiving_tds: 0,
      });
    }

    const player = players.get(key);

    const week = num(row.week);

    if (week > 0) {
      player.games.add(week);
    }

    player.attempts += num(row.attempts);
    player.completions += num(row.completions);
    player.passing_yards += num(row.passing_yards);
    player.passing_tds += num(row.passing_tds);

    player.carries += num(row.carries);
    player.rushing_yards += num(row.rushing_yards);
    player.rushing_tds += num(row.rushing_tds);

    player.targets += num(row.targets);
    player.receptions += num(row.receptions);
    player.receiving_yards += num(row.receiving_yards);
    player.receiving_tds += num(row.receiving_tds);
  }

  return Array.from(players.values()).map((player) => ({
    ...player,
    games: player.games.size,
  }));
}

// ----------------------------------------------------
// TEAM USAGE
// ----------------------------------------------------

function calculateTeamTotals(players: any[]) {
  const totals = new Map<string, any>();

  for (const player of players) {
    if (!totals.has(player.team)) {
      totals.set(player.team, {
        passing_attempts: 0,
        carries: 0,
        targets: 0,
        passing_yards: 0,
        rushing_yards: 0,
        receiving_yards: 0,
      });
    }

    const team = totals.get(player.team);

    team.passing_attempts += player.attempts;
    team.carries += player.carries;
    team.targets += player.targets;

    team.passing_yards += player.passing_yards;
    team.rushing_yards += player.rushing_yards;
    team.receiving_yards += player.receiving_yards;
  }

  return totals;
}

// ----------------------------------------------------
// IMPORTANCE SCORE
// ----------------------------------------------------

function calculateImportance(
  player: any,
  teamTotals: any
) {
  const position = normalizePosition(player.position);

  let usageShare = 0;
  let productionShare = 0;

  if (position === "QB") {
    usageShare =
      teamTotals.passing_attempts > 0
        ? player.attempts /
          teamTotals.passing_attempts
        : 0;

    productionShare =
      teamTotals.passing_yards > 0
        ? player.passing_yards /
          teamTotals.passing_yards
        : 0;
  }

  if (position === "RB") {
    usageShare =
      teamTotals.carries > 0
        ? player.carries /
          teamTotals.carries
        : 0;

    productionShare =
      teamTotals.rushing_yards > 0
        ? player.rushing_yards /
          teamTotals.rushing_yards
        : 0;
  }

  if (
    position === "WR" ||
    position === "TE"
  ) {
    usageShare =
      teamTotals.targets > 0
        ? player.targets /
          teamTotals.targets
        : 0;

    productionShare =
      teamTotals.receiving_yards > 0
        ? player.receiving_yards /
          teamTotals.receiving_yards
        : 0;
  }

  /*
    This score is a CURRENT USAGE INDEX.

    It is NOT yet a betting-model adjustment.

    60% usage share
    40% production share

    This gives us a way to distinguish starters/stars
    from low-usage offensive players without manually
    assigning names or subjective star ratings.
  */

  const rawScore =
    usageShare * 0.6 +
    productionShare * 0.4;

  const score =
    Math.max(
      0,
      Math.min(100, rawScore * 100)
    );

  let tier = "LOW";

  if (score >= 70) {
    tier = "ELITE_USAGE";
  } else if (score >= 45) {
    tier = "HIGH";
  } else if (score >= 25) {
    tier = "MEDIUM";
  }

  return {
    usage_share:
      Number((usageShare * 100).toFixed(1)),

    production_share:
      Number((productionShare * 100).toFixed(1)),

    importance_score:
      Number(score.toFixed(1)),

    importance_tier:
      tier,
  };
}

// ----------------------------------------------------
// MATCH INJURY TO NFLVERSE PLAYER
// ----------------------------------------------------

function findPlayer(
  injury: any,
  players: any[]
) {
  const injuryName =
    normalizeName(
      injury?.display_name ??
      injury?.player_name
    );

  const team =
    String(
      injury?.team_abbr ??
      injury?.team ??
      ""
    ).toUpperCase();

  if (!injuryName || !team) {
    return null;
  }

  return (
    players.find(
      (player) =>
        String(player.team).toUpperCase() === team &&
        normalizeName(player.player_name) === injuryName
    ) ?? null
  );
}

// ----------------------------------------------------
// ROUTE
// ----------------------------------------------------

export async function GET() {
  try {
    const [
      statsRows,
      injuryResponse,
    ] = await Promise.all([
      loadPlayerStats(),
      nflMetaFetch("/injuries"),
    ]);

    const players =
      aggregatePlayers(statsRows);

    const teamTotals =
      calculateTeamTotals(players);

    const injuries =
      normalizeArray(injuryResponse);

    const results = injuries.map((injury) => {
      const matchedPlayer =
        findPlayer(injury, players);

      const gameStatus =
        normalizeGameStatus(injury);

      const team =
        clean(injury?.team_abbr) ??
        clean(injury?.team);

      const position =
        normalizePosition(
          injury?.position
        );

      const playerName =
        clean(injury?.display_name) ??
        clean(injury?.player_name) ??
        clean(injury?.name);

      let importance: any = {
        usage_share: null,
        production_share: null,
        importance_score: null,
        importance_tier: "UNRATED",
      };

      if (
        matchedPlayer &&
        teamTotals.has(matchedPlayer.team)
      ) {
        importance =
          calculateImportance(
            matchedPlayer,
            teamTotals.get(
              matchedPlayer.team
            )
          );
      }

      /*
        Offensive skill players can currently receive
        a usage-based rating.

        OL and defensive positions remain UNRATED here
        because box-score volume is NOT a valid way to
        estimate their importance.

        We will handle them with depth-chart / snap
        information in the next layer.
      */

      const measurablePosition =
        ["QB", "RB", "WR", "TE"].includes(
          position
        );

      if (!measurablePosition) {
        importance = {
          usage_share: null,
          production_share: null,
          importance_score: null,
          importance_tier:
            "NEEDS_DEPTH_CHART_DATA",
        };
      }

      return {
        player_name:
          playerName,

        team,

        position,

        injury:
          clean(
            injury?.report_primary_injury
          ),

        game_status:
          gameStatus,

        practice_status:
          clean(
            injury?.practice_status
          ),

        stats_match:
          Boolean(matchedPlayer),

        nflverse_player_id:
          matchedPlayer?.player_id ??
          null,

        games_played:
          matchedPlayer?.games ??
          null,

        season_stats:
          matchedPlayer
            ? {
                passing_attempts:
                  matchedPlayer.attempts,

                passing_yards:
                  matchedPlayer.passing_yards,

                carries:
                  matchedPlayer.carries,

                rushing_yards:
                  matchedPlayer.rushing_yards,

                targets:
                  matchedPlayer.targets,

                receptions:
                  matchedPlayer.receptions,

                receiving_yards:
                  matchedPlayer.receiving_yards,
              }
            : null,

        ...importance,

        model_adjustment_active:
          false,
      };
    });

    results.sort((a, b) => {
      const aScore =
        a.importance_score ?? -1;

      const bScore =
        b.importance_score ?? -1;

      return bScore - aScore;
    });

    const matched =
      results.filter(
        (x) => x.stats_match
      );

    const unmatched =
      results.filter(
        (x) => !x.stats_match
      );

    const highImportanceInjuries =
      results.filter(
        (x) =>
          x.importance_score !== null &&
          x.importance_score >= 45 &&
          (
            x.game_status === "OUT" ||
            x.game_status === "DOUBTFUL" ||
            x.game_status === "QUESTIONABLE"
          )
      );

    return NextResponse.json({
      success: true,

      version:
        "1.0-player-usage-importance",

      season:
        SEASON,

      sources: {
        player_stats:
          "nflverse",

        injuries:
          "NFLMeta",
      },

      summary: {
        nflverse_players:
          players.length,

        injury_records:
          results.length,

        stats_matched:
          matched.length,

        stats_unmatched:
          unmatched.length,

        high_importance_injuries:
          highImportanceInjuries.length,
      },

      high_importance_injuries:
        highImportanceInjuries,

      matched_players:
        matched,

      unmatched_players:
        unmatched,

      players:
        results,

      model_status: {
        injury_feed_connected:
          true,

        offensive_usage_connected:
          true,

        depth_chart_connected:
          false,

        snap_counts_connected:
          false,

        historical_injury_effect_connected:
          false,

        injury_adjustments_active:
          false,

        message:
          "Player importance is currently descriptive only. RDG does not yet alter projections from these scores.",

        next_step:
          "Validate player matching and importance scores, then add depth-chart/snap information for OL and defensive players before estimating historical injury effects.",
      },

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL player importance route error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error?.message ||
          "Unable to calculate NFL player importance.",
      },
      {
        status: 500,
      }
    );
  }
}
