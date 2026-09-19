import { NextResponse } from "next/server";
import { getRdgNflAnalysis } from "../../../lib/rdg-nfl";

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
  return value > 0 ? `+${value}` : String(value);
}

function getCandidate(game: Game): Candidate | null {
  if (!game.stats_connected) return null;

  const market = game.rdg.market_analysis;
  const history = game.rdg.historical_signal;
  const difference = market.model_vs_market_difference;

  if (difference === null) return null;

  const edge = Math.abs(difference);

  if (edge < 2) return null;

  const team = market.spread_lean;

  const isHome = team === game.home_team;
  const isAway = team === game.away_team;

  if (!isHome && !isAway) return null;

  const line = isHome
    ? market.hard_rock_spread.home_line
    : market.hard_rock_spread.away_line;

  const odds = isHome
    ? market.hard_rock_spread.home_odds
    : market.hard_rock_spread.away_odds;

  if (line === null) return null;

  let score = edge * 10;

  if (history.historical_winner_accuracy >= 70) {
    score += 10;
  } else if (history.historical_winner_accuracy >= 60) {
    score += 6;
  } else if (history.historical_winner_accuracy >= 55) {
    score += 3;
  }

  if (history.sample >= 30) {
    score += 3;
  }

  if (game.rdg.projected_winner === team) {
    score += 4;
  }

  const reasons: string[] = [];
  const risks: string[] = [];

  reasons.push(
    `RDG differs from the Hard Rock spread by ${edge.toFixed(1)} points.`
  );

  reasons.push(
    `RDG projects ${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(
      1
    )} points.`
  );

  reasons.push(
    `Historical ${history.bucket} projected-margin bucket: ${history.correct}/${history.sample} (${history.historical_winner_accuracy}%) on straight-up winner predictions.`
  );

  if (game.rdg.projected_winner !== team) {
    risks.push(
      `RDG projects ${game.rdg.projected_winner} to win outright while the spread value is on ${team}.`
    );
  }

  if (history.historical_winner_accuracy < 55) {
    risks.push(
      "This historical projected-margin bucket was below 55% on straight-up winner predictions."
    );
  }

  if (history.sample < 30) {
    risks.push(
      `Historical bucket sample is only ${history.sample} games.`
    );
  }

  return {
    event_id: game.event_id,
    matchup: `${game.away_team} @ ${game.home_team}`,
    start_date: game.start_date,
    team,
    bet_type: "Spread",
    line,
    odds,
    display_bet: `${team} ${formatSpread(line)}`,
    rdg_projected_winner: game.rdg.projected_winner,
    rdg_projected_margin: game.rdg.projected_margin,
    model_market_difference: Number(edge.toFixed(2)),
    historical_bucket: history.bucket,
    historical_sample: history.sample,
    historical_correct: history.correct,
    historical_accuracy: history.historical_winner_accuracy,
    score: Number(score.toFixed(2)),
    reasons,
    risks,
  };
}

function rank(candidates: Candidate[]) {
  return [...candidates].sort(
    (a, b) => b.score - a.score
  );
}

function safePool(candidates: Candidate[]) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 3.5 &&
      candidate.historical_accuracy >= 55 &&
      candidate.historical_sample >= 30
  );
}

function balancedPool(candidates: Candidate[]) {
  return candidates.filter(
    (candidate) =>
      candidate.model_market_difference >= 3 &&
      candidate.historical_sample >= 30
  );
}

function aggressivePool(candidates: Candidate[]) {
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
  const selected = rank(candidates).slice(
    0,
    numberOfLegs
  );

  if (selected.length < numberOfLegs) {
    return {
      name,
      risk,
      status: "NOT ENOUGH QUALIFYING LEGS",
      requested_legs: numberOfLegs,
      qualifying_legs: selected.length,
      legs: selected,
      note:
        "RDG did not force weaker selections into this parlay.",
    };
  }

  return {
    name,
    risk,
    status: "QUALIFIED",
    requested_legs: numberOfLegs,
    qualifying_legs: selected.length,
    legs: selected,
    note:
      "All legs passed this parlay tier's predefined RDG filters.",
  };
}

export async function GET() {
  try {
    // Directly use the shared RDG engine.
    // No internal Vercel URL request.
    const analysis = await getRdgNflAnalysis();

    const games =
      (analysis.games ?? []) as Game[];

    const candidates = rank(
      games
        .map(getCandidate)
        .filter(
          (candidate): candidate is Candidate =>
            candidate !== null
        )
    );

    const safe = rank(
      safePool(candidates)
    );

    const balanced = rank(
      balancedPool(candidates)
    );

    const aggressive = rank(
      aggressivePool(candidates)
    );

    const bestStraight =
      safe.length > 0
        ? {
            status: "QUALIFIED",
            selection: safe[0],
            note:
              "Highest-ranked spread candidate currently meeting RDG's stricter straight-bet filter.",
          }
        : {
            status: "NO QUALIFYING BET",
            selection: null,
            note:
              "No current game meets all of RDG's stricter straight-bet filters.",
          };

    return NextResponse.json({
      builder:
        "RDG Automatic Bet Builder",

      version: "2.0",

      sportsbook:
        analysis.sportsbook,

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

      best_straight_bet:
        bestStraight,

      parlays: {
        safer_2_leg: buildSlip(
          "RDG Safer 2-Leg",
          "Safer",
          2,
          safe
        ),

        balanced_3_leg: buildSlip(
          "RDG Balanced 3-Leg",
          "Balanced",
          3,
          balanced
        ),

        higher_risk_4_leg: buildSlip(
          "RDG Higher-Risk 4-Leg",
          "Higher Risk",
          4,
          aggressive
        ),
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
      { status: 500 }
    );
  }
}
