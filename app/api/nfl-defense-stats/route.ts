import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const NFLVERSE_GAMES =
  "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

function text(v: any): string {
  return String(v ?? "").trim();
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v: number, digits = 1) {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeTeam(v: any): string {
  const team = text(v).toUpperCase();

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

  return aliases[team] ?? team;
}

/* -------------------------------------------------- */
/* CSV PARSER                                         */
/* -------------------------------------------------- */

function parseCSV(input: string): Record<string, string>[] {
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
      if (char === "\r" && input[i + 1] === "\n") i++;

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
    const obj: Record<string, string> = {};

    headers.forEach((header, index) => {
      obj[header] = values[index] ?? "";
    });

    return obj;
  });
}

/* -------------------------------------------------- */
/* LOAD NFLVERSE                                      */
/* -------------------------------------------------- */

async function loadGames() {
  const response = await fetch(NFLVERSE_GAMES, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Unable to load nflverse games: ${response.status}`
    );
  }

  return parseCSV(await response.text());
}

/* -------------------------------------------------- */
/* TYPES                                              */
/* -------------------------------------------------- */

type DefenseSeason = {
  team: string;
  season: number;

  games: number;

  points_allowed: number;

  opponent_pass_yards: number;
  opponent_rush_yards: number;

  opponent_pass_attempts: number;
  opponent_rush_attempts: number;

  sacks: number;
  takeaways: number;

  points_allowed_per_game: number;

  pass_yards_allowed_per_game: number;
  rush_yards_allowed_per_game: number;

  pass_yards_per_attempt_allowed: number;
  rush_yards_per_attempt_allowed: number;

  sacks_per_game: number;
  takeaways_per_game: number;
};

/* -------------------------------------------------- */
/* CREATE EMPTY TEAM                                  */
/* -------------------------------------------------- */

function emptyDefense(
  team: string,
  season: number
): DefenseSeason {
  return {
    team,
    season,

    games: 0,

    points_allowed: 0,

    opponent_pass_yards: 0,
    opponent_rush_yards: 0,

    opponent_pass_attempts: 0,
    opponent_rush_attempts: 0,

    sacks: 0,
    takeaways: 0,

    points_allowed_per_game: 0,

    pass_yards_allowed_per_game: 0,
    rush_yards_allowed_per_game: 0,

    pass_yards_per_attempt_allowed: 0,
    rush_yards_per_attempt_allowed: 0,

    sacks_per_game: 0,
    takeaways_per_game: 0,
  };
}

/* -------------------------------------------------- */
/* AGGREGATE TEAM DEFENSE                             */
/* -------------------------------------------------- */

function aggregateDefense(
  rows: Record<string, string>[],
  season: number
) {
  const map = new Map<string, DefenseSeason>();

  const games = rows.filter((row) => {
    const rowSeason = num(row.season);

    const gameType =
      text(row.game_type).toUpperCase();

    const completed =
      text(row.result) ||
      text(row.home_score) ||
      text(row.away_score);

    return (
      rowSeason === season &&
      gameType === "REG" &&
      Boolean(completed)
    );
  });

  function getTeam(team: string) {
    if (!map.has(team)) {
      map.set(
        team,
        emptyDefense(team, season)
      );
    }

    return map.get(team)!;
  }

  for (const game of games) {
    const home =
      normalizeTeam(game.home_team);

    const away =
      normalizeTeam(game.away_team);

    if (!home || !away) continue;

    const homeScore =
      num(game.home_score);

    const awayScore =
      num(game.away_score);

    const homeDefense =
      getTeam(home);

    const awayDefense =
      getTeam(away);

    /*
      nflverse games.csv reliably gives us scoring.

      Some versions of the schedule dataset may also
      expose box-score columns. We read them when they
      exist, but we DO NOT invent missing statistics.
    */

    const homePassYards =
      num(
        game.home_pass_yards ||
        game.home_passing_yards
      );

    const awayPassYards =
      num(
        game.away_pass_yards ||
        game.away_passing_yards
      );

    const homeRushYards =
      num(
        game.home_rush_yards ||
        game.home_rushing_yards
      );

    const awayRushYards =
      num(
        game.away_rush_yards ||
        game.away_rushing_yards
      );

    const homePassAttempts =
      num(
        game.home_pass_attempts ||
        game.home_passing_attempts
      );

    const awayPassAttempts =
      num(
        game.away_pass_attempts ||
        game.away_passing_attempts
      );

    const homeRushAttempts =
      num(
        game.home_rush_attempts ||
        game.home_rushing_attempts
      );

    const awayRushAttempts =
      num(
        game.away_rush_attempts ||
        game.away_rushing_attempts
      );

    const homeSacks =
      num(
        game.home_sacks ||
        game.home_def_sacks
      );

    const awaySacks =
      num(
        game.away_sacks ||
        game.away_def_sacks
      );

    const homeTakeaways =
      num(
        game.home_takeaways
      );

    const awayTakeaways =
      num(
        game.away_takeaways
      );

    /* HOME DEFENSE */

    homeDefense.games += 1;

    homeDefense.points_allowed +=
      awayScore;

    homeDefense.opponent_pass_yards +=
      awayPassYards;

    homeDefense.opponent_rush_yards +=
      awayRushYards;

    homeDefense.opponent_pass_attempts +=
      awayPassAttempts;

    homeDefense.opponent_rush_attempts +=
      awayRushAttempts;

    homeDefense.sacks +=
      homeSacks;

    homeDefense.takeaways +=
      homeTakeaways;

    /* AWAY DEFENSE */

    awayDefense.games += 1;

    awayDefense.points_allowed +=
      homeScore;

    awayDefense.opponent_pass_yards +=
      homePassYards;

    awayDefense.opponent_rush_yards +=
      homeRushYards;

    awayDefense.opponent_pass_attempts +=
      homePassAttempts;

    awayDefense.opponent_rush_attempts +=
      homeRushAttempts;

    awayDefense.sacks +=
      awaySacks;

    awayDefense.takeaways +=
      awayTakeaways;
  }

  for (const defense of map.values()) {
    if (!defense.games) continue;

    defense.points_allowed_per_game =
      defense.points_allowed /
      defense.games;

    defense.pass_yards_allowed_per_game =
      defense.opponent_pass_yards /
      defense.games;

    defense.rush_yards_allowed_per_game =
      defense.opponent_rush_yards /
      defense.games;

    defense.pass_yards_per_attempt_allowed =
      defense.opponent_pass_attempts > 0
        ? defense.opponent_pass_yards /
          defense.opponent_pass_attempts
        : 0;

    defense.rush_yards_per_attempt_allowed =
      defense.opponent_rush_attempts > 0
        ? defense.opponent_rush_yards /
          defense.opponent_rush_attempts
        : 0;

    defense.sacks_per_game =
      defense.sacks /
      defense.games;

    defense.takeaways_per_game =
      defense.takeaways /
      defense.games;
  }

  return map;
}

/* -------------------------------------------------- */
/* LEAGUE AVERAGES                                    */
/* -------------------------------------------------- */

function average(
  values: number[]
) {
  const valid =
    values.filter(
      (v) =>
        Number.isFinite(v) &&
        v > 0
    );

  if (!valid.length) return 0;

  return (
    valid.reduce(
      (sum, v) => sum + v,
      0
    ) / valid.length
  );
}

function leagueAverages(
  teams: DefenseSeason[]
) {
  return {
    points_allowed_per_game:
      average(
        teams.map(
          (t) =>
            t.points_allowed_per_game
        )
      ),

    pass_yards_allowed_per_game:
      average(
        teams.map(
          (t) =>
            t.pass_yards_allowed_per_game
        )
      ),

    rush_yards_allowed_per_game:
      average(
        teams.map(
          (t) =>
            t.rush_yards_allowed_per_game
        )
      ),

    pass_yards_per_attempt_allowed:
      average(
        teams.map(
          (t) =>
            t.pass_yards_per_attempt_allowed
        )
      ),

    rush_yards_per_attempt_allowed:
      average(
        teams.map(
          (t) =>
            t.rush_yards_per_attempt_allowed
        )
      ),

    sacks_per_game:
      average(
        teams.map(
          (t) =>
            t.sacks_per_game
        )
      ),

    takeaways_per_game:
      average(
        teams.map(
          (t) =>
            t.takeaways_per_game
        )
      ),
  };
}

/* -------------------------------------------------- */
/* DEFENSIVE INDEX                                    */
/* -------------------------------------------------- */

function lowerBetterIndex(
  value: number,
  leagueAverage: number
) {
  if (
    value <= 0 ||
    leagueAverage <= 0
  ) {
    return null;
  }

  /*
    100 = league average

    Below league average yards/points allowed
    produces a rating ABOVE 100.
  */

  return (
    leagueAverage /
    value *
    100
  );
}

function higherBetterIndex(
  value: number,
  leagueAverage: number
) {
  if (
    value < 0 ||
    leagueAverage <= 0
  ) {
    return null;
  }

  return (
    value /
    leagueAverage *
    100
  );
}

function createRatings(
  defense: DefenseSeason | null,
  averages: ReturnType<
    typeof leagueAverages
  >
) {
  if (!defense) return null;

  const scoring =
    lowerBetterIndex(
      defense.points_allowed_per_game,
      averages.points_allowed_per_game
    );

  const passYards =
    lowerBetterIndex(
      defense.pass_yards_allowed_per_game,
      averages.pass_yards_allowed_per_game
    );

  const passEfficiency =
    lowerBetterIndex(
      defense.pass_yards_per_attempt_allowed,
      averages.pass_yards_per_attempt_allowed
    );

  const rushYards =
    lowerBetterIndex(
      defense.rush_yards_allowed_per_game,
      averages.rush_yards_allowed_per_game
    );

  const rushEfficiency =
    lowerBetterIndex(
      defense.rush_yards_per_attempt_allowed,
      averages.rush_yards_per_attempt_allowed
    );

  const sacks =
    higherBetterIndex(
      defense.sacks_per_game,
      averages.sacks_per_game
    );

  const takeaways =
    higherBetterIndex(
      defense.takeaways_per_game,
      averages.takeaways_per_game
    );

  /*
    Only use a metric if the source actually
    contained usable data for it.
  */

  const overallParts = [
    scoring !== null
      ? { value: scoring, weight: 0.35 }
      : null,

    passEfficiency !== null
      ? {
          value: passEfficiency,
          weight: 0.20,
        }
      : null,

    passYards !== null
      ? {
          value: passYards,
          weight: 0.10,
        }
      : null,

    rushEfficiency !== null
      ? {
          value: rushEfficiency,
          weight: 0.15,
        }
      : null,

    rushYards !== null
      ? {
          value: rushYards,
          weight: 0.10,
        }
      : null,

    sacks !== null
      ? {
          value: sacks,
          weight: 0.05,
        }
      : null,

    takeaways !== null
      ? {
          value: takeaways,
          weight: 0.05,
        }
      : null,
  ].filter(Boolean) as {
    value: number;
    weight: number;
  }[];

  const totalWeight =
    overallParts.reduce(
      (sum, x) =>
        sum + x.weight,
      0
    );

  const overall =
    totalWeight > 0
      ? overallParts.reduce(
          (sum, x) =>
            sum +
            x.value *
              (x.weight /
                totalWeight),
          0
        )
      : null;

  const passParts = [
    passEfficiency,
    passYards,
    sacks,
  ].filter(
    (v): v is number =>
      v !== null
  );

  const rushParts = [
    rushEfficiency,
    rushYards,
  ].filter(
    (v): v is number =>
      v !== null
  );

  return {
    overall:
      overall !== null
        ? clamp(overall, 60, 140)
        : null,

    pass:
      passParts.length
        ? clamp(
            passParts.reduce(
              (a, b) => a + b,
              0
            ) /
              passParts.length,
            60,
            140
          )
        : null,

    rush:
      rushParts.length
        ? clamp(
            rushParts.reduce(
              (a, b) => a + b,
              0
            ) /
              rushParts.length,
            60,
            140
          )
        : null,
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
  if (
    current === null &&
    prior === null
  ) {
    return null;
  }

  if (current === null) {
    return prior;
  }

  if (prior === null) {
    return current;
  }

  /*
    Early-season stabilization.

    Week 1:
      20% current
      80% prior

    Week 2:
      33% current
      67% prior

    Week 4:
      50 / 50

    Week 8:
      67 / 33

    Current season gradually takes over.
  */

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

function ratingLabel(
  rating: number | null
) {
  if (rating === null) {
    return "NO_DATA";
  }

  if (rating >= 115) {
    return "ELITE";
  }

  if (rating >= 105) {
    return "STRONG";
  }

  if (rating <= 85) {
    return "WEAK";
  }

  if (rating <= 95) {
    return "BELOW_AVERAGE";
  }

  return "AVERAGE";
}

/* -------------------------------------------------- */
/* ROUTE                                              */
/* -------------------------------------------------- */

export async function GET() {
  try {
    const rows =
      await loadGames();

    const currentMap =
      aggregateDefense(
        rows,
        CURRENT_SEASON
      );

    const priorMap =
      aggregateDefense(
        rows,
        PRIOR_SEASON
      );

    const currentTeams =
      Array.from(
        currentMap.values()
      );

    const priorTeams =
      Array.from(
        priorMap.values()
      );

    const currentAverages =
      leagueAverages(
        currentTeams
      );

    const priorAverages =
      leagueAverages(
        priorTeams
      );

    const allTeams =
      Array.from(
        new Set([
          ...Array.from(
            currentMap.keys()
          ),
          ...Array.from(
            priorMap.keys()
          ),
        ])
      ).sort();

    const teams =
      allTeams.map((team) => {
        const current =
          currentMap.get(team) ??
          null;

        const prior =
          priorMap.get(team) ??
          null;

        const currentRatings =
          createRatings(
            current,
            currentAverages
          );

        const priorRatings =
          createRatings(
            prior,
            priorAverages
          );

        const games =
          current?.games ?? 0;

        const overall =
          blend(
            currentRatings?.overall ??
              null,
            priorRatings?.overall ??
              null,
            games
          );

        const pass =
          blend(
            currentRatings?.pass ??
              null,
            priorRatings?.pass ??
              null,
            games
          );

        const rush =
          blend(
            currentRatings?.rush ??
              null,
            priorRatings?.rush ??
              null,
            games
          );

        const currentWeight =
          games > 0
            ? games /
              (games + 4)
            : 0;

        return {
          team,

          current_season:
            CURRENT_SEASON,

          prior_season:
            PRIOR_SEASON,

          current_games:
            games,

          current_weight_pct:
            round(
              currentWeight * 100
            ),

          prior_weight_pct:
            round(
              (1 - currentWeight) *
                100
            ),

          ratings: {
            overall_defense:
              overall !== null
                ? round(overall)
                : null,

            overall_label:
              ratingLabel(
                overall
              ),

            pass_defense:
              pass !== null
                ? round(pass)
                : null,

            pass_label:
              ratingLabel(
                pass
              ),

            rush_defense:
              rush !== null
                ? round(rush)
                : null,

            rush_label:
              ratingLabel(
                rush
              ),
          },

          current_2026:
            current
              ? {
                  games:
                    current.games,

                  points_allowed_per_game:
                    round(
                      current.points_allowed_per_game
                    ),

                  pass_yards_allowed_per_game:
                    current.opponent_pass_yards >
                    0
                      ? round(
                          current.pass_yards_allowed_per_game
                        )
                      : null,

                  pass_yards_per_attempt_allowed:
                    current.opponent_pass_attempts >
                    0
                      ? round(
                          current.pass_yards_per_attempt_allowed,
                          2
                        )
                      : null,

                  rush_yards_allowed_per_game:
                    current.opponent_rush_yards >
                    0
                      ? round(
                          current.rush_yards_allowed_per_game
                        )
                      : null,

                  rush_yards_per_attempt_allowed:
                    current.opponent_rush_attempts >
                    0
                      ? round(
                          current.rush_yards_per_attempt_allowed,
                          2
                        )
                      : null,

                  sacks_per_game:
                    current.sacks > 0
                      ? round(
                          current.sacks_per_game,
                          2
                        )
                      : null,

                  takeaways_per_game:
                    current.takeaways >
                    0
                      ? round(
                          current.takeaways_per_game,
                          2
                        )
                      : null,
                }
              : null,

          prior_2025:
            prior
              ? {
                  games:
                    prior.games,

                  points_allowed_per_game:
                    round(
                      prior.points_allowed_per_game
                    ),

                  pass_yards_allowed_per_game:
                    prior.opponent_pass_yards >
                    0
                      ? round(
                          prior.pass_yards_allowed_per_game
                        )
                      : null,

                  pass_yards_per_attempt_allowed:
                    prior.opponent_pass_attempts >
                    0
                      ? round(
                          prior.pass_yards_per_attempt_allowed,
                          2
                        )
                      : null,

                  rush_yards_allowed_per_game:
                    prior.opponent_rush_yards >
                    0
                      ? round(
                          prior.rush_yards_allowed_per_game
                        )
                      : null,

                  rush_yards_per_attempt_allowed:
                    prior.opponent_rush_attempts >
                    0
                      ? round(
                          prior.rush_yards_per_attempt_allowed,
                          2
                        )
                      : null,

                  sacks_per_game:
                    prior.sacks > 0
                      ? round(
                          prior.sacks_per_game,
                          2
                        )
                      : null,

                  takeaways_per_game:
                    prior.takeaways >
                    0
                      ? round(
                          prior.takeaways_per_game,
                          2
                        )
                      : null,
                }
              : null,

          /*
            IMPORTANT:

            These ratings are descriptive only.

            They are NOT changing the RDG passing
            model or picks yet.
          */

          model_adjustment_active:
            false,
        };
      });

    teams.sort(
      (a, b) =>
        (b.ratings
          .overall_defense ?? -999) -
        (a.ratings
          .overall_defense ?? -999)
    );

    return NextResponse.json({
      success: true,

      version:
        "1.0-defense-stabilized",

      current_season:
        CURRENT_SEASON,

      prior_season:
        PRIOR_SEASON,

      methodology: {
        rating_center:
          "100 = league average",

        higher_rating:
          "better defense",

        early_season_stabilization:
          "2026 defense is blended with 2025 defense using currentGames / (currentGames + 4).",

        current_season_weight_example:
          {
            game_1: "20%",
            game_2: "33.3%",
            game_4: "50%",
            game_8: "66.7%",
          },

        future_leakage:
          false,

        opponent_adjustment:
          false,

        injury_adjustment:
          false,

        live_model_adjustment:
          false,
      },

      data_quality: {
        note:
          "The schedule source always provides scores. Passing, rushing, sacks and takeaway metrics are included only if those columns exist in the source. Missing statistics are not fabricated.",
      },

      league_averages: {
        current_2026:
          currentAverages,

        prior_2025:
          priorAverages,
      },

      teams_found:
        teams.length,

      teams,

      next_step:
        "Backtest defensive metrics against the frozen RDG passing V2 model before activating any defensive adjustment.",

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
          "1.0-defense-stabilized",

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
