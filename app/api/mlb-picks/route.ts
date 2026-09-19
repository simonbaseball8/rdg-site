import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as getMLBPicks } from "../mlb-picks/route";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Missing Supabase environment variables."
      );
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Run the existing MLB model directly.
    // This avoids making an HTTP request through
    // Vercel Deployment Protection.
    const mlbResponse = await getMLBPicks();

    if (!mlbResponse.ok) {
      const errorText =
        await mlbResponse.text();

      throw new Error(
        `MLB model failed: ${errorText}`
      );
    }

    const mlb = await mlbResponse.json();

    const games = Array.isArray(mlb?.games)
      ? mlb.games
      : [];

    const allowedSignals = new Set([
      "Priority Review",
      "Strong Review",
      "Watch",
    ]);

    const rows = games
      .filter(
        (game: any) =>
          game?.rdg &&
          allowedSignals.has(
            game.rdg.signal
          )
      )
      .map((game: any) => {
        const team =
          game.rdg.moneyline_lean ||
          game.rdg.projected_winner;

        const isHome =
          team === game.home_team;

        const isAway =
          team === game.away_team;

        if (!isHome && !isAway) {
          return null;
        }

        const odds = isHome
          ? game.hard_rock?.moneyline
              ?.home_odds
          : game.hard_rock?.moneyline
              ?.away_odds;

        const modelProbability = isHome
          ? game.rdg
              .model_home_probability
          : game.rdg
              .model_away_probability;

        const marketProbability = isHome
          ? game.hard_rock?.moneyline
              ?.no_vig_home_probability
          : game.hard_rock?.moneyline
              ?.no_vig_away_probability;

        const gameDate =
          game.start_date
            ? new Date(
                game.start_date
              )
                .toISOString()
                .slice(0, 10)
            : new Date()
                .toISOString()
                .slice(0, 10);

        return {
          event_id:
            String(game.event_id),

          game_pk:
            game.game_pk ?? null,

          game_date:
            gameDate,

          generated_at:
            new Date().toISOString(),

          sport:
            "MLB",

          sportsbook:
            "Hard Rock Bet",

          matchup:
            `${game.away_team} @ ${game.home_team}`,

          team,

          bet_type:
            "Moneyline",

          line:
            null,

          odds:
            odds ?? null,

          rdg_projected_winner:
            game.rdg
              .projected_winner,

          rdg_projected_margin:
            null,

          model_market_difference:
            Number(
              game.rdg
                .model_market_edge ?? 0
            ),

          model_probability:
            Number(
              modelProbability ?? 0
            ),

          market_probability:
            typeof marketProbability ===
            "number"
              ? marketProbability
              : null,

          historical_bucket:
            null,

          historical_sample:
            null,

          historical_correct:
            null,

          historical_accuracy:
            null,

          tier:
            game.rdg.signal,

          status:
            "pending",
        };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message:
          "No qualifying MLB picks to save.",
        saved: 0,
        picks: [],
      });
    }

    /*
      Because RDG snapshots the first qualifying
      selection, we insert instead of overwriting.

      Existing selections are ignored by the
      unique index in Supabase.
    */

    const { data, error } =
      await supabase
        .from("rdg_picks")
        .upsert(rows, {
          onConflict:
            "event_id,team,bet_type,tier",
          ignoreDuplicates: true,
        })
        .select();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,

      sport: "MLB",

      sportsbook:
        "Hard Rock Bet",

      qualifying_picks:
        rows.length,

      newly_saved:
        data?.length ?? 0,

      picks:
        data ?? [],

      generated_at:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "SAVE MLB PICKS ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown MLB save error",
      },
      {
        status: 500,
      }
    );
  }
}
