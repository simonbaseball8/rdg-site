import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Game = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;
  stats_connected: boolean;

  rdg: {
    projected_winner: string;
    projected_margin: number;

    historical_signal: {
      bucket: string;
      sample: number;
      correct: number;
      historical_winner_accuracy: number;
      signal: string;
    };

    market_analysis: {
      model_vs_market_difference: number | null;
      spread_lean: string;
      market_signal: string;

      hard_rock_spread: {
        away_team: string;
        away_line: number | null;
        away_odds: string | null;
        home_team: string;
        home_line: number | null;
        home_odds: string | null;
      };
    };
  };
};

type Analysis = {
  sportsbook: string;
  model: string;
  version: string;
  games_found: number;
  games_with_stats: number;
  games: Game[];
};

type Candidate = {
  event_id: string;
  matchup: string;
  start_date: string;

  team: string;
  bet_type: "Spread";
  line: number;
  odds: string | null;
  display_bet: string;

  rdg_projected_winner: string;
  rdg_projected_margin: number;

  model_market_difference: number;

  historical_bucket: string;
  historical_sample: number;
  historical_correct: number;
  historical_accuracy: number;

  score: number;

  reasons: string[];
  risks: string[];
};

function formatSpread(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

function getCandidate(
  game: Game
): Candidate | null {
  if (!game.stats_connected) {
    return null;
  }

  const market = game.rdg.market_analysis;
  const history = game.rdg.historical_signal;

  const difference =
    market.model_vs_market_difference;

  if (difference === null) {
    return null;
  }

  const edge = Math.abs(difference);

  // Ignore very small model/market differences.
  if (edge < 2) {
    return null;
  }

  const team = market.spread_lean;

  if (!team) {
    return null;
  }

  const isHome =
    team === game.home_team;

  const isAway =
    team === game.away_team;

  if (!isHome && !isAway) {
    return null;
  }

  const line = isHome
    ? market.hard_rock_spread.home_line
    : market.hard_rock_spread.away_line;

  const odds = isHome
    ? market.hard_rock_spread.home_odds
    : market.hard_rock_spread.away_odds;

  if (line === null) {
    return null;
  }

  /*
    Ranking score

    Model/market difference is the main factor.

    Historical straight-up winner performance
    is only a secondary ranking factor.
  */

  let score = edge * 10;

  if (
    history.historical_winner_accuracy >= 70
  ) {
    score += 10;
  } else if (
    history.historical_winner_accuracy >= 60
  ) {
    score += 6;
  } else if (
    history.historical_winner_accuracy >= 55
  ) {
    score += 3;
  }

  if (history.sample >= 30) {
    score += 3;
  }

  if (
    game.rdg.projected_winner === team
  ) {
    score += 4;
  }

  const reasons: string[] = [];
  const risks: string[] = [];

  reasons.push(
    `RDG differs from the Hard Rock spread by ${edge.toFixed(
      1
    )} points.`
  );

  reasons.push(
    `RDG projects ${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(
      1
    )} points.`
  );

  reasons.push(
    `The ${history.bucket} projected-margin bucket went ${history.correct}/${history.sample} (${history.historical_winner_accuracy}%) on straight-up winner predictions in the out-of-sample backtest.`
  );

  if (
    game.rdg.projected_winner !== team
  ) {
    risks.push(
      `RDG projects ${game.rdg.projected_winner} to win outright, while the spread value is on ${team}.`
    );
  }

  if (
    history.historical_winner_accuracy < 55
  ) {
    risks.push(
      `This projected-margin bucket was below 55% on straight-up winner predictions in the historical test.`
    );
  }

  if (history.sample < 30) {
    risks.push(
      `Historical bucket sample is only ${history.sample} games.`
    );
  }

  if (edge < 3.5) {
    risks.push(
      `Model/market difference is below RDG's 3.5-point Strong Review threshold.`
    );
  }

  return {
    event_id: game.event_id,

    matchup:
      `${game.away_team} @ ${game.home_team}`,

    start_date:
      game.start_date,

    team,

    bet_type:
      "Spread",

    line,

    odds,

    display_bet:
      `${team} ${formatSpread(line)}`,

    rdg_projected_winner:
      game.rdg.projected_winner,

    rdg_projected_margin:
      game.rdg.projected_margin,

    model_market_difference:
      Number(edge.toFixed(2)),

    historical_bucket:
      history.bucket,

    historical_sample:
      history.sample,

    historical_correct:
      history.correct,

    historical_accuracy:
      history.historical_winner_accuracy,

    score:
      Number(score.toFixed(2)),

    reasons,

    risks,
  };
}

function rank(
  candidates: Candidate[]
) {
  return [...candidates].sort(
    (a, b) => b.score - a.score
  );
}

function safePool(
  candidates: Candidate[]
) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 3.5 &&
      candidate.historical_accuracy >= 55 &&
      candidate.historical_sample >= 30
  );
}

function balancedPool(
  candidates: Candidate[]
) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 3 &&
      candidate.historical_sample >= 30
  );
}

function aggressivePool(
  candidates: Candidate[]
) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 2
  );
}

function buildSlip(
  name: string,
  risk: string,
  numberOfLegs: number,
  candidates: Candidate[]
) {
  const selected =
    rank(candidates).slice(
      0,
      numberOfLegs
    );

  if (
    selected.length <
    numberOfLegs
  ) {
    return {
      name,
      risk,

      status:
        "NOT ENOUGH QUALIFYING LEGS",

      requested_legs:
        numberOfLegs,

      qualifying_legs:
        selected.length,

      legs:
        selected,

      note:
        "RDG did not force weaker selections into this parlay.",
    };
  }

  return {
    name,
    risk,

    status:
      "QUALIFIED",

    requested_legs:
      numberOfLegs,

    qualifying_legs:
      selected.length,

    legs:
      selected,

    note:
      "All legs passed this parlay tier's predefined RDG filters.",
  };
}

export async function GET(
  request: Request
) {
  try {
    const headers =
      new Headers(request.headers);

    const forwardedHost =
      headers.get("x-forwarded-host");

    const host =
      forwardedHost ||
      headers.get("host");

    const forwardedProto =
      headers.get("x-forwarded-proto");

    const protocol =
      forwardedProto ||
      "https";

    if (!host) {
      throw new Error(
        "Unable to determine deployment host."
      );
    }

    const analyzeUrl =
      `${protocol}://${host}/api/analyze`;

    const response =
      await fetch(analyzeUrl, {
        method: "GET",

        headers: {
          Accept:
            "application/json",
        },

        next: {
          revalidate: 300,
        },
      });

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (!response.ok) {
      const body =
        await response.text();

      throw new Error(
        `Analyze API returned ${response.status}: ${body.slice(
          0,
          200
        )}`
      );
    }

    if (
      !contentType.includes(
        "application/json"
      )
    ) {
      const body =
        await response.text();

      throw new Error(
        `Analyze API returned non-JSON content: ${body.slice(
          0,
          120
        )}`
      );
    }

    const analysis =
      (await response.json()) as Analysis;

    const games =
      analysis.games || [];

    const candidates =
      rank(
        games
          .map(getCandidate)
          .filter(
            (
              candidate
            ): candidate is Candidate =>
              candidate !== null
          )
      );

    const safe =
      rank(
        safePool(candidates)
      );

    const balanced =
      rank(
        balancedPool(candidates)
      );

    const aggressive =
      rank(
        aggressivePool(candidates)
      );

    const bestStraight =
      safe.length > 0
        ? {
            status:
              "QUALIFIED",

            selection:
              safe[0],

            note:
              "Highest-ranked spread candidate currently meeting RDG's stricter straight-bet filter.",
          }
        : {
            status:
              "NO QUALIFYING BET",

            selection:
              null,

            note:
              "No current game meets all of RDG's stricter straight-bet filters.",
          };

    const saferTwoLeg =
      buildSlip(
        "RDG Safer 2-Leg",
        "Safer",
        2,
        safe
      );

    const balancedThreeLeg =
      buildSlip(
        "RDG Balanced 3-Leg",
        "Balanced",
        3,
        balanced
      );

    const higherRiskFourLeg =
      buildSlip(
        "RDG Higher-Risk 4-Leg",
        "Higher Risk",
        4,
        aggressive
      );

    return NextResponse.json({
      builder:
        "RDG Automatic Bet Builder",

      version:
        "1.1",

      sportsbook:
        analysis.sportsbook ||
        "Hard Rock Bet",

      source_model:
        `${analysis.model} ${analysis.version}`,

      generated_at:
        new Date().toISOString(),

      board: {
        games_analyzed:
          games.length,

        games_with_stats:
          analysis.games_with_stats,

        candidates_found:
          candidates.length,

        safer_candidates:
          safe.length,

        balanced_candidates:
          balanced.length,

        higher_risk_candidates:
          aggressive.length,
      },

      filters: {
        best_straight:
          "Model/market difference >= 3.5 points, historical straight-up bucket accuracy >= 55%, historical sample >= 30.",

        safer_2_leg:
          "Each leg must meet the same stricter filter as the straight-bet pool.",

        balanced_3_leg:
          "Model/market difference >= 3 points and historical sample >= 30.",

        higher_risk_4_leg:
          "Model/market difference >= 2 points.",

        force_selections:
          false,
      },

      best_straight_bet:
        bestStraight,

      parlays: {
        safer_2_leg:
          saferTwoLeg,

        balanced_3_leg:
          balancedThreeLeg,

        higher_risk_4_leg:
          higherRiskFourLeg,
      },

      ranked_candidates:
        candidates,

      disclaimer:
        "RDG model differences and historical straight-up results do not establish the probability or profitability of an individual spread wager.",
    });
  } catch (error) {
    console.error(
      "RDG Bet Builder Error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "RDG bet builder failed",

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
