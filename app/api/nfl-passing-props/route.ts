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

function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
      `nflverse ${response.status} for ${url}`
    );
  }

  return parseCSV(await response.text());
}

function passingGames(
  rows: Row[],
  season: number
) {
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
        row.player_display_name ||
        row.player_name ||
        "",

      team:
        row.recent_team ||
        row.team ||
        "",

      attempts: num(row.attempts),
      completions: num(row.completions),
      yards: num(row.passing_yards),
      touchdowns: num(row.passing_tds),
      interceptions: num(row.interceptions),
    }));
}

function average(
  values: number[]
): number | null {
  if (!values.length) return null;

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function weightedAverage(
  values: {
    value: number;
    weight: number;
  }[]
): number | null {
  const valid = values.filter(
    (x) =>
      Number.isFinite(x.value) &&
      Number.isFinite(x.weight) &&
      x.weight > 0
  );

  if (!valid.length) return null;

  const totalWeight = valid.reduce(
    (sum, x) => sum + x.weight,
    0
  );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, x) => sum + x.value * x.weight,
      0
    ) / totalWeight
  );
}

function buildPlayerHistory(
  currentGames: any[],
  priorGames: any[]
) {
  const map = new Map<
    string,
    {
      player_name: string;
      player_id: string;
      current: any[];
      prior: any[];
    }
  >();

  for (const game of [
    ...priorGames,
    ...currentGames,
  ]) {
    const key = normalizeName(game.player_name);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        player_name: game.player_name,
        player_id: game.player_id,
        current: [],
        prior: [],
      });
    }

    const player = map.get(key)!;

    if (game.season === CURRENT_SEASON) {
      player.current.push(game);
    } else {
      player.prior.push(game);
    }
  }

  for (const player of map.values()) {
    player.current.sort(
      (a, b) => a.week - b.week
    );

    player.prior.sort(
      (a, b) => a.week - b.week
    );
  }

  return map;
}

function projectPassingYards(player: {
  current: any[];
  prior: any[];
}) {
  const current = player.current;
  const prior = player.prior;

  const currentYards = current.map(
    (game) => game.yards
  );

  const priorYards = prior.map(
    (game) => game.yards
  );

  const currentAttempts = current.map(
    (game) => game.attempts
  );

  const priorAttempts = prior.map(
    (game) => game.attempts
  );

  const currentAvg = average(currentYards);
  const priorAvg = average(priorYards);

  const currentAttemptAvg =
    average(currentAttempts);

  const priorAttemptAvg =
    average(priorAttempts);

  const recentCurrent = current
    .slice(-3)
    .map((game) => game.yards);

  const recentPrior = prior
    .slice(-5)
    .map((game) => game.yards);

  const recentCurrentAvg =
    average(recentCurrent);

  const recentPriorAvg =
    average(recentPrior);

  /*
    Early-season shrinkage:

    With only 1-2 current games, we do NOT
    allow the new season average to completely
    dominate the projection.

    Current-season weight gradually increases
    as the player accumulates games.
  */

  const currentGames = current.length;
  const priorGames = prior.length;

  let currentWeight = 0;

  if (currentGames === 1) currentWeight = 0.20;
  else if (currentGames === 2) currentWeight = 0.35;
  else if (currentGames === 3) currentWeight = 0.50;
  else if (currentGames === 4) currentWeight = 0.60;
  else if (currentGames >= 5) currentWeight = 0.70;

  if (!priorGames) {
    currentWeight = 1;
  }

  const priorWeight =
    priorGames > 0 ? 1 - currentWeight : 0;

  const seasonBaseline = weightedAverage([
    ...(currentAvg !== null
      ? [
          {
            value: currentAvg,
            weight: currentWeight,
          },
        ]
      : []),

    ...(priorAvg !== null
      ? [
          {
            value: priorAvg,
            weight: priorWeight,
          },
        ]
      : []),
  ]);

  /*
    Recent form is deliberately a smaller
    adjustment than the season baseline.
  */

  const recentBaseline = weightedAverage([
    ...(recentCurrentAvg !== null
      ? [
          {
            value: recentCurrentAvg,
            weight:
              currentGames >= 3 ? 0.65 : 0.40,
          },
        ]
      : []),

    ...(recentPriorAvg !== null
      ? [
          {
            value: recentPriorAvg,
            weight:
              currentGames >= 3 ? 0.35 : 0.60,
          },
        ]
      : []),
  ]);

  let projection =
    seasonBaseline ??
    recentBaseline ??
    null;

  if (
    projection !== null &&
    recentBaseline !== null
  ) {
    projection =
      projection * 0.75 +
      recentBaseline * 0.25;
  }

  /*
    Attempt-volume adjustment.

    This is intentionally small.
  */

  if (
    projection !== null &&
    currentAttemptAvg !== null &&
    priorAttemptAvg !== null &&
    priorAttemptAvg >= 20
  ) {
    const ratio =
      currentAttemptAvg / priorAttemptAvg;

    const cappedRatio = Math.min(
      1.15,
      Math.max(0.85, ratio)
    );

    projection *=
      1 + (cappedRatio - 1) * 0.25;
  }

  if (projection === null) {
    return null;
  }

  return {
    projection: round(projection, 1),

    current_games: currentGames,
    prior_games: priorGames,

    current_season_average:
      currentAvg !== null
        ? round(currentAvg, 1)
        : null,

    prior_season_average:
      priorAvg !== null
        ? round(priorAvg, 1)
        : null,

    recent_average:
      recentBaseline !== null
        ? round(recentBaseline, 1)
        : null,

    current_attempts_per_game:
      currentAttemptAvg !== null
        ? round(currentAttemptAvg, 1)
        : null,

    prior_attempts_per_game:
      priorAttemptAvg !== null
        ? round(priorAttemptAvg, 1)
        : null,
  };
}

function getEventStart(event: any) {
  return (
    event?.status?.startsAt ??
    event?.startsAt ??
    event?.startTime ??
    event?.startDate ??
    null
  );
}

function isPregame(event: any) {
  if (event?.status?.started === true) {
    return false;
  }

  if (event?.status?.completed === true) {
    return false;
  }

  if (event?.status?.ended === true) {
    return false;
  }

  const start = getEventStart(event);

  if (!start) return true;

  const timestamp = new Date(start).getTime();

  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return timestamp > Date.now();
}

function extractPassingProps(event: any) {
  const odds =
    event?.odds &&
    typeof event.odds === "object"
      ? Object.values(event.odds)
      : [];

  return odds.filter((odd: any) => {
    return (
      odd?.statID === "passing_yards" &&
      odd?.betTypeID === "ou" &&
      odd?.periodID === "game" &&
      Boolean(odd?.playerID)
    );
  });
}

function sportsbookLines(odd: any) {
  const books =
    odd?.byBookmaker &&
    typeof odd.byBookmaker === "object"
      ? odd.byBookmaker
      : {};

  return Object.entries(books)
    .map(([book, data]: [string, any]) => ({
      sportsbook: book,

      side: odd.sideID,

      line:
        data?.overUnder !== undefined
          ? num(data.overUnder)
          : null,

      odds:
        data?.odds ?? null,

      available:
        data?.available === true,

      updated_at:
        data?.lastUpdatedAt ?? null,
    }))
    .filter(
      (line) =>
        line.line !== null &&
        Number.isFinite(line.line)
    );
}

export async function GET() {
  const apiKey =
    process.env.SPORTSGAMEODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error:
          "SPORTSGAMEODDS_API_KEY is missing.",
      },
      { status: 500 }
    );
  }

  try {
    const [
      currentRows,
      priorRows,
      oddsResponse,
    ] = await Promise.all([
      fetchCSV(CURRENT_STATS_URL),
      fetchCSV(PRIOR_STATS_URL),

      fetch(
        `${SGO_URL}?${new URLSearchParams({
          leagueID: "NFL",
          oddsAvailable: "true",
          limit: "50",
        }).toString()}`,
        {
          headers: {
            "x-api-key": apiKey,
          },
          cache: "no-store",
        }
      ),
    ]);

    if (!oddsResponse.ok) {
      const body =
        await oddsResponse.text();

      return NextResponse.json(
        {
          success: false,
          provider: "SportsGameOdds",
          status: oddsResponse.status,
          error: body,
        },
        { status: oddsResponse.status }
      );
    }

    const oddsData =
      await oddsResponse.json();

    const events = Array.isArray(
      oddsData?.data
    )
      ? oddsData.data
      : Array.isArray(oddsData?.events)
        ? oddsData.events
        : [];

    const currentGames = passingGames(
      currentRows,
      CURRENT_SEASON
    );

    const priorGames = passingGames(
      priorRows,
      PRIOR_SEASON
    );

    const history = buildPlayerHistory(
      currentGames,
      priorGames
    );

    const props: any[] = [];
    let matchedPlayers = 0;
    let unmatchedPlayers = 0;

    for (const event of events) {
      if (!isPregame(event)) continue;

      const passingProps =
        extractPassingProps(event);

      const grouped = new Map<
        string,
        any[]
      >();

      for (const odd of passingProps) {
        const playerID =
          String(odd.playerID ?? "");

        if (!playerID) continue;

        if (!grouped.has(playerID)) {
          grouped.set(playerID, []);
        }

        grouped.get(playerID)!.push(odd);
      }

      for (const [
        playerID,
        playerOdds,
      ] of grouped.entries()) {
        const sample = playerOdds[0];

        const providerName =
          sample?.marketName
            ?.replace(
              / Passing Yards Over\/Under/i,
              ""
            )
            ?.trim() ||
          playerNameFromId(playerID);

        const key =
          normalizeName(providerName);

        const player =
          history.get(key);

        if (!player) {
          unmatchedPlayers++;

          continue;
        }

        const projection =
          projectPassingYards(player);

        if (!projection) continue;

        matchedPlayers++;

        const allBookLines =
          playerOdds.flatMap(
            sportsbookLines
          );

        const availableLines =
          allBookLines.filter(
            (line) => line.available
          );

        /*
          Build one representative market line
          from currently available sportsbooks.

          We use the median line rather than
          cherry-picking the easiest book.
        */

        const uniqueAvailableLines =
          Array.from(
            new Set(
              availableLines.map(
                (line) => line.line
              )
            )
          ).sort((a, b) => a - b);

        let consensusLine:
          | number
          | null = null;

        if (uniqueAvailableLines.length) {
          const middle = Math.floor(
            uniqueAvailableLines.length / 2
          );

          if (
            uniqueAvailableLines.length % 2 ===
            1
          ) {
            consensusLine =
              uniqueAvailableLines[middle];
          } else {
            consensusLine =
              (
                uniqueAvailableLines[
                  middle - 1
                ] +
                uniqueAvailableLines[middle]
              ) / 2;
          }
        }

        if (consensusLine === null) {
          continue;
        }

        const difference =
          projection.projection -
          consensusLine;

        let lean = "PASS";

        if (difference >= 8) {
          lean = "OVER";
        } else if (difference <= -8) {
          lean = "UNDER";
        }

        let review = "PASS";

        const absDifference =
          Math.abs(difference);

        if (absDifference >= 20) {
          review = "STRONG REVIEW";
        } else if (absDifference >= 12) {
          review = "REVIEW";
        } else if (absDifference >= 8) {
          review = "WATCH";
        }

        /*
          Early-season sample guardrail.
          No "strong" designation based only
          on tiny current-season samples.
        */

        if (
          projection.current_games < 3 &&
          review === "STRONG REVIEW"
        ) {
          review = "REVIEW";
        }

        props.push({
          event_id:
            event?.eventID ??
            event?.id ??
            null,

          start_time:
            getEventStart(event),

          matchup: {
            away:
              event?.teams?.away?.names
                ?.short ??
              event?.teams?.away?.names
                ?.long ??
              null,

            home:
              event?.teams?.home?.names
                ?.short ??
              event?.teams?.home?.names
                ?.long ??
              null,
          },

          player_id: playerID,

          player_name:
            player.player_name ||
            providerName,

          market: "PASSING YARDS",

          consensus_line:
            round(consensusLine, 1),

          rdg_projection:
            projection.projection,

          model_vs_line:
            round(difference, 1),

          lean,

          review,

          sample: {
            current_games:
              projection.current_games,

            prior_games:
              projection.prior_games,

            current_season_average:
              projection.current_season_average,

            prior_season_average:
              projection.prior_season_average,

            recent_average:
              projection.recent_average,

            current_attempts_per_game:
              projection.current_attempts_per_game,

            prior_attempts_per_game:
              projection.prior_attempts_per_game,
          },

          sportsbook_lines:
            availableLines,

          note:
            "Projection review only. No calibrated over/under probability or validated betting edge is assigned yet.",
        });
      }
    }

    props.sort(
      (a, b) =>
        Math.abs(b.model_vs_line) -
        Math.abs(a.model_vs_line)
    );

    return NextResponse.json({
      success: true,

      version:
        "1.0-rdg-passing-yards-projection",

      sport: "NFL",

      market: "passing_yards",

      model_status:
        "Projection Model / Probability Not Yet Calibrated",

      methodology: {
        current_season:
          CURRENT_SEASON,

        prior_season:
          PRIOR_SEASON,

        current_data:
          "nflverse weekly player statistics",

        market_data:
          "SportsGameOdds",

        projection:
          "Prior-season baseline blended with current-season performance, recent form, and a capped passing-attempt volume adjustment.",

        sportsbook_line:
          "Median of currently available sportsbook passing-yard lines.",

        important:
          "model_vs_line is a yardage difference, not a betting edge or win probability.",
      },

      current_player_games:
        currentGames.length,

      prior_player_games:
        priorGames.length,

      sportsbook_events_found:
        events.length,

      matched_prop_players:
        matchedPlayers,

      unmatched_prop_players:
        unmatchedPlayers,

      qualifying_reviews:
        props.filter(
          (prop) => prop.review !== "PASS"
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
      { status: 500 }
    );
  }
}
