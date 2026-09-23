import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "3.0-rushing-v3-development";
const MIN_CARRIES = 5;
const MIN_PRIOR_GAMES = 3;
const RECENT_GAMES = 4;

type PlayerGame = {
  season: number;
  week: number;
  gameId: string;
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  carries: number;
  rushYards: number;
};

type History = {
  games: PlayerGame[];
};

type TeamWeek = {
  carries: number;
  yards: number;
};

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  function split(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (c === "," && !quoted) {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }

    out.push(cur);
    return out;
  }

  const headers = split(lines[0]);

  return lines.slice(1).map((line) => {
    const vals = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

async function loadSeason(season: number): Promise<PlayerGame[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const res = await fetch(url, {
    headers: { "User-Agent": "RDG-NFL-Rushing-V3/3.0" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`nflverse ${season} weekly player stats failed: ${res.status}`);
  }

  const rows = parseCSV(await res.text());
  const games: PlayerGame[] = [];

  for (const row of rows) {
    const seasonType = (row.season_type || "").toUpperCase();
    if (seasonType && seasonType !== "REG") continue;

    const carries = num(row.carries);
    if (carries < MIN_CARRIES) continue;

    const playerId =
      row.player_id || row.player_display_name || row.player_name || "";
    if (!playerId) continue;

    games.push({
      season,
      week: num(row.week),
      gameId:
        row.game_id ||
        `${season}-${row.week}-${row.recent_team || row.team}-${playerId}`,
      playerId,
      playerName: row.player_display_name || row.player_name || playerId,
      position: (row.position || row.position_group || "").toUpperCase(),
      team: row.recent_team || row.team || "",
      carries,
      rushYards: num(row.rushing_yards),
    });
  }

  return games.sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
}

function addHistory(map: Map<string, History>, game: PlayerGame) {
  const h = map.get(game.playerId) ?? { games: [] };
  h.games.push(game);
  map.set(game.playerId, h);
}

function addTeamWeek(
  map: Map<string, TeamWeek[]>,
  games: PlayerGame[],
) {
  const byTeam = new Map<string, TeamWeek>();

  for (const g of games) {
    if (!g.team) continue;
    const x = byTeam.get(g.team) ?? { carries: 0, yards: 0 };
    x.carries += g.carries;
    x.yards += g.rushYards;
    byTeam.set(g.team, x);
  }

  for (const [team, tw] of byTeam) {
    const arr = map.get(team) ?? [];
    arr.push(tw);
    map.set(team, arr);
  }
}

function metrics(errors: number[]) {
  if (!errors.length) return { n: 0, mae: null, rmse: null, mean_error: null };

  const mae = avg(errors.map(Math.abs));
  const rmse = Math.sqrt(avg(errors.map((e) => e * e)));
  const mean = avg(errors);

  return {
    n: errors.length,
    mae: Number(mae.toFixed(2)),
    rmse: Number(rmse.toFixed(2)),
    mean_error: Number(mean.toFixed(2)),
  };
}

export async function GET() {
  try {
    // IMPORTANT: 2026 is intentionally NOT loaded.
    const [train2024, test2025] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
    ]);

    const playerHistory = new Map<string, History>();
    const teamHistory = new Map<string, TeamWeek[]>();

    for (const g of train2024) addHistory(playerHistory, g);

    const trainWeeks = [...new Set(train2024.map((g) => g.week))].sort(
      (a, b) => a - b,
    );
    for (const week of trainWeeks) {
      addTeamWeek(
        teamHistory,
        train2024.filter((g) => g.week === week),
      );
    }

    const baselineErrors: number[] = [];
    const v3Errors: number[] = [];
    const predictions: any[] = [];
    let skippedNoHistory = 0;

    const weeks = [...new Set(test2025.map((g) => g.week))].sort(
      (a, b) => a - b,
    );

    for (const week of weeks) {
      const games = test2025.filter((g) => g.week === week);

      for (const game of games) {
        const h = playerHistory.get(game.playerId);
        if (!h || h.games.length < MIN_PRIOR_GAMES) {
          skippedNoHistory++;
          continue;
        }

        const all = h.games;
        const recent = all.slice(-RECENT_GAMES);

        const longYpg = avg(all.map((x) => x.rushYards));
        const longCarries = avg(all.map((x) => x.carries));
        const recentCarries = avg(recent.map((x) => x.carries));

        const longTotalCarries = all.reduce((s, x) => s + x.carries, 0);
        const longTotalYards = all.reduce((s, x) => s + x.rushYards, 0);
        const longYpc = longTotalYards / Math.max(1, longTotalCarries);

        const recentTotalCarries = recent.reduce((s, x) => s + x.carries, 0);
        const recentTotalYards = recent.reduce((s, x) => s + x.rushYards, 0);
        const recentYpc = recentTotalYards / Math.max(1, recentTotalCarries);

        const teamWeeks = teamHistory.get(game.team) ?? [];
        const teamRecent = teamWeeks.slice(-RECENT_GAMES);
        const teamLongCarries = avg(teamWeeks.map((x) => x.carries));
        const teamRecentCarries = avg(teamRecent.map((x) => x.carries));

        const position = game.position || "UNKNOWN";
        const isQB = position === "QB";

        // V3 workload:
        // RB/other rushers react more to recent role and team opportunity.
        // QBs are kept more conservative because designed/scramble rushing is volatile.
        const recentWeight = isQB ? 0.40 : 0.65;
        let expectedCarries =
          recentWeight * recentCarries +
          (1 - recentWeight) * longCarries;

        // Role trend: cap the adjustment so one unusual game cannot dominate.
        const workloadTrend =
          longCarries > 0 ? recentCarries / longCarries : 1;
        const cappedTrend = clamp(workloadTrend, 0.80, 1.20);

        // Team opportunity trend is deliberately small.
        const teamTrend =
          teamLongCarries > 0 ? teamRecentCarries / teamLongCarries : 1;
        const cappedTeamTrend = clamp(teamTrend, 0.90, 1.10);

        if (!isQB) {
          expectedCarries *=
            0.75 + 0.15 * cappedTrend + 0.10 * cappedTeamTrend;
        }

        // Efficiency is heavily stabilized to long-term YPC.
        const recentYpcWeight = isQB ? 0.15 : 0.20;
        const expectedYpc =
          recentYpcWeight * recentYpc +
          (1 - recentYpcWeight) * longYpc;

        const baselineProjection = longYpg;
        const v3Projection = expectedCarries * expectedYpc;

        baselineErrors.push(baselineProjection - game.rushYards);
        v3Errors.push(v3Projection - game.rushYards);

        predictions.push({
          week,
          player: game.playerName,
          team: game.team,
          position,
          actual_rushing_yards: game.rushYards,
          actual_carries: game.carries,
          prior_games: all.length,
          recent_games: recent.length,
          long_term_yards_per_game: Number(longYpg.toFixed(1)),
          long_term_carries_per_game: Number(longCarries.toFixed(2)),
          recent_carries_per_game: Number(recentCarries.toFixed(2)),
          workload_trend: Number(cappedTrend.toFixed(3)),
          team_long_carries: Number(teamLongCarries.toFixed(2)),
          team_recent_carries: Number(teamRecentCarries.toFixed(2)),
          team_opportunity_trend: Number(cappedTeamTrend.toFixed(3)),
          long_term_yards_per_carry: Number(longYpc.toFixed(2)),
          recent_yards_per_carry: Number(recentYpc.toFixed(2)),
          expected_carries: Number(expectedCarries.toFixed(2)),
          expected_yards_per_carry: Number(expectedYpc.toFixed(2)),
          baseline_projection: Number(baselineProjection.toFixed(1)),
          rushing_v3_projection: Number(v3Projection.toFixed(1)),
        });
      }

      // No same-week leakage.
      for (const game of games) addHistory(playerHistory, game);
      addTeamWeek(teamHistory, games);
    }

    const baseline = metrics(baselineErrors);
    const rushingV3 = metrics(v3Errors);

    const improvement =
      baseline.mae !== null && rushingV3.mae !== null
        ? Number((baseline.mae - rushingV3.mae).toFixed(2))
        : null;

    const improvementPct =
      baseline.mae && improvement !== null
        ? Number(((improvement / baseline.mae) * 100).toFixed(2))
        : null;

    return NextResponse.json({
      success: true,
      version: VERSION,
      purpose:
        "Develop Rushing V3 on 2024 prior history and held-out chronological 2025 results using recent workload, role trend, team rushing opportunity, and position-aware handling.",
      model_status: "DEVELOPMENT TEST ONLY — NOT LIVE",
      data_source: "nflverse weekly player stats",
      development_guardrail:
        "2026 data is intentionally not loaded or used anywhere in this route.",
      samples: {
        training_2024_player_games: train2024.length,
        testing_2025_player_games: test2025.length,
        held_out_predictions: predictions.length,
        skipped_no_prior_history: skippedNoHistory,
      },
      baseline: {
        description: "All prior rushing yards per game",
        ...baseline,
      },
      rushing_v3: {
        description:
          "Position-aware recent workload + capped role trend + team rushing opportunity + stabilized rushing efficiency",
        recent_window_games: RECENT_GAMES,
        ...rushingV3,
      },
      comparison: {
        mae_improvement_yards: improvement,
        mae_improvement_percent: improvementPct,
        v3_beats_baseline:
          improvement !== null ? improvement > 0 : false,
        note:
          "This is a projection-development backtest, not a sportsbook betting win-rate test.",
      },
      methodology: {
        leakage_control:
          "2024 initializes player/team history. Every 2025 week is predicted before that week's player and team results are added.",
        next_step:
          "If V3 materially improves 2025, do not call 2026 untouched validation because 2026 has already been inspected during V2 development. Use a genuinely future sample or another pre-declared out-of-sample validation design.",
      },
      sample_predictions: predictions.slice(0, 30),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error: error?.message || String(error),
      },
      { status: 500 },
    );
  }
}
