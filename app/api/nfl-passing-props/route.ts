import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const CURRENT_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${CURRENT_SEASON}.csv`;

const PRIOR_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${PRIOR_SEASON}.csv`;

const SGO_URL =
  "https://api.sportsgameodds.com/v2/events";

type Row = Record<string, string>;

type PlayerGame = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  team: string;
  attempts: number;
  completions: number;
  yards: number;
};

type PlayerHistory = {
  player_name: string;
  player_id: string;
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

type CalibrationPoint = {
  difference: number;
  over: number;
  under: number;
};

/*
  Frozen 2025 out-of-sample V2 residual calibration.

  These are MODEL-IMPLIED probabilities.

  They are NOT historical sportsbook betting win rates.
*/
const CALIBRATION: CalibrationPoint[] = [
  { difference: -50, over: 21.1, under: 78.9 },
  { difference: -40, over: 25.7, under: 74.3 },
  { difference: -30, over: 31.1, under: 68.9 },
  { difference: -25, over: 33.8, under: 66.2 },
  { difference: -20, over: 36.0, under: 64.0 },
  { difference: -15, over: 40.4, under: 59.6 },
  { difference: -10, over: 42.4, under: 57.6 },
  { difference: -5, over: 45.1, under: 54.9 },
  { difference: 0, over: 47.4, under: 52.6 },
  { difference: 5, over: 50.5, under: 49.5 },
  { difference: 10, over: 52.8, under: 47.2 },
  { difference: 15, over: 55.1, under: 44.9 },
  { difference: 20, over: 58.4, under: 41.6 },
  { difference: 25, over: 60.2, under: 39.8 },
  { difference: 30, over: 61.9, under: 38.1 },
  { difference: 40, over: 66.9, under: 33.1 },
  { difference: 50, over: 71.0, under: 29.0 },
];

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(
  value: number,
  digits = 1
): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(
  values: number[]
): number | null {
  if (!values.length) return null;

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function weightedAverage(
  values: Array<{
    value: number;
    weight: number;
  }>
): number | null {
  const valid = values.filter(
    (item) =>
      Number.isFinite(item.value) &&
      Number.isFinite(item.weight) &&
      item.weight > 0
  );

  if (!valid.length) return null;

  const totalWeight =
    valid.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, item) =>
        sum +
        item.value *
          item.weight,
      0
    ) / totalWeight
  );
}

function normalizeName(
  name: string
): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(
      /\b(jr|sr|ii|iii|iv)\b/g,
      ""
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function playerNameFromId(
  playerID: string
): string {
  return String(playerID ?? "")
    .replace(
      /_\d+_NFL$/i,
      ""
    )
    .split("_")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1).toLowerCase()
    )
    .join(" ");
}

function parseCSVLine(
  line: string
): string[] {
  const result: string[] = [];

  let current = "";
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
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

function parseCSV(
  text: string
): Row[] {
  const lines =
    text
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim().length > 0
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
        }
      );

      return row;
    });
}

async function fetchCSV(
  url: string
): Promise<Row[]> {
  const response =
    await fetch(url, {
      cache: "no-store",
    });

  if (!response.ok) {
    throw new Error(
      `nflverse returned ${response.status} for ${url}`
    );
  }

  return parseCSV(
    await response.text()
  );
}

function passingGames(
  rows: Row[],
  season: number
): PlayerGame[] {
  return rows
    .filter(
      (row) =>
        num(row.season) ===
          season &&
        String(
          row.season_type
        ).toUpperCase() ===
          "REG" &&
        String(
          row.position
        ).toUpperCase() ===
          "QB" &&
        num(row.attempts) >= 10
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

      attempts:
        num(row.attempts),

      completions:
        num(row.completions),

      yards:
        num(row.passing_yards),
    }))
    .sort(
      (a, b) =>
        a.season -
          b.season ||
        a.week -
          b.week
    );
}

function buildPlayerHistory(
  currentGames: PlayerGame[],
  priorGames: PlayerGame[]
): Map<
  string,
  PlayerHistory
> {
  const map =
    new Map<
      string,
      PlayerHistory
    >();

  for (
    const game
    of [
      ...priorGames,
      ...currentGames,
    ]
  ) {
    const key =
      normalizeName(
        game.player_name
      );

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        player_name:
          game.player_name,

        player_id:
          game.player_id,

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
      player.current.push(
        game
      );
    } else {
      player.prior.push(
        game
      );
    }
  }

  for (
    const player
    of map.values()
  ) {
    player.current.sort(
      (a, b) =>
        a.week - b.week
    );

    player.prior.sort(
      (a, b) =>
        a.week - b.week
    );
  }

  return map;
}

function yardsPerAttempt(
  game: PlayerGame
): number {
  if (
    game.attempts <= 0
  ) {
    return 0;
  }

  return (
    game.yards /
    game.attempts
  );
}

function recencyWeighted(
  games: PlayerGame[],
  selector: (
    game: PlayerGame
  ) => number,
  maxGames = 8
): number | null {
  const selected =
    games.slice(
      -maxGames
    );

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
      })
    )
  );
}

/*
  FROZEN RDG V2 PASSING MODEL
*/
function projectPassingYardsV2(
  player: PlayerHistory
) {
  const history:
    PlayerGame[] = [
      ...player.prior,
      ...player.current,
    ].sort(
      (a, b) =>
        a.season -
          b.season ||
        a.week -
          b.week
    );

  if (
    history.length < 3
  ) {
    return null;
  }

  const current =
    player.current;

  const prior =
    player.prior.slice(
      -17
    );

  const careerWindow =
    history.slice(-20);

  const priorAttempts =
    average(
      prior.map(
        (game) =>
          game.attempts
      )
    );

  const currentAttempts =
    average(
      current.map(
        (game) =>
          game.attempts
      )
    );

  const recentAttempts =
    recencyWeighted(
      careerWindow,
      (game) =>
        game.attempts,
      8
    );

  let currentWeight = 0;

  if (
    current.length === 1
  ) {
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
        (1 -
          currentWeight) +
      currentAttempts *
        currentWeight;
  } else {
    expectedAttempts =
      currentAttempts ??
      priorAttempts ??
      recentAttempts;
  }

  if (
    expectedAttempts !==
      null &&
    recentAttempts !== null
  ) {
    expectedAttempts =
      expectedAttempts *
        0.8 +
      recentAttempts *
        0.2;
  }

  const priorYPA =
    average(
      prior.map(
        yardsPerAttempt
      )
    );

  const currentYPA =
    average(
      current.map(
        yardsPerAttempt
      )
    );

  const recentYPA =
    recencyWeighted(
      careerWindow,
      yardsPerAttempt,
      8
    );

  let efficiencyWeight =
    0;

  if (
    current.length === 1
  ) {
    efficiencyWeight =
      0.1;
  } else if (
    current.length === 2
  ) {
    efficiencyWeight =
      0.18;
  } else if (
    current.length === 3
  ) {
    efficiencyWeight =
      0.25;
  } else if (
    current.length === 4
  ) {
    efficiencyWeight =
      0.32;
  } else if (
    current.length >= 5
  ) {
    efficiencyWeight =
      0.4;
  }

  let expectedYPA:
    number | null = null;

  if (
    priorYPA !== null &&
    currentYPA !== null
  ) {
    expectedYPA =
      priorYPA *
        (1 -
          efficiencyWeight) +
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
      expectedYPA *
        0.85 +
      recentYPA *
        0.15;
  }

  if (
    expectedAttempts ===
      null ||
    expectedYPA === null
  ) {
    return null;
  }

  expectedAttempts =
    Math.min(
      45,
      Math.max(
        20,
        expectedAttempts
      )
    );

  expectedYPA =
    Math.min(
      9.5,
      Math.max(
        5,
        expectedYPA
      )
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
      projection *
        0.65 +
      225 * 0.35;
  } else if (
    totalHistory <= 10
  ) {
    projection =
      projection *
        0.8 +
      225 * 0.2;
  }

  return {
    projection:
      round(
        projection,
        1
      ),

    expected_attempts:
      round(
        expectedAttempts,
        1
      ),

    expected_yards_per_attempt:
      round(
        expectedYPA,
        2
      ),

    current_games:
      current.length,

    prior_games:
      prior.length,

    total_history_games:
      totalHistory,

    current_season_yards_average:
      current.length
        ? round(
            average(
              current.map(
                (game) =>
                  game.yards
              )
            ) ?? 0,
            1
          )
        : null,

    prior_season_yards_average:
      prior.length
        ? round(
            average(
              prior.map(
                (game) =>
                  game.yards
              )
            ) ?? 0,
            1
          )
        : null,
  };
}

function getEventStart(
  event: any
): string | null {
  return (
    event?.status
      ?.startsAt ??
    event?.startsAt ??
    event?.startTime ??
    event?.startDate ??
    null
  );
}

function isPregame(
  event: any
): boolean {
  if (
    event?.status
      ?.started === true
  ) {
    return false;
  }

  if (
    event?.status
      ?.completed === true
  ) {
    return false;
  }

  if (
    event?.status
      ?.ended === true
  ) {
    return false;
  }

  const start =
    getEventStart(event);

  if (!start) {
    return true;
  }

  const timestamp =
    new Date(
      start
    ).getTime();

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return true;
  }

  return (
    timestamp >
    Date.now()
  );
}

function extractPassingProps(
  event: any
): any[] {
  const odds: any[] =
    event?.odds &&
    typeof event.odds ===
      "object"
      ? (Object.values(
          event.odds
        ) as any[])
      : [];

  return odds.filter(
    (odd: any) =>
      odd?.statID ===
        "passing_yards" &&
      odd?.betTypeID ===
        "ou" &&
      (!odd?.periodID ||
        odd?.periodID ===
          "game") &&
      Boolean(
        odd?.playerID
      )
  );
}

function sportsbookLines(
  odd: any
): SportsbookLine[] {
  const books:
    Record<
      string,
      any
    > =
    odd?.byBookmaker &&
    typeof odd.byBookmaker ===
      "object"
      ? odd.byBookmaker
      : {};

  const lines:
    SportsbookLine[] =
    [];

  for (
    const [
      book,
      data,
    ]
    of Object.entries(
      books
    )
  ) {
    const line =
      Number(
        data?.overUnder
      );

    if (
      !Number.isFinite(
        line
      )
    ) {
      continue;
    }

    lines.push({
      sportsbook:
        book,

      side:
        odd?.sideID ??
        null,

      line,

      odds:
        data?.odds ??
        null,

      available:
        data?.available ===
        true,

      updated_at:
        data?.lastUpdatedAt ??
        null,
    });
  }

  return lines;
}

/*
  Pick an ACTUAL sportsbook line.

  First choose the line offered by the
  largest number of books.

  If tied, choose the one closest to
  the median of all available lines.
*/
function consensusActualLine(
  lines: SportsbookLine[]
): number | null {
  const available =
    lines.filter(
      (line) =>
        line.available
    );

  if (!available.length) {
    return null;
  }

  const uniqueBookLine =
    new Map<
      string,
      number
    >();

  for (
    const item
    of available
  ) {
    uniqueBookLine.set(
      `${item.sportsbook}|${item.line}`,
      item.line
    );
  }

  const values =
    Array.from(
      uniqueBookLine.values()
    );

  if (!values.length) {
    return null;
  }

  const counts =
    new Map<
      number,
      number
    >();

  for (
    const value
    of values
  ) {
    counts.set(
      value,
      (counts.get(value) ??
        0) + 1
    );
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  const median =
    sorted.length % 2
      ? sorted[middle]
      : (
          sorted[
            middle - 1
          ] +
          sorted[middle]
        ) / 2;

  let bestLine =
    values[0];

  let bestCount =
    counts.get(
      bestLine
    ) ?? 0;

  for (
    const [
      line,
      count,
    ]
    of counts.entries()
  ) {
    if (
      count > bestCount
    ) {
      bestLine =
        line;

      bestCount =
        count;

      continue;
    }

    if (
      count ===
      bestCount
    ) {
      const currentDistance =
        Math.abs(
          line -
            median
        );

      const bestDistance =
        Math.abs(
          bestLine -
            median
        );

      if (
        currentDistance <
        bestDistance
      ) {
        bestLine =
          line;
      }
    }
  }

  return bestLine;
}

/*
  American odds -> raw implied probability.
*/
function americanImpliedProbability(
  odds:
    | string
    | number
    | null
): number | null {
  if (
    odds === null ||
    odds === undefined
  ) {
    return null;
  }

  const value =
    Number(odds);

  if (
    !Number.isFinite(
      value
    ) ||
    value === 0
  ) {
    return null;
  }

  if (value > 0) {
    return (
      100 /
      (value + 100)
    );
  }

  return (
    Math.abs(value) /
    (
      Math.abs(value) +
      100
    )
  );
}

/*
  Calculate no-vig probability using paired
  OVER and UNDER prices from the same book
  at the same line.
*/
function marketNoVigProbability(
  lines: SportsbookLine[],
  selectedLine: number,
  side: "OVER" | "UNDER"
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
      item.line !==
        selectedLine
    ) {
      continue;
    }

    const sideName =
      String(
        item.side ?? ""
      ).toLowerCase();

    if (
      sideName !==
        "over" &&
      sideName !==
        "under"
    ) {
      continue;
    }

    if (
      !books.has(
        item.sportsbook
      )
    ) {
      books.set(
        item.sportsbook,
        {}
      );
    }

    const pair =
      books.get(
        item.sportsbook
      )!;

    if (
      sideName ===
      "over"
    ) {
      pair.over =
        item;
    } else {
      pair.under =
        item;
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
    ]
    of books.entries()
  ) {
    if (
      !pair.over ||
      !pair.under
    ) {
      continue;
    }

    const overRaw =
      americanImpliedProbability(
        pair.over.odds
      );

    const underRaw =
      americanImpliedProbability(
        pair.under.odds
      );

    if (
      overRaw === null ||
      underRaw === null
    ) {
      continue;
    }

    const total =
      overRaw +
      underRaw;

    if (
      total <= 0
    ) {
      continue;
    }

    const overNoVig =
      overRaw /
      total;

    const underNoVig =
      underRaw /
      total;

    const selected =
      side === "OVER"
        ? overNoVig
        : underNoVig;

    probabilities.push(
      selected
    );

    pairedBooks.push({
      sportsbook,

      line:
        selectedLine,

      over_odds:
        pair.over.odds,

      under_odds:
        pair.under.odds,

      over_no_vig_probability:
        round(
          overNoVig *
            100,
          2
        ),

      under_no_vig_probability:
        round(
          underNoVig *
            100,
          2
        ),
    });
  }

  if (
    !probabilities.length
  ) {
    return {
      probability:
        null,

      paired_books:
        pairedBooks,
    };
  }

  return {
    probability:
      round(
        (
          probabilities.reduce(
            (
              sum,
              value
            ) =>
              sum +
              value,
            0
          ) /
          probabilities.length
        ) * 100,
        2
      ),

    paired_books:
      pairedBooks,
  };
}

/*
  Linear interpolation between empirical
  calibration points.

  We cap differences outside +/-50 yards
  at the edge of the historical table
  rather than extrapolating unsupported
  probabilities.
*/
function calibratedProbability(
  difference: number,
  side:
    | "OVER"
    | "UNDER"
): number {
  const field =
    side === "OVER"
      ? "over"
      : "under";

  if (
    difference <=
    CALIBRATION[0]
      .difference
  ) {
    return CALIBRATION[0][
      field
    ];
  }

  const last =
    CALIBRATION[
      CALIBRATION.length -
        1
    ];

  if (
    difference >=
    last.difference
  ) {
    return last[field];
  }

  for (
    let i = 0;
    i <
    CALIBRATION.length -
      1;
    i++
  ) {
    const lower =
      CALIBRATION[i];

    const upper =
      CALIBRATION[
        i + 1
      ];

    if (
      difference >=
        lower.difference &&
      difference <=
        upper.difference
    ) {
      const range =
        upper.difference -
        lower.difference;

      const position =
        (
          difference -
          lower.difference
        ) / range;

      const probability =
        lower[field] +
        (
          upper[field] -
          lower[field]
        ) *
          position;

      return round(
        probability,
        2
      );
    }
  }

  return 50;
}

export async function GET() {
  const apiKey =
    process.env
      .SPORTSGAMEODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success:
          false,

        error:
          "SPORTSGAMEODDS_API_KEY is missing.",
      },
      {
        status: 500,
      }
    );
  }

  try {
    const [
      currentRows,
      priorRows,
      oddsResponse,
    ] =
      await Promise.all([
        fetchCSV(
          CURRENT_STATS_URL
        ),

        fetchCSV(
          PRIOR_STATS_URL
        ),

        fetch(
          `${SGO_URL}?${new URLSearchParams(
            {
              leagueID:
                "NFL",

              oddsAvailable:
                "true",

              limit:
                "50",
            }
          ).toString()}`,
          {
            headers: {
              "x-api-key":
                apiKey,
            },

            cache:
              "no-store",
          }
        ),
      ]);

    if (
      !oddsResponse.ok
    ) {
      return NextResponse.json(
        {
          success:
            false,

          provider:
            "SportsGameOdds",

          status:
            oddsResponse.status,

          error:
            await oddsResponse.text(),
        },
        {
          status:
            oddsResponse.status,
        }
      );
    }

    const oddsData: any =
      await oddsResponse.json();

    const events:
      any[] =
      Array.isArray(
        oddsData?.data
      )
        ? oddsData.data
        : Array.isArray(
              oddsData?.events
            )
          ? oddsData.events
          : [];

    const currentGames =
      passingGames(
        currentRows,
        CURRENT_SEASON
      );

    const priorGames =
      passingGames(
        priorRows,
        PRIOR_SEASON
      );

    const history =
      buildPlayerHistory(
        currentGames,
        priorGames
      );

    const props:
      any[] = [];

    let matchedPlayers =
      0;

    let unmatchedPlayers =
      0;

    let pregameEvents =
      0;

    for (
      const event
      of events
    ) {
      if (
        !isPregame(
          event
        )
      ) {
        continue;
      }

      pregameEvents++;

      const passingProps =
        extractPassingProps(
          event
        );

      const grouped =
        new Map<
          string,
          any[]
        >();

      for (
        const odd
        of passingProps
      ) {
        const playerID =
          String(
            odd?.playerID ??
              ""
          );

        if (!playerID) {
          continue;
        }

        if (
          !grouped.has(
            playerID
          )
        ) {
          grouped.set(
            playerID,
            []
          );
        }

        grouped
          .get(
            playerID
          )!
          .push(odd);
      }

      for (
        const [
          playerID,
          playerOdds,
        ]
        of grouped.entries()
      ) {
        const sample =
          playerOdds[0];

        const marketName =
          String(
            sample?.marketName ??
              ""
          );

        const providerName =
          marketName
            .replace(
              / Passing Yards Over\/Under/i,
              ""
            )
            .replace(
              / Passing Yards/i,
              ""
            )
            .trim() ||
          playerNameFromId(
            playerID
          );

        const key =
          normalizeName(
            providerName
          );

        const player =
          history.get(key);

        if (!player) {
          unmatchedPlayers++;
          continue;
        }

        const projection =
          projectPassingYardsV2(
            player
          );

        if (!projection) {
          continue;
        }

        matchedPlayers++;

        const allBookLines =
          playerOdds.flatMap(
            (odd: any) =>
              sportsbookLines(
                odd
              )
          );

        const availableLines =
          allBookLines.filter(
            (line) =>
              line.available
          );

        const marketLine =
          consensusActualLine(
            availableLines
          );

        if (
          marketLine ===
          null
        ) {
          continue;
        }

        const difference =
          projection.projection -
          marketLine;

        const modelSide:
          | "OVER"
          | "UNDER" =
          difference >= 0
            ? "OVER"
            : "UNDER";

        const modelProbability =
          calibratedProbability(
            difference,
            modelSide
          );

        const market =
          marketNoVigProbability(
            availableLines,
            marketLine,
            modelSide
          );

        const marketProbability =
          market.probability;

        const probabilityEdge =
          marketProbability !==
          null
            ? round(
                modelProbability -
                  marketProbability,
                2
              )
            : null;

        const absDifference =
          Math.abs(
            difference
          );

        let review =
          "PASS";

        /*
          Review labels now require BOTH
          yardage separation and probability
          information when market probability
          is available.

          These are model-review categories,
          not guaranteed betting tiers.
        */
        if (
          probabilityEdge !==
            null &&
          probabilityEdge >=
            8 &&
          absDifference >=
            20
        ) {
          review =
            "STRONG REVIEW";
        } else if (
          probabilityEdge !==
            null &&
          probabilityEdge >=
            5 &&
          absDifference >=
            12
        ) {
          review =
            "REVIEW";
        } else if (
          probabilityEdge !==
            null &&
          probabilityEdge >=
            2 &&
          absDifference >=
            8
        ) {
          review =
            "WATCH";
        } else if (
          marketProbability ===
            null
        ) {
          if (
            absDifference >=
            20
          ) {
            review =
              "REVIEW";
          } else if (
            absDifference >=
            10
          ) {
            review =
              "WATCH";
          }
        }

        /*
          Sample-size caution.
        */
        if (
          projection.total_history_games <
            11 &&
          review ===
            "STRONG REVIEW"
        ) {
          review =
            "REVIEW";
        }

        if (
          projection.total_history_games <
            6 &&
          review ===
            "REVIEW"
        ) {
          review =
            "WATCH";
        }

        props.push({
          event_id:
            event?.eventID ??
            event?.id ??
            null,

          start_time:
            getEventStart(
              event
            ),

          matchup: {
            away:
              event?.teams
                ?.away
                ?.names
                ?.short ??
              event?.teams
                ?.away
                ?.names
                ?.long ??
              null,

            home:
              event?.teams
                ?.home
                ?.names
                ?.short ??
              event?.teams
                ?.home
                ?.names
                ?.long ??
              null,
          },

          player_id:
            playerID,

          player_name:
            player.player_name ||
            providerName,

          market:
            "PASSING YARDS",

          selection:
            modelSide,

          market_line:
            round(
              marketLine,
              1
            ),

          rdg_projection:
            projection.projection,

          model_vs_line_yards:
            round(
              difference,
              1
            ),

          model_probability:
            modelProbability,

          market_no_vig_probability:
            marketProbability,

          model_vs_market_probability:
            probabilityEdge,

          review,

          projection_details: {
            expected_attempts:
              projection.expected_attempts,

            expected_yards_per_attempt:
              projection.expected_yards_per_attempt,

            current_games:
              projection.current_games,

            prior_games:
              projection.prior_games,

            total_history_games:
              projection.total_history_games,

            current_season_yards_average:
              projection.current_season_yards_average,

            prior_season_yards_average:
              projection.prior_season_yards_average,
          },

          paired_market_books:
            market.paired_books,

          sportsbook_lines:
            availableLines,

          probability_note:
            "Model probability comes from the empirical 2025 out-of-sample V2 residual distribution. Market probability removes vig from paired over/under prices at the selected consensus sportsbook line.",

          important:
            "Model-vs-market is a probability-model comparison, not a historical sportsbook betting backtest or proof of positive expected value.",
        });
      }
    }

    props.sort(
      (a, b) => {
        const aEdge =
          a.model_vs_market_probability ??
          -999;

        const bEdge =
          b.model_vs_market_probability ??
          -999;

        return (
          bEdge -
          aEdge
        );
      }
    );

    return NextResponse.json({
      success: true,

      version:
        "3.0-rdg-passing-probability",

      sport:
        "NFL",

      market:
        "passing_yards",

      model_status:
        "Frozen V2 + Historical Residual Calibration",

      validation: {
        development_test_2025: {
          games: 517,

          mae: 59.6,

          rmse: 75.07,

          mean_error:
            -5.4,
        },

        untouched_2026_validation: {
          games: 48,

          rdg_v2_mae:
            57.27,

          rdg_v2_rmse:
            71.51,

          simple_baseline_mae:
            60.06,

          note:
            "2026 validation remains a small sample and is not used to tune model weights.",
        },
      },

      probability_calibration: {
        observations:
          517,

        season:
          2025,

        method:
          "Empirical out-of-sample V2 residual distribution with linear interpolation between observed calibration thresholds.",

        residual_mean:
          -5.4,

        residual_sd:
          74.95,

        important:
          "Historical sportsbook prop lines were not available. These probabilities describe the historical V2 residual distribution relative to hypothetical lines, not historical betting results.",
      },

      methodology: {
        stats_source:
          "nflverse",

        market_source:
          "SportsGameOdds",

        projection_model:
          "Frozen RDG V2",

        model_probability:
          "Empirical historical V2 residual calibration.",

        market_probability:
          "Average no-vig probability from sportsbooks offering paired over and under prices at the selected actual consensus line.",

        comparison:
          "Model probability minus no-vig market probability, expressed in percentage points.",
      },

      current_player_games:
        currentGames.length,

      prior_player_games:
        priorGames.length,

      sportsbook_events_found:
        events.length,

      pregame_events_found:
        pregameEvents,

      matched_prop_players:
        matchedPlayers,

      unmatched_prop_players:
        unmatchedPlayers,

      qualifying_reviews:
        props.filter(
          (prop) =>
            prop.review !==
            "PASS"
        ).length,

      props,

      updated_at:
        new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown NFL passing props error",
      },
      {
        status: 500,
      }
    );
  }
}
