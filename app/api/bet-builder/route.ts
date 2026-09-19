import { NextResponse } from "next/server";

type Game = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;

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

      hard_rock_moneyline: {
        away_team: string;
        away_odds: string | null;
        home_team: string;
        home_odds: string | null;
      };
    };
  };
};

type Candidate = {
  event_id: string;
  matchup: string;
  start_date: string;

  team: string;
  bet_type: "spread";
  line: number;
  odds: string | null;

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

function formatSpread(line: number) {
  if (line > 0) return `+${line}`;
  return String(line);
}

function candidateFromGame(
  game: Game
): Candidate | null {
  const market =
    game.rdg.market_analysis;

  const historical =
    game.rdg.historical_signal;

  const difference =
    market.model_vs_market_difference;

  if (difference === null) {
    return null;
  }

  const team = market.spread_lean;

  if (
    !team ||
    team === "EVEN" ||
    team === "NO SPREAD"
  ) {
    return null;
  }

  const isHome =
    team === game.home_team;

  const line = isHome
    ? market.hard_rock_spread.home_line
    : market.hard_rock_spread.away_line;

  const odds = isHome
    ? market.hard_rock_spread.home_odds
    : market.hard_rock_spread.away_odds;

  if (line === null) {
    return null;
  }

  const edge =
    Math.abs(difference);

  /*
    Candidate score:

    Market disagreement is the primary factor.

    Historical bucket performance is secondary.

    Sample size gets a small bonus so we do not
    overvalue tiny historical samples.
  */

  let score = edge * 10;

  if (
    historical.historical_winner_accuracy >= 70
  ) {
    score += 15;
  } else if (
    historical.historical_winner_accuracy >= 60
  ) {
    score += 10;
  } else if (
    historical.historical_winner_accuracy >= 55
  ) {
    score += 5;
  }

  if (historical.sample >= 30) {
    score += 5;
  }

  /*
    Small penalty when RDG's outright projected
    winner is different from the spread lean.

    Example:
    RDG thinks DEN wins, but JAX +6 is the
    model's ATS lean.

    That can still be a valid spread candidate,
    but it carries additional risk.
  */

  if (
    game.rdg.projected_winner !== team
  ) {
    score -= 5;
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
    `Historical ${historical.bucket} projection bucket went ${historical.correct}/${historical.sample} (${historical.historical_winner_accuracy}%) in the current out-of-sample backtest.`
  );

  if (
    game.rdg.projected_winner !== team
  ) {
    risks.push(
      `RDG's projected outright winner is ${game.rdg.projected_winner}, while the spread value is on ${team}.`
    );
  }

  if (
    historical.historical_winner_accuracy < 55
  ) {
    risks.push(
      `This projection bucket performed below 55% in the historical test.`
    );
  }

  if (historical.sample < 20) {
    risks.push(
      `Historical bucket has a small sample of ${historical.sample} games.`
    );
  }

  if (edge < 3.5) {
    risks.push(
      `Model-to-market difference is below the 3.5-point Strong Review threshold.`
    );
  }

  return {
    event_id: game.event_id,

    matchup:
      `${game.away_team} @ ${game.home_team}`,

    start_date:
      game.start_date,

    team,

    bet_type: "spread",

    line,

    odds,

    rdg_projected_winner:
      game.rdg.projected_winner,

    rdg_projected_margin:
      game.rdg.projected_margin,

    model_market_difference:
      Number(edge.toFixed(2)),

    historical_bucket:
      historical.bucket,

    historical_sample:
      historical.sample,

    historical_correct:
      historical.correct,

    historical_accuracy:
      historical.historical_winner_accuracy,

    score:
      Number(score.toFixed(2)),

    reasons,

    risks,
  };
}

function safeCandidates(
  candidates: Candidate[]
) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 3.5 &&
      candidate.historical_accuracy >= 55 &&
      candidate.historical_sample >= 30
  );
}

function balancedCandidates(
  candidates: Candidate[]
) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 3 &&
      candidate.historical_sample >= 30
  );
}

function aggressiveCandidates(
  candidates: Candidate[]
) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 2
  );
}

function uniqueGames(
  candidates: Candidate[]
) {
  const seen = new Set<string>();

  return candidates.filter(
    (candidate) => {
      if (
        seen.has(candidate.event_id)
      ) {
        return false;
      }

      seen.add(candidate.event_id);
      return true;
    }
  );
}

function sortCandidates(
  candidates: Candidate[]
) {
  return [...candidates].sort(
    (a, b) => b.score - a.score
  );
}

function buildSlip(
  name: string,
  category: string,
  requestedLegs: number,
  candidates: Candidate[]
) {
  const sorted =
    uniqueGames(
      sortCandidates(candidates)
    );

  const legs =
    sorted.slice(0, requestedLegs);

  if (
    legs.length < requestedLegs
  ) {
    return {
      name,
      category,

      status:
        "NOT ENOUGH QUALIFYING LEGS",

      requested_legs:
        requestedLegs,

      qualifying_legs:
        legs.length,

      legs,

      note:
        "RDG will not force additional legs when the current board does not meet this slip's rules.",
    };
  }

  return {
    name,
    category,

    status: "QUALIFIED",

    requested_legs:
      requestedLegs,

    qualifying_legs:
      legs.length,

    legs,

    note:
      "Selections are generated from predefined RDG model rules. Historical results do not guarantee future outcomes.",
  };
}

export async function GET(
  request: Request
) {
  try {
    /*
      Pull directly from our existing live
      analysis route.

      This keeps /api/analyze as the single
      source of truth for the NFL model.
    */

    const url =
      new URL(request.url);

    const analyzeUrl =
      `${url.origin}/api/analyze`;

    const response =
      await fetch(analyzeUrl, {
        cache: "no-store",
      });

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            "Unable to load RDG NFL analysis",
          status:
            response.status,
        },
        {
          status: 500,
        }
      );
    }

    const analysis =
      await response.json();

    const games: Game[] =
      analysis.games ?? [];

    const candidates =
      games
        .map(candidateFromGame)
        .filter(
          (
            candidate
          ): candidate is Candidate =>
            candidate !== null
        );

    const ranked =
      sortCandidates(candidates);

    /*
      STRAIGHT BET

      Highest-scoring candidate must meet
      minimum quality rules.
    */

    const straightPool =
      safeCandidates(ranked);

    const bestStraight =
      straightPool.length > 0
        ? {
            status: "QUALIFIED",
            selection:
              straightPool[0],

            note:
              "Highest-ranked spread candidate meeting RDG straight-bet requirements.",
          }
        : {
            status:
              "NO QUALIFYING BET",
            selection: null,

            note:
              "No current spread meets the minimum RDG straight-bet requirements.",
          };

    /*
      PARLAY BUILDER

      We intentionally do NOT force a parlay.

      If the board does not contain enough
      qualifying independent games, the
      builder returns NOT ENOUGH QUALIFYING
      LEGS instead.
    */

    const saferTwoLeg =
      buildSlip(
        "RDG Safer 2-Leg",
        "Safer",
        2,
        safeCandidates(ranked)
      );

    const balancedThreeLeg =
      buildSlip(
        "RDG Balanced 3-Leg",
        "Balanced",
        3,
        balancedCandidates(ranked)
      );

    const higherRisk =
      buildSlip(
        "RDG Higher-Risk 4-Leg",
        "Higher Risk",
        4,
        aggressiveCandidates(ranked)
      );

    return NextResponse.json({
      builder:
        "RDG Automatic Bet Builder",

      version: "1.0",

      sportsbook:
        analysis.sportsbook ??
        "Hard Rock Bet",

      sport: "NFL",

      generated_at:
        new Date().toISOString(),

      rules: {
        straight_bet:
          "At least 3.5-point model/market difference, historical bucket >=55%, sample >=30.",

        safer_parlay:
          "Each leg must satisfy the straight-bet rules.",

        balanced_parlay:
          "At least 3-point model/market difference and historical sample >=30.",

        higher_risk_parlay:
          "At least 2-point model/market difference.",

        forced_bets: false,
      },

      board: {
        games_analyzed:
          games.length,

        candidates_found:
          candidates.length,

        safe_candidates:
          safeCandidates(ranked)
            .length,

        balanced_candidates:
          balancedCandidates(ranked)
            .length,

        aggressive_candidates:
          aggressiveCandidates(ranked)
            .length,
      },

      best_straight_bet:
        bestStraight,

      parlays: {
        safer_2_leg:
          saferTwoLeg,

        balanced_3_leg:
          balancedThreeLeg,

        higher_risk_4_leg:
          higherRisk,
      },

      ranked_candidates:
        ranked,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "RDG bet builder failed",

        details:
          String(error),
      },
      {
        status: 500,
      }
    );
  }
}
