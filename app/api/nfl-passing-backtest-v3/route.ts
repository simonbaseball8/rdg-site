import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TRAIN_SEASONS = [2023, 2024];
const TEST_SEASON = 2025;

type Row = Record<string, string>;

type PlayerGame = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  team: string;
  opponent: string;
  home: boolean | null;
  attempts: number;
  completions: number;
  yards: number;
};

type TeamGame = {
  season: number;
  week: number;
  team: string;
  opponent: string;
  passing_yards_allowed: number;
  passing_attempts_allowed: number;
};

type Result = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  team: string;
  opponent: string;
  actual: number;
  projection: number;
  error: number;
  absolute_error: number;
  prior_games: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedAverage(
  values: Array<{ value: number; weight: number }>
): number | null {
  const valid = values.filter(
    (x) =>
      Number.isFinite(x.value) &&
      Number.isFinite(x.weight) &&
      x.weight > 0
  );

  if (!valid.length) return null;

  const weight = valid.reduce((s, x) => s + x.weight, 0);

  if (!weight) return null;

  return (
    valid.reduce((s, x) => s + x.value * x.weight, 0) /
    weight
  );
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      out.push(value);
      value = "";
    } else {
      value += c;
    }
  }

  out.push(value);
  return out;
}

function parseCSV(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (!lines.length) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Row = {};

    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });

    return row;
  });
}

async function fetchPlayerSeason(
  season: number
): Promise<PlayerGame[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      `Player stats returned ${response.status} for ${season}`
    );
  }

  const rows = parseCSV(await response.text());

  return rows
    .filter(
      (row) =>
        num(row.season) === season &&
        String(row.season_type).toUpperCase() === "REG" &&
        String(row.position).toUpperCase() === "QB" &&
        num(row.attempts) >= 10
    )
    .map((row) => ({
      season,
      week: num(row.week),
      player_id: row.player_id ?? "",
      player_name:
        row.player_display_name || row.player_name || "",
      team: row.recent_team || row.team || "",
      opponent: row.opponent_team || row.opponent || "",
      home:
        row.home_away === "home"
          ? true
          : row.home_away === "away"
            ? false
            : null,
      attempts: num(row.attempts),
      completions: num(row.completions),
      yards: num(row.passing_yards),
    }));
}

/*
  Build opponent pass-defense history directly from
  QB performances.

  IMPORTANT:
  During the chronological backtest, a defense receives
  credit only for QB games that have already occurred.
*/
function buildTeamGameFromQB(game: PlayerGame): TeamGame | null {
  if (!game.opponent) return null;

  return {
    season: game.season,
    week: game.week,
    team: game.opponent,
    opponent: game.team,
    passing_yards_allowed: game.yards,
    passing_attempts_allowed: game.attempts,
  };
}

function ypa(game: PlayerGame): number {
  return game.attempts > 0 ? game.yards / game.attempts : 0;
}

function recencyWeighted(
  games: PlayerGame[],
  selector: (game: PlayerGame) => number,
  maxGames = 8
): number | null {
  const selected = games.slice(-maxGames);

  if (!selected.length) return null;

  return weightedAverage(
    selected.map((game, index) => ({
      value: selector(game),
      weight: index + 1,
    }))
  );
}

function teamRecencyWeighted(
  games: TeamGame[],
  selector: (game: TeamGame) => number,
  maxGames = 8
): number | null {
  const selected = games.slice(-maxGames);

  if (!selected.length) return null;

  return weightedAverage(
    selected.map((game, index) => ({
      value: selector(game),
      weight: index + 1,
    }))
  );
}

/*
  V2 CORE

  This intentionally mirrors the structure that beat
  the simple baseline in our previous held-out test.
*/
function projectV2Core(history: PlayerGame[]): number | null {
  if (history.length < 3) return null;

  const latestSeason = history[history.length - 1].season;

  const current = history.filter(
    (g) => g.season === latestSeason
  );

  const prior = history
    .filter((g) => g.season < latestSeason)
    .slice(-17);

  const careerWindow = history.slice(-20);

  const priorAttempts = average(prior.map((g) => g.attempts));
  const currentAttempts = average(
    current.map((g) => g.attempts)
  );

  const recentAttempts = recencyWeighted(
    careerWindow,
    (g) => g.attempts
  );

  let currentWeight = 0;

  if (current.length === 1) currentWeight = 0.15;
  else if (current.length === 2) currentWeight = 0.25;
  else if (current.length === 3) currentWeight = 0.35;
  else if (current.length === 4) currentWeight = 0.45;
  else if (current.length >= 5) currentWeight = 0.55;

  let expectedAttempts: number | null;

  if (priorAttempts !== null && currentAttempts !== null) {
    expectedAttempts =
      priorAttempts * (1 - currentWeight) +
      currentAttempts * currentWeight;
  } else {
    expectedAttempts =
      currentAttempts ?? priorAttempts ?? recentAttempts;
  }

  if (expectedAttempts !== null && recentAttempts !== null) {
    expectedAttempts =
      expectedAttempts * 0.8 + recentAttempts * 0.2;
  }

  const priorYPA = average(prior.map(ypa));
  const currentYPA = average(current.map(ypa));

  const recentYPA = recencyWeighted(
    careerWindow,
    ypa
  );

  let efficiencyWeight = 0;

  if (current.length === 1) efficiencyWeight = 0.1;
  else if (current.length === 2) efficiencyWeight = 0.18;
  else if (current.length === 3) efficiencyWeight = 0.25;
  else if (current.length === 4) efficiencyWeight = 0.32;
  else if (current.length >= 5) efficiencyWeight = 0.4;

  let expectedYPA: number | null;

  if (priorYPA !== null && currentYPA !== null) {
    expectedYPA =
      priorYPA * (1 - efficiencyWeight) +
      currentYPA * efficiencyWeight;
  } else {
    expectedYPA =
      currentYPA ?? priorYPA ?? recentYPA;
  }

  if (expectedYPA !== null && recentYPA !== null) {
    expectedYPA =
      expectedYPA * 0.85 + recentYPA * 0.15;
  }

  if (expectedAttempts === null || expectedYPA === null) {
    return null;
  }

  expectedAttempts = Math.min(
    45,
    Math.max(20, expectedAttempts)
  );

  expectedYPA = Math.min(
    9.5,
    Math.max(5, expectedYPA)
  );

  let projection = expectedAttempts * expectedYPA;

  if (history.length <= 5) {
    projection = projection * 0.65 + 225 * 0.35;
  } else if (history.length <= 10) {
    projection = projection * 0.8 + 225 * 0.2;
  }

  return projection;
}

/*
  V3

  Start with V2, then make deliberately conservative
  matchup adjustments.

  We do NOT allow matchup context to move the projection
  wildly. This prevents a few defensive games from
  overpowering the QB's own history.
*/
function projectV3(
  playerHistory: PlayerGame[],
  defenseHistory: TeamGame[]
): number | null {
  const base = projectV2Core(playerHistory);

  if (base === null) return null;

  let projection = base;

  /*
    Recent QB volume.

    This captures meaningful role changes while limiting
    the maximum adjustment.
  */
  const longAttempts = average(
    playerHistory.slice(-12).map((g) => g.attempts)
  );

  const recentAttempts = average(
    playerHistory.slice(-3).map((g) => g.attempts)
  );

  if (
    longAttempts !== null &&
    recentAttempts !== null &&
    longAttempts >= 20
  ) {
    const ratio = recentAttempts / longAttempts;

    const capped = Math.min(1.12, Math.max(0.88, ratio));

    projection *= 1 + (capped - 1) * 0.25;
  }

  /*
    Opponent pass defense.

    Only historical games are available here.
  */
  if (defenseHistory.length >= 3) {
    const defenseYards = teamRecencyWeighted(
      defenseHistory,
      (g) => g.passing_yards_allowed,
      8
    );

    const defenseAttempts = teamRecencyWeighted(
      defenseHistory,
      (g) => g.passing_attempts_allowed,
      8
    );

    /*
      Conservative league baselines.
      Adjustments are heavily dampened.
    */
    if (defenseYards !== null) {
      const yardRatio = defenseYards / 225;

      const capped = Math.min(
        1.12,
        Math.max(0.88, yardRatio)
      );

      projection *= 1 + (capped - 1) * 0.2;
    }

    if (defenseAttempts !== null) {
      const attemptRatio = defenseAttempts / 33;

      const capped = Math.min(
        1.1,
        Math.max(0.9, attemptRatio)
      );

      projection *= 1 + (capped - 1) * 0.15;
    }
  }

  /*
    Final guardrail.

    Matchup adjustments should not transform a normal
    projection into an extreme number.
  */
  projection = Math.min(
    base + 30,
    Math.max(base - 30, projection)
  );

  return projection;
}

function projectBaseline(
  history: PlayerGame[]
): number | null {
  if (history.length < 3) return null;

  return average(
    history.slice(-17).map((g) => g.yards)
  );
}

function summarize(results: Result[]) {
  if (!results.length) {
    return {
      games: 0,
      mae: null,
      rmse: null,
      mean_error: null,
    };
  }

  const mae =
    results.reduce(
      (sum, r) => sum + r.absolute_error,
      0
    ) / results.length;

  const mse =
    results.reduce(
      (sum, r) => sum + r.error * r.error,
      0
    ) / results.length;

  const bias =
    results.reduce(
      (sum, r) => sum + r.error,
      0
    ) / results.length;

  return {
    games: results.length,
    mae: round(mae),
    rmse: round(Math.sqrt(mse)),
    mean_error: round(bias),
  };
}

function runBacktests(games: PlayerGame[]) {
  const ordered = [...games].sort(
    (a, b) =>
      a.season - b.season ||
      a.week - b.week ||
      a.player_id.localeCompare(b.player_id)
  );

  const playerHistory = new Map<string, PlayerGame[]>();
  const defenseHistory = new Map<string, TeamGame[]>();

  const v3: Result[] = [];
  const v2: Result[] = [];
  const baseline: Result[] = [];

  for (const game of ordered) {
    const playerPrevious =
      playerHistory.get(game.player_id) ?? [];

    const defensePrevious =
      game.opponent
        ? defenseHistory.get(game.opponent) ?? []
        : [];

    if (
      game.season === TEST_SEASON &&
      playerPrevious.length >= 3
    ) {
      const v3Projection = projectV3(
        playerPrevious,
        defensePrevious
      );

      const v2Projection = projectV2Core(playerPrevious);

      const baselineProjection =
        projectBaseline(playerPrevious);

      const makeResult = (
        projection: number
      ): Result => {
        const error = game.yards - projection;

        return {
          season: game.season,
          week: game.week,
          player_id: game.player_id,
          player_name: game.player_name,
          team: game.team,
          opponent: game.opponent,
          actual: game.yards,
          projection,
          error,
          absolute_error: Math.abs(error),
          prior_games: playerPrevious.length,
        };
      };

      if (v3Projection !== null) {
        v3.push(makeResult(v3Projection));
      }

      if (v2Projection !== null) {
        v2.push(makeResult(v2Projection));
      }

      if (baselineProjection !== null) {
        baseline.push(makeResult(baselineProjection));
      }
    }

    playerPrevious.push(game);
    playerHistory.set(game.player_id, playerPrevious);

    const defensiveGame = buildTeamGameFromQB(game);

    if (defensiveGame && defensiveGame.team) {
      const prior =
        defenseHistory.get(defensiveGame.team) ?? [];

      prior.push(defensiveGame);

      defenseHistory.set(defensiveGame.team, prior);
    }
  }

  return { v3, v2, baseline };
}

function matchingResults(
  reference: Result[],
  comparison: Result[]
): Result[] {
  const keys = new Set(
    reference.map(
      (r) => `${r.player_id}-${r.season}-${r.week}`
    )
  );

  return comparison.filter((r) =>
    keys.has(`${r.player_id}-${r.season}-${r.week}`)
  );
}

function bySample(results: Result[]) {
  const groups = [
    { label: "3-5 prior games", min: 3, max: 5 },
    { label: "6-10 prior games", min: 6, max: 10 },
    { label: "11-17 prior games", min: 11, max: 17 },
    { label: "18+ prior games", min: 18, max: Infinity },
  ];

  return groups.map((group) => {
    const subset = results.filter(
      (r) =>
        r.prior_games >= group.min &&
        r.prior_games <= group.max
    );

    return {
      sample: group.label,
      ...summarize(subset),
    };
  });
}

function byWeek(results: Result[]) {
  const weeks = Array.from(
    new Set(results.map((r) => r.week))
  ).sort((a, b) => a - b);

  return weeks.map((week) => ({
    week,
    ...summarize(
      results.filter((r) => r.week === week)
    ),
  }));
}

function errorDistribution(results: Result[]) {
  return [10, 20, 30, 40, 50].map((yards) => {
    const count = results.filter(
      (r) => r.absolute_error <= yards
    ).length;

    return {
      within_yards: yards,
      games: count,
      percentage: results.length
        ? round((count / results.length) * 100, 1)
        : 0,
    };
  });
}

export async function GET() {
  try {
    const seasons = [
      ...TRAIN_SEASONS,
      TEST_SEASON,
    ];

    const seasonData = await Promise.all(
      seasons.map(fetchPlayerSeason)
    );

    const games = seasonData.flat();

    const raw = runBacktests(games);

    /*
      Strict apples-to-apples sample.
    */
    const v2Matched = matchingResults(raw.v3, raw.v2);
    const baselineMatched = matchingResults(
      raw.v3,
      raw.baseline
    );

    const commonKeys = new Set(
      baselineMatched.map(
        (r) => `${r.player_id}-${r.season}-${r.week}`
      )
    );

    const v3 = raw.v3.filter((r) =>
      commonKeys.has(
        `${r.player_id}-${r.season}-${r.week}`
      )
    );

    const v2 = v2Matched.filter((r) =>
      commonKeys.has(
        `${r.player_id}-${r.season}-${r.week}`
      )
    );

    const baseline = baselineMatched;

    const v3Summary = summarize(v3);
    const v2Summary = summarize(v2);
    const baselineSummary = summarize(baseline);

    const v3VsV2 =
      v3Summary.mae !== null && v2Summary.mae !== null
        ? round(v2Summary.mae - v3Summary.mae)
        : null;

    const v3VsBaseline =
      v3Summary.mae !== null &&
      baselineSummary.mae !== null
        ? round(baselineSummary.mae - v3Summary.mae)
        : null;

    return NextResponse.json({
      success: true,

      version: "3.0-rdg-passing-yards-backtest",

      market: "NFL Passing Yards",

      model_status:
        "Held-Out Matchup-Aware Historical Backtest",

      methodology: {
        development_seasons: TRAIN_SEASONS,
        held_out_season: TEST_SEASON,

        leakage_control:
          "Every player and opponent-defense feature uses only games completed before the game being evaluated.",

        v3:
          "V2 passing-volume and efficiency projection plus conservative recent-volume and opponent pass-defense adjustments.",

        opponent_context:
          "Opponent passing yards and attempts allowed are constructed chronologically from prior QB performances only.",

        guardrails:
          "Matchup adjustments are dampened and capped at plus/minus 30 passing yards from the V2 core projection.",

        important:
          "This evaluates yardage projection accuracy only. It does not use historical sportsbook prop lines or measure betting ROI or profitability.",
      },

      evaluation: {
        games: v3.length,

        rdg_v3: v3Summary,

        rdg_v2_same_sample: v2Summary,

        simple_baseline_same_sample: baselineSummary,

        comparison: {
          v3_mae_improvement_vs_v2_yards: v3VsV2,

          v3_mae_improvement_vs_baseline_yards:
            v3VsBaseline,

          v3_beats_v2:
            v3Summary.mae !== null &&
            v2Summary.mae !== null
              ? v3Summary.mae < v2Summary.mae
              : null,

          v3_beats_baseline:
            v3Summary.mae !== null &&
            baselineSummary.mae !== null
              ? v3Summary.mae < baselineSummary.mae
              : null,
        },
      },

      v3_error_distribution: errorDistribution(v3),

      v3_by_prior_sample: bySample(v3),

      v3_by_week: byWeek(v3),

      largest_v3_misses: v3
        .slice()
        .sort(
          (a, b) =>
            b.absolute_error - a.absolute_error
        )
        .slice(0, 15)
        .map((r) => ({
          week: r.week,
          player: r.player_name,
          team: r.team,
          opponent: r.opponent,
          projection: round(r.projection, 1),
          actual: r.actual,
          error: round(r.error, 1),
          absolute_error: round(r.absolute_error, 1),
          prior_games: r.prior_games,
        })),

      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL passing V3 backtest error",
      },
      { status: 500 }
    );
  }
}
