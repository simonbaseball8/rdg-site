import { loadOddsMarket } from "../../../lib/odds-api";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NHL_API = "https://api-web.nhle.com/v1";

/*
  ============================================================
  RDG NHL MODEL v1.0
  ============================================================

  Historical calibration:
    Training: 2023-24 + 2024-25
    Evaluation: 2025-26
    Held-out games: 1,145
    Held-out winner accuracy: 54.32%

  IMPORTANT:
  This is winner-prediction accuracy.
  It is NOT a historical betting win rate or ROI result.

  Fitted coefficients from /api/nhl-backtest:
*/

const INTERCEPT = 0.229698;
const POINT_PCT_COEF = 0.417319;
const GOAL_DIFF_COEF = 0.297026;

const MIN_CURRENT_GAMES = 10;

/*
  During preseason we do NOT treat the regular-season
  calibrated model as fully active.

  We can still display market/model information for
  development/testing, but preseason games are prevented
  from receiving normal Strong/Priority review labels.
*/

type TeamStats = {
  abbreviation: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  pointPct: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiffPerGame: number;
};

type NHLGame = {
  gameId: number;
  gameDate: string;
  startTimeUTC: string | null;
  gameType: number;
  gameState: string;

  awayTeam: string;
  homeTeam: string;

  awayScore: number | null;
  homeScore: number | null;
};

type Moneyline = {
  team: string;
  odds: number;
};

type OddsGame = {
  sportsbook?: string;
  requires_florida_verification?: boolean;
  eventId: string;
  awayTeam: string;
  homeTeam: string;
  startTime: string | null;
  moneylines: Moneyline[];
};

function logistic(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }

  const z = Math.exp(value);
  return z / (1 + z);
}

function americanToProbability(
  odds: number
): number | null {
  if (!Number.isFinite(odds) || odds === 0) {
    return null;
  }

  if (odds > 0) {
    return 100 / (odds + 100);
  }

  return Math.abs(odds) /
    (Math.abs(odds) + 100);
}

function noVigProbabilities(
  homeOdds: number,
  awayOdds: number
): {
  home: number;
  away: number;
} | null {
  const rawHome =
    americanToProbability(homeOdds);

  const rawAway =
    americanToProbability(awayOdds);

  if (
    rawHome === null ||
    rawAway === null
  ) {
    return null;
  }

  const total =
    rawHome + rawAway;

  if (total <= 0) {
    return null;
  }

  return {
    home: rawHome / total,
    away: rawAway / total,
  };
}

function normalizeTeamName(
  value: string
): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamMatches(
  oddsName: string,
  abbreviation: string,
  fullName?: string
): boolean {
  const odds =
    normalizeTeamName(oddsName);

  const abbr =
    normalizeTeamName(abbreviation);

  if (
    odds === abbr ||
    odds.endsWith(abbr)
  ) {
    return true;
  }

  if (fullName) {
    const full =
      normalizeTeamName(fullName);

    if (
      odds === full ||
      odds.includes(full) ||
      full.includes(odds)
    ) {
      return true;
    }
  }

  return false;
}

function getReviewSignal(
  edgePercentagePoints: number,
  gameType: number,
  sampleReady: boolean
): string {
  /*
    gameType:
      1 = preseason
      2 = regular season
      3 = playoffs
  */

  if (gameType === 1) {
    if (
      edgePercentagePoints >= 3
    ) {
      return "Preseason Watch";
    }

    return "Pass";
  }

  if (!sampleReady) {
    if (
      edgePercentagePoints >= 3
    ) {
      return "Small Sample Watch";
    }

    return "Pass";
  }

  if (
    edgePercentagePoints >= 7
  ) {
    return "Priority Review";
  }

  if (
    edgePercentagePoints >= 5
  ) {
    return "Strong Review";
  }

  if (
    edgePercentagePoints >= 3
  ) {
    return "Watch";
  }

  return "Pass";
}

function gameTypeLabel(
  gameType: number
): string {
  if (gameType === 1) {
    return "Preseason";
  }

  if (gameType === 2) {
    return "Regular Season";
  }

  if (gameType === 3) {
    return "Playoffs";
  }

  return `Game Type ${gameType}`;
}

async function fetchNHLGames(): Promise<NHLGame[]> {
  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const response =
    await fetch(
      `${NHL_API}/schedule/${today}`,
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `NHL schedule request failed: ${response.status}`
    );
  }

  const data: any =
    await response.json();

  const games: NHLGame[] = [];

  const weeks =
    Array.isArray(data?.gameWeek)
      ? data.gameWeek
      : [];

  for (const day of weeks) {
    if (
      day?.date !== today
    ) {
      continue;
    }

    const dayGames =
      Array.isArray(day?.games)
        ? day.games
        : [];

    for (const game of dayGames) {
      const id =
        game?.id;

      const home =
        game?.homeTeam?.abbrev;

      const away =
        game?.awayTeam?.abbrev;

      if (
        typeof id !== "number" ||
        typeof home !== "string" ||
        typeof away !== "string"
      ) {
        continue;
      }

      games.push({
        gameId: id,

        gameDate:
          day.date,

        startTimeUTC:
          typeof game?.startTimeUTC ===
          "string"
            ? game.startTimeUTC
            : null,

        gameType:
          typeof game?.gameType ===
          "number"
            ? game.gameType
            : 0,

        gameState:
          typeof game?.gameState ===
          "string"
            ? game.gameState
            : "UNKNOWN",

        awayTeam:
          away,

        homeTeam:
          home,

        awayScore:
          typeof game?.awayTeam?.score ===
          "number"
            ? game.awayTeam.score
            : null,

        homeScore:
          typeof game?.homeTeam?.score ===
          "number"
            ? game.homeTeam.score
            : null,
      });
    }
  }

  return games;
}

async function fetchStandings(): Promise<{
  stats: Map<string, TeamStats>;
  names: Map<string, string>;
}> {
  const response =
    await fetch(
      `${NHL_API}/standings/now`,
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `NHL standings request failed: ${response.status}`
    );
  }

  const data: any =
    await response.json();

  const standings =
    Array.isArray(data?.standings)
      ? data.standings
      : [];

  const stats =
    new Map<string, TeamStats>();

  const names =
    new Map<string, string>();

  for (const team of standings) {
    const abbreviation =
      team?.teamAbbrev?.default;

    if (
      typeof abbreviation !==
      "string"
    ) {
      continue;
    }

    const gamesPlayed =
      Number(team?.gamesPlayed ?? 0);

    const wins =
      Number(team?.wins ?? 0);

    const losses =
      Number(team?.losses ?? 0);

    const otLosses =
      Number(team?.otLosses ?? 0);

    const points =
      Number(team?.points ?? 0);

    const goalsFor =
      Number(team?.goalFor ?? 0);

    const goalsAgainst =
      Number(team?.goalAgainst ?? 0);

    /*
      Use official NHL points percentage
      if supplied. Otherwise calculate it.
    */

    let pointPct =
      Number(
        team?.pointPctg ??
        team?.pointPct ??
        NaN
      );

    if (
      !Number.isFinite(pointPct)
    ) {
      pointPct =
        gamesPlayed > 0
          ? points /
            (gamesPlayed * 2)
          : 0.5;
    }

    const goalDiffPerGame =
      gamesPlayed > 0
        ? (
            goalsFor -
            goalsAgainst
          ) / gamesPlayed
        : 0;

    stats.set(
      abbreviation,
      {
        abbreviation,
        gamesPlayed,
        wins,
        losses,
        otLosses,
        points,
        pointPct,
        goalsFor,
        goalsAgainst,
        goalDiffPerGame,
      }
    );

    const fullName =
      team?.teamName?.default;

    if (
      typeof fullName ===
      "string"
    ) {
      names.set(
        abbreviation,
        fullName
      );
    }
  }

  return {
    stats,
    names,
  };
}

function extractAmericanOdds(
  value: any
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const parsed =
      Number(
        value.replace(
          "+",
          ""
        )
      );

    if (
      Number.isFinite(parsed)
    ) {
      return parsed;
    }
  }

  return null;
}

function extractOddsEvents(
  payload: any
): any[] {
  if (
    Array.isArray(payload)
  ) {
    return payload;
  }

  const possibilities = [
    payload?.events,
    payload?.data,
    payload?.games,
    payload?.results,
    payload?.odds,
  ];

  for (const candidate of possibilities) {
    if (
      Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return [];
}

function parseMarketMoneylines(
  payload: any
): OddsGame[] {
  const events =
    extractOddsEvents(payload);

  const output:
    OddsGame[] = [];

  for (const event of events) {
    const eventId =
      String(
        event?.id ??
        event?.event_id ??
        event?.eventId ??
        ""
      );

    const homeTeam =
      String(
        event?.home_team ??
        event?.homeTeam ??
        event?.home ??
        ""
      );

    const awayTeam =
      String(
        event?.away_team ??
        event?.awayTeam ??
        event?.away ??
        ""
      );

    const startTime =
      event?.start_time ??
      event?.startTime ??
      event?.commence_time ??
      event?.commenceTime ??
      null;

    const moneylines:
      Moneyline[] = [];

    /*
      Provider payloads can expose markets
      through slightly different nesting.

      Walk the event recursively and look
      for moneyline-style selections.
    */

    function walk(
      node: any,
      marketHint = ""
    ) {
      if (
        node === null ||
        node === undefined
      ) {
        return;
      }

      if (
        Array.isArray(node)
      ) {
        for (
          const child of node
        ) {
          walk(
            child,
            marketHint
          );
        }

        return;
      }

      if (
        typeof node !== "object"
      ) {
        return;
      }

      const marketName =
        String(
          node?.market ??
          node?.market_name ??
          node?.marketName ??
          node?.type ??
          node?.key ??
          marketHint ??
          ""
        ).toLowerCase();

      const isMoneyline =
        marketName.includes(
          "moneyline"
        ) ||
        marketName === "ml" ||
        marketName.includes(
          "money line"
        ) ||
        marketName.includes(
          "h2h"
        );

      const team =
        node?.team ??
        node?.name ??
        node?.label ??
        node?.selection ??
        node?.participant ??
        node?.outcome;

      const odds =
        extractAmericanOdds(
          node?.american_odds ??
          node?.americanOdds ??
          node?.odds ??
          node?.price
        );

      if (
        isMoneyline &&
        typeof team ===
          "string" &&
        odds !== null
      ) {
        moneylines.push({
          team,
          odds,
        });
      }

      for (
        const [
          key,
          child,
        ] of Object.entries(
          node
        )
      ) {
        if (
          typeof child ===
            "object" &&
          child !== null
        ) {
          walk(
            child,
            marketName ||
              key
          );
        }
      }
    }

    walk(event);

    /*
      Remove duplicate team/odds
      combinations.
    */

    const unique =
      new Map<
        string,
        Moneyline
      >();

    for (
      const line
      of moneylines
    ) {
      const key =
        `${normalizeTeamName(
          line.team
        )}:${line.odds}`;

      unique.set(
        key,
        line
      );
    }

    output.push({
      sportsbook: event.sportsbook,
      requires_florida_verification: event.requires_florida_verification,
      eventId:
        eventId ||
        `${awayTeam}-${homeTeam}-${startTime ?? ""}`,

      awayTeam,
      homeTeam,

      startTime:
        typeof startTime ===
        "string"
          ? startTime
          : null,

      moneylines:
        Array.from(
          unique.values()
        ),
    });
  }

  return output;
}

async function fetchHardRockOdds(): Promise<OddsGame[]> {
  const payload = await loadOddsMarket("NHL");
  return parseMarketMoneylines(payload);
}

function findOddsGame(
  game: NHLGame,
  oddsGames: OddsGame[],
  names: Map<string, string>
): OddsGame | null {
  const homeName =
    names.get(
      game.homeTeam
    );

  const awayName =
    names.get(
      game.awayTeam
    );

  for (
    const oddsGame
    of oddsGames
  ) {
    if (!oddsGame.startTime || !game.startTimeUTC || Math.abs(Date.parse(oddsGame.startTime) - Date.parse(game.startTimeUTC)) > 90 * 60_000) continue;
    const homeMatch =
      teamMatches(
        oddsGame.homeTeam,
        game.homeTeam,
        homeName
      );

    const awayMatch =
      teamMatches(
        oddsGame.awayTeam,
        game.awayTeam,
        awayName
      );

    if (
      homeMatch &&
      awayMatch
    ) {
      return oddsGame;
    }
  }

  /*
    Fallback:
    match selections themselves in case
    Provider event-level team names differ.
  */

  for (
    const oddsGame
    of oddsGames
  ) {
    if (!oddsGame.startTime || !game.startTimeUTC || Math.abs(Date.parse(oddsGame.startTime) - Date.parse(game.startTimeUTC)) > 90 * 60_000) continue;
    const hasHome =
      oddsGame.moneylines.some(
        (line) =>
          teamMatches(
            line.team,
            game.homeTeam,
            homeName
          )
      );

    const hasAway =
      oddsGame.moneylines.some(
        (line) =>
          teamMatches(
            line.team,
            game.awayTeam,
            awayName
          )
      );

    if (
      hasHome &&
      hasAway
    ) {
      return oddsGame;
    }
  }

  return null;
}

function findTeamMoneyline(
  oddsGame: OddsGame,
  abbreviation: string,
  fullName?: string
): number | null {
  const line =
    oddsGame.moneylines.find(
      (candidate) =>
        teamMatches(
          candidate.team,
          abbreviation,
          fullName
        )
    );

  return line
    ? line.odds
    : null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const [
      games,
      standingsData,
      oddsGames,
    ] =
      await Promise.all([
        fetchNHLGames(),
        fetchStandings(),
        fetchHardRockOdds(),
      ]);

    const {
      stats,
      names,
    } =
      standingsData;

    const board: any[] = [];

    let gamesWithOdds = 0;
    let gamesWithModel = 0;
    let preseasonGames = 0;

    for (const game of games) {
      if (
        game.gameType === 1
      ) {
        preseasonGames++;
      }

      const homeStats =
        stats.get(
          game.homeTeam
        );

      const awayStats =
        stats.get(
          game.awayTeam
        );

      const oddsGame =
        findOddsGame(
          game,
          oddsGames,
          names
        );

      const base = {
        sportsbook: oddsGame?.sportsbook,
        requires_florida_verification: oddsGame?.requires_florida_verification,
        game_id:
          game.gameId,

        event_id:
          oddsGame?.eventId ??
          String(game.gameId),

        date:
          game.gameDate,

        start_time_utc:
          game.startTimeUTC,

        game_type:
          game.gameType,

        game_type_label:
          gameTypeLabel(
            game.gameType
          ),

        game_state:
          game.gameState,

        matchup:
          `${game.awayTeam} @ ${game.homeTeam}`,

        away_team:
          game.awayTeam,

        home_team:
          game.homeTeam,
      };

      if (
        !homeStats ||
        !awayStats
      ) {
        board.push({
          ...base,

          model_available:
            false,

          odds_available:
            Boolean(
              oddsGame
            ),

          signal:
            "Pass",

          note:
            "Missing team statistics.",
        });

        continue;
      }

      gamesWithModel++;

      /*
        RDG calibrated team model.
      */

      const pointPctDiff =
        homeStats.pointPct -
        awayStats.pointPct;

      const goalDiffDifference =
        homeStats.goalDiffPerGame -
        awayStats.goalDiffPerGame;

      const modelLogit =
        INTERCEPT +
        POINT_PCT_COEF *
          pointPctDiff +
        GOAL_DIFF_COEF *
          goalDiffDifference;

      const homeModelProbability =
        logistic(
          modelLogit
        );

      const awayModelProbability =
        1 -
        homeModelProbability;

      const projectedWinner =
        homeModelProbability >=
        awayModelProbability
          ? game.homeTeam
          : game.awayTeam;

      const projectedWinnerProbability =
        Math.max(
          homeModelProbability,
          awayModelProbability
        );

      const sampleReady =
        homeStats.gamesPlayed >=
          MIN_CURRENT_GAMES &&
        awayStats.gamesPlayed >=
          MIN_CURRENT_GAMES;

      if (!oddsGame) {
        board.push({
          ...base,

          model_available:
            true,

          odds_available:
            false,

          rdg_projected_winner:
            projectedWinner,

          rdg_home_probability:
            Number(
              (
                homeModelProbability *
                100
              ).toFixed(2)
            ),

          rdg_away_probability:
            Number(
              (
                awayModelProbability *
                100
              ).toFixed(2)
            ),

          projected_winner_probability:
            Number(
              (
                projectedWinnerProbability *
                100
              ).toFixed(2)
            ),

          signal:
            game.gameType === 1
              ? "Preseason"
              : "No Market",

          note:
            game.gameType === 1
              ? "Preseason game. Regular-season calibration is not treated as a normal live betting signal."
              : "Hard Rock moneyline not found.",
        });

        continue;
      }

      const homeOdds =
        findTeamMoneyline(
          oddsGame,
          game.homeTeam,
          names.get(
            game.homeTeam
          )
        );

      const awayOdds =
        findTeamMoneyline(
          oddsGame,
          game.awayTeam,
          names.get(
            game.awayTeam
          )
        );

      if (
        homeOdds === null ||
        awayOdds === null
      ) {
        board.push({
          ...base,

          model_available:
            true,

          odds_available:
            false,

          rdg_projected_winner:
            projectedWinner,

          signal:
            game.gameType === 1
              ? "Preseason"
              : "No Market",

          note:
            "Hard Rock event found, but both moneylines could not be matched.",
        });

        continue;
      }

      gamesWithOdds++;

      const market =
        noVigProbabilities(
          homeOdds,
          awayOdds
        );

      if (!market) {
        continue;
      }

      /*
        Compare model probability against
        the no-vig Hard Rock probability
        for BOTH teams.

        The selected team is whichever side
        has the larger positive model-market
        difference.

        This means the RDG selection can be
        different from the outright projected
        winner.
      */

      const homeEdge =
        homeModelProbability -
        market.home;

      const awayEdge =
        awayModelProbability -
        market.away;

      const selectedHome =
        homeEdge >=
        awayEdge;

      const selectedTeam =
        selectedHome
          ? game.homeTeam
          : game.awayTeam;

      const selectedOdds =
        selectedHome
          ? homeOdds
          : awayOdds;

      const selectedModelProbability =
        selectedHome
          ? homeModelProbability
          : awayModelProbability;

      const selectedMarketProbability =
        selectedHome
          ? market.home
          : market.away;

      const edge =
        selectedModelProbability -
        selectedMarketProbability;

      const edgePercentagePoints =
        edge * 100;

      const signal =
        getReviewSignal(
          edgePercentagePoints,
          game.gameType,
          sampleReady
        );

      board.push({
        ...base,

        model_available:
          true,

        odds_available:
          true,

        sportsbook:
          "Hard Rock Bet",

        home_stats: {
          games_played:
            homeStats.gamesPlayed,

          record:
            `${homeStats.wins}-${homeStats.losses}-${homeStats.otLosses}`,

          points:
            homeStats.points,

          point_pct:
            Number(
              homeStats.pointPct.toFixed(
                4
              )
            ),

          goal_diff_per_game:
            Number(
              homeStats.goalDiffPerGame.toFixed(
                3
              )
            ),
        },

        away_stats: {
          games_played:
            awayStats.gamesPlayed,

          record:
            `${awayStats.wins}-${awayStats.losses}-${awayStats.otLosses}`,

          points:
            awayStats.points,

          point_pct:
            Number(
              awayStats.pointPct.toFixed(
                4
              )
            ),

          goal_diff_per_game:
            Number(
              awayStats.goalDiffPerGame.toFixed(
                3
              )
            ),
        },

        hard_rock: {
          away_moneyline:
            awayOdds,

          home_moneyline:
            homeOdds,

          no_vig_away_probability:
            Number(
              (
                market.away *
                100
              ).toFixed(2)
            ),

          no_vig_home_probability:
            Number(
              (
                market.home *
                100
              ).toFixed(2)
            ),
        },

        rdg_projected_winner:
          projectedWinner,

        rdg_home_probability:
          Number(
            (
              homeModelProbability *
              100
            ).toFixed(2)
          ),

        rdg_away_probability:
          Number(
            (
              awayModelProbability *
              100
            ).toFixed(2)
          ),

        selection:
          selectedTeam,

        selection_odds:
          selectedOdds,

        model_probability:
          Number(
            (
              selectedModelProbability *
              100
            ).toFixed(2)
          ),

        market_probability:
          Number(
            (
              selectedMarketProbability *
              100
            ).toFixed(2)
          ),

        model_market_difference:
          Number(
            edgePercentagePoints.toFixed(
              2
            )
          ),

        sample_ready:
          sampleReady,

        signal,

        note:
          game.gameType === 1
            ? "Preseason Watch only. RDG regular-season calibration is not directly validated for preseason."
            : !sampleReady
            ? `At least one team has fewer than ${MIN_CURRENT_GAMES} current-season games.`
            : "Regular-season calibrated team model compared with Hard Rock no-vig moneyline probability.",
      });
    }

    /*
      Sort strongest model-market
      differences first.
    */

    board.sort(
      (a, b) =>
        Number(
          b?.model_market_difference ??
          -999
        ) -
        Number(
          a?.model_market_difference ??
          -999
        )
    );

    const priority =
      board.filter(
        (game) =>
          game.signal ===
          "Priority Review"
      ).length;

    const strong =
      board.filter(
        (game) =>
          game.signal ===
          "Strong Review"
      ).length;

    const watch =
      board.filter(
        (game) =>
          game.signal ===
            "Watch" ||
          game.signal ===
            "Small Sample Watch"
      ).length;

    const preseasonWatch =
      board.filter(
        (game) =>
          game.signal ===
          "Preseason Watch"
      ).length;

    return NextResponse.json({
      success: true,

      sport:
        "NHL",

      version:
        "1.0-calibrated-team-model",

      model_status:
        preseasonGames > 0
          ? "Regular-Season Calibrated / Preseason Restricted"
          : "Regular-Season Calibrated",

      model: {
        intercept:
          INTERCEPT,

        point_pct_coefficient:
          POINT_PCT_COEF,

        goal_diff_per_game_coefficient:
          GOAL_DIFF_COEF,

        historical_training_seasons: [
          "2023-24",
          "2024-25",
        ],

        held_out_evaluation_season:
          "2025-26",

        held_out_games:
          1145,

        held_out_winner_accuracy:
          54.32,

        equal_team_home_win_probability:
          55.72,

        warning:
          "54.32% is historical winner-prediction accuracy, not a betting win rate. Historical Hard Rock prices were not included in the backtest.",
      },

      market:
        "Hard Rock Bet",

      games_found:
        games.length,

      preseason_games:
        preseasonGames,

      games_with_model:
        gamesWithModel,

      games_with_hard_rock_moneylines:
        gamesWithOdds,

      review_summary: {
        priority_reviews:
          priority,

        strong_reviews:
          strong,

        watches:
          watch,

        preseason_watches:
          preseasonWatch,
      },

      games:
        board,

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "NHL PICKS ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown NHL picks error";

    return NextResponse.json(
      {
        success: false,

        sport:
          "NHL",

        error:
          message,

        generated_at:
          new Date().toISOString(),
      },
      {
        status: 500,
      }
    );
  }
}
