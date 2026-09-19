import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as getMLBPicks } from "../mlb-picks/route";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing Supabase environment variables.",
        },
        { status: 500 }
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

    /*
      Run the existing MLB model directly.
      This avoids problems with Vercel Deployment Protection.
    */

    const mlbResponse: Response =
      await getMLBPicks();

    if (!mlbResponse.ok) {
      const errorText =
        await mlbResponse.text();

      return NextResponse.json(
        {
          success: false,
          error: `MLB model failed: ${errorText}`,
        },
        { status: 500 }
      );
    }

    const mlb: any =
      await mlbResponse.json();

    const games: any[] =
      Array.isArray(mlb?.games)
        ? mlb.games
        : [];

    /*
      Save review-qualified MLB selections.
      Pass-rated games are excluded.
    */

    const allowedSignals =
      new Set<string>([
        "Priority Review",
        "Strong Review",
        "Watch",
      ]);

    const rows = games
      .map((game: any) => {
        if (!game?.rdg) {
          return null;
        }

        if (
          !allowedSignals.has(
            game.rdg.signal
          )
        ) {
          return null;
        }

        const team =
          game.rdg.moneyline_lean ||
          game.rdg.projected_winner;

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

        /*
          Hard Rock odds for the selected team.
        */

        const odds = isHome
          ? game.hard_rock?.moneyline?.home_odds
          : game.hard_rock?.moneyline?.away_odds;

        /*
          RDG model probability.
        */

        const modelProbability = isHome
          ? game.rdg.model_home_probability
          : game.rdg.model_away_probability;

        /*
          Hard Rock no-vig market probability.
        */

        const marketProbability = isHome
          ? game.hard_rock?.moneyline
              ?.no_vig_home_probability
          : game.hard_rock?.moneyline
              ?.no_vig_away_probability;

        /*
          MLB model returns percentages such as
          54.28 rather than decimals such as .5428.
        */

        const modelProbabilityNumber =
          typeof modelProbability === "number"
            ? modelProbability
            : null;

        const marketProbabilityNumber =
          typeof marketProbability === "number"
            ? marketProbability
            : null;

        /*
          Determine the game date.
        */

        let gameDate: string;

        if (game.start_date) {
          gameDate =
            new Date(game.start_date)
              .toISOString()
              .slice(0, 10);
        } else {
          gameDate =
            new Date()
              .toISOString()
              .slice(0, 10);
        }

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

          /*
            Moneyline selections do not have
            a spread line.
          */

          line:
            null,

          odds:
            odds !== undefined &&
            odds !== null
              ? String(odds)
              : null,

          rdg_projected_winner:
            game.rdg.projected_winner ??
            team,

          rdg_projected_margin:
            null,

          model_market_difference:
            typeof game.rdg
              .model_market_edge === "number"
              ? game.rdg.model_market_edge
              : null,

          model_probability:
            modelProbabilityNumber,

          market_probability:
            marketProbabilityNumber,

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

          actual_home_score:
            null,

          actual_away_score:
            null,

          graded_at:
            null,
        };
      })
      .filter(
        (row: any) =>
          row !== null
      );

    /*
      No qualifying MLB selections today.
    */

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,

        sport:
          "MLB",

        sportsbook:
          "Hard Rock Bet",

        games_checked:
          games.length,

        qualifying_picks:
          0,

        newly_saved:
          0,

        message:
          "No qualifying MLB picks to save.",

        picks:
          [],

        generated_at:
          new Date().toISOString(),
      });
    }

    /*
      Save the first snapshot of each selection.

      Supabase's unique index prevents the
      same event/team/bet type/tier combination
      from being repeatedly inserted.
    */

    const {
      data,
      error,
    } = await supabase
      .from("rdg_picks")
      .upsert(
        rows,
        {
          onConflict:
            "event_id,team,bet_type,tier",

          ignoreDuplicates:
            true,
        }
      )
      .select();

    if (error) {
      throw new Error(
        error.message
      );
    }

    return NextResponse.json({
      success:
        true,

      sport:
        "MLB",

      sportsbook:
        "Hard Rock Bet",

      model_version:
        mlb?.version ?? null,

      model_status:
        mlb?.model_status ?? null,

      games_checked:
        games.length,

      qualifying_picks:
        rows.length,

      newly_saved:
        data?.length ?? 0,

      picks:
        data ?? [],

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "SAVE MLB PICKS ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown MLB save error";

    return NextResponse.json(
      {
        success:
          false,

        error:
          message,
      },
      {
        status:
          500,
      }
    );
  }
}
