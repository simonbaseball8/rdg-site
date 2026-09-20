Pasted text(20260919-192416).txt
Document
Pasted text(20260919-192923).txt
Document
Pasted text(20260919-194514).txt
Document
Edit
this is what it looks like. How do we fix the broken image
 this is what it looks like now 
okay but first can we make these changes. Ilike how this is showing RDG top parlay pick and then a blue one next to it 
Edit
Pasted text(20260919-195716).txt
Document
When looking at these bets it seems very unfavorable why is that
I still dont think this is accurate. It is showing all teams to win as unfavoratable on the parlays
Pasted text(20260920-033044).txt
Document
 I still dont think its correct. my parlays are still showing all unfavoratable bets like +300 or +900
This is all still wrong. Why would i make a parlay on all unfavorable teams that doesnt make sense. You should want some actual -120 or favorable picks in this
Pasted text(20260920-042218).txt
Document
Pasted markdown(4).md
File
now hat looks much more reasonable. Now instead of just focusing on money lines and spreads can we mix in total points and player props
Pasted text(20260920-043034).txt
Document
mlb picks whats next
Pasted markdown(5).md
File
Pasted text(20260920-043424).txt
Document
I do not see the over 7.5 or over 8.5 onthe website though. But here is the backtest 
Pasted text(20260920-043728).txt
Document
Why is their a weird blue logo O/U 
Pasted markdown(6).md
File
Pasted text(20260920-050203).txt
Document
Pasted markdown(7).md
File
Pasted markdown(8).md
File
Pasted text(20260920-050820).txt
Document
Pasted text(20260920-211133).txt
Document
Pasted markdown(9).md
File
This is what I see now. When you are making your parlays is it pulling all games for that coming week or just that day
Pasted text(20260920-212042).txt
Document
Pasted markdown(10).md
File
Pasted markdown(20260920-213456).md
File
Pasted markdown(20260920-214002).md
File

Perfect. Replace everything inside:

app/api/nfl-passing-props/route.ts

with this complete version. This moves the live route to the frozen V2 model that scored 57.27 MAE on the untouched 2026 validation sample.

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

Now Commit → Deploy → open /api/nfl-passing-props and send me the result.

We want to confirm it says version: "2.0-rdg-passing-yards-live" and inspect the new V2 projections before we build the probability calibration.

{"success":true,"version":"2.0-rdg-passing-yards-live","sport":"NFL","market":"passing_yards","model_status":"Frozen V2 Projection Model","validation":{"development_test_2025":{"games":517,"mae":59.6,"rmse":75.07},"untouched_2026_validation":{"games":48,"rdg_v2_mae":57.27,"rdg_v2_rmse":71.51,"simple_baseline_mae":60.06,"note":"2026 validation sample is still small and should continue to be monitored."}},"methodology":{"stats_source":"nflverse","market_source":"SportsGameOdds","model":"Expected passing attempts multiplied by expected yards per attempt, using prior-season history, current-season performance, mild recency weighting and small-sample shrinkage.","market_line":"Median of currently available sportsbook passing-yard lines.","important":"No model probability is assigned yet. Model-vs-line represents projected passing yards minus the sportsbook consensus line."},"current_player_games":49,"prior_player_games":561,"sportsbook_events_found":50,"pregame_events_found":44,"matched_prop_players":6,"unmatched_prop_players":0,"qualifying_reviews":4,"props":[{"event_id":"oK0GpQpLxuVia9pfNsOR","start_time":"2026-09-22T00:15:00.000Z","matchup":{"away":"NYG","home":"LA"},"player_id":"JAXSON_DART_1_NFL","player_name":"Jaxson Dart","market":"PASSING YARDS","consensus_line":214,"rdg_projection":188.2,"model_vs_line":-25.8,"lean":"UNDER","review":"STRONG REVIEW","projection_details":{"expected_attempts":28.3,"expected_yards_per_attempt":6.65,"current_games":1,"prior_games":12,"total_history_games":13,"current_season_yards_average":230,"prior_season_yards_average":189.3,"current_attempts_average":29,"prior_attempts_average":28.3,"current_ypa":7.93,"prior_ypa":6.53},"sportsbook_lines":[{"sportsbook":"fanduel","side":"over","line":213.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"caesars","side":"over","line":213.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"betmgm","side":"over","line":213.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:54:41.799Z"},{"sportsbook":"espnbet","side":"over","line":214.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"fanduel","side":"under","line":213.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"caesars","side":"under","line":213.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"betmgm","side":"under","line":213.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:54:41.799Z"},{"sportsbook":"espnbet","side":"under","line":214.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"}],"note":"Frozen RDG V2 projection. Model-vs-line is a yardage difference, not a calibrated betting edge or win probability."},{"event_id":"Z8yv8qtSV0WJ5KARxGLa","start_time":"2026-09-21T00:20:00.000Z","matchup":{"away":"IND","home":"KC"},"player_id":"DANIEL_JONES_1_NFL","player_name":"Daniel Jones","market":"PASSING YARDS","consensus_line":218.5,"rdg_projection":244.1,"model_vs_line":25.6,"lean":"OVER","review":"STRONG REVIEW","projection_details":{"expected_attempts":31.4,"expected_yards_per_attempt":7.77,"current_games":1,"prior_games":12,"total_history_games":13,"current_season_yards_average":166,"prior_season_yards_average":253.4,"current_attempts_average":31,"prior_attempts_average":31.4,"current_ypa":5.35,"prior_ypa":8.16},"sportsbook_lines":[{"sportsbook":"fanduel","side":"over","line":218.5,"odds":"-113","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"caesars","side":"over","line":217.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"draftkings","side":"over","line":217.5,"odds":"-111","available":true,"updated_at":"2026-09-20T21:54:29.815Z"},{"sportsbook":"espnbet","side":"over","line":219.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"fanduel","side":"under","line":218.5,"odds":"-113","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"caesars","side":"under","line":217.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"draftkings","side":"under","line":217.5,"odds":"-113","available":true,"updated_at":"2026-09-20T21:54:29.815Z"},{"sportsbook":"espnbet","side":"under","line":219.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"}],"note":"Frozen RDG V2 projection. Model-vs-line is a yardage difference, not a calibrated betting edge or win probability."},{"event_id":"Z8yv8qtSV0WJ5KARxGLa","start_time":"2026-09-21T00:20:00.000Z","matchup":{"away":"IND","home":"KC"},"player_id":"PATRICK_MAHOMES_1_NFL","player_name":"Patrick Mahomes","market":"PASSING YARDS","consensus_line":220.5,"rdg_projection":242,"model_vs_line":21.5,"lean":"OVER","review":"STRONG REVIEW","projection_details":{"expected_attempts":34.3,"expected_yards_per_attempt":7.06,"current_games":1,"prior_games":14,"total_history_games":15,"current_season_yards_average":184,"prior_season_yards_average":256.2,"current_attempts_average":27,"prior_attempts_average":35.9,"current_ypa":6.81,"prior_ypa":7.15},"sportsbook_lines":[{"sportsbook":"fanduel","side":"over","line":221.5,"odds":"-113","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"bovada","side":"over","line":221.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"espnbet","side":"over","line":219.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"fanduel","side":"under","line":221.5,"odds":"-113","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"bovada","side":"under","line":221.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"espnbet","side":"under","line":219.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"}],"note":"Frozen RDG V2 projection. Model-vs-line is a yardage difference, not a calibrated betting edge or win probability."},{"event_id":"oK0GpQpLxuVia9pfNsOR","start_time":"2026-09-22T00:15:00.000Z","matchup":{"away":"NYG","home":"LA"},"player_id":"MATTHEW_STAFFORD_1_NFL","player_name":"Matthew Stafford","market":"PASSING YARDS","consensus_line":239.5,"rdg_projection":260.1,"model_vs_line":20.6,"lean":"OVER","review":"STRONG REVIEW","projection_details":{"expected_attempts":34,"expected_yards_per_attempt":7.64,"current_games":1,"prior_games":17,"total_history_games":18,"current_season_yards_average":155,"prior_season_yards_average":276.9,"current_attempts_average":25,"prior_attempts_average":35.1,"current_ypa":6.2,"prior_ypa":7.8},"sportsbook_lines":[{"sportsbook":"fanduel","side":"over","line":238.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"draftkings","side":"over","line":238.5,"odds":"-113","available":true,"updated_at":"2026-09-20T21:54:29.815Z"},{"sportsbook":"bovada","side":"over","line":238.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:54:48.759Z"},{"sportsbook":"betmgm","side":"over","line":244.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:54:41.799Z"},{"sportsbook":"espnbet","side":"over","line":239.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"},{"sportsbook":"fanduel","side":"under","line":238.5,"odds":"-114","available":true,"updated_at":"2026-09-20T21:54:38.141Z"},{"sportsbook":"draftkings","side":"under","line":238.5,"odds":"-111","available":true,"updated_at":"2026-09-20T21:54:29.815Z"},{"sportsbook":"bovada","side":"under","line":238.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:54:48.759Z"},{"sportsbook":"betmgm","side":"under","line":244.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:54:41.799Z"},{"sportsbook":"espnbet","side":"under","line":239.5,"odds":"-115","available":true,"updated_at":"2026-09-20T21:55:38.335Z"}],"note":"Frozen RDG V2 projection. Model-vs-line is a yardage difference, not a calibrated betting edge or win probability."}],"updated_at":"2026-09-20T21:59:22.123Z"}

Perfect — the live V2 route is working correctly. ✅

A few things stand out:

6/6 players matched, 0 unmatched.
4 qualifying reviews are being produced.
Dart: 188.2 vs 214 → Under by 25.8 yards.
Daniel Jones: 244.1 vs 218.5 → Over by 25.6.
Mahomes: 242.0 vs 220.5 → Over by 21.5.
Stafford: 260.1 vs 239.5 → Over by 20.6.

One important point: those four being labeled STRONG REVIEW currently just means a ≥20-yard projection difference. It doesn't yet mean they have a proven high probability of winning.

Next step: probability calibration

Now we can use the historical V2 errors to answer the important question:

If RDG projects a QB 20 yards above the sportsbook line, how often should we actually expect him to finish over?

We'll build a distribution from the historical out-of-sample projection errors instead of inventing a percentage. Then RDG can eventually display:

Patrick Mahomes — Over 220.5
RDG Projection: 242.0
Model Probability: XX.X%
Market Probability: XX.X%
Model vs Market: +X.X%

Create:

app/api/nfl-passing-calibration/route.ts

Tell me done, and I'll give you the entire calibration file in one copy/paste.

done

Perfect. Paste this entire file into:

app/api/nfl-passing-calibration/route.ts

This uses historical V2 out-of-sample residuals to estimate how often a given projection difference would clear a hypothetical prop line. It does not pretend we have historical sportsbook lines.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HISTORY_SEASONS = [2023, 2024];
const CALIBRATION_SEASON = 2025;

type Row = Record<string, string>;

type Game = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  attempts: number;
  yards: number;
};

type ProjectionResult = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  projection: number;
  actual: number;
  residual: number;
  absolute_error: number;
  prior_games: number;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 2): number {
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
  values: Array<{ value: number; weight: number }>
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
      (sum, item) => sum + item.value * item.weight,
      0
    ) / totalWeight
  );
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
    .filter((line) => line.trim());

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

async function fetchSeason(
  season: number
): Promise<Game[]> {
  const url =
    `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `nflverse returned ${response.status} for ${season}`
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

      player_id:
        row.player_id ?? "",

      player_name:
        row.player_display_name ||
        row.player_name ||
        "",

      attempts:
        num(row.attempts),

      yards:
        num(row.passing_yards),
    }));
}

function yardsPerAttempt(game: Game): number {
  if (game.attempts <= 0) return 0;

  return game.yards / game.attempts;
}

function recencyWeighted(
  games: Game[],
  selector: (game: Game) => number,
  maxGames = 8
): number | null {
  const selected =
    games.slice(-maxGames);

  if (!selected.length) return null;

  return weightedAverage(
    selected.map((game, index) => ({
      value: selector(game),
      weight: index + 1,
    }))
  );
}

/*
  EXACT FROZEN V2 MODEL

  Keep this identical to the live V2 logic.
*/
function projectV2(
  history: Game[]
): number | null {
  if (history.length < 3) {
    return null;
  }

  const latestSeason =
    history[history.length - 1].season;

  const current =
    history.filter(
      (game) =>
        game.season === latestSeason
    );

  const prior =
    history
      .filter(
        (game) =>
          game.season < latestSeason
      )
      .slice(-17);

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
        game.attempts
    );

  let currentWeight = 0;

  if (current.length === 1) {
    currentWeight = 0.15;
  } else if (current.length === 2) {
    currentWeight = 0.25;
  } else if (current.length === 3) {
    currentWeight = 0.35;
  } else if (current.length === 4) {
    currentWeight = 0.45;
  } else if (current.length >= 5) {
    currentWeight = 0.55;
  }

  let expectedAttempts: number | null;

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
      yardsPerAttempt
    );

  let efficiencyWeight = 0;

  if (current.length === 1) {
    efficiencyWeight = 0.1;
  } else if (current.length === 2) {
    efficiencyWeight = 0.18;
  } else if (current.length === 3) {
    efficiencyWeight = 0.25;
  } else if (current.length === 4) {
    efficiencyWeight = 0.32;
  } else if (current.length >= 5) {
    efficiencyWeight = 0.4;
  }

  let expectedYPA: number | null;

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

  if (history.length <= 5) {
    projection =
      projection * 0.65 +
      225 * 0.35;
  } else if (history.length <= 10) {
    projection =
      projection * 0.8 +
      225 * 0.2;
  }

  return projection;
}

function buildResiduals(
  games: Game[]
): ProjectionResult[] {
  const ordered =
    [...games].sort(
      (a, b) =>
        a.season - b.season ||
        a.week - b.week ||
        a.player_id.localeCompare(
          b.player_id
        )
    );

  const history =
    new Map<string, Game[]>();

  const results:
    ProjectionResult[] = [];

  for (const game of ordered) {
    if (!game.player_id) continue;

    const previous =
      history.get(
        game.player_id
      ) ?? [];

    if (
      game.season ===
        CALIBRATION_SEASON &&
      previous.length >= 3
    ) {
      const projection =
        projectV2(previous);

      if (projection !== null) {
        const residual =
          game.yards -
          projection;

        results.push({
          season:
            game.season,

          week:
            game.week,

          player_id:
            game.player_id,

          player_name:
            game.player_name,

          projection,

          actual:
            game.yards,

          residual,

          absolute_error:
            Math.abs(
              residual
            ),

          prior_games:
            previous.length,
        });
      }
    }

    previous.push(game);

    history.set(
      game.player_id,
      previous
    );
  }

  return results;
}

function standardDeviation(
  values: number[]
): number | null {
  if (values.length < 2) {
    return null;
  }

  const mean =
    average(values);

  if (mean === null) {
    return null;
  }

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        Math.pow(
          value - mean,
          2
        ),
      0
    ) /
    (values.length - 1);

  return Math.sqrt(
    variance
  );
}

/*
  Empirical probability:

  Suppose RDG projects 20 yards ABOVE a line.

  For the OVER to win:

      actual > line

  Because:

      actual = projection + residual

  and:

      line = projection - difference

  OVER wins when:

      residual > -difference

  This lets us estimate probabilities directly from
  historical V2 residuals without assuming a normal
  distribution.
*/
function empiricalOverProbability(
  residuals: number[],
  projectionDifference: number
): number | null {
  if (!residuals.length) {
    return null;
  }

  const threshold =
    -projectionDifference;

  const wins =
    residuals.filter(
      (residual) =>
        residual > threshold
    ).length;

  return (
    wins /
    residuals.length
  );
}

function empiricalUnderProbability(
  residuals: number[],
  projectionDifference: number
): number | null {
  if (!residuals.length) {
    return null;
  }

  const threshold =
    -projectionDifference;

  const wins =
    residuals.filter(
      (residual) =>
        residual < threshold
    ).length;

  return (
    wins /
    residuals.length
  );
}

function probabilityTable(
  residuals: number[]
) {
  const differences = [
    -50,
    -40,
    -30,
    -25,
    -20,
    -15,
    -10,
    -5,
    0,
    5,
    10,
    15,
    20,
    25,
    30,
    40,
    50,
  ];

  return differences.map(
    (difference) => {
      const over =
        empiricalOverProbability(
          residuals,
          difference
        );

      const under =
        empiricalUnderProbability(
          residuals,
          difference
        );

      return {
        model_vs_line_yards:
          difference,

        over_probability:
          over !== null
            ? round(
                over * 100,
                1
              )
            : null,

        under_probability:
          under !== null
            ? round(
                under * 100,
                1
              )
            : null,
      };
    }
  );
}

function sampleBuckets(
  results: ProjectionResult[]
) {
  const groups = [
    {
      label:
        "3-5 prior games",
      min: 3,
      max: 5,
    },
    {
      label:
        "6-10 prior games",
      min: 6,
      max: 10,
    },
    {
      label:
        "11-17 prior games",
      min: 11,
      max: 17,
    },
    {
      label:
        "18+ prior games",
      min: 18,
      max: Infinity,
    },
  ];

  return groups.map(
    (group) => {
      const subset =
        results.filter(
          (result) =>
            result.prior_games >=
              group.min &&
            result.prior_games <=
              group.max
        );

      const residuals =
        subset.map(
          (result) =>
            result.residual
        );

      return {
        sample:
          group.label,

        games:
          subset.length,

        mean_error:
          residuals.length
            ? round(
                average(
                  residuals
                ) ?? 0
              )
            : null,

        residual_sd:
          residuals.length >= 2
            ? round(
                standardDeviation(
                  residuals
                ) ?? 0
              )
            : null,

        mae:
          subset.length
            ? round(
                subset.reduce(
                  (sum, result) =>
                    sum +
                    result.absolute_error,
                  0
                ) /
                  subset.length
              )
            : null,
      };
    }
  );
}

export async function GET() {
  try {
    const seasons = [
      ...HISTORY_SEASONS,
      CALIBRATION_SEASON,
    ];

    const seasonData =
      await Promise.all(
        seasons.map(
          fetchSeason
        )
      );

    const games =
      seasonData.flat();

    const results =
      buildResiduals(
        games
      );

    const residuals =
      results.map(
        (result) =>
          result.residual
      );

    const meanError =
      average(
        residuals
      );

    const residualSD =
      standardDeviation(
        residuals
      );

    const mae =
      results.length
        ? results.reduce(
            (sum, result) =>
              sum +
              result.absolute_error,
            0
          ) /
          results.length
        : null;

    const sortedResiduals =
      [...residuals].sort(
        (a, b) => a - b
      );

    function percentile(
      p: number
    ): number | null {
      if (
        !sortedResiduals.length
      ) {
        return null;
      }

      const index =
        (sortedResiduals.length -
          1) *
        p;

      const lower =
        Math.floor(index);

      const upper =
        Math.ceil(index);

      if (
        lower === upper
      ) {
        return sortedResiduals[
          lower
        ];
      }

      const weight =
        index - lower;

      return (
        sortedResiduals[
          lower
        ] *
          (1 - weight) +
        sortedResiduals[
          upper
        ] *
          weight
      );
    }

    return NextResponse.json({
      success: true,

      version:
        "1.0-rdg-passing-calibration",

      market:
        "NFL Passing Yards",

      model:
        "Frozen RDG V2",

      calibration_status:
        "Historical Residual Calibration",

      methodology: {
        history_seasons:
          HISTORY_SEASONS,

        calibration_season:
          CALIBRATION_SEASON,

        observations:
          results.length,

        leakage_control:
          "Every 2025 projection uses only player games completed before the game being evaluated.",

        probability_method:
          "Empirical distribution of out-of-sample V2 projection residuals.",

        residual_definition:
          "Actual passing yards minus RDG projected passing yards.",

        interpretation:
          "The table estimates how frequently an over or under would have cleared at hypothetical lines positioned a specified number of yards away from the RDG projection.",

        important:
          "Historical sportsbook prop lines are not included. These are residual-based model probabilities, not a historical sportsbook betting backtest or proof of profitability.",
      },

      residual_summary: {
        observations:
          results.length,

        mean_error:
          meanError !== null
            ? round(
                meanError
              )
            : null,

        mae:
          mae !== null
            ? round(mae)
            : null,

        residual_standard_deviation:
          residualSD !== null
            ? round(
                residualSD
              )
            : null,

        percentiles: {
          p10:
            percentile(0.1) !== null
              ? round(
                  percentile(
                    0.1
                  )!
                )
              : null,

          p25:
            percentile(0.25) !== null
              ? round(
                  percentile(
                    0.25
                  )!
                )
              : null,

          median:
            percentile(0.5) !== null
              ? round(
                  percentile(
                    0.5
                  )!
                )
              : null,

          p75:
            percentile(0.75) !== null
              ? round(
                  percentile(
                    0.75
                  )!
                )
              : null,

          p90:
            percentile(0.9) !== null
              ? round(
                  percentile(
                    0.9
                  )!
                )
              : null,
        },
      },

      probability_table:
        probabilityTable(
          residuals
        ),

      by_prior_sample:
        sampleBuckets(
          results
        ),

      note:
        "Positive model-vs-line means RDG projects more passing yards than the hypothetical line. Negative means RDG projects fewer.",

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
            : "Unknown NFL passing calibration error",
      },
      {
        status: 500,
      }
    );
  }
}

Now Commit → Deploy → open:

/api/nfl-passing-calibration

Send me the result. The most important section will be probability_table, especially the probabilities around ±10, ±15, ±20 and ±25 yards.
