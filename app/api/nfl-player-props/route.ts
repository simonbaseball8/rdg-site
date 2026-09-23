import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 900;
export const maxDuration = 60;

const VERSION = "6.0-rdg-unified-nfl-player-props";
const CACHE_SECONDS = 900;

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const CURRENT_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${CURRENT_SEASON}.csv`;

const PRIOR_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${PRIOR_SEASON}.csv`;

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_SPORT = "americanfootball_nfl";

/*
  ============================================================
  CORE MARKETS

  These are the six markets RDG will actually analyze.

  We are no longer exposing a pile of sportsbook-only markets
  that the model is not using.
  ============================================================
*/

const CORE_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_rush_yds",
  "player_reception_yds",
  "player_receptions",
  "player_anytime_td",
] as const;

type CoreMarket = (typeof CORE_MARKETS)[number];

type Row = Record<string, string>;

type PlayerGame = {
  season: number;
  week: number;

  player_id: string;
  player_name: string;

  team: string;
  position: string;

  attempts: number;
  completions: number;

  passing_yards: number;
  passing_tds: number;

  carries: number;
  rushing_yards: number;
  rushing_tds: number;

  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
};

type PlayerHistory = {
  player_name: string;
  player_id: string;
  position: string;

  current: PlayerGame[];
  prior: PlayerGame[];
};

type SportsbookLine = {
  sportsbook: string;
  side: string | null;
  line: number;
  odds: string | number | null;
  available: boolean;
  updated_at: string | null;
};

type AnytimeTDLine = {
  sportsbook: string;
  selection: string;
  odds: string | number | null;
  available: boolean;
  updated_at: string | null;
};

type OddsEvent = {
  id: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
};

/*
  ============================================================
  UTILITIES
  ============================================================
*/

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number | null {
  if (!values.length) return null;

  return (
    values.reduce(
      (sum, value) => sum + value,
      0,
    ) / values.length
  );
}

function weightedAverage(
  values: Array<{
    value: number;
    weight: number;
  }>,
): number | null {
  const valid = values.filter(
    (item) =>
      Number.isFinite(item.value) &&
      Number.isFinite(item.weight) &&
      item.weight > 0,
  );

  if (!valid.length) return null;

  const totalWeight = valid.reduce(
    (sum, item) => sum + item.weight,
    0,
  );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, item) =>
        sum + item.value * item.weight,
      0,
    ) / totalWeight
  );
}

function normalizeName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/*
  ============================================================
  CSV
  ============================================================
*/

function parseCSVLine(line: string): string[] {
  const result: string[] = [];

  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (
      char === "," &&
      !quoted
    ) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result;
}

function parseCSV(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim().length > 0,
    );

  if (!lines.length) {
    return [];
  }

  const headers =
    parseCSVLine(lines[0]);

  return lines
    .slice(1)
    .map((line) => {
      const values =
        parseCSVLine(line);

      const row: Row = {};

      headers.forEach(
        (header, index) => {
          row[header] =
            values[index] ?? "";
        },
      );

      return row;
    });
}

async function fetchCSV(
  url: string,
): Promise<Row[]> {
  const response =
    await fetch(url, {
      next: {
        revalidate: 3600,
      },
    });

  if (!response.ok) {
    throw new Error(
      `nflverse returned ${response.status} for ${url}`,
    );
  }

  return parseCSV(
    await response.text(),
  );
}

/*
  ============================================================
  PLAYER HISTORY

  One history structure now supports:
  - Passing
  - Rushing
  - Receiving
  - Receptions
  - Touchdowns
  ============================================================
*/

function playerGames(
  rows: Row[],
  season: number,
): PlayerGame[] {
  return rows
    .filter(
      (row) =>
        num(row.season) === season &&
        String(
          row.season_type,
        ).toUpperCase() === "REG",
    )
    .map((row) => ({
      season,

      week:
        num(row.week),

      player_id:
        row.player_id ?? "",

      player_name:
        row.player_display_name ||
        row.player_name ||
        "",

      team:
        row.recent_team ||
        row.team ||
        "",

      position:
        String(
          row.position ?? "",
        ).toUpperCase(),

      attempts:
        num(row.attempts),

      completions:
        num(row.completions),

      passing_yards:
        num(row.passing_yards),

      passing_tds:
        num(row.passing_tds),

      carries:
        num(row.carries),

      rushing_yards:
        num(row.rushing_yards),

      rushing_tds:
        num(row.rushing_tds),

      targets:
        num(row.targets),

      receptions:
        num(row.receptions),

      receiving_yards:
        num(row.receiving_yards),

      receiving_tds:
        num(row.receiving_tds),
    }))
    .filter(
      (game) =>
        Boolean(game.player_name),
    )
    .sort(
      (a, b) =>
        a.season - b.season ||
        a.week - b.week,
    );
}

function buildPlayerHistory(
  currentGames: PlayerGame[],
  priorGames: PlayerGame[],
): Map<string, PlayerHistory> {
  const map =
    new Map<
      string,
      PlayerHistory
    >();

  for (
    const game of [
      ...priorGames,
      ...currentGames,
    ]
  ) {
    const key =
      normalizeName(
        game.player_name,
      );

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        player_name:
          game.player_name,

        player_id:
          game.player_id,

        position:
          game.position,

        current: [],
        prior: [],
      });
    }

    const player =
      map.get(key)!;

    if (
      game.season ===
      CURRENT_SEASON
    ) {
      player.current.push(game);
    } else {
      player.prior.push(game);
    }
  }

  for (
    const player
    of map.values()
  ) {
    player.current.sort(
      (a, b) =>
        a.week - b.week,
    );

    player.prior.sort(
      (a, b) =>
        a.week - b.week,
    );
  }

  return map;
}

function historyGames(
  player: PlayerHistory,
): PlayerGame[] {
  return [
    ...player.prior,
    ...player.current,
  ].sort(
    (a, b) =>
      a.season - b.season ||
      a.week - b.week,
  );
}

function recencyWeighted(
  games: PlayerGame[],
  selector:
    (game: PlayerGame) => number,
  maxGames = 8,
): number | null {
  const selected =
    games.slice(-maxGames);

  if (!selected.length) {
    return null;
  }

  return weightedAverage(
    selected.map(
      (game, index) => ({
        value:
          selector(game),

        weight:
          index + 1,
      }),
    ),
  );
}

/*
  ============================================================
  FROZEN RDG PASSING YARDS V2

  This preserves the core Passing V2 structure already used
  by the previous centralized route.
  ============================================================
*/

function yardsPerAttempt(
  game: PlayerGame,
): number {
  if (
    game.attempts <= 0
  ) {
    return 0;
  }

  return (
    game.passing_yards /
    game.attempts
  );
}

function projectPassingYardsV2(
  player: PlayerHistory,
) {
  const history =
    historyGames(player)
      .filter(
        (game) =>
          game.attempts >= 10,
      );

  if (
    history.length < 3
  ) {
    return null;
  }

  const current =
    player.current.filter(
      (game) =>
        game.attempts >= 10,
    );

  const prior =
    player.prior
      .filter(
        (game) =>
          game.attempts >= 10,
      )
      .slice(-17);

  const careerWindow =
    history.slice(-20);

  const priorAttempts =
    average(
      prior.map(
        (game) =>
          game.attempts,
      ),
    );

  const currentAttempts =
    average(
      current.map(
        (game) =>
          game.attempts,
      ),
    );

  const recentAttempts =
    recencyWeighted(
      careerWindow,
      (game) =>
        game.attempts,
      8,
    );

  let currentWeight = 0;

  if (current.length === 1) {
    currentWeight = 0.15;
  } else if (
    current.length === 2
  ) {
    currentWeight = 0.25;
  } else if (
    current.length === 3
  ) {
    currentWeight = 0.35;
  } else if (
    current.length === 4
  ) {
    currentWeight = 0.45;
  } else if (
    current.length >= 5
  ) {
    currentWeight = 0.55;
  }

  let expectedAttempts:
    number | null = null;

  if (
    priorAttempts !== null &&
    currentAttempts !== null
  ) {
    expectedAttempts =
      priorAttempts *
        (1 - currentWeight) +
      currentAttempts *
        currentWeight;
  } else {
    expectedAttempts =
      currentAttempts ??
      priorAttempts ??
      recentAttempts;
  }

  if (
    expectedAttempts !== null &&
    recentAttempts !== null
  ) {
    expectedAttempts =
      expectedAttempts * 0.8 +
      recentAttempts * 0.2;
  }

  const priorYPA =
    average(
      prior.map(
        yardsPerAttempt,
      ),
    );

  const currentYPA =
    average(
      current.map(
        yardsPerAttempt,
      ),
    );

  const recentYPA =
    recencyWeighted(
      careerWindow,
      yardsPerAttempt,
      8,
    );

  let efficiencyWeight = 0;

  if (current.length === 1) {
    efficiencyWeight = 0.1;
  } else if (
    current.length === 2
  ) {
    efficiencyWeight = 0.18;
  } else if (
    current.length === 3
  ) {
    efficiencyWeight = 0.25;
  } else if (
    current.length === 4
  ) {
    efficiencyWeight = 0.32;
  } else if (
    current.length >= 5
  ) {
    efficiencyWeight = 0.4;
  }

  let expectedYPA:
    number | null = null;

  if (
    priorYPA !== null &&
    currentYPA !== null
  ) {
    expectedYPA =
      priorYPA *
        (1 - efficiencyWeight) +
      currentYPA *
        efficiencyWeight;
  } else {
    expectedYPA =
      currentYPA ??
      priorYPA ??
      recentYPA;
  }

  if (
    expectedYPA !== null &&
    recentYPA !== null
  ) {
    expectedYPA =
      expectedYPA * 0.85 +
      recentYPA * 0.15;
  }

  if (
    expectedAttempts === null ||
    expectedYPA === null
  ) {
    return null;
  }

  expectedAttempts =
    clamp(
      expectedAttempts,
      20,
      45,
    );

  expectedYPA =
    clamp(
      expectedYPA,
      5,
      9.5,
    );

  let projection =
    expectedAttempts *
    expectedYPA;

  const totalHistory =
    history.length;

  if (
    totalHistory <= 5
  ) {
    projection =
      projection * 0.65 +
      225 * 0.35;
  } else if (
    totalHistory <= 10
  ) {
    projection =
      projection * 0.8 +
      225 * 0.2;
  }

  return {
    projection:
      round(projection, 1),

    expected_attempts:
      round(
        expectedAttempts,
        1,
      ),

    expected_yards_per_attempt:
      round(
        expectedYPA,
        2,
      ),

    current_games:
      current.length,

    prior_games:
      prior.length,

    total_history_games:
      totalHistory,

    model:
      "Frozen RDG Passing V2",
  };
}

/*
  ============================================================
  GENERIC HISTORY PROJECTION

  Used for markets that have not yet received a separately
  validated frozen model.

  This is intentionally conservative.

  Prior season = stability
  Current season = role
  Recent games = current usage/form

  These are projections — NOT claimed historical win rates.
  ============================================================
*/

function projectHistoryMetric(
  player: PlayerHistory,
  selector:
    (game: PlayerGame) => number,
  participation:
    (game: PlayerGame) => boolean,
  modelName: string,
) {
  const all =
    historyGames(player)
      .filter(participation);

  if (
    all.length < 3
  ) {
    return null;
  }

  const prior =
    player.prior
      .filter(participation)
      .slice(-17);

  const current =
    player.current
      .filter(participation);

  const recent =
    all.slice(-6);

  const priorAverage =
    average(
      prior.map(selector),
    );

  const currentAverage =
    average(
      current.map(selector),
    );

  const recentAverage =
    recencyWeighted(
      recent,
      selector,
      6,
    );

  let projection:
    number | null = null;

  /*
    Early season:
    keep significant prior-season weight.

    Later season:
    current-season role becomes more important.
  */

  if (
    current.length === 0
  ) {
    projection =
      priorAverage ??
      recentAverage;
  } else if (
    current.length <= 2
  ) {
    projection =
      weightedAverage([
        {
          value:
            priorAverage ??
            currentAverage ??
            0,
          weight: 0.55,
        },
        {
          value:
            currentAverage ??
            priorAverage ??
            0,
          weight: 0.25,
        },
        {
          value:
            recentAverage ??
            currentAverage ??
            0,
          weight: 0.20,
        },
      ]);
  } else if (
    current.length <= 5
  ) {
    projection =
      weightedAverage([
        {
          value:
            priorAverage ??
            currentAverage ??
            0,
          weight: 0.35,
        },
        {
          value:
            currentAverage ??
            priorAverage ??
            0,
          weight: 0.40,
        },
        {
          value:
            recentAverage ??
            currentAverage ??
            0,
          weight: 0.25,
        },
      ]);
  } else {
    projection =
      weightedAverage([
        {
          value:
            priorAverage ??
            currentAverage ??
            0,
          weight: 0.20,
        },
        {
          value:
            currentAverage ??
            priorAverage ??
            0,
          weight: 0.45,
        },
        {
          value:
            recentAverage ??
            currentAverage ??
            0,
          weight: 0.35,
        },
      ]);
  }

  if (
    projection === null
  ) {
    return null;
  }

  return {
    projection:
      round(projection, 2),

    prior_average:
      priorAverage === null
        ? null
        : round(
            priorAverage,
            2,
          ),

    current_average:
      currentAverage === null
        ? null
        : round(
            currentAverage,
            2,
          ),

    recent_weighted_average:
      recentAverage === null
        ? null
        : round(
            recentAverage,
            2,
          ),

    prior_games:
      prior.length,

    current_games:
      current.length,

    total_history_games:
      all.length,

    model:
      modelName,
  };
}

/*
  ============================================================
  RUSHING YARDS

  Role-aware historical projection.

  QB rushing and RB rushing behave differently, so QB history
  is intentionally more stable and less reactive.
  ============================================================
*/

function projectRushingYards(
  player: PlayerHistory,
) {
  const all =
    historyGames(player)
      .filter(
        (game) =>
          game.carries > 0,
      );

  if (
    all.length < 3
  ) {
    return null;
  }

  const careerWindow =
    all.slice(-17);

  const recent =
    all.slice(-4);

  const lastTwo =
    all.slice(-2);

  const careerYards =
    average(
      careerWindow.map(
        (game) =>
          game.rushing_yards,
      ),
    );

  const recentYards =
    average(
      recent.map(
        (game) =>
          game.rushing_yards,
      ),
    );

  const lastTwoYards =
    average(
      lastTwo.map(
        (game) =>
          game.rushing_yards,
      ),
    );

  const careerCarries =
    average(
      careerWindow.map(
        (game) =>
          game.carries,
      ),
    );

  const recentCarries =
    average(
      recent.map(
        (game) =>
          game.carries,
      ),
    );

  if (
    careerYards === null
  ) {
    return null;
  }

  const isQB =
    player.position === "QB";

  let base: number;

  if (isQB) {
    base =
      careerYards * 0.80 +
      (recentYards ??
        careerYards) *
        0.15 +
      (lastTwoYards ??
        recentYards ??
        careerYards) *
        0.05;
  } else {
    base =
      careerYards * 0.65 +
      (recentYards ??
        careerYards) *
        0.25 +
      (lastTwoYards ??
        recentYards ??
        careerYards) *
        0.10;
  }

  /*
    Small role adjustment.

    We intentionally prevent recent carries from moving the
    projection too aggressively.
  */

  let carryMultiplier = 1;

  if (
    careerCarries !== null &&
    careerCarries > 0 &&
    recentCarries !== null
  ) {
    const roleRatio =
      recentCarries /
      careerCarries;

    const roleStrength =
      isQB
        ? 0.05
        : 0.10;

    carryMultiplier =
      1 +
      (roleRatio - 1) *
        roleStrength;

    carryMultiplier =
      clamp(
        carryMultiplier,
        0.92,
        1.08,
      );
  }

  const projection =
    base *
    carryMultiplier;

  return {
    projection:
      round(projection, 1),

    position:
      player.position,

    career_yards_average:
      round(
        careerYards,
        1,
      ),

    recent_4_yards_average:
      recentYards === null
        ? null
        : round(
            recentYards,
            1,
          ),

    last_2_yards_average:
      lastTwoYards === null
        ? null
        : round(
            lastTwoYards,
            1,
          ),

    career_carries_average:
      careerCarries === null
        ? null
        : round(
            careerCarries,
            1,
          ),

    recent_carries_average:
      recentCarries === null
        ? null
        : round(
            recentCarries,
            1,
          ),

    carry_role_multiplier:
      round(
        carryMultiplier,
        3,
      ),

    total_history_games:
      all.length,

    model:
      "RDG Role-Aware Rushing History",
  };
}

function projectReceivingYards(
  player: PlayerHistory,
) {
  return projectHistoryMetric(
    player,

    (game) =>
      game.receiving_yards,

    (game) =>
      game.targets > 0 ||
      game.receptions > 0,

    "RDG Receiving History",
  );
}

function projectReceptions(
  player: PlayerHistory,
) {
  return projectHistoryMetric(
    player,

    (game) =>
      game.receptions,

    (game) =>
      game.targets > 0 ||
      game.receptions > 0,

    "RDG Reception History",
  );
}

function projectPassingTDs(
  player: PlayerHistory,
) {
  return projectHistoryMetric(
    player,

    (game) =>
      game.passing_tds,

    (game) =>
      game.attempts >= 10,

    "RDG Passing TD History",
  );
}

/*
  ============================================================
  ANYTIME TD

  We calculate scoring frequency from rushing + receiving TDs.

  This is NOT treated like an OVER/UNDER market.

  Output:
  YES or PASS
  ============================================================
*/

function projectAnytimeTD(
  player: PlayerHistory,
) {
  const all =
    historyGames(player)
      .filter(
        (game) =>
          game.carries > 0 ||
          game.targets > 0 ||
          game.receptions > 0,
      );

  if (
    all.length < 4
  ) {
    return null;
  }

  const window =
    all.slice(-17);

  const recent =
    all.slice(-6);

  const scored =
    window.filter(
      (game) =>
        game.rushing_tds +
          game.receiving_tds >
        0,
    ).length;

  const recentScored =
    recent.filter(
      (game) =>
        game.rushing_tds +
          game.receiving_tds >
        0,
    ).length;

  const seasonRate =
    scored /
    window.length;

  const recentRate =
    recentScored /
    recent.length;

  const blendedRate =
    seasonRate * 0.65 +
    recentRate * 0.35;

  return {
    projection:
      round(
        blendedRate * 100,
        1,
      ),

    anytime_td_score_rate:
      round(
        blendedRate * 100,
        1,
      ),

    historical_score_rate:
      round(
        seasonRate * 100,
        1,
      ),

    recent_6_score_rate:
      round(
        recentRate * 100,
        1,
      ),

    total_history_games:
      window.length,

    model:
      "RDG Anytime TD Historical Rate",
  };
}

/*
  ============================================================
  ODDS API
  ============================================================
*/

async function oddsFetch(
  url: string,
  key: string,
  revalidate = CACHE_SECONDS,
) {
  const separator =
    url.includes("?")
      ? "&"
      : "?";

  const response =
    await fetch(
      `${url}${separator}apiKey=${encodeURIComponent(key)}`,
      {
        next: {
          revalidate,
        },
      },
    );

  const usage = {
    used:
      Number(
        response.headers.get(
          "x-requests-used",
        ),
      ) || null,

    remaining:
      Number(
        response.headers.get(
          "x-requests-remaining",
        ),
      ) || null,

    last:
      Number(
        response.headers.get(
          "x-requests-last",
        ),
      ) || null,
  };

  if (!response.ok) {
    throw new Error(
      `The Odds API returned ${response.status}: ${await response.text()}`,
    );
  }

  return {
    data:
      await response.json(),

    usage,
  };
}

function marketPlayers(
  data: any,
  marketKey: string,
) {
  const players =
    new Map<
      string,
      string
    >();

  for (
    const book of
      Array.isArray(
        data?.bookmakers,
      )
        ? data.bookmakers
        : []
  ) {
    for (
      const market of
        Array.isArray(
          book?.markets,
        )
          ? book.markets
          : []
    ) {
      if (
        String(
          market?.key ?? "",
        ) !== marketKey
      ) {
        continue;
      }

      for (
        const outcome of
          Array.isArray(
            market?.outcomes,
          )
            ? market.outcomes
            : []
      ) {
        const name =
          String(
            outcome?.description ??
              "",
          ).trim();

        const key =
          normalizeName(name);

        if (
          key &&
          name
        ) {
          players.set(
            key,
            name,
          );
        }
      }
    }
  }

  return [
    ...players.values(),
  ];
}

function oddsLines(
  data: any,
  marketKey: string,
  playerName: string,
): SportsbookLine[] {
  const out:
    SportsbookLine[] = [];

  const target =
    normalizeName(
      playerName,
    );

  for (
    const book of
      Array.isArray(
        data?.bookmakers,
      )
        ? data.bookmakers
        : []
  ) {
    for (
      const market of
        Array.isArray(
          book?.markets,
        )
          ? book.markets
          : []
    ) {
      if (
        String(
          market?.key ?? "",
        ) !== marketKey
      ) {
        continue;
      }

      for (
        const outcome of
          Array.isArray(
            market?.outcomes,
          )
            ? market.outcomes
            : []
      ) {
        if (
          normalizeName(
            String(
              outcome?.description ??
                "",
            ),
          ) !== target
        ) {
          continue;
        }

        const side =
          String(
            outcome?.name ?? "",
          ).toUpperCase();

        const line =
          Number(
            outcome?.point,
          );

        if (
          (
            side !== "OVER" &&
            side !== "UNDER"
          ) ||
          !Number.isFinite(line)
        ) {
          continue;
        }

        out.push({
          sportsbook:
            String(
              book?.title ??
              book?.key ??
              "Unknown",
            ),

          side,

          line,

          odds:
            outcome?.price ??
            null,

          available:
            true,

          updated_at:
            market?.last_update ??
            null,
        });
      }
    }
  }

  return out;
}

function anytimeTDLines(
  data: any,
  playerName: string,
): AnytimeTDLine[] {
  const out:
    AnytimeTDLine[] = [];

  const target =
    normalizeName(
      playerName,
    );

  for (
    const book of
      Array.isArray(
        data?.bookmakers,
      )
        ? data.bookmakers
        : []
  ) {
    for (
      const market of
        Array.isArray(
          book?.markets,
        )
          ? book.markets
          : []
    ) {
      if (
        String(
          market?.key ?? "",
        ) !==
        "player_anytime_td"
      ) {
        continue;
      }

      for (
        const outcome of
          Array.isArray(
            market?.outcomes,
          )
            ? market.outcomes
            : []
      ) {
        if (
          normalizeName(
            String(
              outcome?.description ??
                "",
            ),
          ) !== target
        ) {
          continue;
        }

        out.push({
          sportsbook:
            String(
              book?.title ??
              book?.key ??
              "Unknown",
            ),

          selection:
            String(
              outcome?.name ??
              "YES",
            ).toUpperCase(),

          odds:
            outcome?.price ??
            null,

          available:
            true,

          updated_at:
            market?.last_update ??
            null,
        });
      }
    }
  }

  return out;
}

function consensusLine(
  lines: SportsbookLine[],
) {
  const values = [
    ...new Map(
      lines
        .filter(
          (line) =>
            line.available,
        )
        .map(
          (line) => [
            `${line.sportsbook}|${line.line}`,
            line.line,
          ],
        ),
    ).values(),
  ];

  if (!values.length) {
    return null;
  }

  const counts =
    new Map<
      number,
      number
    >();

  values.forEach(
    (value) =>
      counts.set(
        value,
        (
          counts.get(value) ??
          0
        ) + 1,
      ),
  );

  const sorted =
    [...values].sort(
      (a, b) =>
        a - b,
    );

  const middle =
    Math.floor(
      sorted.length / 2,
    );

  const median =
    sorted.length % 2
      ? sorted[middle]
      : (
          sorted[middle - 1] +
          sorted[middle]
        ) / 2;

  return [
    ...counts.entries(),
  ].sort(
    (a, b) =>
      b[1] - a[1] ||
      Math.abs(
        a[0] - median,
      ) -
        Math.abs(
          b[0] - median,
        ),
  )[0][0];
}

function impliedProbability(
  odds:
    string |
    number |
    null,
) {
  const n =
    Number(odds);

  if (
    !Number.isFinite(n) ||
    n === 0
  ) {
    return null;
  }

  return n > 0
    ? 100 / (n + 100)
    : Math.abs(n) /
        (
          Math.abs(n) +
          100
        );
}

function noVig(
  lines: SportsbookLine[],
  line: number,
  side:
    "OVER" |
    "UNDER",
) {
  const books =
    new Map<
      string,
      {
        over?: SportsbookLine;
        under?: SportsbookLine;
      }
    >();

  for (
    const item
    of lines
  ) {
    if (
      !item.available ||
      item.line !== line
    ) {
      continue;
    }

    const key =
      String(
        item.side ?? "",
      ).toUpperCase();

    if (
      key !== "OVER" &&
      key !== "UNDER"
    ) {
      continue;
    }

    if (
      !books.has(
        item.sportsbook,
      )
    ) {
      books.set(
        item.sportsbook,
        {},
      );
    }

    if (
      key === "OVER"
    ) {
      books.get(
        item.sportsbook,
      )!.over = item;
    } else {
      books.get(
        item.sportsbook,
      )!.under = item;
    }
  }

  const probabilities:
    number[] = [];

  const pairedBooks:
    any[] = [];

  for (
    const [
      sportsbook,
      pair,
    ] of books
  ) {
    if (
      !pair.over ||
      !pair.under
    ) {
      continue;
    }

    const over =
      impliedProbability(
        pair.over.odds,
      );

    const under =
      impliedProbability(
        pair.under.odds,
      );

    if (
      over === null ||
      under === null ||
      over + under <= 0
    ) {
      continue;
    }

    const total =
      over + under;

    const overNoVig =
      over / total;

    const underNoVig =
      under / total;

    probabilities.push(
      side === "OVER"
        ? overNoVig
        : underNoVig,
    );

    pairedBooks.push({
      sportsbook,
      line,

      over_odds:
        pair.over.odds,

      under_odds:
        pair.under.odds,

      over_no_vig_probability:
        round(
          overNoVig * 100,
          2,
        ),

      under_no_vig_probability:
        round(
          underNoVig * 100,
          2,
        ),
    });
  }

  return {
    probability:
      probabilities.length
        ? round(
            (
              probabilities.reduce(
                (a, b) =>
                  a + b,
                0,
              ) /
              probabilities.length
            ) * 100,
            2,
          )
        : null,

    paired_books:
      pairedBooks,
  };
}

/*
  ============================================================
  CONFIDENCE / PICK ENGINE

  IMPORTANT:

  confidence is an RDG ranking score.

  It is NOT being represented as:
  "this bet has X% chance of winning."

  This lets the parlay builder rank plays without pretending
  we have validated win probabilities for every market.
  ============================================================
*/

const MARKET_SCALE:
  Record<
    Exclude<
      CoreMarket,
      "player_anytime_td"
    >,
    number
  > = {
    player_pass_yds: 35,
    player_pass_tds: 0.75,
    player_rush_yds: 15,
    player_reception_yds: 15,
    player_receptions: 1.5,
  };

const PASS_THRESHOLD:
  Record<
    Exclude<
      CoreMarket,
      "player_anytime_td"
    >,
    number
  > = {
    player_pass_yds: 8,
    player_pass_tds: 0.20,
    player_rush_yds: 5,
    player_reception_yds: 5,
    player_receptions: 0.45,
  };

function confidenceScore(
  market:
    Exclude<
      CoreMarket,
      "player_anytime_td"
    >,

  difference: number,

  historyGamesCount: number,

  sportsbookCount: number,

  marketProbability:
    number | null,
) {
  const scale =
    MARKET_SCALE[market];

  const strength =
    clamp(
      Math.abs(
        difference,
      ) / scale,
      0,
      1,
    );

  const historyStrength =
    clamp(
      historyGamesCount / 12,
      0,
      1,
    );

  const bookStrength =
    clamp(
      sportsbookCount / 5,
      0,
      1,
    );

  let score =
    45 +
    strength * 35 +
    historyStrength * 10 +
    bookStrength * 10;

  /*
    If the market itself heavily prices the same side,
    give a small boost.

    This is deliberately small so RDG does not simply copy
    the sportsbook.
  */

  if (
    marketProbability !== null
  ) {
    if (
      marketProbability >= 55
    ) {
      score += 3;
    } else if (
      marketProbability < 48
    ) {
      score -= 3;
    }
  }

  return round(
    clamp(
      score,
      0,
      99,
    ),
    1,
  );
}

function analyzeOverUnder(
  market: Exclude<
    CoreMarket,
    "player_anytime_td"
  >,

  projection: any,

  line: number,

  lines: SportsbookLine[],
) {
  const difference =
    projection.projection -
    line;

  const rawSide:
    "OVER" |
    "UNDER" =
      difference >= 0
        ? "OVER"
        : "UNDER";

  const marketData =
    noVig(
      lines,
      line,
      rawSide,
    );

  const threshold =
    PASS_THRESHOLD[
      market
    ];

  const historyCount =
    Number(
      projection
        ?.total_history_games ??
      0,
    );

  const confidence =
    confidenceScore(
      market,
      difference,
      historyCount,
      new Set(
        lines.map(
          (item) =>
            item.sportsbook,
        ),
      ).size,
      marketData.probability,
    );

  /*
    PASS protects us from forcing tiny model/line differences
    into parlays.
  */

  let pick:
    "OVER" |
    "UNDER" |
    "PASS" =
      rawSide;

  if (
    Math.abs(
      difference,
    ) < threshold
  ) {
    pick = "PASS";
  }

  if (
    historyCount < 3
  ) {
    pick = "PASS";
  }

  return {
    pick,

    directional_pick:
      rawSide,

    difference:
      round(
        difference,
        2,
      ),

    confidence:
      pick === "PASS"
        ? Math.min(
            confidence,
            59,
          )
        : confidence,

    market_no_vig_probability:
      marketData.probability,

    paired_market_books:
      marketData.paired_books,
  };
}

/*
  ============================================================
  MARKET LABELS
  ============================================================
*/

function marketLabel(
  market: CoreMarket,
) {
  switch (market) {
    case "player_pass_yds":
      return "PASSING YARDS";

    case "player_pass_tds":
      return "PASSING TDS";

    case "player_rush_yds":
      return "RUSHING YARDS";

    case "player_reception_yds":
      return "RECEIVING YARDS";

    case "player_receptions":
      return "RECEPTIONS";

    case "player_anytime_td":
      return "ANYTIME TD";
  }
}

function projectionForMarket(
  market: CoreMarket,
  player: PlayerHistory,
) {
  switch (market) {
    case "player_pass_yds":
      return projectPassingYardsV2(
        player,
      );

    case "player_pass_tds":
      return projectPassingTDs(
        player,
      );

    case "player_rush_yds":
      return projectRushingYards(
        player,
      );

    case "player_reception_yds":
      return projectReceivingYards(
        player,
      );

    case "player_receptions":
      return projectReceptions(
        player,
      );

    case "player_anytime_td":
      return projectAnytimeTD(
        player,
      );
  }
}

/*
  ============================================================
  MAIN ROUTE
  ============================================================
*/

export async function GET() {
  const apiKey =
    process.env.ODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,

        version:
          VERSION,

        error:
          "ODDS_API_KEY is missing.",
      },
      {
        status: 500,
      },
    );
  }

  try {
    /*
      Load player history + upcoming NFL events.
    */

    const [
      currentRows,
      priorRows,
      eventResult,
    ] =
      await Promise.all([
        fetchCSV(
          CURRENT_STATS_URL,
        ),

        fetchCSV(
          PRIOR_STATS_URL,
        ),

        oddsFetch(
          `${ODDS_API_BASE}/sports/${ODDS_API_SPORT}/events?dateFormat=iso`,
          apiKey,
          CACHE_SECONDS,
        ),
      ]);

    const events:
      OddsEvent[] =
        (
          Array.isArray(
            eventResult.data,
          )
            ? eventResult.data
            : []
        )
          .filter(
            (
              event:
                OddsEvent,
            ) => {
              const time =
                new Date(
                  String(
                    event
                      .commence_time ??
                      "",
                  ),
                ).getTime();

              return (
                Number.isFinite(
                  time,
                ) &&
                time >
                  Date.now()
              );
            },
          )
          .sort(
            (a, b) =>
              new Date(
                String(
                  a.commence_time,
                ),
              ).getTime() -
              new Date(
                String(
                  b.commence_time,
                ),
              ).getTime(),
          );

    /*
      Build historical player database.
    */

    const currentGames =
      playerGames(
        currentRows,
        CURRENT_SEASON,
      );

    const priorGames =
      playerGames(
        priorRows,
        PRIOR_SEASON,
      );

    const history =
      buildPlayerHistory(
        currentGames,
        priorGames,
      );

    /*
      Request all six markets for every upcoming event.
    */

    const markets =
      CORE_MARKETS.join(",");

    const results =
      await Promise.all(
        events.map(
          async (
            event,
          ) => {
            try {
              const result =
                await oddsFetch(
                  `${ODDS_API_BASE}/sports/${ODDS_API_SPORT}/events/${encodeURIComponent(event.id)}/odds?regions=us&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`,
                  apiKey,
                  CACHE_SECONDS,
                );

              return {
                event,

                data:
                  result.data,

                usage:
                  result.usage,

                error:
                  null,
              };
            } catch (
              error
            ) {
              return {
                event,

                data:
                  null,

                usage:
                  null,

                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown Odds API error",
              };
            }
          },
        ),
      );

    const props:
      any[] = [];

    const marketCounts:
      Record<
        string,
        number
      > = {};

    let matchedPlayers = 0;
    let unmatchedPlayers = 0;
    let providerErrors = 0;

    /*
      ========================================================
      ANALYZE EVERY EVENT / MARKET / PLAYER
      ========================================================
    */

    for (
      const result
      of results
    ) {
      if (
        result.error ||
        !result.data
      ) {
        providerErrors++;
        continue;
      }

      for (
        const market
        of CORE_MARKETS
      ) {
        const players =
          marketPlayers(
            result.data,
            market,
          );

        marketCounts[
          market
        ] =
          (
            marketCounts[
              market
            ] ?? 0
          ) +
          players.length;

        for (
          const providerName
          of players
        ) {
          const player =
            history.get(
              normalizeName(
                providerName,
              ),
            );

          if (!player) {
            unmatchedPlayers++;
            continue;
          }

          const projection =
            projectionForMarket(
              market,
              player,
            );

          if (!projection) {
            continue;
          }

          /*
            ================================================
            ANYTIME TD
            ================================================
          */

          if (
            market ===
            "player_anytime_td"
          ) {
            const tdLines =
              anytimeTDLines(
                result.data,
                providerName,
              );

            if (
              !tdLines.length
            ) {
              continue;
            }

            matchedPlayers++;

            const impliedValues =
              tdLines
                .map(
                  (line) =>
                    impliedProbability(
                      line.odds,
                    ),
                )
                .filter(
                  (
                    value,
                  ): value is number =>
                    value !== null,
                );

            const marketImplied =
              impliedValues.length
                ? (
                    impliedValues.reduce(
                      (
                        sum,
                        value,
                      ) =>
                        sum +
                        value,
                      0,
                    ) /
                    impliedValues.length
                  ) *
                  100
                : null;

            const rdgTD =
              Number(
                projection.projection,
              );

            const tdEdge =
              marketImplied === null
                ? null
                : rdgTD -
                  marketImplied;

            let pick:
              "YES" |
              "PASS" =
                "PASS";

            /*
              Require RDG scoring rate to clear both:
              - minimum historical TD rate
              - market-implied probability by a useful margin
            */

            if (
              marketImplied !==
                null &&
              rdgTD >= 35 &&
              tdEdge >= 5
            ) {
              pick = "YES";
            }

            let confidence =
              45;

            if (
              tdEdge !== null
            ) {
              confidence +=
                clamp(
                  tdEdge,
                  0,
                  20,
                ) *
                1.5;
            }

            confidence +=
              clamp(
                (
                  projection
                    .total_history_games ??
                  0
                ) / 12,
                0,
                1,
              ) * 10;

            confidence +=
              clamp(
                tdLines.length /
                  5,
                0,
                1,
              ) * 10;

            confidence =
              round(
                clamp(
                  confidence,
                  0,
                  99,
                ),
                1,
              );

            if (
              pick === "PASS"
            ) {
              confidence =
                Math.min(
                  confidence,
                  59,
                );
            }

            props.push({
              event_id:
                result.event.id,

              start_time:
                result.event
                  .commence_time ??
                null,

              matchup: {
                away:
                  result.event
                    .away_team ??
                  null,

                home:
                  result.event
                    .home_team ??
                  null,
              },

              player_id:
                player.player_id ||
                null,

              player_name:
                player.player_name ||
                providerName,

              position:
                player.position ||
                null,

              market:
                marketLabel(
                  market,
                ),

              provider_market:
                market,

              sportsbook_line:
                null,

              sportsbook_implied_probability:
                marketImplied ===
                null
                  ? null
                  : round(
                      marketImplied,
                      2,
                    ),

              rdg_projection:
                rdgTD,

              edge:
                tdEdge === null
                  ? null
                  : round(
                      tdEdge,
                      2,
                    ),

              pick,

              confidence,

              confidence_type:
                "RDG ranking score - not validated win probability",

              projection_details:
                projection,

              sportsbook_lines:
                tdLines,
            });

            continue;
          }

          /*
            ================================================
            OVER / UNDER MARKETS
            ================================================
          */

          const lines =
            oddsLines(
              result.data,
              market,
              providerName,
            );

          if (
            !lines.length
          ) {
            continue;
          }

          const line =
            consensusLine(
              lines,
            );

          if (
            line === null
          ) {
            continue;
          }

          matchedPlayers++;

          const analysis =
            analyzeOverUnder(
              market,
              projection,
              line,
              lines,
            );

          props.push({
            event_id:
              result.event.id,

            start_time:
              result.event
                .commence_time ??
              null,

            matchup: {
              away:
                result.event
                  .away_team ??
                null,

              home:
                result.event
                  .home_team ??
                null,
            },

            player_id:
              player.player_id ||
              null,

            player_name:
              player.player_name ||
              providerName,

            position:
              player.position ||
              null,

            market:
              marketLabel(
                market,
              ),

            provider_market:
              market,

            sportsbook_line:
              round(
                line,
                2,
              ),

            rdg_projection:
              projection.projection,

            difference:
              analysis.difference,

            pick:
              analysis.pick,

            directional_pick:
              analysis.directional_pick,

            confidence:
              analysis.confidence,

            confidence_type:
              "RDG ranking score - not validated win probability",

            market_no_vig_probability:
              analysis.market_no_vig_probability,

            projection_details:
              projection,

            paired_market_books:
              analysis.paired_market_books,

            sportsbook_lines:
              lines,
          });
        }
      }
    }

    /*
      ========================================================
      SORTING

      Highest confidence usable plays first.

      PASS automatically goes below actionable plays.
      ========================================================
    */

    props.sort(
      (a, b) => {
        const aPass =
          a.pick ===
          "PASS";

        const bPass =
          b.pick ===
          "PASS";

        if (
          aPass !== bPass
        ) {
          return aPass
            ? 1
            : -1;
        }

        return (
          Number(
            b.confidence ??
            0,
          ) -
          Number(
            a.confidence ??
            0,
          )
        );
      },
    );

    /*
      Parlay builder can consume this array directly.

      No redundant YES/NO "eligible" field.

      It simply receives the strongest non-PASS plays.
    */

    const parlayPool =
      props
        .filter(
          (prop) =>
            prop.pick !==
            "PASS",
        )
        .sort(
          (a, b) =>
            Number(
              b.confidence ??
              0,
            ) -
            Number(
              a.confidence ??
              0,
            ),
        );

    const usage =
      [...results]
        .reverse()
        .find(
          (item) =>
            item.usage,
        )
        ?.usage ??
      eventResult.usage;

    return NextResponse.json(
      {
        success: true,

        version:
          VERSION,

        sport:
          "NFL",

        provider:
          "The Odds API",

        architecture: {
          centralized:
            true,

          route:
            "/api/nfl-player-props",

          sportsbook_source:
            "The Odds API",

          historical_stats_source:
            "nflverse",

          markets:
            CORE_MARKETS,

          workflow:
            "Sportsbook line -> RDG projection -> edge -> OVER/UNDER/YES/PASS -> RDG confidence -> parlay pool",
        },

        model_status: {
          passing_yards:
            "Frozen RDG Passing V2",

          rushing_yards:
            "RDG role-aware historical projection",

          receiving_yards:
            "RDG historical projection",

          receptions:
            "RDG historical projection",

          passing_tds:
            "RDG historical projection",

          anytime_td:
            "RDG historical scoring-rate projection",

          confidence:
            "Ranking score only. Not a claimed historical win probability.",
        },

        api_usage: {
          credits_used:
            usage?.used ??
            null,

          credits_remaining:
            usage?.remaining ??
            null,

          last_request_cost:
            usage?.last ??
            null,
        },

        sportsbook_events_found:
          events.length,

        provider_event_errors:
          providerErrors,

        players_matched:
          matchedPlayers,

        players_unmatched:
          unmatchedPlayers,

        market_player_counts:
          marketCounts,

        total_props_analyzed:
          props.length,

        actionable_props:
          parlayPool.length,

        pass_count:
          props.filter(
            (prop) =>
              prop.pick ===
              "PASS",
          ).length,

        /*
          This is what the future parlay builder should use.
        */

        parlay_pool:
          parlayPool,

        /*
          Full analysis including PASS.
        */

        props,

        updated_at:
          new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=900, stale-while-revalidate=1800",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        version:
          VERSION,

        provider:
          "The Odds API",

        error:
          error instanceof Error
            ? error.message
            : "Unknown centralized NFL player props error",
      },
      {
        status: 500,
      },
    );
  }
}
