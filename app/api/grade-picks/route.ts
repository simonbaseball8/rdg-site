import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Pick = {
  id: number;
  event_id: string;
  game_date: string;
  matchup: string;
  team: string;
  bet_type: string;
  line: number;
  odds: string | null;
  status: string;
};

type ScoreboardGame = {
  competitions?: Array<{
    competitors?: Array<{
      team?: {
        abbreviation?: string;
      };
      score?: string;
      winner?: boolean;
    }>;
    status?: {
      type?: {
        completed?: boolean;
      };
    };
  }>;
};

function normalizeTeam(team: string) {
  const map: Record<string, string> = {
    HTX: "HOU",
    OTI: "TEN",
    LA: "LAR",
    LV: "LV",
    SF: "SF",
    GB: "GB",
    NE: "NE",
    TB: "TB",
    KC: "KC",
    CIN: "CIN",
    ATL: "ATL",
    CAR: "CAR",
    JAX: "JAX",
    DEN: "DEN",
    CHI: "CHI",
    MIN: "MIN",
    CLE: "CLE",
    PHI: "PHI",
    DAL: "DAL",
    NYG: "NYG",
    NYJ: "NYJ",
    BUF: "BUF",
    MIA: "MIA",
    DET: "DET",
    WAS: "WSH",
    PIT: "PIT",
    BAL: "BAL",
    IND: "IND",
    NO: "NO",
    ARI: "ARI",
    SEA: "SEA",
    LAC: "LAC",
    LAR: "LAR",
    TEN: "TEN",
    HOU: "HOU",
  };

  return map[team] || team;
}

function getTeamFromPick(
  pick: Pick
) {
  return normalizeTeam(pick.team);
}

function calculateSpreadResult(
  pick: Pick,
  homeScore: number,
  awayScore: number,
  homeTeam: string,
  awayTeam: string
) {
  const pickedTeam =
    getTeamFromPick(pick);

  const normalizedHome =
    normalizeTeam(homeTeam);

  const normalizedAway =
    normalizeTeam(awayTeam);

  let margin: number;

  if (pickedTeam === normalizedHome) {
    margin = homeScore - awayScore;
  } else if (
    pickedTeam === normalizedAway
  ) {
    margin = awayScore - homeScore;
  } else {
    return null;
  }

  /*
    Example:

    Team -2.5 wins if margin > 2.5
    Team +2.5 wins if margin + 2.5 > 0

    We calculate:
      actual margin + betting line

    Therefore:

      -2.5 with a 3-point win:
      3 + (-2.5) = +0.5 = WIN

      +2.5 with a 2-point loss:
      -2 + 2.5 = +0.5 = WIN
  */

  const adjustedMargin =
    margin + pick.line;

  if (adjustedMargin > 0) {
    return "won";
  }

  if (adjustedMargin < 0) {
    return "lost";
  }

  return "push";
}

async function getCompletedGames(
  date: string
) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replace(
      /-/g,
      ""
    )}`;

  const response =
    await fetch(url, {
      cache: "no-store",
    });

  if (!response.ok) {
    throw new Error(
      `ESPN scoreboard request failed: ${response.status}`
    );
  }

  const data =
    await response.json();

  return (
    data.events as ScoreboardGame[]
  ) || [];
}

function extractGame(
  event: ScoreboardGame
) {
  const competition =
    event.competitions?.[0];

  if (
    !competition ||
    !competition.competitors ||
    competition.competitors.length !== 2
  ) {
    return null;
  }

  if (
    !competition.status?.type
      ?.completed
  ) {
    return null;
  }

  const competitors =
    competition.competitors;

  const first =
    competitors[0];

  const second =
    competitors[1];

  if (
    !first.team?.abbreviation ||
    !second.team?.abbreviation
  ) {
    return null;
  }

  const firstScore =
    Number(first.score);

  const secondScore =
    Number(second.score);

  if (
    !Number.isFinite(firstScore) ||
    !Number.isFinite(secondScore)
  ) {
    return null;
  }

  /*
    ESPN marks the home team through
    the competitor order/metadata.
    For the NFL scoreboard, the second
    competitor is normally the home team,
    but we also inspect the matchup
    convention used by RDG.

    The route below uses the pick matchup
    to determine home/away explicitly.
  */

  return {
    team1:
      first.team.abbreviation,

    score1: firstScore,

    team2:
      second.team.abbreviation,

    score2: secondScore,
  };
}

function findGameForPick(
  pick: Pick,
  games: ScoreboardGame[]
) {
  const parts =
    pick.matchup.split("@");

  if (parts.length !== 2) {
    return null;
  }

  const away =
    normalizeTeam(parts[0].trim());

  const home =
    normalizeTeam(parts[1].trim());

  for (const event of games) {
    const game =
      extractGame(event);

    if (!game) {
      continue;
    }

    const team1 =
      normalizeTeam(game.team1);

    const team2 =
      normalizeTeam(game.team2);

    if (
      (team1 === away &&
        team2 === home) ||
      (team1 === home &&
        team2 === away)
    ) {
      let awayScore: number;
      let homeScore: number;

      if (team1 === away) {
        awayScore =
          game.score1;
        homeScore =
          game.score2;
      } else {
        awayScore =
          game.score2;
        homeScore =
          game.score1;
      }

      return {
        awayTeam: away,
        homeTeam: home,
        awayScore,
        homeScore,
      };
    }
  }

  return null;
}

export async function GET() {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL"
      );
    }

    if (!serviceKey) {
      throw new Error(
        "Missing SUPABASE_SERVICE_ROLE_KEY"
      );
    }

    const supabase =
      createClient(
        supabaseUrl,
        serviceKey,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );

    /*
      Only grade pending NFL picks.
    */

    const {
      data: picks,
      error: picksError,
    } = await supabase
      .from("rdg_picks")
      .select(`
        id,
        event_id,
        game_date,
        matchup,
        team,
        bet_type,
        line,
        odds,
        status
      `)
      .eq("status", "pending")
      .eq("sport", "NFL");

    if (picksError) {
      throw new Error(
        picksError.message
      );
    }

    if (!picks || picks.length === 0) {
      return NextResponse.json({
        success: true,
        message:
          "No pending NFL picks to grade.",
        graded: 0,
      });
    }

    /*
      Group picks by game date so we
      only request each scoreboard once.
    */

    const gamesByDate =
      new Map<
        string,
        ScoreboardGame[]
      >();

    for (const pick of picks) {
      if (
        gamesByDate.has(
          pick.game_date
        )
      ) {
        continue;
      }

      const games =
        await getCompletedGames(
          pick.game_date
        );

      gamesByDate.set(
        pick.game_date,
        games
      );
    }

    const graded: Array<{
      id: number;
      matchup: string;
      team: string;
      result: string;
      away_score: number;
      home_score: number;
    }> = [];

    const notFound: number[] = [];

    for (const pick of picks) {
      /*
        Currently this grader handles
        spread bets.
      */

      if (
        pick.bet_type
          .toLowerCase()
          .includes("spread") === false
      ) {
        continue;
      }

      const games =
        gamesByDate.get(
          pick.game_date
        ) || [];

      const game =
        findGameForPick(
          pick,
          games
        );

      if (!game) {
        notFound.push(pick.id);
        continue;
      }

      const result =
        calculateSpreadResult(
          pick,
          game.homeScore,
          game.awayScore,
          game.homeTeam,
          game.awayTeam
        );

      if (!result) {
        notFound.push(pick.id);
        continue;
      }

      const { error } =
        await supabase
          .from("rdg_picks")
          .update({
            status: result,

            actual_home_score:
              game.homeScore,

            actual_away_score:
              game.awayScore,

            graded_at:
              new Date().toISOString(),
          })
          .eq("id", pick.id);

      if (error) {
        throw new Error(
          error.message
        );
      }

      graded.push({
        id: pick.id,
        matchup: pick.matchup,
        team: pick.team,
        result,
        away_score:
          game.awayScore,
        home_score:
          game.homeScore,
      });
    }

    return NextResponse.json({
      success: true,

      checked:
        picks.length,

      graded:
        graded.length,

      not_ready:
        notFound.length,

      results:
        graded,
    });
  } catch (error) {
    console.error(
      "RDG Grade Picks Error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "RDG grading failed",
        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
