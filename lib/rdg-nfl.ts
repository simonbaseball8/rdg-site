import { loadNflMarketFeed } from "./nfl-market-feed";

type Row = Record<string, string>;

const HOME_FIELD_ADVANTAGE = 1.5;

const CALIBRATION_INTERCEPT = 1.1785;
const CALIBRATION_SLOPE = 1.2456;

function normalizeTeam(team: string) {
  const map: Record<string, string> = {
    ARI: "ARI",
    CRD: "ARI",
    ATL: "ATL",
    BAL: "BAL",
    RAV: "BAL",
    BUF: "BUF",
    CAR: "CAR",
    CHI: "CHI",
    CIN: "CIN",
    CLE: "CLE",
    CLV: "CLE",
    DAL: "DAL",
    DEN: "DEN",
    DET: "DET",
    GB: "GB",
    GNB: "GB",
    HOU: "HOU",
    HTX: "HOU",
    IND: "IND",
    CLT: "IND",
    JAX: "JAX",
    KC: "KC",
    KAN: "KC",
    LAC: "LAC",
    SDG: "LAC",
    LA: "LA",
    LAR: "LA",
    RAM: "LA",
    LV: "LV",
    RAI: "LV",
    MIA: "MIA",
    MIN: "MIN",
    NE: "NE",
    NWE: "NE",
    NO: "NO",
    NOR: "NO",
    NYG: "NYG",
    NYJ: "NYJ",
    PHI: "PHI",
    PIT: "PIT",
    SEA: "SEA",
    SF: "SF",
    SFO: "SF",
    TB: "TB",
    TAM: "TB",
    TEN: "TEN",
    OTI: "TEN",
    WAS: "WAS",
  };

  return map[team] ?? team;
}

function num(
  value: string | number | undefined | null
) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split(/\r?\n/);

  if (lines.length < 2) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim());

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
    (row) =>
      (row.season_type ?? "")
        .trim()
        .toUpperCase() === "REG"
  );
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

function weightedAverage(
  rows: Row[],
  field: string
) {
  if (!rows.length) return 0;

  const sorted = [...rows].sort(
    (a, b) => num(a.week) - num(b.week)
  );

  let total = 0;
  let totalWeight = 0;

  sorted.forEach((row, index) => {
    const weight = 1 + index * 0.12;

    total += num(row[field]) * weight;
    totalWeight += weight;
  });

  return totalWeight
    ? total / totalWeight
    : 0;
}

function teamRows(
  rows: Row[],
  team: string
) {
  const code = normalizeTeam(team);

  return rows.filter(
    (row) =>
      normalizeTeam(row.team) === code
  );
}

function opponentRows(
  rows: Row[],
  team: string
) {
  const code = normalizeTeam(team);
  const games = teamRows(rows, team);
  const opponents: Row[] = [];

  for (const game of games) {
    const opponent = rows.find(
      (row) =>
        row.game_id === game.game_id &&
        normalizeTeam(row.team) !== code
    );

    if (opponent) {
      opponents.push(opponent);
    }
  }

  return opponents;
}

function offense(
  rows: Row[],
  recent = false
) {
  const avg = recent
    ? weightedAverage
    : average;

  return {
    passing_yards: avg(
      rows,
      "passing_yards"
    ),

    rushing_yards: avg(
      rows,
      "rushing_yards"
    ),

    passing_tds: avg(
      rows,
      "passing_tds"
    ),

    rushing_tds: avg(
      rows,
      "rushing_tds"
    ),

    sacks_allowed: avg(
      rows,
      "sacks_suffered"
    ),

    passing_epa: avg(
      rows,
      "passing_epa"
    ),

    rushing_epa: avg(
      rows,
      "rushing_epa"
    ),
  };
}

function defense(
  rows: Row[],
  recent = false
) {
  const avg = recent
    ? weightedAverage
    : average;

  return {
    passing_yards_allowed: avg(
      rows,
      "passing_yards"
    ),

    rushing_yards_allowed: avg(
      rows,
      "rushing_yards"
    ),

    passing_tds_allowed: avg(
      rows,
      "passing_tds"
    ),

    rushing_tds_allowed: avg(
      rows,
      "rushing_tds"
    ),

    sacks_generated: avg(
      rows,
      "sacks_suffered"
    ),

    passing_epa_allowed: avg(
      rows,
      "passing_epa"
    ),

    rushing_epa_allowed: avg(
      rows,
      "rushing_epa"
    ),
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
  const currentW = currentWeight(games);
  const historicalW = 1 - currentW;

  return (
    historical * historicalW +
    current * currentW
  );
}

function buildProfile(
  historicalRows: Row[],
  currentRows: Row[],
  team: string
) {
  const historicalTeam =
    teamRows(historicalRows, team);

  const currentTeam =
    teamRows(currentRows, team);

  const historicalOpp =
    opponentRows(historicalRows, team);

  const currentOpp =
    opponentRows(currentRows, team);

  const historicalOffense =
    offense(historicalTeam);

  const currentOffense =
    offense(currentTeam, true);

  const historicalDefense =
    defense(historicalOpp);

  const currentDefense =
    defense(currentOpp, true);

  const games = currentTeam.length;

  return {
    current_season_games: games,

    current_season_weight:
      Number(
        currentWeight(games).toFixed(2)
      ),

    offense: {
      passing_yards: blend(
        historicalOffense.passing_yards,
        currentOffense.passing_yards,
        games
      ),

      rushing_yards: blend(
        historicalOffense.rushing_yards,
        currentOffense.rushing_yards,
        games
      ),

      passing_tds: blend(
        historicalOffense.passing_tds,
        currentOffense.passing_tds,
        games
      ),

      rushing_tds: blend(
        historicalOffense.rushing_tds,
        currentOffense.rushing_tds,
        games
      ),

      sacks_allowed: blend(
        historicalOffense.sacks_allowed,
        currentOffense.sacks_allowed,
        games
      ),

      passing_epa: blend(
        historicalOffense.passing_epa,
        currentOffense.passing_epa,
        games
      ),

      rushing_epa: blend(
        historicalOffense.rushing_epa,
        currentOffense.rushing_epa,
        games
      ),
    },

    defense: {
      passing_yards_allowed: blend(
        historicalDefense.passing_yards_allowed,
        currentDefense.passing_yards_allowed,
        games
      ),

      rushing_yards_allowed: blend(
        historicalDefense.rushing_yards_allowed,
        currentDefense.rushing_yards_allowed,
        games
      ),

      passing_tds_allowed: blend(
        historicalDefense.passing_tds_allowed,
        currentDefense.passing_tds_allowed,
        games
      ),

      rushing_tds_allowed: blend(
        historicalDefense.rushing_tds_allowed,
        currentDefense.rushing_tds_allowed,
        games
      ),

      sacks_generated: blend(
        historicalDefense.sacks_generated,
        currentDefense.sacks_generated,
        games
      ),

      passing_epa_allowed: blend(
        historicalDefense.passing_epa_allowed,
        currentDefense.passing_epa_allowed,
        games
      ),

      rushing_epa_allowed: blend(
        historicalDefense.rushing_epa_allowed,
        currentDefense.rushing_epa_allowed,
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
  return (
    offenseScore(profile) +
    defenseScore(profile)
  );
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
    const teamCode = normalizeTeam(team);

    const opponent = current.find(
      (x) =>
        x.game_id === row.game_id &&
        normalizeTeam(x.team) !== teamCode
    );

    if (opponent) {
      opponents.push(opponent.team);
    }
  }

  if (!opponents.length) return 0;

  const opponentStrengths =
    opponents.map((opponent) => {
      const profile = buildProfile(
        historical,
        current,
        opponent
      );

      return teamStrength(profile);
    });

  const teams = Array.from(
    new Set(
      historical.map((row) =>
        normalizeTeam(row.team)
      )
    )
  );

  const leagueStrengths =
    teams.map((team) =>
      teamStrength(
        buildProfile(
          historical,
          current,
          team
        )
      )
    );

  const leagueAverage =
    leagueStrengths.reduce(
      (a, b) => a + b,
      0
    ) /
    Math.max(
      leagueStrengths.length,
      1
    );

  const opponentAverage =
    opponentStrengths.reduce(
      (a, b) => a + b,
      0
    ) /
    Math.max(
      opponentStrengths.length,
      1
    );

  return (
    (opponentAverage - leagueAverage) *
    0.15
  );
}

function projectedMargin(
  historical: Row[],
  current: Row[],
  awayTeam: string,
  homeTeam: string
) {
  const awayProfile = buildProfile(
    historical,
    current,
    awayTeam
  );

  const homeProfile = buildProfile(
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
    teamStrength(awayProfile) +
    awaySOS;

  const homeRating =
    teamStrength(homeProfile) +
    homeSOS +
    HOME_FIELD_ADVANTAGE;

  const rawDifference =
    homeRating - awayRating;

  const calibrated =
    CALIBRATION_INTERCEPT +
    CALIBRATION_SLOPE *
      rawDifference;

  return {
    awayProfile,
    homeProfile,

    rawDifference: Number(
      rawDifference.toFixed(2)
    ),

    projectedMargin: Number(
      calibrated.toFixed(2)
    ),

    awaySOS: Number(
      awaySOS.toFixed(2)
    ),

    homeSOS: Number(
      homeSOS.toFixed(2)
    ),
  };
}

function historicalBucket(
  projected: number
) {
  const value = Math.abs(projected);

  if (value < 3) {
    return {
      bucket: "Under 3",
      sample: 48,
      correct: 23,
      historical_winner_accuracy: 47.92,
      signal: "Weak",
    };
  }

  if (value < 6) {
    return {
      bucket: "3 to 6",
      sample: 42,
      correct: 23,
      historical_winner_accuracy: 54.76,
      signal: "Moderate",
    };
  }

  if (value < 10) {
    return {
      bucket: "6 to 10",
      sample: 34,
      correct: 24,
      historical_winner_accuracy: 70.59,
      signal: "Strong",
    };
  }

  return {
    bucket: "10+",
    sample: 13,
    correct: 12,
    historical_winner_accuracy: 92.31,
    signal: "Very Strong",
  };
}

function americanToImplied(
  odds: string | number | null
) {
  if (odds === null) return null;

  const value = num(odds);

  if (value === 0) return null;

  if (value > 0) {
    return Number(
      (
        100 /
        (value + 100) *
        100
      ).toFixed(2)
    );
  }

  return Number(
    (
      Math.abs(value) /
      (Math.abs(value) + 100) *
      100
    ).toFixed(2)
  );
}

function analyzeMarket(
  awayTeam: string,
  homeTeam: string,
  projection: number,
  spread: any[],
  moneyline: any[]
) {
  const homeSpread = spread.find(
    (item: any) =>
      normalizeTeam(item.team) ===
      normalizeTeam(homeTeam)
  );

  const awaySpread = spread.find(
    (item: any) =>
      normalizeTeam(item.team) ===
      normalizeTeam(awayTeam)
  );

  const homeML = moneyline.find(
    (item: any) =>
      normalizeTeam(item.team) ===
      normalizeTeam(homeTeam)
  );

  const awayML = moneyline.find(
    (item: any) =>
      normalizeTeam(item.team) ===
      normalizeTeam(awayTeam)
  );

  const modelFavorite =
    projection > 0
      ? homeTeam
      : projection < 0
      ? awayTeam
      : "EVEN";

  let marketFavorite = "EVEN";

  if (
    homeSpread &&
    num(homeSpread.line) < 0
  ) {
    marketFavorite = homeTeam;
  } else if (
    awaySpread &&
    num(awaySpread.line) < 0
  ) {
    marketFavorite = awayTeam;
  }

  const marketHomeMargin =
    homeSpread
      ? -num(homeSpread.line)
      : null;

  const marketDifference =
    marketHomeMargin !== null
      ? Number(
          (
            projection -
            marketHomeMargin
          ).toFixed(2)
        )
      : null;

  let spreadLean = "NO SPREAD";

  if (marketDifference !== null) {
    if (marketDifference > 0) {
      spreadLean = homeTeam;
    } else if (marketDifference < 0) {
      spreadLean = awayTeam;
    } else {
      spreadLean = "EVEN";
    }
  }

  const edgeSize =
    marketDifference !== null
      ? Math.abs(marketDifference)
      : 0;

  let marketSignal = "Pass";

  if (edgeSize >= 2) {
    marketSignal = "Watch";
  }

  if (edgeSize >= 3.5) {
    marketSignal = "Strong Review";
  }

  if (edgeSize >= 5) {
    marketSignal = "Priority Review";
  }

  return {
    model_favorite: modelFavorite,
    market_favorite: marketFavorite,

    model_projected_home_margin:
      projection,

    market_implied_home_margin:
      marketHomeMargin,

    model_vs_market_difference:
      marketDifference,

    spread_lean: spreadLean,

    market_signal: marketSignal,

    hard_rock_spread: {
      away_team: awayTeam,
      away_line:
        awaySpread?.line ?? null,
      away_odds:
        awaySpread?.odds ?? null,

      home_team: homeTeam,
      home_line:
        homeSpread?.line ?? null,
      home_odds:
        homeSpread?.odds ?? null,
    },

    hard_rock_moneyline: {
      away_team: awayTeam,
      away_odds:
        awayML?.odds ?? null,

      away_implied_probability:
        americanToImplied(
          awayML?.odds ?? null
        ),

      home_team: homeTeam,
      home_odds:
        homeML?.odds ?? null,

      home_implied_probability:
        americanToImplied(
          homeML?.odds ?? null
        ),
    },
  };
}

export async function getRdgNflAnalysis() {
  const apiKey =
    process.env.ODDS_API_KEY;

  const [
    marketFeed,
    stats25Response,
    stats26Response,
    scheduleResponse,
  ] = await Promise.all([
    loadNflMarketFeed(apiKey),

    fetch(
      "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv",
      {
        cache: "no-store",
      }
    ),

    fetch(
      "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2026.csv",
      {
        cache: "no-store",
      }
    ),

    fetch(
      "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv",
      {
        cache: "no-store",
      }
    ),
  ]);


  if (
    !stats25Response.ok ||
    !stats26Response.ok ||
    !scheduleResponse.ok
  ) {
    throw new Error(
      `NFL data request failed. 2025 stats: ${stats25Response.status}, 2026 stats: ${stats26Response.status}, schedule: ${scheduleResponse.status}`
    );
  }

  const oddsData = marketFeed;

  const historical =
    regularSeason(
      parseCsv(
        await stats25Response.text()
      )
    );

  const current =
    regularSeason(
      parseCsv(
        await stats26Response.text()
      )
    );

  const scheduleRows = parseCsv(
    await scheduleResponse.text()
  ).filter(
    (row) =>
      num(row.season) === 2026 &&
      (row.game_type ?? "").trim().toUpperCase() === "REG"
  );

  const todayDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Rolling NFL betting board: today through the next 7 calendar days.
  const windowStart = todayDate;
  const windowEndDate = new Date(`${todayDate}T12:00:00-04:00`);
  windowEndDate.setDate(windowEndDate.getDate() + 7);

  const windowEnd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(windowEndDate);

  const slate = scheduleRows.filter((row) => {
    const gameDate = (row.gameday ?? "").trim();
    return gameDate && gameDate >= windowStart && gameDate <= windowEnd;
  });

  const weeksInWindow = Array.from(
    new Set(slate.map((row) => num(row.week)))
  ).sort((a, b) => a - b);

  const nextWeek = weeksInWindow[0] ?? 1;

  const marketEvents = oddsData.events ?? [];

  function findMarketEvent(awayTeam: string, homeTeam: string) {
    return marketEvents.find(
      (event: any) =>
        normalizeTeam(event.team1) === normalizeTeam(awayTeam) &&
        normalizeTeam(event.team2) === normalizeTeam(homeTeam)
    );
  }

  const nowMs = Date.now();

  const games = slate
    .map((schedule: Row) => {
      const awayTeam = normalizeTeam(schedule.away_team);
      const homeTeam = normalizeTeam(schedule.home_team);
      const event = findMarketEvent(awayTeam, homeTeam);
      const odds = event?.odds ?? [];

      const moneyline = odds
        .filter(
          (o: any) =>
            o.market === "moneyline"
        )
        .map((o: any) => ({
          team: o.team,
          odds: o.american_odds,
        }));

      const spread = odds
        .filter(
          (o: any) =>
            o.market === "spread"
        )
        .map((o: any) => ({
          team: o.team,
          line: o.line,
          odds: o.american_odds,
        }));

      const total = odds
        .filter(
          (o: any) =>
            o.market === "total"
        )
        .map((o: any) => ({
          side: o.team,
          line: o.line,
          odds: o.american_odds,
        }));

      const model =
        projectedMargin(
          historical,
          current,
          awayTeam,
          homeTeam
        );

      const bucket =
        historicalBucket(
          model.projectedMargin
        );

      const market =
        analyzeMarket(
          awayTeam,
          homeTeam,
          model.projectedMargin,
          spread,
          moneyline
        );

      const statsConnected =
        model.awayProfile
          .current_season_games > 0 &&
        model.homeProfile
          .current_season_games > 0;

      return {
        event_id:
          event?.event_id ??
          schedule.game_id ??
          `${schedule.season}_${schedule.week}_${awayTeam}_${homeTeam}`,

        start_date:
          event?.start_date ??
          `${schedule.gameday}T${schedule.gametime || "12:00"}:00-04:00`,

        away_team:
          awayTeam,

        home_team:
          homeTeam,

        schedule_week:
          num(schedule.week),

        odds_available:
          Boolean(event),

        moneyline,
        spread,
        total,

        stats_connected:
          statsConnected,

        rdg: {
          raw_rating_difference:
            model.rawDifference,

          projected_home_margin:
            model.projectedMargin,

          projected_winner:
            model.projectedMargin > 0
              ? homeTeam
              : model.projectedMargin < 0
              ? awayTeam
              : "EVEN",

          projected_margin:
            Math.abs(
              model.projectedMargin
            ),

          home_field_adjustment:
            HOME_FIELD_ADVANTAGE,

          strength_of_schedule: {
            away:
              model.awaySOS,
            home:
              model.homeSOS,
          },

          historical_signal:
            bucket,

          market_analysis:
            market,
        },

        profiles: {
          away:
            model.awayProfile,

          home:
            model.homeProfile,
        },
      };
    })
    .sort(
      (a: any, b: any) =>
        new Date(
          a.start_date
        ).getTime() -
        new Date(
          b.start_date
        ).getTime()
    );

  const priorityGames =
    games.filter(
      (game: any) =>
        game.rdg.market_analysis
          .market_signal ===
        "Priority Review"
    );

  const strongGames =
    games.filter(
      (game: any) =>
        game.rdg.market_analysis
          .market_signal ===
        "Strong Review"
    );

  return {
    market_data_available: marketFeed.available,
    market_data_warning: marketFeed.warning,

    sportsbook:
      "Hard Rock Bet",

    sport: "NFL",

    model:
      "RDG NFL Live",

    version: "1.5-rolling-7-day-window",

    model_status:
      "Backtested",

    backtest: {
      evaluation_games: 137,

      winner_accuracy:
        59.85,

      margin_mae:
        10.29,

      note:
        "Backtest results describe historical out-of-sample performance and are not probabilities for individual future games. nflverse remains the schedule master. RDG uses a rolling 7-day NFL betting window from today through the next 7 calendar days, allowing adjacent NFL weeks to appear together when applicable. Live Hard Rock markets are attached from Oddize when available.",
    },

    calibration: {
      intercept:
        CALIBRATION_INTERCEPT,

      slope:
        CALIBRATION_SLOPE,
    },

    schedule_source:
      "nflverse nfldata games.csv",

    schedule_week:
      nextWeek,

    schedule_weeks:
      weeksInWindow,

    betting_window: {
      start_date: windowStart,
      end_date: windowEnd,
      days_forward: 7,
    },

    weekly_schedule_games:
      slate.length,

    upcoming_games:
      games.filter(
        (game: any) =>
          new Date(game.start_date).getTime() > nowMs
      ).length,

    games_found:
      games.length,

    games_with_stats:
      games.filter(
        (game: any) =>
          game.stats_connected
      ).length,

    priority_reviews:
      priorityGames.length,

    strong_reviews:
      strongGames.length,

    updated_at:
      new Date().toISOString(),

    games,
  };
}
