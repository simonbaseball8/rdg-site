import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
    };

    market_analysis: {
      model_vs_market_difference: number | null;
      spread_lean: string;

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

type Pick = {
  event_id: string;
  game_date: string;
  sport: string;
  sportsbook: string;
  matchup: string;
  team: string;
  bet_type: string;
  line: number;
  odds: string | null;
  rdg_projected_winner: string;
  rdg_projected_margin: number;
  model_market_difference: number;
  historical_bucket: string;
  historical_sample: number;
  historical_correct: number;
  historical_accuracy: number;
  tier: string;
  status: string;
};

function buildPick(
  game: Game,
  tier: string
): Pick | null {
  if (!game.stats_connected) {
    return null;
  }

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

  return {
    event_id: game.event_id,

    game_date:
      game.start_date.slice(0, 10),

    sport: "NFL",

    sportsbook: "Hard Rock Bet",

    matchup:
      `${game.away_team} @ ${game.home_team}`,

    team,

    bet_type: "Spread",

    line,

    odds,

    rdg_projected_winner:
      game.rdg.projected_winner,

    rdg_projected_margin:
      game.rdg.projected_margin,

    model_market_difference:
      Number(
        Math.abs(difference).toFixed(2)
      ),

    historical_bucket:
      historical.bucket,

    historical_sample:
      historical.sample,

    historical_correct:
      historical.correct,

    historical_accuracy:
      historical.historical_winner_accuracy,

    tier,

    status: "pending",
  };
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

    const supabase = createClient(
      supabaseUrl,
      serviceKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const analysis =
      await getRdgNflAnalysis();

    const games =
      (analysis.games || []) as Game[];

    const candidates = games
      .map((game) => {
        const difference =
          game.rdg.market_analysis
            .model_vs_market_difference;

        if (
          !game.stats_connected ||
          difference === null ||
          Math.abs(difference) < 2
        ) {
          return null;
        }

        return {
          game,
          edge:
            Math.abs(difference),
          history:
            game.rdg.historical_signal,
        };
      })
      .filter(
        (
          item
        ): item is {
          game: Game;
          edge: number;
          history: Game["rdg"]["historical_signal"];
        } => item !== null
      );

    /*
      SAME FILTERS AS THE
      DASHBOARD BET BUILDER
    */

    const safer = candidates
      .filter(
        (item) =>
          item.edge >= 3.5 &&
          item.history
            .historical_winner_accuracy >=
            55 &&
          item.history.sample >= 30
      )
      .sort(
        (a, b) =>
          b.edge - a.edge
      );

    const balanced = candidates
      .filter(
        (item) =>
          item.edge >= 3 &&
          item.history.sample >= 30
      )
      .sort(
        (a, b) =>
          b.edge - a.edge
      );

    const aggressive = candidates
      .filter(
        (item) =>
          item.edge >= 2
      )
      .sort(
        (a, b) =>
          b.edge - a.edge
      );

    const picks: Pick[] = [];

    /*
      BEST STRAIGHT
    */

    if (safer.length >= 1) {
      const pick = buildPick(
        safer[0].game,
        "Best Straight"
      );

      if (pick) {
        picks.push(pick);
      }
    }

    /*
      SAFER 2-LEG

      Only save if BOTH legs qualify.
    */

    if (safer.length >= 2) {
      for (const item of safer.slice(0, 2)) {
        const pick = buildPick(
          item.game,
          "Safer 2-Leg"
        );

        if (pick) {
          picks.push(pick);
        }
      }
    }

    /*
      BALANCED 3-LEG

      Only save if all 3 qualify.
    */

    if (balanced.length >= 3) {
      for (
        const item of balanced.slice(0, 3)
      ) {
        const pick = buildPick(
          item.game,
          "Balanced 3-Leg"
        );

        if (pick) {
          picks.push(pick);
        }
      }
    }

    /*
      HIGHER-RISK 4-LEG

      Only save if all 4 qualify.
    */

    if (aggressive.length >= 4) {
      for (
        const item of aggressive.slice(0, 4)
      ) {
        const pick = buildPick(
          item.game,
          "Higher-Risk 4-Leg"
        );

        if (pick) {
          picks.push(pick);
        }
      }
    }

    if (picks.length === 0) {
      return NextResponse.json({
        success: true,
        saved: 0,
        message:
          "No qualifying RDG picks to save.",
      });
    }

    const { data, error } =
      await supabase
        .from("rdg_picks")
        .upsert(picks, {
          onConflict:
            "event_id,team,bet_type,line,tier",
          ignoreDuplicates: true,
        })
        .select();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,

      generated_at:
        new Date().toISOString(),

      games_analyzed:
        games.length,

      picks_generated:
        picks.length,

      rows_saved:
        data?.length || 0,

      picks: data || [],
    });
  } catch (error) {
    console.error(
      "RDG Save Picks Error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          "RDG save picks failed",

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
