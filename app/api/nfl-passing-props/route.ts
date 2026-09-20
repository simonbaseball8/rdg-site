import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const CURRENT_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${CURRENT_SEASON}.csv`;

const PRIOR_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${PRIOR_SEASON}.csv`;

const SGO_URL = "https://api.sportsgameodds.com/v2/events";

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

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (!values.length) return null;

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
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

  const totalWeight = valid.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, item) =>
        sum + item.value * item.weight,
      0
    ) / totalWeight
  );
}

function normalizeName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function playerNameFromId(playerID: string): string {
  return String(playerID ?? "")
    .replace(/_\d+_NFL$/i, "")
    .split("_")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1).toLowerCase()
    )
    .join(" ");
}

function parseCSVLine(line: string): string[] {
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

function parseCSV(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return row;
  });
}

async function fetchCSV(url: string): Promise<Row[]> {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `nflverse returned ${response.status} for ${url}`
    );
  }

  return parseCSV(await response.text());
}

function passingGames(
  rows: Row[],
  season: number
): PlayerGame[] {
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
        a.season - b.season ||
        a.week - b.week
    );
}

function buildPlayerHistory(
  currentGames: PlayerGame[],
  priorGames: PlayerGame[]
): Map<string, PlayerHistory> {
  const map =
    new Map<string, PlayerHistory>();

  for (const game of [
    ...priorGames,
    ...currentGames,
  ]) {
    const key =
      normalizeName(game.player_name);

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
      player.current.push(game);
    } else {
      player.prior.push(game);
    }
  }

  for (const player of map.values()) {
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
  if (game.attempts <= 0) {
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
      })
    )
  );
}

/*
  FROZEN RDG V2 PASSING MODEL

  Validated results:

  2025 held-out:
  MAE 59.60

  2026 untouched validation:
  MAE 57.27

  Simple baseline on same 2026 sample:
  MAE 60.06

  The model projects:

  expected passing attempts
             ×
  expected yards per attempt

  It also applies conservative early-season
  shrinkage for small samples.
*/
function projectPassingYardsV2(
  player: PlayerHistory
) {
  const history: PlayerGame[] = [
    ...player.prior,
    ...player.current,
  ].sort(
    (a, b) =>
      a.season - b.season ||
      a.week - b.week
  );

  if (history.length < 3) {
    return null;
  }

  const current =
    player.current;

  const prior =
    player.prior.slice(-17);

  const careerWindow =
    history.slice(-20);

  /*
    PASSING ATTEMPTS
  */

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
    | number
    | null = null;

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

  /*
    YARDS PER ATTEMPT
  */

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
    | number
    | null = null;

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

  /*
    Guardrails validated in V2.
  */

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

  /*
    Small-sample shrinkage.
  */

  const totalHistory =
    history.length;

  const LEAGUE_BASELINE =
    225;

  if (
    totalHistory <= 5
  ) {
    projection =
      projection * 0.65 +
      LEAGUE_BASELINE *
        0.35;
  } else if (
    totalHistory <= 10
  ) {
    projection =
      projection * 0.8 +
      LEAGUE_BASELINE *
        0.2;
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

    current_attempts_average:
      currentAttempts !== null
        ? round(
            currentAttempts,
            1
          )
        : null,

    prior_attempts_average:
      priorAttempts !== null
        ? round(
            priorAttempts,
            1
          )
        : null,

    current_ypa:
      currentYPA !== null
        ? round(
            currentYPA,
            2
          )
        : null,

    prior_ypa:
      priorYPA !== null
        ? round(
            priorYPA,
            2
          )
        : null,
  };
}

function getEventStart(
  event: any
): string | null {
  return (
    event?.status?.startsAt ??
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
    event?.status?.started === true
  ) {
    return false;
  }

  if (
    event?.status?.completed === true
  ) {
    return false;
  }

  if (
    event?.status?.ended === true
  ) {
    return false;
  }

  const start =
    getEventStart(event);

  if (!start) {
    return true;
  }

  const timestamp =
    new Date(start).getTime();

  if (
    !Number.isFinite(timestamp)
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
  const books: Record<
    string,
    any
  > =
    odd?.byBookmaker &&
    typeof odd.byBookmaker ===
      "object"
      ? (odd.byBookmaker as Record<
          string,
          any
        >)
      : {};

  const lines:
    SportsbookLine[] = [];

  for (
    const [book, data]
    of Object.entries(books)
  ) {
    const rawLine =
      data?.overUnder;

    const line =
      Number(rawLine);

    if (
      !Number.isFinite(line)
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

function median(
  values: number[]
): number | null {
  if (!values.length) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2
  ) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}

export async function GET() {
  const apiKey =
    process.env
      .SPORTSGAMEODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,

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
    ] = await Promise.all([
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

    if (!oddsResponse.ok) {
      const body =
        await oddsResponse.text();

      return NextResponse.json(
        {
          success: false,

          provider:
            "SportsGameOdds",

          status:
            oddsResponse.status,

          error:
            body,
        },
        {
          status:
            oddsResponse.status,
        }
      );
    }

    const oddsData: any =
      await oddsResponse.json();

    const events: any[] =
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

    const props: any[] =
      [];

    let matchedPlayers = 0;
    let unmatchedPlayers = 0;
    let pregameEvents = 0;

    for (
      const event
      of events
    ) {
      if (
        !isPregame(event)
      ) {
        continue;
      }

      pregameEvents++;

      const passingProps:
        any[] =
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
          .get(playerID)!
          .push(odd);
      }

      for (
        const [
          playerID,
          playerOdds,
        ]
        of grouped.entries()
      ) {
        const sample: any =
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

        const allBookLines:
          SportsbookLine[] =
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

        const numericLines =
          availableLines.map(
            (line) =>
              line.line
          );

        /*
          Deduplicate the same line appearing
          on both OVER and UNDER.
        */
        const uniqueLines =
          Array.from(
            new Set(
              numericLines
            )
          );

        const consensusLine =
          median(
            uniqueLines
          );

        if (
          consensusLine === null
        ) {
          continue;
        }

        const difference =
          projection.projection -
          consensusLine;

        let lean:
          | "OVER"
          | "UNDER"
          | "PASS" =
          "PASS";

        /*
          These remain REVIEW thresholds,
          not calibrated betting probabilities.
        */
        if (
          difference >= 8
        ) {
          lean = "OVER";
        } else if (
          difference <= -8
        ) {
          lean = "UNDER";
        }

        const absDifference =
          Math.abs(
            difference
          );

        let review =
          "PASS";

        if (
          absDifference >= 20
        ) {
          review =
            "STRONG REVIEW";
        } else if (
          absDifference >= 12
        ) {
          review =
            "REVIEW";
        } else if (
          absDifference >= 8
        ) {
          review =
            "WATCH";
        }

        /*
          Extra caution for QBs with
          limited historical samples.
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

          consensus_line:
            round(
              consensusLine,
              1
            ),

          rdg_projection:
            projection.projection,

          model_vs_line:
            round(
              difference,
              1
            ),

          lean,

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

            current_attempts_average:
              projection.current_attempts_average,

            prior_attempts_average:
              projection.prior_attempts_average,

            current_ypa:
              projection.current_ypa,

            prior_ypa:
              projection.prior_ypa,
          },

          sportsbook_lines:
            availableLines,

          note:
            "Frozen RDG V2 projection. Model-vs-line is a yardage difference, not a calibrated betting edge or win probability.",
        });
      }
    }

    props.sort(
      (a, b) =>
        Math.abs(
          b.model_vs_line
        ) -
        Math.abs(
          a.model_vs_line
        )
    );

    return NextResponse.json({
      success: true,

      version:
        "2.0-rdg-passing-yards-live",

      sport:
        "NFL",

      market:
        "passing_yards",

      model_status:
        "Frozen V2 Projection Model",

      validation: {
        development_test_2025: {
          games:
            517,

          mae:
            59.6,

          rmse:
            75.07,
        },

        untouched_2026_validation: {
          games:
            48,

          rdg_v2_mae:
            57.27,

          rdg_v2_rmse:
            71.51,

          simple_baseline_mae:
            60.06,

          note:
            "2026 validation sample is still small and should continue to be monitored.",
        },
      },

      methodology: {
        stats_source:
          "nflverse",

        market_source:
          "SportsGameOdds",

        model:
          "Expected passing attempts multiplied by expected yards per attempt, using prior-season history, current-season performance, mild recency weighting and small-sample shrinkage.",

        market_line:
          "Median of currently available sportsbook passing-yard lines.",

        important:
          "No model probability is assigned yet. Model-vs-line represents projected passing yards minus the sportsbook consensus line.",
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
