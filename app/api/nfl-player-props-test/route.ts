import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "4.0-rushing-v4-workload-efficiency";
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

type History = { games: PlayerGame[] };

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function avg(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const split = (line: string) => {
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
  };

  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const values = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] ?? ""));
    return row;
  });
}

async function loadSeason(season: number): Promise<PlayerGame[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const res = await fetch(url, {
    headers: { "User-Agent": "RDG-Rushing-V4/4.0" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) throw new Error(`nflverse ${season} failed: ${res.status}`);

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

function addHistory(map: Map<string, History>, g: PlayerGame) {
  const h = map.get(g.playerId) ?? { games: [] };
  h.games.push(g);
  map.set(g.playerId, h);
}

function metrics(errors: number[]) {
  if (!errors.length) return { n: 0, mae: null, rmse: null, mean_error: null };

  return {
    n: errors.length,
    mae: Number(avg(errors.map(Math.abs)).toFixed(2)),
    rmse: Number(Math.sqrt(avg(errors.map((e) => e * e))).toFixed(2)),
    mean_error: Number(avg(errors).toFixed(2)),
  };
}

export async function GET() {
  try {
    // Keep 2026 completely out of V4 development.
    const [train2024, test2025] = await Promise.all([
      loadSeason(2024),
      loadSeason(2025),
    ]);

    const history = new Map<string, History>();
    for (const g of train2024) addHistory(history, g);

    const baselineErrors: number[] = [];
    const v4Errors: number[] = [];
    const carryErrors: number[] = [];
    const predictions: any[] = [];
    let skipped = 0;

    const weeks = [...new Set(test2025.map((g) => g.week))].sort((a, b) => a - b);

    for (const week of weeks) {
      const weekGames = test2025.filter((g) => g.week === week);

      for (const game of weekGames) {
        const h = history.get(game.playerId);

        if (!h || h.games.length < MIN_PRIOR_GAMES) {
          skipped++;
          continue;
        }

        const all = h.games;
        const recent = all.slice(-RECENT_GAMES);

        const careerCarries = avg(all.map((g) => g.carries));
        const recentCarries = avg(recent.map((g) => g.carries));

        const last1Carries = recent[recent.length - 1]?.carries ?? recentCarries;
        const last2Carries = avg(recent.slice(-2).map((g) => g.carries));

        const careerYards = all.reduce((s, g) => s + g.rushYards, 0);
        const careerCarryTotal = all.reduce((s, g) => s + g.carries, 0);
        const careerYpc = careerYards / Math.max(1, careerCarryTotal);

        const recentYards = recent.reduce((s, g) => s + g.rushYards, 0);
        const recentCarryTotal = recent.reduce((s, g) => s + g.carries, 0);
        const recentYpc = recentYards / Math.max(1, recentCarryTotal);

        const careerYpg = avg(all.map((g) => g.rushYards));

        const isQB = game.position === "QB";

        /*
          V4 explicitly separates workload from efficiency.

          WORKLOAD:
          RBs: recent role matters strongly.
          QBs: workload is stabilized because scramble volume is noisy.

          This is a pre-declared V4 hypothesis. 2026 is not used.
        */
        let expectedCarries: number;

        if (isQB) {
          expectedCarries =
            0.25 * last2Carries +
            0.25 * recentCarries +
            0.50 * careerCarries;
        } else {
          expectedCarries =
            0.20 * last1Carries +
            0.35 * last2Carries +
            0.30 * recentCarries +
            0.15 * careerCarries;
        }

        // Prevent extreme workload extrapolation.
        expectedCarries = clamp(
          expectedCarries,
          Math.max(1, careerCarries * 0.60),
          careerCarries * 1.45,
        );

        /*
          EFFICIENCY:
          YPC is noisy, so V4 shrinks recent efficiency heavily
          toward the player's longer-term efficiency.
        */
        const expectedYpc = isQB
          ? 0.90 * careerYpc + 0.10 * recentYpc
          : 0.85 * careerYpc + 0.15 * recentYpc;

        const baselineProjection = careerYpg;
        const v4Projection = expectedCarries * expectedYpc;

        baselineErrors.push(baselineProjection - game.rushYards);
        v4Errors.push(v4Projection - game.rushYards);
        carryErrors.push(expectedCarries - game.carries);

        predictions.push({
          week,
          player: game.playerName,
          team: game.team,
          position: game.position || "UNKNOWN",
          actual_rushing_yards: game.rushYards,
          actual_carries: game.carries,
          prior_games: all.length,
          recent_games: recent.length,

          career_carries_per_game: Number(careerCarries.toFixed(2)),
          recent_carries_per_game: Number(recentCarries.toFixed(2)),
          last_2_carries_per_game: Number(last2Carries.toFixed(2)),
          last_game_carries: last1Carries,
          expected_carries: Number(expectedCarries.toFixed(2)),

          career_yards_per_carry: Number(careerYpc.toFixed(2)),
          recent_yards_per_carry: Number(recentYpc.toFixed(2)),
          expected_yards_per_carry: Number(expectedYpc.toFixed(2)),

          baseline_projection: Number(baselineProjection.toFixed(1)),
          rushing_v4_projection: Number(v4Projection.toFixed(1)),
        });
      }

      // Predict the full week before adding that week's results.
      for (const g of weekGames) addHistory(history, g);
    }

    const baseline = metrics(baselineErrors);
    const v4 = metrics(v4Errors);
    const carryModel = metrics(carryErrors);

    const improvement =
      baseline.mae !== null && v4.mae !== null
        ? Number((baseline.mae - v4.mae).toFixed(2))
        : null;

    const improvementPct =
      baseline.mae && improvement !== null
        ? Number(((improvement / baseline.mae) * 100).toFixed(2))
        : null;

    return NextResponse.json({
      success: true,
      version: VERSION,
      purpose:
        "Rushing V4 development test that models expected rushing workload separately from rushing efficiency.",
      model_status: "DEVELOPMENT TEST ONLY — NOT LIVE",
      development_guardrail:
        "Only 2024 prior history and chronological 2025 evaluation are used. 2026 is not loaded.",
      samples: {
        training_2024_player_games: train2024.length,
        testing_2025_player_games: test2025.length,
        held_out_predictions: predictions.length,
        skipped_no_prior_history: skipped,
      },
      baseline: {
        description: "All prior rushing yards per game",
        ...baseline,
      },
      workload_model: {
        description: "Expected carries compared with actual carries",
        ...carryModel,
      },
      rushing_v4: {
        description:
          "Expected carries × stabilized expected yards per carry",
        ...v4,
      },
      comparison: {
        mae_improvement_yards: improvement,
        mae_improvement_percent: improvementPct,
        v4_beats_baseline:
          improvement !== null ? improvement > 0 : false,
        v4_beats_baseline_rmse:
          v4.rmse !== null && baseline.rmse !== null
            ? v4.rmse < baseline.rmse
            : false,
      },
      methodology: {
        workload:
          "RB workload emphasizes last game, last two games, and four-game recent usage. QB workload is more heavily stabilized toward long-term carries.",
        efficiency:
          "Recent YPC is heavily shrunk toward long-term YPC because rushing efficiency is volatile.",
        leakage_control:
          "2024 initializes history. Every 2025 week is predicted before that week's results are added.",
        important:
          "This is a projection-development test, not a sportsbook prop backtest or betting win-rate test.",
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
