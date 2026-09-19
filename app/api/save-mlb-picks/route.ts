import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as getMLBPicks } from "../mlb-picks/route";

export const dynamic = "force-dynamic";

type MLBPickRow = {
  event_id: string;
  game_pk: number | null;
  game_date: string;
  generated_at: string;
  sport: string;
  sportsbook: string;
  matchup: string;
  team: string;
  bet_type: string;
  line: number | null;
  odds: string | null;
  rdg_projected_winner: string;
  rdg_projected_margin: number | null;
  model_market_difference: number | null;
  model_probability: number | null;
  market_probability: number | null;
  historical_bucket: string | null;
  historical_sample: number | null;
  historical_correct: number | null;
  historical_accuracy: number | null;
  tier: string;
  status: string;
  actual_home_score: number | null;
  actual_away_score: number | null;
  graded_at: string | null;
};

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
          error:
            "Missing Supabase environment variables.",
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
    */

    const mlbResponse: Response =
      await getMLBPicks();

    if (!mlbResponse.ok) {
      const errorText =
        await mlbResponse.text();

      return NextResponse.json(
        {
          success: false,
          error:
            `MLB model failed: ${errorText}`,
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

    const allowedSignals =
      new Set<string>([
        "Priority Review",
        "Strong Review",
        "Watch",
      ]);

    /*
      Build rows using a loop instead of
      map/filter.

      This guarantees TypeScript knows
      every item in rows is a real
      MLBPickRow and never null.
    */

    const rows: MLBPickRow[] = [];

    for (const game of games) {
      if (!game?.rdg) {
        continue;
      }

      if (
        !allowedSignals.has(
          game.rdg.signal
        )
      ) {
        continue;
      }

      const team =
        game.rdg.moneyline_lean ||
        game.rdg.projected_winner;

      if (
        !team ||
        typeof team !== "string"
      ) {
        continue;
      }

      const isHome =
        team === game.home_team;

      const isAway =
        team === game.away_team;

      if (!isHome && !isAway) {
        continue;
      }

      /*
        Get the Hard Rock moneyline
        for RDG's selected team.
      */

      const odds = isHome
        ? game.hard_rock?.moneyline
            ?.home_odds
        : game.hard_rock?.moneyline
            ?.away_odds;

      /*
        Get RDG model probability.
      */

      const modelProbability =
        isHome
          ? game.rdg
              .model_home_probability
          : game.rdg
              .model_away_probability;

      /*
        Get Hard Rock no-vig
        market probability.
      */

      const marketProbability =
        isHome
          ? game.hard_rock?.moneyline
              ?.no_vig_home_probability
          : game.hard_rock?.moneyline
              ?.no_vig_away_probability;

      /*
        Determine game date.
      */

      let gameDate: string;

      if (game.start_date) {
        const parsedDate =
          new Date(game.start_date);

        if (
          !Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          gameDate =
            parsedDate
              .toISOString()
              .slice(0, 10);
        } else {
          gameDate =
            new Date()
              .toISOString()
              .slice(0, 10);
        }
      } else {
        gameDate =
          new Date()
            .toISOString()
            .slice(0, 10);
      }

      const row: MLBPickRow = {
        event_id:
          String(game.event_id),

        game_pk:
          typeof game.game_pk ===
          "number"
            ? game.game_pk
            : null,

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
          odds !== undefined &&
          odds !== null
            ? String(odds)
            : null,

        rdg_projected_winner:
          typeof game.rdg
            .projected_winner ===
          "string"
            ? game.rdg
                .projected_winner
            : team,

        rdg_projected_margin:
          null,

        model_market_difference:
          typeof game.rdg
            .model_market_edge ===
          "number"
            ? game.rdg
                .model_market_edge
            : null,

        model_probability:
          typeof modelProbability ===
          "number"
            ? modelProbability
            : null,

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
          String(
            game.rdg.signal
          ),

        status:
          "pending",

        actual_home_score:
          null,

        actual_away_score:
          null,

        graded_at:
          null,
      };

      rows.push(row);
    }

    /*
      Nothing qualifies today.
    */

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,

        sport:
          "MLB",

        sportsbook:
          "Hard Rock Bet",

        model_version:
          mlb?.version ?? null,

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
      Save first snapshot.

      Existing identical selections
      are ignored by Supabase.
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
        success: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}
