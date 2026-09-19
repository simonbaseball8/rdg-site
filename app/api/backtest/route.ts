import { NextResponse } from "next/server";

type Row = Record<string, string>;

const BASELINE_ACCURACY = 53.87;
const BASELINE_MAE = 11.15;

// NFL home-field advantage starting assumption.
// Backtest output will tell us whether the overall model improves.
const HOME_FIELD_ADVANTAGE = 1.5;

function num(value: string | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Row = {};

    headers.forEach((header, i) => {
      row[header] = values[i]?.trim() ?? "";
    });

    return row;
  });
}

function regularSeason(rows: Row[]) {
  return rows.filter(
    (row) => (row.season_type ?? "").trim().toUpperCase() === "REG"
  );
}

function average(rows: Row[], field: string) {
  if (!rows.length) return 0;

  return (
    rows.reduce((sum, row) => sum + num(row[field]), 0) /
    rows.length
  );
}

function weightedAverage(rows: Row[], field: string) {
  if (!rows.length) return 0;

  const sorted = [...rows].sort(
    (a, b) => num(a.week) - num(b.week)
  );

  let total = 0;
  let totalWeight = 0;

  sorted.forEach((row, index) => {
    // Newer games receive more weight.
    const weight = 1 + index * 0.12;

    total += num(row[field]) * weight;
    totalWeight += weight;
  });

  return totalWeight ? total / totalWeight : 0;
}

function teamRows(rows: Row[], team: string) {
  return rows.filter((row) => row.team === team);
}

function opponentRows(rows: Row[], team: string) {
  const games = teamRows(rows, team);
  const opponents: Row[] = [];

  for (const game of games) {
    const opponent = rows.find(
      (row) =>
        row.game_id === game.game_id &&
        row.team !== team
    );

    if (opponent) opponents.push(opponent);
  }

  return opponents;
}

function offense(rows: Row[], recent = false) {
  const avg = recent ? weightedAverage : average;

  return {
    passing_yards: avg(rows, "passing_yards"),
    rushing_yards: avg(rows, "rushing_yards"),
    passing_tds: avg(rows, "passing_tds"),
    rushing_tds: avg(rows, "rushing_tds"),
    sacks_allowed: avg(rows, "sacks_suffered"),
    passing_epa: avg(rows, "passing_epa"),
    rushing_epa: avg(rows, "rushing_epa"),
  };
}

function defense(rows: Row[], recent = false) {
  const avg = recent ? weightedAverage : average;

  return {
    passing_yards_allowed: avg(rows, "passing_yards"),
    rushing_yards_allowed: avg(rows, "rushing_yards"),
    passing_tds_allowed: avg(rows, "passing_tds"),
    rushing_tds_allowed: avg(rows, "rushing_tds"),
    sacks_generated: avg(rows, "sacks_suffered"),
    passing_epa_allowed: avg(rows, "passing_epa"),
    rushing_epa_allowed: avg(rows, "rushing_epa"),
  };
}

function currentWeight(games: number) {
  if (games <= 0) return 0;
  if (games === 1) return 0.30;
  if (games <= 3) return 0.45;
  if (games <= 5) return 0.60;
  if (games <= 8) return 0.72;
  if (games <= 12) return 0.82;
  return 0.88;
}

function blend(
  historical: number,
  current: number,
  games: number
) {
  const cw = currentWeight(games);
  const hw = 1 - cw;

  return historical * hw + current * cw;
}

function buildProfile(
  historicalRows: Row[],
  currentRows: Row[],
  team: string
) {
  const histTeam = teamRows(historicalRows, team);
  const currTeam = teamRows(currentRows, team);

  const histOpp = opponentRows(historicalRows, team);
  const currOpp = opponentRows(currentRows, team);

  const histO = offense(histTeam);
  const currO = offense(currTeam, true);

  const histD = defense(histOpp);
  const currD = defense(currOpp, true);

  const games = currTeam.length;

  return {
    games,

    offense: {
      passing_yards: blend(
        histO.passing_yards,
        currO.passing_yards,
        games
      ),
      rushing_yards: blend(
        histO.rushing_yards,
        currO.rushing_yards,
        games
      ),
      passing_tds: blend(
        histO.passing_tds,
        currO.passing_tds,
        games
      ),
      rushing_tds: blend(
        histO.rushing_tds,
        currO.rushing_tds,
        games
      ),
      sacks_allowed: blend(
        histO.sacks_allowed,
        currO.sacks_allowed,
        games
      ),
      passing_epa: blend(
        histO.passing_epa,
        currO.passing_epa,
        games
      ),
      rushing_epa: blend(
        histO.rushing_epa,
        currO.rushing_epa,
        games
      ),
    },

    defense: {
      passing_yards_allowed: blend(
        histD.passing_yards_allowed,
        currD.passing_yards_allowed,
        games
      ),
      rushing_yards_allowed: blend(
        histD.rushing_yards_allowed,
        currD.rushing_yards_allowed,
        games
      ),
      passing_tds_allowed: blend(
        histD.passing_tds_allowed,
        currD.passing_tds_allowed,
        games
      ),
      rushing_tds_allowed: blend(
        histD.rushing_tds_allowed,
        currD.rushing_tds_allowed,
        games
      ),
      sacks_generated: blend(
        histD.sacks_generated,
        currD.sacks_generated,
        games
      ),
      passing_epa_allowed: blend(
        histD.passing_epa_allowed,
        currD.passing_epa_allowed,
        games
      ),
      rushing_epa_allowed: blend(
        histD.rushing_epa_allowed,
        currD.rushing_epa_allowed,
        games
      ),
    },
  };
}

function offenseScore(profile: any) {
  const o = profile.offense;

  return (
    o.passing_yards * 0.018 +
    o.rushing_yards * 0.025 +
    o.passing_tds * 1.8 +
    o.rushing_tds * 1.8 +
    o.passing_epa * 0.12 +
    o.rushing_epa * 0.12 -
    o.sacks_allowed * 0.65
  );
}

function defenseScore(profile: any) {
  const d = profile.defense;

  return (
    14 -
    d.passing_yards_allowed * 0.012 -
    d.rushing_yards_allowed * 0.018 -
    d.passing_tds_allowed * 1.3 -
    d.rushing_tds_allowed * 1.3 -
    d.passing_epa_allowed * 0.10 -
    d.rushing_epa_allowed * 0.10 +
    d.sacks_generated * 0.55
  );
}

function teamStrength(profile: any) {
  return offenseScore(profile) + defenseScore(profile);
}

function strengthOfSchedule(
  historical: Row[],
  current: Row[],
  team: string
) {
  const rows = teamRows(current, team);

  if (!rows.length) return 0;

  const opponents: string[] = [];

  for (const row of rows) {
    const opp = current.find(
      (x) =>
        x.game_id === row.game_id &&
        x.team !== team
    );

    if (opp) opponents.push(opp.team);
  }

  if (!opponents.length) return 0;

  const values = opponents.map((opponent) => {
    const profile = buildProfile(
      historical,
      current,
      opponent
    );

    return teamStrength(profile);
  });

  const leagueProfiles = Array.from(
    new Set(historical.map((r) => r.team))
  ).map((t) =>
    teamStrength(buildProfile(historical, current, t))
  );

  const leagueAverage =
    leagueProfiles.reduce((a, b) => a + b, 0) /
    Math.max(leagueProfiles.length, 1);

  const opponentAverage =
    values.reduce((a, b) => a + b, 0) /
    Math.max(values.length, 1);

  // Keep SOS adjustment deliberately modest.
  return (opponentAverage - leagueAverage) * 0.15;
}

function rawMatchupDifference(
  historical: Row[],
  current: Row[],
  awayTeam: string,
  homeTeam: string
) {
  const away = buildProfile(
    historical,
    current,
    awayTeam
  );

  const home = buildProfile(
    historical,
    current,
    homeTeam
  );

  const awaySOS = strengthOfSchedule(
    historical,
    current,
    awayTeam
  );

  const homeSOS = strengthOfSchedule(
    historical,
    current,
    homeTeam
  );

  const awayRating =
    teamStrength(away) + awaySOS;

  const homeRating =
    teamStrength(home) +
    homeSOS +
    HOME_FIELD_ADVANTAGE;

  return homeRating - awayRating;
}

function regression(
  x: number[],
  y: number[]
) {
  if (!x.length || x.length !== y.length) {
    return {
      slope: 1,
      intercept: 0,
    };
  }

  const xMean =
    x.reduce((a, b) => a + b, 0) / x.length;

  const yMean =
    y.reduce((a, b) => a + b, 0) / y.length;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < x.length; i++) {
    numerator +=
      (x[i] - xMean) * (y[i] - yMean);

    denominator +=
      Math.pow(x[i] - xMean, 2);
  }

  const slope =
    denominator === 0
      ? 1
      : numerator / denominator;

  const intercept =
    yMean - slope * xMean;

  return {
    slope,
    intercept,
  };
}

export async function GET() {
  try {
    const [
      gamesRes,
      stats24Res,
      stats25Res,
    ] = await Promise.all([
      fetch(
        "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
        { cache: "no-store" }
      ),

      fetch(
        "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2024.csv",
        { cache: "no-store" }
      ),

      fetch(
        "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv",
        { cache: "no-store" }
      ),
    ]);

    if (
      !gamesRes.ok ||
      !stats24Res.ok ||
      !stats25Res.ok
    ) {
      return NextResponse.json(
        {
          error: "Historical data request failed",
        },
        { status: 500 }
      );
    }

    const games = parseCsv(
      await gamesRes.text()
    );

    const stats24 = regularSeason(
      parseCsv(await stats24Res.text())
    );

    const stats25 = regularSeason(
      parseCsv(await stats25Res.text())
    );

    const testGames = games.filter(
      (game) =>
        num(game.season) === 2025 &&
        game.game_type === "REG" &&
        game.home_score !== "" &&
        game.away_score !== ""
    );

    /*
      PHASE 1:
      Generate true walk-forward raw predictions.

      Each game only receives statistics from weeks
      completed BEFORE that game.
    */
    const rawResults = testGames.map(
      (game) => {
        const week = num(game.week);

        const available2025 =
          stats25.filter(
            (row) => num(row.week) < week
          );

        const rawDifference =
          rawMatchupDifference(
            stats24,
            available2025,
            game.away_team,
            game.home_team
          );

        const actualMargin =
          num(game.home_score) -
          num(game.away_score);

        return {
          week,
          away_team: game.away_team,
          home_team: game.home_team,
          raw_difference: rawDifference,
          actual_margin: actualMargin,
          prior_games:
            teamRows(
              available2025,
              game.home_team
            ).length,
        };
      }
    );

    /*
      PHASE 2:
      Calibration.

      IMPORTANT:
      We use the first half of the season to fit the
      raw-score -> actual-margin relationship, then
      evaluate weeks 10+ out of sample.

      This avoids fitting and grading on the exact
      same games.
    */
    const calibrationGames =
      rawResults.filter(
        (game) => game.week <= 9
      );

    const evaluationGames =
      rawResults.filter(
        (game) => game.week >= 10
      );

    const calibration = regression(
      calibrationGames.map(
        (g) => g.raw_difference
      ),
      calibrationGames.map(
        (g) => g.actual_margin
      )
    );

    const evaluated = evaluationGames.map(
      (game) => {
        const projectedMargin =
          calibration.intercept +
          calibration.slope *
            game.raw_difference;

        const modelWinner =
          projectedMargin > 0
            ? game.home_team
            : projectedMargin < 0
            ? game.away_team
            : "EVEN";

        const actualWinner =
          game.actual_margin > 0
            ? game.home_team
            : game.actual_margin < 0
            ? game.away_team
            : "TIE";

        const error = Math.abs(
          projectedMargin -
            game.actual_margin
        );

        return {
          week: game.week,
          away_team: game.away_team,
          home_team: game.home_team,

          raw_rdg_difference: Number(
            game.raw_difference.toFixed(2)
          ),

          projected_margin: Number(
            projectedMargin.toFixed(2)
          ),

          actual_margin:
            game.actual_margin,

          model_winner: modelWinner,
          actual_winner: actualWinner,

          winner_correct:
            modelWinner === actualWinner,

          absolute_error: Number(
            error.toFixed(2)
          ),
        };
      }
    );

    const decisive = evaluated.filter(
      (game) =>
        game.model_winner !== "EVEN" &&
        game.actual_winner !== "TIE"
    );

    const correct = decisive.filter(
      (game) => game.winner_correct
    ).length;

    const accuracy =
      decisive.length > 0
        ? (correct / decisive.length) * 100
        : 0;

    const mae =
      evaluated.length > 0
        ? evaluated.reduce(
            (sum, game) =>
              sum + game.absolute_error,
            0
          ) / evaluated.length
        : 0;

    const improvementAccuracy =
      accuracy - BASELINE_ACCURACY;

    const improvementMae =
      BASELINE_MAE - mae;

    /*
      Break performance into confidence buckets
      based on absolute projected margin.
    */
    function bucket(
      min: number,
      max: number
    ) {
      const games = evaluated.filter(
        (g) => {
          const edge = Math.abs(
            g.projected_margin
          );

          return edge >= min && edge < max;
        }
      );

      const decisiveGames = games.filter(
        (g) =>
          g.actual_winner !== "TIE" &&
          g.model_winner !== "EVEN"
      );

      const wins = decisiveGames.filter(
        (g) => g.winner_correct
      ).length;

      return {
        games: decisiveGames.length,
        correct: wins,
        accuracy:
          decisiveGames.length > 0
            ? Number(
                (
                  (wins /
                    decisiveGames.length) *
                  100
                ).toFixed(2)
              )
            : null,
      };
    }

    return NextResponse.json({
      model:
        "RDG NFL Complete Backtest",

      version: "1.0",

      methodology: {
        historical_baseline:
          "2024 regular season",
        walk_forward:
          "Only 2025 games completed before each tested game are available to the model.",
        recent_form:
          "Later current-season games receive progressively greater weight.",
        opponent_adjustment:
          "Strength of schedule is estimated from prior opponents.",
        home_field_advantage:
          HOME_FIELD_ADVANTAGE,
        calibration:
          "Weeks 1-9 calibrate raw RDG difference to actual NFL margin. Weeks 10+ are evaluated out of sample.",
      },

      data_integrity: {
        future_game_leakage: false,
        postseason_removed: true,
      },

      calibration_sample:
        calibrationGames.length,

      evaluation_sample:
        evaluated.length,

      calibration_equation: {
        intercept: Number(
          calibration.intercept.toFixed(4)
        ),
        slope: Number(
          calibration.slope.toFixed(4)
        ),
        formula:
          "projected_margin = intercept + (slope × raw_rdg_difference)",
      },

      finished_model_results: {
        winner_accuracy: {
          correct,
          tested: decisive.length,
          percentage: Number(
            accuracy.toFixed(2)
          ),
        },

        margin_mae: Number(
          mae.toFixed(2)
        ),
      },

      old_model_baseline: {
        winner_accuracy:
          BASELINE_ACCURACY,
        margin_mae: BASELINE_MAE,
      },

      improvement: {
        accuracy_percentage_points:
          Number(
            improvementAccuracy.toFixed(2)
          ),

        mae_points:
          Number(
            improvementMae.toFixed(2)
          ),

        accuracy_improved:
          accuracy >
          BASELINE_ACCURACY,

        mae_improved:
          mae < BASELINE_MAE,
      },

      performance_by_projected_margin: {
        under_3: bucket(0, 3),
        margin_3_to_6: bucket(3, 6),
        margin_6_to_10: bucket(6, 10),
        margin_10_plus: bucket(
          10,
          Infinity
        ),
      },

      sample_predictions:
        evaluated.slice(0, 15),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Complete RDG backtest failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
