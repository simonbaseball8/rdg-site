import { NextResponse } from "next/server";
import { GET as getNHLPicks } from "../nhl-picks/route";

export const dynamic = "force-dynamic";

type NHLPickRow = {
  event_id: string;
  game_date: string;
  generated_at: string;
  sport: string;
  sportsbook: string;
  matchup: string;
  team: string;
  bet_type: string;
  line: null;
  odds: string | null;
  rdg_projected_winner: string | null;
  model_probability: number | null;
  market_probability: number | null;
  model_market_difference: number | null;
  historical_bucket: string | null;
  historical_sample: number | null;
  historical_correct: number | null;
  historical_accuracy: number | null;
  tier: string;
  status: "pending";
  game_pk: number;
};

function getEasternDate(
  date: Date
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    ).formatToParts(date);

  const year =
    parts.find(
      (part) =>
        part.type === "year"
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type === "month"
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type === "day"
    )?.value;

  if (
    !year ||
    !month ||
    !day
  ) {
    return date
      .toISOString()
      .slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function isFutureGame(
  startTime: unknown
): boolean {
  if (
    typeof startTime !==
    "string"
  ) {
    return false;
  }

  const parsed =
    new Date(startTime);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return false;
  }

  return (
    parsed.getTime() >
    Date.now()
  );
}

function formatOdds(
  odds: unknown
): string | null {
  if (
    typeof odds !==
      "number" ||
    !Number.isFinite(odds)
  ) {
    return null;
  }

  return odds > 0
    ? `+${odds}`
    : String(odds);
}

function historicalBucket(
  probability: number | null
): string | null {
  if (
    probability === null
  ) {
    return null;
  }

  const confidence =
    Math.max(
      probability,
      100 - probability
    );

  if (confidence < 55) {
    return "50-54";
  }

  if (confidence < 60) {
    return "55-59";
  }

  if (confidence < 65) {
    return "60-64";
  }

  if (confidence < 70) {
    return "65-69";
  }

  return "70+";
}

function historicalInfo(
  bucket: string | null
): {
  sample: number | null;
  correct: number | null;
  accuracy: number | null;
} {
  /*
    Held-out 2025-26 NHL results
    from /api/nhl-backtest.

    These are winner-prediction
    calibration results, NOT
    historical betting results.
  */

  if (
    bucket === "50-54"
  ) {
    return {
      sample: 453,
      correct: 232,
      accuracy: 51.21,
    };
  }

  if (
    bucket === "55-59"
  ) {
    return {
      sample: 395,
      correct: 222,
      accuracy: 56.2,
    };
  }

  if (
    bucket === "60-64"
  ) {
    return {
      sample: 217,
      correct: 116,
      accuracy: 53.46,
    };
  }

  if (
    bucket === "65-69"
  ) {
    return {
      sample: 63,
      correct: 40,
      accuracy: 63.49,
    };
  }

  if (
    bucket === "70+"
  ) {
    return {
      sample: 17,
      correct: 12,
      accuracy: 70.59,
    };
  }

  return {
    sample: null,
    correct: null,
    accuracy: null,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const supabaseUrl =
      process.env
        .NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env
        .SUPABASE_SERVICE_ROLE_KEY;

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Supabase service-role environment variables are missing."
      );
    }

    /*
      Call the NHL model directly.

      This avoids making an HTTP
      request back into the same
      Vercel deployment.
    */

    const picksResponse =
      await getNHLPicks();

    const picksPayload =
      await picksResponse.json();

    if (
      !picksResponse.ok ||
      !picksPayload?.success
    ) {
      throw new Error(
        picksPayload?.error ??
          "NHL picks route failed."
      );
    }

    const games =
      Array.isArray(
        picksPayload?.games
      )
        ? picksPayload.games
        : [];

    const rows:
      NHLPickRow[] = [];

    let skippedPreseason = 0;
    let skippedStarted = 0;
    let skippedNoOdds = 0;
    let skippedPass = 0;

    for (const game of games) {
      /*
        Only save regular-season
        NHL games.

        The current model was
        calibrated on regular-season
        games, so preseason picks
        should not enter our tracked
        performance history.
      */

      if (
        game?.game_type !== 2
      ) {
        skippedPreseason++;
        continue;
      }

      /*
        Preserve true pregame
        snapshots.

        Once the scheduled start
        time has passed, don't create
        a new tracked prediction.
      */

      if (
        !isFutureGame(
          game?.start_time_utc
        )
      ) {
        skippedStarted++;
        continue;
      }

      if (
        !game?.odds_available ||
        typeof game?.selection !==
          "string"
      ) {
        skippedNoOdds++;
        continue;
      }

      const signal =
        typeof game?.signal ===
        "string"
          ? game.signal
          : "Pass";

      /*
        Save only the normal
        actionable review tiers.

        Small Sample Watch and
        preseason signals are not
        included in tracked NHL
        regular-season picks.
      */

      const allowedSignals = [
        "Priority Review",
        "Strong Review",
        "Watch",
      ];

      if (
        !allowedSignals.includes(
          signal
        )
      ) {
        skippedPass++;
        continue;
      }

      const gameId =
        Number(
          game?.game_id
        );

      if (
        !Number.isFinite(gameId)
      ) {
        continue;
      }

      const eventId =
        String(
          game?.event_id ??
            gameId
        );

      const matchup =
        String(
          game?.matchup ?? ""
        );

      const team =
        String(
          game.selection
        );

      const modelProbability =
        typeof game
          ?.model_probability ===
          "number"
          ? game.model_probability
          : null;

      const marketProbability =
        typeof game
          ?.market_probability ===
          "number"
          ? game.market_probability
          : null;

      const modelMarketDifference =
        typeof game
          ?.model_market_difference ===
          "number"
          ? game.model_market_difference
          : null;

      const bucket =
        historicalBucket(
          modelProbability
        );

      const history =
        historicalInfo(
          bucket
        );

      const startDate =
        typeof game
          ?.start_time_utc ===
          "string"
          ? new Date(
              game.start_time_utc
            )
          : new Date();

      rows.push({
        event_id:
          eventId,

        game_date:
          getEasternDate(
            startDate
          ),

        generated_at:
          new Date().toISOString(),

        sport:
          "NHL",

        sportsbook:
          "Hard Rock Bet",

        matchup,

        team,

        bet_type:
          "Moneyline",

        line:
          null,

        odds:
          formatOdds(
            game
              ?.selection_odds
          ),

        rdg_projected_winner:
          typeof game
            ?.rdg_projected_winner ===
            "string"
            ? game
                .rdg_projected_winner
            : null,

        model_probability:
          modelProbability,

        market_probability:
          marketProbability,

        model_market_difference:
          modelMarketDifference,

        historical_bucket:
          bucket,

        historical_sample:
          history.sample,

        historical_correct:
          history.correct,

        historical_accuracy:
          history.accuracy,

        tier:
          signal,

        status:
          "pending",

        game_pk:
          gameId,
      });
    }

    /*
      During preseason this will
      normally return zero qualifying
      rows. That is intentional.
    */

    if (
      rows.length === 0
    ) {
      return NextResponse.json({
        success: true,

        sport:
          "NHL",

        model_version:
          picksPayload?.version ??
          null,

        model_status:
          picksPayload
            ?.model_status ??
          null,

        games_checked:
          games.length,

        qualifying_picks:
          0,

        newly_saved:
          0,

        skipped: {
          preseason_or_non_regular:
            skippedPreseason,

          already_started:
            skippedStarted,

          missing_odds:
            skippedNoOdds,

          non_qualifying_signal:
            skippedPass,
        },

        message:
          "No qualifying pregame NHL regular-season picks to save.",

        generated_at:
          new Date().toISOString(),
      });
    }

    /*
      Use Supabase REST directly
      with the service-role key.

      ignore-duplicates prevents
      repeatedly saving the same
      selection when the cron runs
      more than once.
    */

    const response =
      await fetch(
        `${supabaseUrl}/rest/v1/rdg_picks?on_conflict=event_id,team,bet_type,tier`,
        {
          method: "POST",

          headers: {
            apikey:
              serviceRoleKey,

            Authorization:
              `Bearer ${serviceRoleKey}`,

            "Content-Type":
              "application/json",

            Prefer:
              "resolution=ignore-duplicates,return=representation",
          },

          body:
            JSON.stringify(
              rows
            ),
        }
      );

    const responseText =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `Supabase NHL save failed: ${response.status} ${responseText}`
      );
    }

    let savedRows: any[] =
      [];

    if (
      responseText.trim()
    ) {
      try {
        const parsed =
          JSON.parse(
            responseText
          );

        if (
          Array.isArray(parsed)
        ) {
          savedRows =
            parsed;
        }
      } catch {
        /*
          Successful Supabase
          response with no usable
          representation.
        */
      }
    }

    return NextResponse.json({
      success: true,

      sport:
        "NHL",

      model_version:
        picksPayload?.version ??
        null,

      model_status:
        picksPayload
          ?.model_status ??
        null,

      games_checked:
        games.length,

      qualifying_picks:
        rows.length,

      newly_saved:
        savedRows.length,

      skipped: {
        preseason_or_non_regular:
          skippedPreseason,

        already_started:
          skippedStarted,

        missing_odds:
          skippedNoOdds,

        non_qualifying_signal:
          skippedPass,
      },

      saved:
        savedRows.map(
          (row) => ({
            id:
              row.id,

            game_pk:
              row.game_pk,

            matchup:
              row.matchup,

            team:
              row.team,

            odds:
              row.odds,

            tier:
              row.tier,

            model_probability:
              row
                .model_probability,

            market_probability:
              row
                .market_probability,

            model_market_difference:
              row
                .model_market_difference,
          })
        ),

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error(
      "SAVE NHL PICKS ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown NHL save error";

    return NextResponse.json(
      {
        success: false,

        sport:
          "NHL",

        error:
          message,

        generated_at:
          new Date().toISOString(),
      },
      {
        status: 500,
      }
    );
  }
}
