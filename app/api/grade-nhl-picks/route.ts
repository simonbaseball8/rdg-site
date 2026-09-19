import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NHL_API = "https://api-web.nhle.com/v1";

type PendingPick = {
  id: number;
  game_pk: number | null;
  team: string;
  matchup: string;
};

type GradeResult = {
  id: number;
  game_pk: number;
  matchup: string;
  team: string;
  winner: string;
  status: "won" | "lost";
  away_score: number;
  home_score: number;
};

function normalizeTeam(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

async function getGame(
  gamePk: number
): Promise<any> {
  const response = await fetch(
    `${NHL_API}/gamecenter/${gamePk}/landing`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `NHL game ${gamePk} failed: ${response.status}`
    );
  }

  return response.json();
}

export async function GET(): Promise<NextResponse> {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase service-role environment variables are missing."
      );
    }

    /*
      Load only pending NHL picks.
    */

    const pendingResponse = await fetch(
      `${supabaseUrl}/rest/v1/rdg_picks?sport=eq.NHL&status=eq.pending&select=id,game_pk,team,matchup`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization:
            `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!pendingResponse.ok) {
      const text =
        await pendingResponse.text();

      throw new Error(
        `Supabase pending-picks request failed: ${pendingResponse.status} ${text}`
      );
    }

    const pending =
      (await pendingResponse.json()) as PendingPick[];

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        sport: "NHL",
        pending_checked: 0,
        unique_games_checked: 0,
        games_final: 0,
        games_not_final: 0,
        games_failed: 0,
        picks_graded: 0,
        results: [],
        message:
          "No pending NHL picks to grade.",
        generated_at:
          new Date().toISOString(),
      });
    }

    /*
      Group multiple picks from the
      same NHL game so the NHL API
      only gets called once per game.
    */

    const grouped = new Map<
      number,
      PendingPick[]
    >();

    for (const pick of pending) {
      const gamePk =
        Number(pick.game_pk);

      if (!Number.isFinite(gamePk)) {
        continue;
      }

      if (!grouped.has(gamePk)) {
        grouped.set(gamePk, []);
      }

      grouped.get(gamePk)!.push(pick);
    }

    const results: GradeResult[] = [];

    let gamesFinal = 0;
    let gamesNotFinal = 0;
    let gamesFailed = 0;

    for (const [
      gamePk,
      picks,
    ] of grouped.entries()) {
      try {
        const game =
          await getGame(gamePk);

        /*
          NHL gamecenter responses use
          gameState such as FUT, LIVE,
          FINAL, or OFF.

          FINAL/OFF are treated as
          completed games.
        */

        const gameState =
          String(
            game?.gameState ?? ""
          ).toUpperCase();

        const isFinal =
          gameState === "FINAL" ||
          gameState === "OFF";

        if (!isFinal) {
          gamesNotFinal++;
          continue;
        }

        const awayTeam =
          normalizeTeam(
            game?.awayTeam?.abbrev
          );

        const homeTeam =
          normalizeTeam(
            game?.homeTeam?.abbrev
          );

        const awayScore =
          Number(
            game?.awayTeam?.score
          );

        const homeScore =
          Number(
            game?.homeTeam?.score
          );

        if (
          !awayTeam ||
          !homeTeam ||
          !Number.isFinite(
            awayScore
          ) ||
          !Number.isFinite(
            homeScore
          )
        ) {
          throw new Error(
            `Incomplete final data for NHL game ${gamePk}`
          );
        }

        /*
          NHL games cannot finish tied,
          including overtime/shootout.
        */

        if (
          awayScore === homeScore
        ) {
          throw new Error(
            `Final NHL game ${gamePk} returned a tied score.`
          );
        }

        const winner =
          homeScore > awayScore
            ? homeTeam
            : awayTeam;

        gamesFinal++;

        for (const pick of picks) {
          const selectedTeam =
            normalizeTeam(
              pick.team
            );

          /*
            Saved NHL selections should
            already use abbreviations.
            As a safety check, make sure
            the selected team belongs to
            this game.
          */

          if (
            selectedTeam !==
              awayTeam &&
            selectedTeam !==
              homeTeam
          ) {
            console.error(
              `NHL pick ${pick.id} team mismatch: ${selectedTeam} not in ${awayTeam} @ ${homeTeam}`
            );

            continue;
          }

          const status:
            | "won"
            | "lost" =
            selectedTeam === winner
              ? "won"
              : "lost";

          /*
            Update the individual pick.
          */

          const updateResponse =
            await fetch(
              `${supabaseUrl}/rest/v1/rdg_picks?id=eq.${pick.id}`,
              {
                method: "PATCH",

                headers: {
                  apikey:
                    serviceRoleKey,

                  Authorization:
                    `Bearer ${serviceRoleKey}`,

                  "Content-Type":
                    "application/json",

                  Prefer:
                    "return=minimal",
                },

                body:
                  JSON.stringify({
                    status,

                    actual_home_score:
                      homeScore,

                    actual_away_score:
                      awayScore,

                    graded_at:
                      new Date().toISOString(),
                  }),
              }
            );

          if (!updateResponse.ok) {
            const text =
              await updateResponse.text();

            throw new Error(
              `Failed grading NHL pick ${pick.id}: ${updateResponse.status} ${text}`
            );
          }

          results.push({
            id: pick.id,
            game_pk: gamePk,
            matchup:
              `${awayTeam} @ ${homeTeam}`,
            team:
              selectedTeam,
            winner,
            status,
            away_score:
              awayScore,
            home_score:
              homeScore,
          });
        }
      } catch (error) {
        gamesFailed++;

        console.error(
          `NHL grading failed for game ${gamePk}:`,
          error
        );
      }
    }

    return NextResponse.json({
      success: true,

      sport: "NHL",

      pending_checked:
        pending.length,

      unique_games_checked:
        grouped.size,

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
      "GRADE NHL PICKS ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        sport: "NHL",
        error:
          error instanceof Error
            ? error.message
            : "Unknown NHL grading error",
        generated_at:
          new Date().toISOString(),
      },
      {
        status: 500,
      }
    );
  }
}
