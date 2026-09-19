import { NextResponse } from "next/server";

type Row = Record<string, string>;

function normalizeTeam(team: string) {
  const teamMap: Record<string, string> = {
    ARI: "ARI", CRD: "ARI",
    ATL: "ATL",
    BAL: "BAL", RAV: "BAL",
    BUF: "BUF",
    CAR: "CAR",
    CHI: "CHI",
    CIN: "CIN",
    CLE: "CLE", CLV: "CLE",
    DAL: "DAL",
    DEN: "DEN",
    DET: "DET",
    GB: "GB", GNB: "GB",
    HOU: "HOU", HTX: "HOU",
    IND: "IND", CLT: "IND",
    JAX: "JAX",
    KC: "KC", KAN: "KC",
    LAC: "LAC", SDG: "LAC",
    LA: "LA", LAR: "LA", RAM: "LA",
    LV: "LV", RAI: "LV",
    MIA: "MIA",
    MIN: "MIN",
    NE: "NE", NWE: "NE",
    NO: "NO", NOR: "NO",
    NYG: "NYG",
    NYJ: "NYJ",
    PHI: "PHI",
    PIT: "PIT",
    SEA: "SEA",
    SF: "SF", SFO: "SF",
    TB: "TB", TAM: "TB",
    TEN: "TEN", OTI: "TEN",
    WAS: "WAS",
  };

  return teamMap[team] ?? team;
}

function num(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(rows: Row[], field: string) {
  if (!rows.length) return 0;

  return (
    rows.reduce(
      (sum, row) => sum + num(row[field]),
      0
    ) / rows.length
  );
}

function parseCsv(csv: string) {
  const lines = csv.trim().split(/\r?\n/);

  if (lines.length < 2) return [];

  const headers = lines[0]
    .split(",")
    .map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Row = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });

    return row;
  });
}

function buildMetrics(rows: Row[]) {
  return {
    games: rows.length,

    passing_yards_per_game: Number(
      average(rows, "passing_yards").toFixed(1)
    ),

    rushing_yards_per_game: Number(
      average(rows, "rushing_yards").toFixed(1)
    ),

    passing_tds_per_game: Number(
      average(rows, "passing_tds").toFixed(2)
    ),

    rushing_tds_per_game: Number(
      average(rows, "rushing_tds").toFixed(2)
    ),

    sacks_allowed_per_game: Number(
      average(rows, "sacks_suffered").toFixed(2)
    ),

    passing_epa_per_game: Number(
      average(rows, "passing_epa").toFixed(2)
    ),

    rushing_epa_per_game: Number(
      average(rows, "rushing_epa").toFixed(2)
    ),
  };
}

function getWeights(currentGames: number) {
  if (currentGames >= 8) {
    return {
      weight2024: 0.05,
      weight2025: 0.15,
      weight2026: 0.80,
    };
  }

  if (currentGames >= 6) {
    return {
      weight2024: 0.08,
      weight2025: 0.22,
      weight2026: 0.70,
    };
  }

  if (currentGames >= 4) {
    return {
      weight2024: 0.10,
      weight2025: 0.30,
      weight2026: 0.60,
    };
  }

  if (currentGames >= 2) {
    return {
      weight2024: 0.15,
      weight2025: 0.35,
      weight2026: 0.50,
    };
  }

  if (currentGames === 1) {
    return {
      weight2024: 0.20,
      weight2025: 0.45,
      weight2026: 0.35,
    };
  }

  return {
    weight2024: 0.30,
    weight2025: 0.70,
    weight2026: 0,
  };
}

function blendMetrics(
  metrics2024: ReturnType<typeof buildMetrics>,
  metrics2025: ReturnType<typeof buildMetrics>,
  metrics2026: ReturnType<typeof buildMetrics>
) {
  const weights = getWeights(metrics2026.games);

  const blend = (
    value2024: number,
    value2025: number,
    value2026: number
  ) =>
    Number(
      (
        value2024 * weights.weight2024 +
        value2025 * weights.weight2025 +
        value2026 * weights.weight2026
      ).toFixed(2)
    );

  return {
    games_2024: metrics2024.games,
    games_2025: metrics2025.games,
    games_2026: metrics2026.games,

    weights: {
      season_2024: weights.weight2024,
      season_2025: weights.weight2025,
      season_2026: weights.weight2026,
    },

    passing_yards_per_game: blend(
      metrics2024.passing_yards_per_game,
      metrics2025.passing_yards_per_game,
      metrics2026.passing_yards_per_game
    ),

    rushing_yards_per_game: blend(
      metrics2024.rushing_yards_per_game,
      metrics2025.rushing_yards_per_game,
      metrics2026.rushing_yards_per_game
    ),

    passing_tds_per_game: blend(
      metrics2024.passing_tds_per_game,
      metrics2025.passing_tds_per_game,
      metrics2026.passing_tds_per_game
    ),

    rushing_tds_per_game: blend(
      metrics2024.rushing_tds_per_game,
      metrics2025.rushing_tds_per_game,
      metrics2026.rushing_tds_per_game
    ),

    sacks_allowed_per_game: blend(
      metrics2024.sacks_allowed_per_game,
      metrics2025.sacks_allowed_per_game,
      metrics2026.sacks_allowed_per_game
    ),

    passing_epa_per_game: blend(
      metrics2024.passing_epa_per_game,
      metrics2025.passing_epa_per_game,
      metrics2026.passing_epa_per_game
    ),

    rushing_epa_per_game: blend(
      metrics2024.rushing_epa_per_game,
      metrics2025.rushing_epa_per_game,
      metrics2026.rushing_epa_per_game
    ),
  };
}

function calculateStrength(metrics: any) {
  const offense =
    metrics.passing_yards_per_game * 0.02 +
    metrics.rushing_yards_per_game * 0.03 +
    metrics.passing_tds_per_game * 2 +
    metrics.rushing_tds_per_game * 2;

  const efficiency =
    metrics.passing_epa_per_game * 0.15 +
    metrics.rushing_epa_per_game * 0.15;

  const protection =
    metrics.sacks_allowed_per_game * -0.75;

  return Number(
    (offense + efficiency + protection).toFixed(2)
  );
}

function getLean(
  awayTeam: string,
  homeTeam: string,
  awayScore: number,
  homeScore: number
) {
  const difference = homeScore - awayScore;
  const gap = Math.abs(difference);

  let strength = "Slight";

  if (gap >= 5) strength = "Moderate";
  if (gap >= 10) strength = "Strong";

  return {
    team: difference >= 0 ? homeTeam : awayTeam,
    strength,
    score_difference: Number(gap.toFixed(2)),
  };
}

export async function GET() {
  try {
    const apiKey = process.env.ODDIZE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "ODDIZE_API_KEY is missing" },
        { status: 500 }
      );
    }

    const [
      oddsResponse,
      stats2024Response,
      stats2025Response,
      stats2026Response,
    ] = await Promise.all([
      fetch(
        "https://oddize.com/api/v1/odds/latest?sport=nfl&books=hrb",
        {
          headers: {
            "X-API-Key": apiKey,
          },
          cache: "no-store",
        }
      ),

      fetch(
        "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2024.csv",
        { cache: "no-store" }
      ),

      fetch(
        "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv",
        { cache: "no-store" }
      ),

      fetch(
        "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2026.csv",
        { cache: "no-store" }
      ),
    ]);

    if (!oddsResponse.ok) {
      return NextResponse.json(
        {
          error: "Oddize request failed",
          status: oddsResponse.status,
        },
        { status: 500 }
      );
    }

    if (
      !stats2024Response.ok ||
      !stats2025Response.ok ||
      !stats2026Response.ok
    ) {
      return NextResponse.json(
        {
          error: "NFL stats request failed",
          stats_2024_status: stats2024Response.status,
          stats_2025_status: stats2025Response.status,
          stats_2026_status: stats2026Response.status,
        },
        { status: 500 }
      );
    }

    const oddsData = await oddsResponse.json();

    const stats2024 = parseCsv(
      await stats2024Response.text()
    );

    const stats2025 = parseCsv(
      await stats2025Response.text()
    );

    const stats2026 = parseCsv(
      await stats2026Response.text()
    );

    const getTeamRows = (
      stats: Row[],
      team: string
    ) =>
      stats.filter(
        (row) =>
          normalizeTeam(row.team) ===
          normalizeTeam(team)
      );

    const games = (oddsData.events ?? [])
      .map((event: any) => {
        const odds = event.odds ?? [];

        const away2024 = getTeamRows(
          stats2024,
          event.team1
        );

        const home2024 = getTeamRows(
          stats2024,
          event.team2
        );

        const away2025 = getTeamRows(
          stats2025,
          event.team1
        );

        const home2025 = getTeamRows(
          stats2025,
          event.team2
        );

        const away2026 = getTeamRows(
          stats2026,
          event.team1
        );

        const home2026 = getTeamRows(
          stats2026,
          event.team2
        );

        const awayMetrics = blendMetrics(
          buildMetrics(away2024),
          buildMetrics(away2025),
          buildMetrics(away2026)
        );

        const homeMetrics = blendMetrics(
          buildMetrics(home2024),
          buildMetrics(home2025),
          buildMetrics(home2026)
        );

        const awayStrength =
          calculateStrength(awayMetrics);

        const homeStrength =
          calculateStrength(homeMetrics);

        const lean = getLean(
          event.team1,
          event.team2,
          awayStrength,
          homeStrength
        );

        const moneyline = odds
          .filter((o: any) => o.market === "moneyline")
          .map((o: any) => ({
            team: o.team,
            odds: o.american_odds,
          }));

        const spread = odds
          .filter((o: any) => o.market === "spread")
          .map((o: any) => ({
            team: o.team,
            line: o.line,
            odds: o.american_odds,
          }));

        const total = odds
          .filter((o: any) => o.market === "total")
          .map((o: any) => ({
            side: o.team,
            line: o.line,
            odds: o.american_odds,
          }));

        return {
          event_id: event.event_id,
          start_date: event.start_date,

          away_team: event.team1,
          home_team: event.team2,

          moneyline,
          spread,
          total,

          stats_connected:
            away2024.length > 0 &&
            home2024.length > 0 &&
            away2025.length > 0 &&
            home2025.length > 0 &&
            away2026.length > 0 &&
            home2026.length > 0,

          away_metrics: awayMetrics,
          home_metrics: homeMetrics,

          rdg_analysis: {
            away_strength: awayStrength,
            home_strength: homeStrength,
            lean,
            data_note:
              "2024 + 2025 historical data blended with 2026 current-season performance",
          },
        };
      })
      .filter(
        (game: any) =>
          game.moneyline.length > 0 ||
          game.spread.length > 0 ||
          game.total.length > 0
      )
      .sort(
        (a: any, b: any) =>
          new Date(a.start_date).getTime() -
          new Date(b.start_date).getTime()
      );

    return NextResponse.json({
      sportsbook: "Hard Rock Bet",
      sport: "NFL",

      model_version: "RDG NFL v0.3",

      methodology:
        "2024 + 2025 historical baseline blended with 2026 current-season statistics",

      games_found: games.length,

      games_with_stats: games.filter(
        (game: any) => game.stats_connected
      ).length,

      games,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Analysis route failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
