import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type PendingPick = {
  id: number;
  game_pk: number | null;
  team: string;
  matchup: string;
};

type GradeResult = {
  id: number;
  game_pk: number;
  team: string;
  matchup: string;
  status: "won" | "lost";
  actual_home_score: number;
  actual_away_score: number;
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
      Get all pending MLB picks.
    */

    const {
      data: pendingData,
      error: pendingError,
    } = await supabase
      .from("rdg_picks")
      .select(
        "id,game_pk,team,matchup"
      )
      .eq("sport", "MLB")
      .eq("status", "pending");

    if (pendingError) {
      throw new Error(
        pendingError.message
      );
    }

    const pendingPicks =
      (pendingData ?? []) as PendingPick[];

    if (pendingPicks.length === 0) {
      return NextResponse.json({
        success: true,
        sport: "MLB",
        pending_checked: 0,
        games_final: 0,
        picks_graded: 0,
        message:
          "No pending MLB picks to grade.",
        results: [],
        generated_at:
          new Date().toISOString(),
      });
    }

    /*
      Group picks by MLB gamePk so we only
      request each MLB game once.
    */

    const gameGroups =
      new Map<number, PendingPick[]>();

    for (const pick of pendingPicks) {
      if (
        typeof pick.game_pk !== "number"
      ) {
        continue;
      }

      const existing =
        gameGroups.get(pick.game_pk) ?? [];

      existing.push(pick);

      gameGroups.set(
        pick.game_pk,
        existing
      );
    }

    const results: GradeResult[] = [];

    let gamesFinal = 0;
    let gamesNotFinal = 0;
    let gamesFailed = 0;

    /*
      Check official MLB game data.
    */

    for (
      const [gamePk, picks]
      of gameGroups.entries()
    ) {
      try {
        const url =
          `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;

        const response =
          await fetch(url, {
            cache: "no-store",
          });

        if (!response.ok) {
          gamesFailed++;
          continue;
        }

        const game: any =
          await response.json();

        const abstractState =
          game?.gameData?.status
            ?.abstractGameState;

        const detailedState =
          game?.gameData?.status
            ?.detailedState;

        /*
          Only grade games MLB reports
          as completed.
        */

        const isFinal =
          abstractState === "Final" ||
          detailedState === "Final" ||
          detailedState ===
            "Game Over";

        if (!isFinal) {
          gamesNotFinal++;
          continue;
        }

        const homeTeam =
          game?.gameData?.teams
            ?.home?.name;

        const awayTeam =
          game?.gameData?.teams
            ?.away?.name;

        const homeScore =
          game?.liveData?.linescore
            ?.teams?.home?.runs;

        const awayScore =
          game?.liveData?.linescore
            ?.teams?.away?.runs;

        if (
          typeof homeTeam !== "string" ||
          typeof awayTeam !== "string" ||
          typeof homeScore !== "number" ||
          typeof awayScore !== "number"
        ) {
          gamesFailed++;
          continue;
        }

        /*
          MLB games should have a winner
          once officially final.
        */

        if (homeScore === awayScore) {
          gamesFailed++;
          continue;
        }

        gamesFinal++;

        const winner =
          homeScore > awayScore
            ? homeTeam
            : awayTeam;

        for (const pick of picks) {
          /*
            The saved team may use an
            abbreviation such as ATL while
            MLB uses Atlanta Braves.

            Determine home/away from the
            saved matchup:
              ATL @ HOU
          */

          const matchupParts =
            pick.matchup.split(" @ ");

          if (
            matchupParts.length !== 2
          ) {
            continue;
          }

          const savedAway =
            matchupParts[0].trim();

          const savedHome =
            matchupParts[1].trim();

          let selectedSide:
            | "home"
            | "away"
            | null = null;

          if (
            pick.team === savedHome
          ) {
            selectedSide = "home";
          }

          if (
            pick.team === savedAway
          ) {
            selectedSide = "away";
          }

          if (!selectedSide) {
            continue;
          }

          const selectedWon =
            selectedSide === "home"
              ? winner === homeTeam
              : winner === awayTeam;

          const status:
            | "won"
            | "lost" =
            selectedWon
              ? "won"
              : "lost";

          const gradedAt =
            new Date().toISOString();

          const {
            error: updateError,
          } = await supabase
            .from("rdg_picks")
            .update({
              status,
              actual_home_score:
                homeScore,
              actual_away_score:
                awayScore,
              graded_at:
                gradedAt,
            })
            .eq("id", pick.id)
            .eq("status", "pending");

          if (updateError) {
            throw new Error(
              updateError.message
            );
          }

          results.push({
            id: pick.id,
            game_pk: gamePk,
            team: pick.team,
            matchup: pick.matchup,
            status,
            actual_home_score:
              homeScore,
            actual_away_score:
              awayScore,
          });
        }
      } catch (gameError) {
        console.error(
          `MLB grading error for game ${gamePk}:`,
          gameError
        );

        gamesFailed++;
      }
    }

    return NextResponse.json({
      success: true,

      sport: "MLB",

      pending_checked:
        pendingPicks.length,

      unique_games_checked:
        gameGroups.size,

      games_final:
        gamesFinal,

      games_not_final:
        gamesNotFinal,

      games_failed:
        gamesFailed,

      picks_graded:
        results.length,

      results,

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "GRADE MLB PICKS ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown MLB grading error";

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
