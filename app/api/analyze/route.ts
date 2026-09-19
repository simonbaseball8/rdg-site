import { NextResponse } from "next/server";

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

function number(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(
  rows: Record<string, string>[],
  field: string
) {
  if (!rows.length) return 0;

  return (
    rows.reduce(
      (sum, row) => sum + number(row[field]),
      0
    ) / rows.length
  );
}

function buildTeamMetrics(
  rows: Record<string, string>[]
) {
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

    const oddsResponse = await fetch(
      "https://oddize.com/api/v1/odds/latest?sport=nfl&books=hrb",
      {
        headers: {
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      }
    );

    if (!oddsResponse.ok) {
      return NextResponse.json(
        {
          error: "Oddize request failed",
          status: oddsResponse.status,
        },
        { status: 500 }
      );
    }

    const oddsData = await oddsResponse.json();

    const statsResponse = await fetch(
      "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2026.csv",
      { cache: "no-store" }
    );

    if (!statsResponse.ok) {
      return NextResponse.json(
        {
          error: "NFL stats request failed",
          status: statsResponse.status,
        },
        { status: 500 }
      );
    }

    const statsCsv = await statsResponse.text();

    const lines = statsCsv.trim().split(/\r?\n/);
    const headers = lines[0]
      .split(",")
      .map((header) => header.trim());

    const stats = lines.slice(1).map((line) => {
      const values = line.split(",");
      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        row[header] = values[index]?.trim() ?? "";
      });

      return row;
    });

    const teamStats = new Map<
      string,
      Record<string, string>[]
    >();

    for (const row of stats) {
      if (!row.team) continue;

      if (!teamStats.has(row.team)) {
        teamStats.set(row.team, []);
      }

      teamStats.get(row.team)!.push(row);
    }

    const games = (oddsData.events ?? [])
      .map((event: any) => {
        const odds = event.odds ?? [];

        const awayCode = normalizeTeam(event.team1);
        const homeCode = normalizeTeam(event.team2);

        const awayStats = teamStats.get(awayCode) ?? [];
        const homeStats = teamStats.get(homeCode) ?? [];

        const awayMetrics = buildTeamMetrics(awayStats);
        const homeMetrics = buildTeamMetrics(homeStats);

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
            awayStats.length > 0 &&
            homeStats.length > 0,

          away_metrics: awayMetrics,
          home_metrics: homeMetrics,

          rdg_analysis: {
            away_strength: awayStrength,
            home_strength: homeStrength,
            lean,
            sample_size_warning:
              awayMetrics.games < 3 ||
              homeMetrics.games < 3
                ? "Small sample size"
                : null,
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
      games_found: games.length,

      games_with_stats: games.filter(
        (game: any) => game.stats_connected
      ).length,

      model_version: "RDG NFL v0.1",

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
