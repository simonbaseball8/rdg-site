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
    rows.reduce((sum, row) => sum + num(row[field]), 0) /
    rows.length
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

function getTeamRows(stats: Row[], team: string) {
  return stats.filter(
    (row) =>
      normalizeTeam(row.team) === normalizeTeam(team)
  );
}

function getOpponentRows(stats: Row[], team: string) {
  const teamCode = normalizeTeam(team);

  const teamGames = stats.filter(
    (row) => normalizeTeam(row.team) === teamCode
  );

  const opponentRows: Row[] = [];

  for (const teamGame of teamGames) {
    const opponent = stats.find(
      (row) =>
        row.game_id === teamGame.game_id &&
        normalizeTeam(row.team) !== teamCode
    );

    if (opponent) {
      opponentRows.push(opponent);
    }
  }

  return opponentRows;
}

function buildOffense(rows: Row[]) {
  return {
    games: rows.length,
    passing_yards: Number(average(rows, "passing_yards").toFixed(2)),
    rushing_yards: Number(average(rows, "rushing_yards").toFixed(2)),
    passing_tds: Number(average(rows, "passing_tds").toFixed(2)),
    rushing_tds: Number(average(rows, "rushing_tds").toFixed(2)),
    sacks_allowed: Number(average(rows, "sacks_suffered").toFixed(2)),
    passing_epa: Number(average(rows, "passing_epa").toFixed(2)),
    rushing_epa: Number(average(rows, "rushing_epa").toFixed(2)),
  };
}

function buildDefense(rows: Row[]) {
  return {
    games: rows.length,
    passing_yards_allowed: Number(
      average(rows, "passing_yards").toFixed(2)
    ),
    rushing_yards_allowed: Number(
      average(rows, "rushing_yards").toFixed(2)
    ),
    passing_tds_allowed: Number(
      average(rows, "passing_tds").toFixed(2)
    ),
    rushing_tds_allowed: Number(
      average(rows, "rushing_tds").toFixed(2)
    ),
    sacks_generated: Number(
      average(rows, "sacks_suffered").toFixed(2)
    ),
    passing_epa_allowed: Number(
      average(rows, "passing_epa").toFixed(2)
    ),
    rushing_epa_allowed: Number(
      average(rows, "rushing_epa").toFixed(2)
    ),
  };
}

function getWeights(currentGames: number) {
  if (currentGames >= 8)
    return { w24: 0.05, w25: 0.15, w26: 0.8 };

  if (currentGames >= 6)
    return { w24: 0.08, w25: 0.22, w26: 0.7 };

  if (currentGames >= 4)
    return { w24: 0.1, w25: 0.3, w26: 0.6 };

  if (currentGames >= 2)
    return { w24: 0.15, w25: 0.35, w26: 0.5 };

  if (currentGames === 1)
    return { w24: 0.2, w25: 0.45, w26: 0.35 };

  return { w24: 0.3, w25: 0.7, w26: 0 };
}

function blend(
  value24: number,
  value25: number,
  value26: number,
  weights: ReturnType<typeof getWeights>
) {
  return Number(
    (
      value24 * weights.w24 +
      value25 * weights.w25 +
      value26 * weights.w26
    ).toFixed(2)
  );
}

function buildTeamProfile(
  stats24: Row[],
  stats25: Row[],
  stats26: Row[],
  team: string
) {
  const offense24 = buildOffense(getTeamRows(stats24, team));
  const offense25 = buildOffense(getTeamRows(stats25, team));
  const offense26 = buildOffense(getTeamRows(stats26, team));

  const defense24 = buildDefense(getOpponentRows(stats24, team));
  const defense25 = buildDefense(getOpponentRows(stats25, team));
  const defense26 = buildDefense(getOpponentRows(stats26, team));

  const weights = getWeights(offense26.games);

  return {
    games: {
      season_2024: offense24.games,
      season_2025: offense25.games,
      season_2026: offense26.games,
    },

    defensive_games: {
      season_2024: defense24.games,
      season_2025: defense25.games,
      season_2026: defense26.games,
    },

    weights: {
      season_2024: weights.w24,
      season_2025: weights.w25,
      season_2026: weights.w26,
    },

    offense: {
      passing_yards: blend(
        offense24.passing_yards,
        offense25.passing_yards,
        offense26.passing_yards,
        weights
      ),
      rushing_yards: blend(
        offense24.rushing_yards,
        offense25.rushing_yards,
        offense26.rushing_yards,
        weights
      ),
      passing_tds: blend(
        offense24.passing_tds,
        offense25.passing_tds,
        offense26.passing_tds,
        weights
      ),
      rushing_tds: blend(
        offense24.rushing_tds,
        offense25.rushing_tds,
        offense26.rushing_tds,
        weights
      ),
      sacks_allowed: blend(
        offense24.sacks_allowed,
        offense25.sacks_allowed,
        offense26.sacks_allowed,
        weights
      ),
      passing_epa: blend(
        offense24.passing_epa,
        offense25.passing_epa,
        offense26.passing_epa,
        weights
      ),
      rushing_epa: blend(
        offense24.rushing_epa,
        offense25.rushing_epa,
        offense26.rushing_epa,
        weights
      ),
    },

    defense: {
      passing_yards_allowed: blend(
        defense24.passing_yards_allowed,
        defense25.passing_yards_allowed,
        defense26.passing_yards_allowed,
        weights
      ),
      rushing_yards_allowed: blend(
        defense24.rushing_yards_allowed,
        defense25.rushing_yards_allowed,
        defense26.rushing_yards_allowed,
        weights
      ),
      passing_tds_allowed: blend(
        defense24.passing_tds_allowed,
        defense25.passing_tds_allowed,
        defense26.passing_tds_allowed,
        weights
      ),
      rushing_tds_allowed: blend(
        defense24.rushing_tds_allowed,
        defense25.rushing_tds_allowed,
        defense26.rushing_tds_allowed,
        weights
      ),
      sacks_generated: blend(
        defense24.sacks_generated,
        defense25.sacks_generated,
        defense26.sacks_generated,
        weights
      ),
      passing_epa_allowed: blend(
        defense24.passing_epa_allowed,
        defense25.passing_epa_allowed,
        defense26.passing_epa_allowed,
        weights
      ),
      rushing_epa_allowed: blend(
        defense24.rushing_epa_allowed,
        defense25.rushing_epa_allowed,
        defense26.rushing_epa_allowed,
        weights
      ),
    },
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

function matchupScore(
  offenseProfile: any,
  opponentProfile: any
) {
  return Number(
    (
      offenseScore(offenseProfile) +
      defenseScore(opponentProfile)
    ).toFixed(2)
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

/*
  v0.5:
  Compare the direction of RDG's matchup advantage
  against the sportsbook spread.

  This does NOT claim the RDG score equals projected
  NFL points. Calibration comes later.
*/
function analyzeMarket(
  awayTeam: string,
  homeTeam: string,
  awayScore: number,
  homeScore: number,
  spread: any[],
  moneyline: any[]
) {
  const modelDifference = Number(
    (homeScore - awayScore).toFixed(2)
  );

  const modelLean =
    modelDifference > 0
      ? homeTeam
      : modelDifference < 0
      ? awayTeam
      : "EVEN";

  const homeSpread = spread.find(
    (item: any) =>
      normalizeTeam(item.team) === normalizeTeam(homeTeam)
  );

  const awaySpread = spread.find(
    (item: any) =>
      normalizeTeam(item.team) === normalizeTeam(awayTeam)
  );

  const homeMoneyline = moneyline.find(
    (item: any) =>
      normalizeTeam(item.team) === normalizeTeam(homeTeam)
  );

  const awayMoneyline = moneyline.find(
    (item: any) =>
      normalizeTeam(item.team) === normalizeTeam(awayTeam)
  );

  let marketFavorite = "EVEN";

  if (homeSpread && Number(homeSpread.line) < 0) {
    marketFavorite = homeTeam;
  } else if (awaySpread && Number(awaySpread.line) < 0) {
    marketFavorite = awayTeam;
  }

  const modelMarketAgreement =
    modelLean === "EVEN" ||
    marketFavorite === "EVEN"
      ? "neutral"
      : modelLean === marketFavorite
      ? "agree"
      : "disagree";

  let reviewPriority = "Low";

  const gap = Math.abs(modelDifference);

  if (gap >= 3) reviewPriority = "Medium";
  if (gap >= 6) reviewPriority = "High";

  if (
    modelMarketAgreement === "disagree" &&
    gap >= 3
  ) {
    reviewPriority = "High";
  }

  return {
    model_difference: modelDifference,
    model_lean: modelLean,

    market_favorite: marketFavorite,

    hard_rock_spread: {
      away_team: awayTeam,
      away_line: awaySpread?.line ?? null,
      away_odds: awaySpread?.odds ?? null,

      home_team: homeTeam,
      home_line: homeSpread?.line ?? null,
      home_odds: homeSpread?.odds ?? null,
    },

    hard_rock_moneyline: {
      away_team: awayTeam,
      away_odds: awayMoneyline?.odds ?? null,

      home_team: homeTeam,
      home_odds: homeMoneyline?.odds ?? null,
    },

    model_market_agreement: modelMarketAgreement,

    review_priority: reviewPriority,

    calibration_note:
      "RDG matchup score is not yet calibrated to projected point margin, so this is a market comparison signal rather than a quantified betting edge.",
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
      response24,
      response25,
      response26,
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

    if (!response24.ok || !response25.ok || !response26.ok) {
      return NextResponse.json(
        {
          error: "NFL stats request failed",
          stats_2024_status: response24.status,
          stats_2025_status: response25.status,
          stats_2026_status: response26.status,
        },
        { status: 500 }
      );
    }

    const oddsData = await oddsResponse.json();

    const stats24 = parseCsv(await response24.text());
    const stats25 = parseCsv(await response25.text());
    const stats26 = parseCsv(await response26.text());

    const games = (oddsData.events ?? [])
      .map((event: any) => {
        const odds = event.odds ?? [];

        const awayProfile = buildTeamProfile(
          stats24,
          stats25,
          stats26,
          event.team1
        );

        const homeProfile = buildTeamProfile(
          stats24,
          stats25,
          stats26,
          event.team2
        );

        const awayScore = matchupScore(
          awayProfile,
          homeProfile
        );

        const homeScore = matchupScore(
          homeProfile,
          awayProfile
        );

        const lean = getLean(
          event.team1,
          event.team2,
          awayScore,
          homeScore
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

        const marketAnalysis = analyzeMarket(
          event.team1,
          event.team2,
          awayScore,
          homeScore,
          spread,
          moneyline
        );

        const statsConnected =
          awayProfile.games.season_2024 > 0 &&
          awayProfile.games.season_2025 > 0 &&
          awayProfile.games.season_2026 > 0 &&
          homeProfile.games.season_2024 > 0 &&
          homeProfile.games.season_2025 > 0 &&
          homeProfile.games.season_2026 > 0 &&
          awayProfile.defensive_games.season_2024 > 0 &&
          awayProfile.defensive_games.season_2025 > 0 &&
          awayProfile.defensive_games.season_2026 > 0 &&
          homeProfile.defensive_games.season_2024 > 0 &&
          homeProfile.defensive_games.season_2025 > 0 &&
          homeProfile.defensive_games.season_2026 > 0;

        return {
          event_id: event.event_id,
          start_date: event.start_date,

          away_team: event.team1,
          home_team: event.team2,

          moneyline,
          spread,
          total,

          stats_connected: statsConnected,

          away_profile: awayProfile,
          home_profile: homeProfile,

          rdg_analysis: {
            away_matchup_score: awayScore,
            home_matchup_score: homeScore,
            lean,

            market_analysis: marketAnalysis,

            data_note:
              "2024 + 2025 + 2026 weighted offense, defense, and Hard Rock market comparison",
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

      model_version: "RDG NFL v0.5",

      methodology:
        "2024 + 2025 + 2026 weighted offense/defense model compared with current Hard Rock lines",

      games_found: games.length,

      games_with_stats: games.filter(
        (game: any) => game.stats_connected
      ).length,

      high_priority_reviews: games.filter(
        (game: any) =>
          game.rdg_analysis.market_analysis.review_priority ===
          "High"
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
