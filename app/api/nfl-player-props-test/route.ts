import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "2.0-rushing-v2-backtest";
const MIN_CARRIES = 5;
const MIN_PRIOR_GAMES = 3;
const RECENT_GAMES = 4;

type PlayerGame = {
  season: number;
  week: number;
  gameId: string;
  playerId: string;
  playerName: string;
  team: string;
  carries: number;
  rushYards: number;
};

type History = {
  games: PlayerGame[];
};

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  function split(line: string) {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        out.push(cur);
        cur = "";
      } else cur += c;
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
    headers: { "User-Agent": "RDG-NFL-Rushing-V2/2.0" },
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
      team: row.recent_team || row.team || "",
      carries,
      rushYards: num(row.rushing_yards),
    });
  }

  return games.sort((a, b) => a.week - b.week || a.gameId.localeCompare(b.gameId));
}

function avg(values: number[]) {
  return values.length
    ? values.reduce((s, x) => s + x, 0) / values.length
    : 0;
}

function addHistory(map: Map<string, History>, g: PlayerGame) {
  const h = map.get(g.playerId) ?? { games: [] };
  h.games.push(g);
  map.set(g.playerId, h);
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
    const [train2024, test2025] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
    ]);

    const history = new Map<string, History>();
    for (const g of train2024) addHistory(history, g);

    const baselineErrors: number[] = [];
    const v2Errors: number[] = [];
    const predictions: any[] = [];
    let skippedNoHistory = 0;

    const weeks = [...new Set(test2025.map((g) => g.week))].sort((a, b) => a - b);

    for (const week of weeks) {
      const games = test2025.filter((g) => g.week === week);

      for (const g of games) {
        const h = history.get(g.playerId);
        if (!h || h.games.length < MIN_PRIOR_GAMES) {
          skippedNoHistory++;
          continue;
        }

        const all = h.games;
        const recent = all.slice(-RECENT_GAMES);

        const careerYpg = avg(all.map((x) => x.rushYards));
        const careerCarries = avg(all.map((x) => x.carries));
        const careerYpc =
          all.reduce((s, x) => s + x.rushYards, 0) /
          Math.max(1, all.reduce((s, x) => s + x.carries, 0));

        const recentYpg = avg(recent.map((x) => x.rushYards));
        const recentCarries = avg(recent.map((x) => x.carries));
        const recentYpc =
          recent.reduce((s, x) => s + x.rushYards, 0) /
          Math.max(1, recent.reduce((s, x) => s + x.carries, 0));

        // Rushing V2:
        // workload leans toward recent usage; efficiency is deliberately
        // more conservative because YPC is noisy game to game.
        const expectedCarries = 0.65 * recentCarries + 0.35 * careerCarries;
        const expectedYpc = 0.30 * recentYpc + 0.70 * careerYpc;
        const v2Projection = expectedCarries * expectedYpc;

        const baselineProjection = careerYpg;

        baselineErrors.push(baselineProjection - g.rushYards);
        v2Errors.push(v2Projection - g.rushYards);

        predictions.push({
          week,
          player: g.playerName,
          team: g.team,
          actual_rushing_yards: g.rushYards,
          actual_carries: g.carries,
          prior_games: all.length,
          recent_games: recent.length,
          career_yards_per_game: Number(careerYpg.toFixed(1)),
          career_carries_per_game: Number(careerCarries.toFixed(2)),
          career_yards_per_carry: Number(careerYpc.toFixed(2)),
          recent_yards_per_game: Number(recentYpg.toFixed(1)),
          recent_carries_per_game: Number(recentCarries.toFixed(2)),
          recent_yards_per_carry: Number(recentYpc.toFixed(2)),
          expected_carries: Number(expectedCarries.toFixed(2)),
          expected_yards_per_carry: Number(expectedYpc.toFixed(2)),
          baseline_projection: Number(baselineProjection.toFixed(1)),
          rushing_v2_projection: Number(v2Projection.toFixed(1)),
        });
      }

      // Prevent same-week leakage.
      for (const g of games) addHistory(history, g);
    }

    const baseline = metrics(baselineErrors);
    const rushingV2 = metrics(v2Errors);

    const improvement =
      baseline.mae !== null && rushingV2.mae !== null
        ? Number((baseline.mae - rushingV2.mae).toFixed(2))
        : null;

    const improvementPct =
      baseline.mae && improvement !== null
        ? Number(((improvement / baseline.mae) * 100).toFixed(2))
        : null;

    return NextResponse.json({
      success: true,
      version: VERSION,
      purpose:
        "Test whether recent workload and recent efficiency improve leakage-safe rushing-yard projections over a player's prior rushing-yards/game baseline.",
      model_status: "TEST ONLY — NOT LIVE",
      data_source: "nflverse weekly player stats",
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
      rushing_v2: {
        description:
          "Expected carries (65% recent / 35% long-term) × expected YPC (30% recent / 70% long-term)",
        recent_window_games: RECENT_GAMES,
        ...rushingV2,
      },
      comparison: {
        mae_improvement_yards: improvement,
        mae_improvement_percent: improvementPct,
        v2_beats_baseline:
          improvement !== null ? improvement > 0 : false,
        note:
          "This is a held-out projection test, not a sportsbook betting win-rate test.",
      },
      methodology: {
        leakage_control:
          "2024 initializes history. Each 2025 week is predicted before that week's results are added.",
        important:
          "The V2 weights are an initial hypothesis, not validated live-model weights. If V2 improves 2025, it still requires separate 2026 validation.",
      },
      sample_predictions: predictions.slice(0, 25),
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
