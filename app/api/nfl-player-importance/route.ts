import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const NFLVERSE_BASE =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player";

const NFLMETA_BASE = "https://nflmeta.org/api/v1";

function text(v: any): string {
  return String(v ?? "").trim();
}

function number(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, digits = 1) {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

function normalizeTeam(v: any): string {
  return text(v).toUpperCase();
}

function normalizePosition(v: any): string {
  const p = text(v).toUpperCase();

  if (["HB", "FB"].includes(p)) return "RB";
  if (["OT", "LT", "RT", "OG", "LG", "RG", "C", "G", "T", "C/G"].includes(p))
    return "OL";

  if (["DE", "DT", "NT"].includes(p)) return "DL";
  if (["ILB", "OLB", "EDGE"].includes(p)) return "LB";
  if (["CB", "S", "DB", "FS", "SS"].includes(p)) return p;

  return p;
}

function normalizeName(v: any): string {
  return text(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function lastName(v: any): string {
  const cleaned = text(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, " ")
    .replace(/\b(Jr|Sr|II|III|IV|V)\b\.?/gi, "")
    .trim()
    .split(/\s+/);

  return normalizeName(cleaned[cleaned.length - 1] || "");
}

function firstInitial(v: any): string {
  const cleaned = text(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, " ")
    .trim();

  return cleaned ? cleaned[0].toLowerCase() : "";
}

/* -------------------------------------------------- */
/* CSV                                                */
/* -------------------------------------------------- */

function parseCSV(input: string): Record<string, string>[] {
  const rows: string[][] = [];

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
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;

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
    const obj: Record<string, string> = {};

    headers.forEach((header, index) => {
      obj[header] = values[index] ?? "";
    });

    return obj;
  });
}

/* -------------------------------------------------- */
/* NFLVERSE                                           */
/* -------------------------------------------------- */

async function loadSeasonStats(season: number) {
  const url =
    `${NFLVERSE_BASE}/stats_player_week_${season}.csv`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Unable to load nflverse ${season}: ${response.status}`
    );
  }

  return parseCSV(await response.text());
}

type PlayerSeason = {
  player_id: string | null;
  player_name: string;
  team: string;
  position: string;
  season: number;
  games: number;
  attempts: number;
  passing_yards: number;
  carries: number;
  rushing_yards: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
};

function aggregateSeason(
  rows: Record<string, string>[],
  season: number
): PlayerSeason[] {
  const map = new Map<string, any>();

  for (const row of rows) {
    if (text(row.season_type) && text(row.season_type) !== "REG") continue;

    const name =
      text(row.player_display_name) ||
      text(row.player_name);

    const team = normalizeTeam(row.team);

    if (!name || !team) continue;

    const id =
      text(row.player_id) ||
      text(row.gsis_id) ||
      null;

    const key =
      id ||
      `${normalizeName(name)}|${team}|${normalizePosition(row.position)}`;

    if (!map.has(key)) {
      map.set(key, {
        player_id: id,
        player_name: name,
        team,
        position: normalizePosition(row.position),
        season,
        weeks: new Set<number>(),
        attempts: 0,
        passing_yards: 0,
        carries: 0,
        rushing_yards: 0,
        targets: 0,
        receptions: 0,
        receiving_yards: 0,
      });
    }

    const p = map.get(key);

    const week = number(row.week);
    if (week > 0) p.weeks.add(week);

    p.attempts += number(row.attempts);
    p.passing_yards += number(row.passing_yards);

    p.carries += number(row.carries);
    p.rushing_yards += number(row.rushing_yards);

    p.targets += number(row.targets);
    p.receptions += number(row.receptions);
    p.receiving_yards += number(row.receiving_yards);
  }

  return Array.from(map.values()).map((p) => ({
    player_id: p.player_id,
    player_name: p.player_name,
    team: p.team,
    position: p.position,
    season,
    games: p.weeks.size,
    attempts: p.attempts,
    passing_yards: p.passing_yards,
    carries: p.carries,
    rushing_yards: p.rushing_yards,
    targets: p.targets,
    receptions: p.receptions,
    receiving_yards: p.receiving_yards,
  }));
}

function teamTotals(players: PlayerSeason[]) {
  const totals = new Map<string, any>();

  for (const p of players) {
    if (!totals.has(p.team)) {
      totals.set(p.team, {
        passing_attempts: 0,
        passing_yards: 0,
        carries: 0,
        rushing_yards: 0,
        targets: 0,
        receiving_yards: 0,
      });
    }

    const t = totals.get(p.team);

    t.passing_attempts += p.attempts;
    t.passing_yards += p.passing_yards;
    t.carries += p.carries;
    t.rushing_yards += p.rushing_yards;
    t.targets += p.targets;
    t.receiving_yards += p.receiving_yards;
  }

  return totals;
}

function usageForPlayer(
  p: PlayerSeason | null,
  totals: Map<string, any>
) {
  if (!p) return null;

  const team = totals.get(p.team);
  if (!team) return null;

  const position = normalizePosition(p.position);

  let usage = 0;
  let production = 0;

  if (position === "QB") {
    usage =
      team.passing_attempts > 0
        ? p.attempts / team.passing_attempts
        : 0;

    production =
      team.passing_yards > 0
        ? p.passing_yards / team.passing_yards
        : 0;
  } else if (position === "RB") {
    const carryShare =
      team.carries > 0
        ? p.carries / team.carries
        : 0;

    const targetShare =
      team.targets > 0
        ? p.targets / team.targets
        : 0;

    usage =
      carryShare * 0.75 +
      targetShare * 0.25;

    const rushShare =
      team.rushing_yards > 0
        ? p.rushing_yards / team.rushing_yards
        : 0;

    const recShare =
      team.receiving_yards > 0
        ? p.receiving_yards / team.receiving_yards
        : 0;

    production =
      rushShare * 0.75 +
      recShare * 0.25;
  } else if (position === "WR" || position === "TE") {
    usage =
      team.targets > 0
        ? p.targets / team.targets
        : 0;

    production =
      team.receiving_yards > 0
        ? p.receiving_yards / team.receiving_yards
        : 0;
  } else {
    return null;
  }

  return {
    usage_share: clamp(usage, 0, 1),
    production_share: clamp(production, 0, 1),
  };
}

/* -------------------------------------------------- */
/* PLAYER MATCHING                                    */
/* -------------------------------------------------- */

function findPlayer(
  injury: any,
  players: PlayerSeason[]
): PlayerSeason | null {
  const injuryName =
    text(injury.display_name) ||
    text(injury.player_name) ||
    text(injury.name);

  const injuryTeam =
    normalizeTeam(
      injury.team_abbr ||
      injury.team
    );

  const injuryPosition =
    normalizePosition(injury.position);

  if (!injuryName) return null;

  const exactName = normalizeName(injuryName);

  // 1. Exact normalized name + team
  let match = players.find(
    (p) =>
      normalizeName(p.player_name) === exactName &&
      p.team === injuryTeam
  );

  if (match) return match;

  // 2. Exact normalized name regardless of team.
  // Useful after offseason trades.
  const exactMatches = players.filter(
    (p) =>
      normalizeName(p.player_name) === exactName
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  // 3. Same team + last name + first initial + position
  const ln = lastName(injuryName);
  const fi = firstInitial(injuryName);

  const fuzzy = players.filter((p) => {
    const sameTeam = p.team === injuryTeam;
    const sameLast = lastName(p.player_name) === ln;
    const sameInitial = firstInitial(p.player_name) === fi;

    const samePosition =
      !injuryPosition ||
      normalizePosition(p.position) === injuryPosition;

    return (
      sameTeam &&
      sameLast &&
      sameInitial &&
      samePosition
    );
  });

  if (fuzzy.length === 1) {
    return fuzzy[0];
  }

  return null;
}

/* -------------------------------------------------- */
/* CURRENT INJURY FILTER                              */
/* -------------------------------------------------- */

function injurySeason(row: any): number | null {
  const candidates = [
    row.season_year,
    row.season,
    row.year,
  ];

  for (const value of candidates) {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed > 2000) {
      return parsed;
    }
  }

  return null;
}

function injuryWeek(row: any): number | null {
  const candidates = [
    row.week,
    row.week_number,
    row.season_week,
  ];

  for (const value of candidates) {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function normalizeGameStatus(row: any) {
  // Official report status gets priority.
  const report = text(
    row.report_status ||
    row.game_designation ||
    row.designation
  ).toUpperCase();

  if (report.includes("OUT")) return "OUT";
  if (report.includes("DOUBTFUL")) return "DOUBTFUL";
  if (report.includes("QUESTIONABLE")) return "QUESTIONABLE";
  if (report.includes("PROBABLE")) return "PROBABLE";

  // Do NOT automatically convert NFLMeta "Inactive"
  // into OUT. The official report designation above
  // must determine the injury designation.

  return "NO_DESIGNATION";
}

function isRestRelated(row: any) {
  const injury = text(
    row.report_primary_injury ||
    row.injury ||
    row.primary_injury
  ).toLowerCase();

  return (
    injury.includes("nir") ||
    injury.includes("rest") ||
    injury.includes("not injury related") ||
    injury.includes("not injury-related")
  );
}

/* -------------------------------------------------- */
/* NFLMETA                                            */
/* -------------------------------------------------- */

async function loadCurrentInjuries() {
  const key = process.env.NFLMETA_KEY;

  if (!key) {
    throw new Error(
      "NFLMETA_KEY is missing from Vercel environment variables."
    );
  }

  const response = await fetch(
    `${NFLMETA_BASE}/injuries`,
    {
      headers: {
        "X-NFLMeta-Key": key,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `NFLMeta injuries request failed: ${response.status}`
    );
  }

  const data = await response.json();

  let rows: any[] = [];

  if (Array.isArray(data)) rows = data;
  else if (Array.isArray(data.data)) rows = data.data;
  else if (Array.isArray(data.injuries)) rows = data.injuries;
  else if (Array.isArray(data.results)) rows = data.results;
  else if (Array.isArray(data.items)) rows = data.items;

  /*
    HARD SAFETY RULE:

    A record explicitly marked as another season can
    NEVER enter RDG's current injury list.

    If NFLMeta's current /injuries endpoint omits the
    season field, we retain the record because this is
    the provider's current injury endpoint, but flag it
    in the response for visibility.
  */

  const filtered = rows.filter((row) => {
    const season = injurySeason(row);

    if (season !== null && season !== CURRENT_SEASON) {
      return false;
    }

    return true;
  });

  const explicitCurrentSeason =
    filtered.filter(
      (row) => injurySeason(row) === CURRENT_SEASON
    ).length;

  const missingSeasonField =
    filtered.filter(
      (row) => injurySeason(row) === null
    ).length;

  return {
    raw: rows,
    current: filtered,
    explicitCurrentSeason,
    missingSeasonField,
  };
}

/* -------------------------------------------------- */
/* STABILIZED IMPORTANCE                              */
/* -------------------------------------------------- */

function stabilizedImportance(
  currentPlayer: PlayerSeason | null,
  priorPlayer: PlayerSeason | null,
  currentTotals: Map<string, any>,
  priorTotals: Map<string, any>,
  position: string
) {
  if (!["QB", "RB", "WR", "TE"].includes(position)) {
    return {
      importance_score: null,
      importance_tier: "NEEDS_DEPTH_CHART_DATA",
      current_usage_share: null,
      prior_usage_share: null,
      stabilized_usage_share: null,
      current_production_share: null,
      prior_production_share: null,
      stabilized_production_share: null,
      current_weight: null,
      prior_weight: null,
    };
  }

  const current =
    usageForPlayer(currentPlayer, currentTotals);

  const prior =
    usageForPlayer(priorPlayer, priorTotals);

  const currentGames =
    currentPlayer?.games ?? 0;

  /*
    Early-season stabilization:

    1 game  = 20% current / 80% prior
    2 games = 33% current / 67% prior
    3 games = 43% current / 57% prior
    ...
    Current season gradually takes over.

    This is a stabilization mechanism, NOT an injury
    effect and NOT a betting adjustment.
  */

  let currentWeight =
    currentGames > 0
      ? currentGames / (currentGames + 4)
      : 0;

  if (!prior && current) currentWeight = 1;
  if (prior && !current) currentWeight = 0;

  const priorWeight = 1 - currentWeight;

  const currentUsage =
    current?.usage_share ?? 0;

  const priorUsage =
    prior?.usage_share ?? 0;

  const currentProduction =
    current?.production_share ?? 0;

  const priorProduction =
    prior?.production_share ?? 0;

  const stabilizedUsage =
    currentUsage * currentWeight +
    priorUsage * priorWeight;

  const stabilizedProduction =
    currentProduction * currentWeight +
    priorProduction * priorWeight;

  /*
    Importance remains a transparent usage index:

    65% stabilized opportunity / usage
    35% stabilized production

    It is NOT yet a projection adjustment.
  */

  const score =
    clamp(
      stabilizedUsage * 0.65 +
      stabilizedProduction * 0.35,
      0,
      1
    ) * 100;

  let tier = "LOW";

  if (score >= 70) tier = "ELITE_USAGE";
  else if (score >= 45) tier = "HIGH";
  else if (score >= 25) tier = "MEDIUM";

  return {
    importance_score: round(score),
    importance_tier: tier,

    current_usage_share:
      current
        ? round(current.usage_share * 100)
        : null,

    prior_usage_share:
      prior
        ? round(prior.usage_share * 100)
        : null,

    stabilized_usage_share:
      round(stabilizedUsage * 100),

    current_production_share:
      current
        ? round(current.production_share * 100)
        : null,

    prior_production_share:
      prior
        ? round(prior.production_share * 100)
        : null,

    stabilized_production_share:
      round(stabilizedProduction * 100),

    current_weight:
      round(currentWeight * 100),

    prior_weight:
      round(priorWeight * 100),
  };
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    const [
      currentRows,
      priorRows,
      injuryData,
    ] = await Promise.all([
      loadSeasonStats(CURRENT_SEASON),
      loadSeasonStats(PRIOR_SEASON),
      loadCurrentInjuries(),
    ]);

    const currentPlayers =
      aggregateSeason(
        currentRows,
        CURRENT_SEASON
      );

    const priorPlayers =
      aggregateSeason(
        priorRows,
        PRIOR_SEASON
      );

    const currentTotals =
      teamTotals(currentPlayers);

    const priorTotals =
      teamTotals(priorPlayers);

    const currentWeeks =
      currentRows
        .filter(
          (r) =>
            !text(r.season_type) ||
            text(r.season_type) === "REG"
        )
        .map((r) => number(r.week))
        .filter((w) => w > 0);

    const latestStatsWeek =
      currentWeeks.length
        ? Math.max(...currentWeeks)
        : null;

    const results =
      injuryData.current.map((injury) => {
        const playerName =
          text(injury.display_name) ||
          text(injury.player_name) ||
          text(injury.name);

        const team =
          normalizeTeam(
            injury.team_abbr ||
            injury.team
          );

        const position =
          normalizePosition(
            injury.position
          );

        const currentPlayer =
          findPlayer(
            injury,
            currentPlayers
          );

        /*
          For prior-season matching we first try normal
          matching. Because players can change teams,
          findPlayer() also allows a unique exact-name
          match across teams.
        */

        const priorPlayer =
          findPlayer(
            injury,
            priorPlayers
          );

        const gameStatus =
          normalizeGameStatus(injury);

        const restRelated =
          isRestRelated(injury);

        const importance =
          stabilizedImportance(
            currentPlayer,
            priorPlayer,
            currentTotals,
            priorTotals,
            position
          );

        const meaningfulCurrentInjury =
          ["OUT", "DOUBTFUL", "QUESTIONABLE"].includes(
            gameStatus
          );

        return {
          player_name: playerName,
          team,
          position,

          injury:
            text(
              injury.report_primary_injury ||
              injury.injury ||
              injury.primary_injury
            ) || null,

          injury_season:
            injurySeason(injury),

          injury_week:
            injuryWeek(injury),

          game_status:
            gameStatus,

          practice_status:
            text(
              injury.practice_status
            ) || null,

          rest_related:
            restRelated,

          current_injury:
            meaningfulCurrentInjury,

          current_stats_match:
            Boolean(currentPlayer),

          prior_stats_match:
            Boolean(priorPlayer),

          current_player_id:
            currentPlayer?.player_id ??
            null,

          prior_player_id:
            priorPlayer?.player_id ??
            null,

          current_team:
            currentPlayer?.team ??
            null,

          prior_team:
            priorPlayer?.team ??
            null,

          current_games:
            currentPlayer?.games ??
            0,

          prior_games:
            priorPlayer?.games ??
            0,

          current_season_stats:
            currentPlayer
              ? {
                  passing_attempts:
                    currentPlayer.attempts,

                  passing_yards:
                    currentPlayer.passing_yards,

                  carries:
                    currentPlayer.carries,

                  rushing_yards:
                    currentPlayer.rushing_yards,

                  targets:
                    currentPlayer.targets,

                  receptions:
                    currentPlayer.receptions,

                  receiving_yards:
                    currentPlayer.receiving_yards,
                }
              : null,

          prior_season_stats:
            priorPlayer
              ? {
                  passing_attempts:
                    priorPlayer.attempts,

                  passing_yards:
                    priorPlayer.passing_yards,

                  carries:
                    priorPlayer.carries,

                  rushing_yards:
                    priorPlayer.rushing_yards,

                  targets:
                    priorPlayer.targets,

                  receptions:
                    priorPlayer.receptions,

                  receiving_yards:
                    priorPlayer.receiving_yards,
                }
              : null,

          ...importance,

          /*
            IMPORTANT:
            Still disabled.

            No passing/rushing/receiving projection
            changes happen from this route yet.
          */

          model_adjustment_active:
            false,
        };
      });

    results.sort((a, b) => {
      const statusRank: Record<string, number> = {
        OUT: 4,
        DOUBTFUL: 3,
        QUESTIONABLE: 2,
        PROBABLE: 1,
        NO_DESIGNATION: 0,
      };

      const aStatus =
        statusRank[a.game_status] ?? 0;

      const bStatus =
        statusRank[b.game_status] ?? 0;

      if (aStatus !== bStatus) {
        return bStatus - aStatus;
      }

      return (
        (b.importance_score ?? -1) -
        (a.importance_score ?? -1)
      );
    });

    /*
      This is the list we will eventually feed into
      model-adjustment research.

      Rest-only / practice-only records are NOT included
      unless they carry an official OUT / DOUBTFUL /
      QUESTIONABLE designation.
    */

    const activeInjuries =
      results.filter(
        (p) =>
          p.current_injury
      );

    const offensiveActiveInjuries =
      activeInjuries.filter(
        (p) =>
          ["QB", "RB", "WR", "TE"].includes(
            p.position
          )
      );

    const unmatchedActiveOffense =
      offensiveActiveInjuries.filter(
        (p) =>
          !p.current_stats_match &&
          !p.prior_stats_match
      );

    return NextResponse.json({
      success: true,

      version:
        "1.1-current-injury-prior-stabilized",

      current_season:
        CURRENT_SEASON,

      prior_stats_season:
        PRIOR_SEASON,

      latest_current_stats_week:
        latestStatsWeek,

      rules: {
        current_injury_source:
          "NFLMeta current injuries endpoint",

        current_injury_season:
          CURRENT_SEASON,

        historical_injuries_used:
          false,

        prior_season_stats_used:
          true,

        prior_season_injuries_used:
          false,

        rest_only_counts_as_current_injury:
          false,

        injury_adjustments_active:
          false,
      },

      summary: {
        nflmeta_raw_records:
          injuryData.raw.length,

        records_after_season_filter:
          injuryData.current.length,

        explicitly_marked_2026:
          injuryData.explicitCurrentSeason,

        missing_injury_season_field:
          injuryData.missingSeasonField,

        current_injuries:
          activeInjuries.length,

        offensive_current_injuries:
          offensiveActiveInjuries.length,

        unmatched_offensive_current_injuries:
          unmatchedActiveOffense.length,

        current_nflverse_players:
          currentPlayers.length,

        prior_nflverse_players:
          priorPlayers.length,
      },

      current_injuries:
        activeInjuries,

      offensive_current_injuries:
        offensiveActiveInjuries,

      unmatched_offensive_current_injuries:
        unmatchedActiveOffense,

      all_current_report_records:
        results,

      model_status: {
        current_injury_filter:
          true,

        prior_season_usage_stabilization:
          true,

        improved_name_matching:
          true,

        depth_chart_connected:
          false,

        snap_counts_connected:
          false,

        historical_injury_effect_backtest:
          false,

        injury_adjustments_active:
          false,

        message:
          "Only the current NFLMeta injury feed can identify current injuries. 2025 is used only for player usage stabilization. No historical injury is treated as current and no injury currently changes an RDG projection.",
      },

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL player importance v1.1 error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        version:
          "1.1-current-injury-prior-stabilized",
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
