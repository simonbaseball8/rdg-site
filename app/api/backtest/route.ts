import { NextResponse } from "next/server";

type Row = Record<string, string>;

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
    (row) => (row.season_type ?? "").toUpperCase() === "REG"
  );
}

function average(rows: Row[], field: string) {
  if (!rows.length) return 0;

  return (
    rows.reduce((sum, row) => sum + num(row[field]), 0) /
    rows.length
  );
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

function offense(rows: Row[]) {
  return {
    passing_yards: average(rows, "passing_yards"),
    rushing_yards: average(rows, "rushing_yards"),
    passing_tds: average(rows, "passing_tds"),
    rushing_tds: average(rows, "rushing_tds"),
    sacks_allowed: average(rows, "sacks_suffered"),
    passing_epa: average(rows, "passing_epa"),
    rushing_epa: average(rows, "rushing_epa"),
  };
}

function defense(rows: Row[]) {
  return {
    passing_yards_allowed: average(rows, "passing_yards"),
    rushing_yards_allowed: average(rows, "rushing_yards"),
    passing_tds_allowed: average(rows, "passing_tds"),
    rushing_tds_allowed: average(rows, "rushing_tds"),
    sacks_generated: average(rows, "sacks_suffered"),
    passing_epa_allowed: average(rows, "passing_epa"),
    rushing_epa_allowed: average(rows, "rushing_epa"),
  };
}

function blend(
  historical: number,
  current: number,
  currentGames: number
) {
  let historicalWeight = 0.7;
  let currentWeight = 0.3;

  if (currentGames >= 2) {
    historicalWeight = 0.6;
    currentWeight = 0.4;
  }

  if (currentGames >= 4) {
    historicalWeight = 0.45;
    currentWeight = 0.55;
  }

  if (currentGames >= 6) {
    historicalWeight = 0.3;
    currentWeight = 0.7;
  }

  if (currentGames >= 8) {
    historicalWeight = 0.2;
    currentWeight = 0.8;
  }

  if (currentGames === 0) {
    historicalWeight = 1;
    currentWeight = 0;
  }

  return historical * historicalWeight + current * currentWeight;
}

function buildProfile(
  stats2024: Row[],
  prior2025: Row[],
  team: string
) {
  const historicalOffenseRows = teamRows(stats2024, team);
  const currentOffenseRows = teamRows(prior2025, team);

  const historicalDefenseRows = opponentRows(stats2024, team);
  const currentDefenseRows = opponentRows(prior2025, team);

  const oldO = offense(historicalOffenseRows);
  const newO = offense(currentOffenseRows);

  const oldD = defense(historicalDefenseRows);
  const newD = defense(currentDefenseRows);

  const games = currentOffenseRows.length;

  return {
    offense: {
      passing_yards: blend(
        oldO.passing_yards,
        newO.passing_yards,
        games
      ),
      rushing_yards: blend(
        oldO.rushing_yards,
        newO.rushing_yards,
        games
      ),
      passing_tds: blend(
        oldO.passing_tds,
        newO.passing_tds,
        games
      ),
      rushing_tds: blend(
        oldO.rushing_tds,
        newO.rushing_tds,
        games
      ),
      sacks_allowed: blend(
        oldO.sacks_allowed,
        newO.sacks_allowed,
        games
      ),
      passing_epa: blend(
        oldO.passing_epa,
        newO.passing_epa,
        games
      ),
      rushing_epa: blend(
        oldO.rushing_epa,
        newO.rushing_epa,
        games
      ),
    },

    defense: {
      passing_yards_allowed: blend(
        oldD.passing_yards_allowed,
        newD.passing_yards_allowed,
        games
      ),
      rushing_yards_allowed: blend(
        oldD.rushing_yards_allowed,
        newD.rushing_yards_allowed,
        games
      ),
      passing_tds_allowed: blend(
        oldD.passing_tds_allowed,
        newD.passing_tds_allowed,
        games
      ),
      rushing_tds_allowed: blend(
        oldD.rushing_tds_allowed,
        newD.rushing_tds_allowed,
        games
      ),
      sacks_generated: blend(
        oldD.sacks_generated,
        newD.sacks_generated,
        games
      ),
      passing_epa_allowed: blend(
        oldD.passing_epa_allowed,
        newD.passing_epa_allowed,
        games
      ),
      rushing_epa_allowed: blend(
        oldD.rushing_epa_allowed,
        newD.rushing_epa_allowed,
        games
      ),
    },

    prior_games: games,
  };
}

function offenseScore(profile: any) {
  const o = profile.offense;

  return (
    o.passing_yards * 0.02 +
    o.rushing_yards * 0.03 +
    o.passing_tds * 2 +
    o.rushing_tds * 2 +
    o.passing_epa * 0.15 +
    o.rushing_epa * 0.15 -
    o.sacks_allowed * 0.75
  );
}

function defenseScore(profile: any) {
  const d = profile.defense;

  return (
    15 -
    d.passing_yards_allowed * 0.015 -
    d.rushing_yards_allowed * 0.02 -
    d.passing_tds_allowed * 1.5 -
    d.rushing_tds_allowed * 1.5 -
    d.passing_epa_allowed * 0.12 -
    d.rushing_epa_allowed * 0.12 +
    d.sacks_generated * 0.6
  );
}

function matchupScore(offenseTeam: any, opponent: any) {
  return offenseScore(offenseTeam) + defenseScore(opponent);
}

export async function GET() {
  try {
    const [gamesRes, stats24Res, stats25Res] =
      await Promise.all([
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
        { error: "Historical data request failed" },
        { status: 500 }
      );
    }

    const games = parseCsv(await gamesRes.text());

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

    const results = testGames.map((game) => {
      const week = num(game.week);

      // CRITICAL:
      // Only stats from weeks BEFORE this game.
      const prior2025 = stats25.filter(
        (row) => num(row.week) < week
      );

      const awayProfile = buildProfile(
        stats24,
        prior2025,
        game.away_team
      );

      const homeProfile = buildProfile(
        stats24,
        prior2025,
        game.home_team
      );

      const awayScore = matchupScore(
        awayProfile,
        homeProfile
      );

      const homeScore = matchupScore(
        homeProfile,
        awayProfile
      );

      const modelDifference = homeScore - awayScore;

      const actualDifference =
        num(game.home_score) - num(game.away_score);

      const modelWinner =
        modelDifference > 0
          ? game.home_team
          : modelDifference < 0
          ? game.away_team
          : "EVEN";

      const actualWinner =
        actualDifference > 0
          ? game.home_team
          : actualDifference < 0
          ? game.away_team
          : "TIE";

      return {
        week,
        away_team: game.away_team,
        home_team: game.home_team,

        prior_2025_games: {
          away: awayProfile.prior_games,
          home: homeProfile.prior_games,
        },

        rdg_difference: Number(
          modelDifference.toFixed(2)
        ),

        actual_margin: actualDifference,

        model_winner: modelWinner,
        actual_winner: actualWinner,

        winner_correct:
          modelWinner === actualWinner,
      };
    });

    const decisiveGames = results.filter(
      (game) =>
        game.model_winner !== "EVEN" &&
        game.actual_winner !== "TIE"
    );

    const correct = decisiveGames.filter(
      (game) => game.winner_correct
    ).length;

    const accuracy =
      decisiveGames.length > 0
        ? Number(
            (
              (correct / decisiveGames.length) *
              100
            ).toFixed(2)
          )
        : 0;

    const avgAbsoluteError =
      results.length > 0
        ? Number(
            (
              results.reduce(
                (sum, game) =>
                  sum +
                  Math.abs(
                    game.rdg_difference -
                      game.actual_margin
                  ),
                0
              ) / results.length
            ).toFixed(2)
          )
        : 0;

    return NextResponse.json({
      backtest_version: "RDG Backtest v0.2",

      methodology:
        "2025 walk-forward backtest using 2024 regular-season baseline plus only 2025 statistics available before each tested game",

      leakage_protection:
        "Each 2025 game only uses 2025 team statistics from earlier weeks.",

      games_tested: results.length,

      winner_accuracy: {
        correct,
        tested: decisiveGames.length,
        percentage: accuracy,
      },

      raw_margin_mae: avgAbsoluteError,

      calibration_note:
        "Raw RDG score difference is not yet a projected NFL point spread. This backtest is measuring its relationship with actual margins so it can be calibrated.",

      sample_results: results.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Backtest failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
