import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

type Row = Record<string, string>;

type Defense = {
  team: string;
  season: number;
  games: Set<string>;

  passAttempts: number;
  passYards: number;

  rushAttempts: number;
  rushYards: number;

  sacks: number;
  interceptions: number;
  fumblesLost: number;

  totalPlays: number;
  totalYards: number;
};

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

function txt(v: any): string {
  return String(v ?? "").trim();
}

function num(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round(v: number | null, digits = 1) {
  if (v === null || !Number.isFinite(v)) return null;

  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeTeam(v: any): string {
  const t = txt(v).toUpperCase();

  const aliases: Record<string, string> = {
    JAC: "JAX",
    SD: "LAC",
    SDG: "LAC",
    OAK: "LV",
    RAI: "LV",
    STL: "LA",
    LAR: "LA",
    RAM: "LA",
    KAN: "KC",
    CLT: "IND",
    CRD: "ARI",
  };

  return aliases[t] ?? t;
}

/* -------------------------------------------------- */
/* CSV PARSER                                         */
/* -------------------------------------------------- */

function parseCSV(input: string): Row[] {
  const rows: string[][] = [];

  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") {
        i++;
      }

      row.push(value);

      if (row.some((x) => x.length > 0)) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());

  return rows.slice(1).map((values) => {
    const obj: Row = {};

    headers.forEach((header, index) => {
      obj[header] = values[index] ?? "";
    });

    return obj;
  });
}

/* -------------------------------------------------- */
/* LOAD NFLVERSE PBP                                  */
/* -------------------------------------------------- */

async function loadPBP(season: number) {
  const response = await fetch(PBP_URL(season), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Unable to load ${season} nflverse PBP: ${response.status}`
    );
  }

  const body = await response.text();

  return parseCSV(body);
}

/* -------------------------------------------------- */
/* EMPTY DEFENSE                                      */
/* -------------------------------------------------- */

function emptyDefense(team: string, season: number): Defense {
  return {
    team,
    season,

    games: new Set<string>(),

    passAttempts: 0,
    passYards: 0,

    rushAttempts: 0,
    rushYards: 0,

    sacks: 0,
    interceptions: 0,
    fumblesLost: 0,

    totalPlays: 0,
    totalYards: 0,
  };
}

/* -------------------------------------------------- */
/* AGGREGATE DEFENSE                                  */
/* -------------------------------------------------- */

function aggregateDefense(rows: Row[], season: number) {
  const defenses = new Map<string, Defense>();

  function getDefense(team: string) {
    if (!defenses.has(team)) {
      defenses.set(team, emptyDefense(team, season));
    }

    return defenses.get(team)!;
  }

  for (const row of rows) {
    /*
      IMPORTANT:

      Each nflverse PBP file is already season-specific.

      We therefore DO NOT filter using row.season.
    */

    const seasonType = txt(row.season_type).toUpperCase();

    if (seasonType && seasonType !== "REG") {
      continue;
    }

    const defensiveTeam = normalizeTeam(row.defteam);
    const gameID = txt(row.game_id);

    if (!defensiveTeam || !gameID) {
      continue;
    }

    const defense = getDefense(defensiveTeam);

    defense.games.add(gameID);

    const playType = txt(row.play_type).toLowerCase();

    const sack =
      num(row.sack) === 1;

    const interception =
      num(row.interception) === 1;

    const fumbleLost =
      num(row.fumble_lost) === 1;

    /*
      PASS PLAYS

      We use official play_type rather than relying only
      on pass_attempt flags.

      Sacks are NOT counted as pass attempts for YPA,
      but they are tracked separately.
    */

    if (playType === "pass" && !sack) {
      defense.passAttempts += 1;

      const yards =
        num(row.passing_yards) ||
        num(row.yards_gained);

      defense.passYards += yards;

      defense.totalPlays += 1;
      defense.totalYards += yards;
    }

    /*
      RUSH PLAYS
    */

    if (playType === "run") {
      defense.rushAttempts += 1;

      const yards =
        num(row.rushing_yards) ||
        num(row.yards_gained);

      defense.rushYards += yards;

      defense.totalPlays += 1;
      defense.totalYards += yards;
    }

    /*
      SACKS
    */

    if (sack) {
      defense.sacks += 1;

      /*
        Sacks count as offensive plays for overall
        yards/play, but not normal pass attempts.
      */

      defense.totalPlays += 1;

      defense.totalYards +=
        num(row.yards_gained);
    }

    /*
      TAKEAWAYS
    */

    if (interception) {
      defense.interceptions += 1;
    }

    if (fumbleLost) {
      defense.fumblesLost += 1;
    }
  }

  return defenses;
}

/* -------------------------------------------------- */
/* TEAM METRICS                                       */
/* -------------------------------------------------- */

function getMetrics(defense: Defense | null) {
  if (!defense) return null;

  const games = defense.games.size;

  if (!games) return null;

  const passYPG =
    defense.passYards / games;

  const passYPA =
    defense.passAttempts > 0
      ? defense.passYards / defense.passAttempts
      : null;

  const rushYPG =
    defense.rushYards / games;

  const rushYPC =
    defense.rushAttempts > 0
      ? defense.rushYards / defense.rushAttempts
      : null;

  const sacksPG =
    defense.sacks / games;

  const takeaways =
    defense.interceptions +
    defense.fumblesLost;

  const takeawaysPG =
    takeaways / games;

  const yardsPerPlay =
    defense.totalPlays > 0
      ? defense.totalYards / defense.totalPlays
      : null;

  return {
    games,

    pass_attempts_faced:
      defense.passAttempts,

    pass_yards_allowed:
      defense.passYards,

    pass_yards_allowed_per_game:
      passYPG,

    pass_yards_per_attempt_allowed:
      passYPA,

    rush_attempts_faced:
      defense.rushAttempts,

    rush_yards_allowed:
      defense.rushYards,

    rush_yards_allowed_per_game:
      rushYPG,

    rush_yards_per_carry_allowed:
      rushYPC,

    sacks:
      defense.sacks,

    sacks_per_game:
      sacksPG,

    interceptions:
      defense.interceptions,

    fumbles_lost_forced:
      defense.fumblesLost,

    takeaways,

    takeaways_per_game:
      takeawaysPG,

    total_defensive_plays:
      defense.totalPlays,

    yards_per_play_allowed:
      yardsPerPlay,
  };
}

/* -------------------------------------------------- */
/* LEAGUE AVERAGES                                    */
/* -------------------------------------------------- */

function average(values: Array<number | null>) {
  const valid = values.filter(
    (value): value is number =>
      value !== null &&
      Number.isFinite(value)
  );

  if (!valid.length) return null;

  return (
    valid.reduce((sum, value) => sum + value, 0) /
    valid.length
  );
}

function getLeagueAverages(
  defenses: Map<string, Defense>
) {
  const metrics = Array.from(defenses.values())
    .map((defense) => getMetrics(defense))
    .filter(Boolean) as NonNullable<
    ReturnType<typeof getMetrics>
  >[];

  return {
    pass_yards_allowed_per_game:
      average(
        metrics.map(
          (m) => m.pass_yards_allowed_per_game
        )
      ),

    pass_yards_per_attempt_allowed:
      average(
        metrics.map(
          (m) => m.pass_yards_per_attempt_allowed
        )
      ),

    rush_yards_allowed_per_game:
      average(
        metrics.map(
          (m) => m.rush_yards_allowed_per_game
        )
      ),

    rush_yards_per_carry_allowed:
      average(
        metrics.map(
          (m) => m.rush_yards_per_carry_allowed
        )
      ),

    sacks_per_game:
      average(
        metrics.map(
          (m) => m.sacks_per_game
        )
      ),

    takeaways_per_game:
      average(
        metrics.map(
          (m) => m.takeaways_per_game
        )
      ),

    yards_per_play_allowed:
      average(
        metrics.map(
          (m) => m.yards_per_play_allowed
        )
      ),
  };
}

/* -------------------------------------------------- */
/* RATING HELPERS                                     */
/* -------------------------------------------------- */

function lowerIsBetter(
  value: number | null,
  leagueAverage: number | null
) {
  if (
    value === null ||
    leagueAverage === null ||
    value <= 0 ||
    leagueAverage <= 0
  ) {
    return null;
  }

  return clamp(
    (leagueAverage / value) * 100,
    60,
    140
  );
}

function higherIsBetter(
  value: number | null,
  leagueAverage: number | null
) {
  if (
    value === null ||
    leagueAverage === null ||
    leagueAverage <= 0
  ) {
    return null;
  }

  return clamp(
    (value / leagueAverage) * 100,
    60,
    140
  );
}

function weightedAverage(
  parts: Array<{
    value: number | null;
    weight: number;
  }>
) {
  const valid = parts.filter(
    (
      part
    ): part is {
      value: number;
      weight: number;
    } => part.value !== null
  );

  if (!valid.length) return null;

  const totalWeight =
    valid.reduce(
      (sum, part) => sum + part.weight,
      0
    );

  return valid.reduce(
    (sum, part) =>
      sum +
      part.value *
        (part.weight / totalWeight),
    0
  );
}

/* -------------------------------------------------- */
/* DEFENSE RATINGS                                    */
/* -------------------------------------------------- */

function getRatings(
  defense: Defense | null,
  league: ReturnType<typeof getLeagueAverages>
) {
  const metrics = getMetrics(defense);

  if (!metrics) return null;

  const passYardsRating =
    lowerIsBetter(
      metrics.pass_yards_allowed_per_game,
      league.pass_yards_allowed_per_game
    );

  const passEfficiencyRating =
    lowerIsBetter(
      metrics.pass_yards_per_attempt_allowed,
      league.pass_yards_per_attempt_allowed
    );

  const rushYardsRating =
    lowerIsBetter(
      metrics.rush_yards_allowed_per_game,
      league.rush_yards_allowed_per_game
    );

  const rushEfficiencyRating =
    lowerIsBetter(
      metrics.rush_yards_per_carry_allowed,
      league.rush_yards_per_carry_allowed
    );

  const sackRating =
    higherIsBetter(
      metrics.sacks_per_game,
      league.sacks_per_game
    );

  const takeawayRating =
    higherIsBetter(
      metrics.takeaways_per_game,
      league.takeaways_per_game
    );

  const yardsPerPlayRating =
    lowerIsBetter(
      metrics.yards_per_play_allowed,
      league.yards_per_play_allowed
    );

  const passDefense =
    weightedAverage([
      {
        value: passEfficiencyRating,
        weight: 0.5,
      },
      {
        value: passYardsRating,
        weight: 0.3,
      },
      {
        value: sackRating,
        weight: 0.2,
      },
    ]);

  const rushDefense =
    weightedAverage([
      {
        value: rushEfficiencyRating,
        weight: 0.65,
      },
      {
        value: rushYardsRating,
        weight: 0.35,
      },
    ]);

  const overallDefense =
    weightedAverage([
      {
        value: passEfficiencyRating,
        weight: 0.25,
      },
      {
        value: rushEfficiencyRating,
        weight: 0.2,
      },
      {
        value: yardsPerPlayRating,
        weight: 0.25,
      },
      {
        value: sackRating,
        weight: 0.15,
      },
      {
        value: takeawayRating,
        weight: 0.15,
      },
    ]);

  return {
    pass: passDefense,
    rush: rushDefense,
    overall: overallDefense,

    components: {
      pass_yards:
        passYardsRating,

      pass_efficiency:
        passEfficiencyRating,

      rush_yards:
        rushYardsRating,

      rush_efficiency:
        rushEfficiencyRating,

      sacks:
        sackRating,

      takeaways:
        takeawayRating,

      yards_per_play:
        yardsPerPlayRating,
    },
  };
}

/* -------------------------------------------------- */
/* STABILIZATION                                      */
/* -------------------------------------------------- */

function blend(
  current: number | null,
  prior: number | null,
  currentGames: number
) {
  if (current === null && prior === null) {
    return null;
  }

  if (current === null) return prior;
  if (prior === null) return current;

  const currentWeight =
    currentGames /
    (currentGames + 4);

  const priorWeight =
    1 - currentWeight;

  return (
    current * currentWeight +
    prior * priorWeight
  );
}

function ratingLabel(value: number | null) {
  if (value === null) {
    return "NO_DATA";
  }

  if (value >= 115) {
    return "ELITE";
  }

  if (value >= 105) {
    return "STRONG";
  }

  if (value <= 85) {
    return "WEAK";
  }

  if (value <= 95) {
    return "BELOW_AVERAGE";
  }

  return "AVERAGE";
}

/* -------------------------------------------------- */
/* CLEAN OUTPUT                                       */
/* -------------------------------------------------- */

function cleanMetrics(defense: Defense | null) {
  const metrics = getMetrics(defense);

  if (!metrics) return null;

  return {
    games:
      metrics.games,

    pass_attempts_faced:
      metrics.pass_attempts_faced,

    pass_yards_allowed:
      round(
        metrics.pass_yards_allowed,
        0
      ),

    pass_yards_allowed_per_game:
      round(
        metrics.pass_yards_allowed_per_game
      ),

    pass_yards_per_attempt_allowed:
      round(
        metrics.pass_yards_per_attempt_allowed,
        2
      ),

    rush_attempts_faced:
      metrics.rush_attempts_faced,

    rush_yards_allowed:
      round(
        metrics.rush_yards_allowed,
        0
      ),

    rush_yards_allowed_per_game:
      round(
        metrics.rush_yards_allowed_per_game
      ),

    rush_yards_per_carry_allowed:
      round(
        metrics.rush_yards_per_carry_allowed,
        2
      ),

    sacks:
      metrics.sacks,

    sacks_per_game:
      round(
        metrics.sacks_per_game,
        2
      ),

    interceptions:
      metrics.interceptions,

    fumbles_lost_forced:
      metrics.fumbles_lost_forced,

    takeaways:
      metrics.takeaways,

    takeaways_per_game:
      round(
        metrics.takeaways_per_game,
        2
      ),

    total_defensive_plays:
      metrics.total_defensive_plays,

    yards_per_play_allowed:
      round(
        metrics.yards_per_play_allowed,
        2
      ),
  };
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    const [currentRows, priorRows] =
      await Promise.all([
        loadPBP(CURRENT_SEASON),
        loadPBP(PRIOR_SEASON),
      ]);

    const currentDefense =
      aggregateDefense(
        currentRows,
        CURRENT_SEASON
      );

    const priorDefense =
      aggregateDefense(
        priorRows,
        PRIOR_SEASON
      );

    const currentLeague =
      getLeagueAverages(
        currentDefense
      );

    const priorLeague =
      getLeagueAverages(
        priorDefense
      );

    const allTeams = Array.from(
      new Set([
        ...Array.from(
          currentDefense.keys()
        ),

        ...Array.from(
          priorDefense.keys()
        ),
      ])
    ).sort();

    const teams = allTeams.map(
      (teamName) => {
        const current =
          currentDefense.get(
            teamName
          ) ?? null;

        const prior =
          priorDefense.get(
            teamName
          ) ?? null;

        const currentMetrics =
          getMetrics(current);

        const currentRatings =
          getRatings(
            current,
            currentLeague
          );

        const priorRatings =
          getRatings(
            prior,
            priorLeague
          );

        const games =
          currentMetrics?.games ?? 0;

        const currentWeight =
          games > 0
            ? games /
              (games + 4)
            : 0;

        const passRating =
          blend(
            currentRatings?.pass ??
              null,

            priorRatings?.pass ??
              null,

            games
          );

        const rushRating =
          blend(
            currentRatings?.rush ??
              null,

            priorRatings?.rush ??
              null,

            games
          );

        const overallRating =
          blend(
            currentRatings?.overall ??
              null,

            priorRatings?.overall ??
              null,

            games
          );

        return {
          team:
            teamName,

          current_games:
            games,

          stabilization: {
            current_2026_weight_pct:
              round(
                currentWeight * 100
              ),

            prior_2025_weight_pct:
              round(
                (1 - currentWeight) *
                  100
              ),
          },

          ratings: {
            overall_defense:
              round(
                overallRating
              ),

            overall_label:
              ratingLabel(
                overallRating
              ),

            pass_defense:
              round(
                passRating
              ),

            pass_label:
              ratingLabel(
                passRating
              ),

            rush_defense:
              round(
                rushRating
              ),

            rush_label:
              ratingLabel(
                rushRating
              ),
          },

          current_2026:
            cleanMetrics(
              current
            ),

          prior_2025:
            cleanMetrics(
              prior
            ),

          model_adjustment_active:
            false,
        };
      }
    );

    teams.sort(
      (a, b) =>
        (b.ratings
          .overall_defense ??
          -999) -
        (a.ratings
          .overall_defense ??
          -999)
    );

    return NextResponse.json({
      success: true,

      version:
        "1.2-pbp-defense-fixed",

      seasons: {
        current:
          CURRENT_SEASON,

        prior:
          PRIOR_SEASON,
      },

      source:
        "nflverse play-by-play",

      methodology: {
        rating_center:
          "100 = league average",

        higher_rating:
          "better defense",

        pass_defense_inputs: [
          "passing yards allowed per game",
          "yards allowed per pass attempt",
          "sacks per game",
        ],

        rush_defense_inputs: [
          "rushing yards allowed per game",
          "yards allowed per carry",
        ],

        overall_inputs: [
          "pass efficiency",
          "rush efficiency",
          "yards per play",
          "sacks",
          "takeaways",
        ],

        stabilization:
          "Current season weight = games / (games + 4).",

        opponent_adjusted:
          false,

        injury_adjusted:
          false,

        live_model_adjustment:
          false,
      },

      league_averages: {
        current_2026:
          Object.fromEntries(
            Object.entries(
              currentLeague
            ).map(
              ([key, value]) => [
                key,

                value === null
                  ? null
                  : round(
                      value,
                      2
                    ),
              ]
            )
          ),

        prior_2025:
          Object.fromEntries(
            Object.entries(
              priorLeague
            ).map(
              ([key, value]) => [
                key,

                value === null
                  ? null
                  : round(
                      value,
                      2
                    ),
              ]
            )
          ),
      },

      diagnostics: {
        current_pbp_rows:
          currentRows.length,

        prior_pbp_rows:
          priorRows.length,

        current_defensive_teams:
          currentDefense.size,

        prior_defensive_teams:
          priorDefense.size,
      },

      teams_found:
        teams.length,

      teams,

      validation_status: {
        defense_data_connected:
          teams.length > 0,

        passing_v2_backtest_complete:
          false,

        defense_adjustment_approved:
          false,

        message:
          "Defense is connected, but it will not alter RDG projections until held-out backtesting shows an improvement over frozen Passing V2.",
      },

      next_step:
        "Backtest individual defensive features against frozen Passing V2 before activating defense in live projections.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense stats error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.2-pbp-defense-fixed",

        error:
          error?.message ||
          "Unable to calculate NFL defensive statistics.",
      },
      {
        status: 500,
      }
    );
  }
}
