import { NextResponse } from "next/server";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import * as readline from "node:readline";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const PBP_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

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
  fumbleTakeaways: number;

  totalPlays: number;
  totalYards: number;
};

type LeagueAverages = {
  pass_yards_allowed_per_game: number | null;
  pass_yards_per_attempt_allowed: number | null;
  rush_yards_allowed_per_game: number | null;
  rush_yards_per_carry_allowed: number | null;
  sacks_per_game: number | null;
  takeaways_per_game: number | null;
  yards_per_play_allowed: number | null;
};

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

function txt(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(
  value: number | null,
  digits = 1
): number | null {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const multiplier = 10 ** digits;

  return (
    Math.round(value * multiplier) /
    multiplier
  );
}

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function normalizeTeam(value: unknown) {
  const team = txt(value).toUpperCase();

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
/* CSV LINE PARSER                                    */
/* -------------------------------------------------- */

function parseCSVLine(line: string): string[] {
  const values: string[] = [];

  let value = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (
      char === "," &&
      !quoted
    ) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  values.push(value);

  return values;
}

/* -------------------------------------------------- */
/* EMPTY TEAM                                         */
/* -------------------------------------------------- */

function emptyDefense(
  team: string,
  season: number
): Defense {
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
    fumbleTakeaways: 0,

    totalPlays: 0,
    totalYards: 0,
  };
}

/* -------------------------------------------------- */
/* STREAM NFLVERSE PBP                                */
/* -------------------------------------------------- */

async function loadSeasonDefense(
  season: number
) {
  const response = await fetch(
    PBP_URL(season),
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `Unable to download ${season} nflverse PBP: ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error(
      `${season} nflverse PBP returned no response body.`
    );
  }

  /*
    Convert the Web ReadableStream returned by fetch
    into a Node stream and decompress it as data arrives.

    This prevents us from storing the entire decompressed
    CSV in memory.
  */

  const nodeStream =
    Readable.fromWeb(
      response.body as any
    );

  const gunzip = createGunzip();

  nodeStream.pipe(gunzip);

  const reader =
    readline.createInterface({
      input: gunzip,
      crlfDelay: Infinity,
    });

  const defenses =
    new Map<string, Defense>();

  let headers: string[] = [];

  let headerIndexes:
    | {
        game_id: number;
        season_type: number;
        defteam: number;
        play_type: number;
        pass_attempt: number;
        rush_attempt: number;
        passing_yards: number;
        rushing_yards: number;
        yards_gained: number;
        sack: number;
        interception: number;
        fumble_lost: number;
      }
    | null = null;

  let rowsRead = 0;
  let regularSeasonRows = 0;
  let rowsWithDefense = 0;

  function indexOf(name: string) {
    return headers.indexOf(name);
  }

  function value(
    values: string[],
    index: number
  ) {
    if (index < 0) return "";
    return values[index] ?? "";
  }

  function getDefense(team: string) {
    if (!defenses.has(team)) {
      defenses.set(
        team,
        emptyDefense(
          team,
          season
        )
      );
    }

    return defenses.get(team)!;
  }

  let firstLine = true;

  for await (const rawLine of reader) {
    const line = String(rawLine);

    if (firstLine) {
      firstLine = false;

      headers = parseCSVLine(line).map(
        (header) =>
          header
            .replace(/^\uFEFF/, "")
            .trim()
      );

      headerIndexes = {
        game_id:
          indexOf("game_id"),

        season_type:
          indexOf("season_type"),

        defteam:
          indexOf("defteam"),

        play_type:
          indexOf("play_type"),

        pass_attempt:
          indexOf("pass_attempt"),

        rush_attempt:
          indexOf("rush_attempt"),

        passing_yards:
          indexOf("passing_yards"),

        rushing_yards:
          indexOf("rushing_yards"),

        yards_gained:
          indexOf("yards_gained"),

        sack:
          indexOf("sack"),

        interception:
          indexOf("interception"),

        fumble_lost:
          indexOf("fumble_lost"),
      };

      if (
        headerIndexes.game_id < 0 ||
        headerIndexes.defteam < 0
      ) {
        throw new Error(
          `${season} PBP is missing required game_id or defteam columns.`
        );
      }

      continue;
    }

    if (
      !line ||
      !headerIndexes
    ) {
      continue;
    }

    rowsRead++;

    const values =
      parseCSVLine(line);

    const seasonType =
      txt(
        value(
          values,
          headerIndexes.season_type
        )
      ).toUpperCase();

    if (
      seasonType &&
      seasonType !== "REG"
    ) {
      continue;
    }

    regularSeasonRows++;

    const team =
      normalizeTeam(
        value(
          values,
          headerIndexes.defteam
        )
      );

    const gameID =
      txt(
        value(
          values,
          headerIndexes.game_id
        )
      );

    if (
      !team ||
      !gameID
    ) {
      continue;
    }

    rowsWithDefense++;

    const defense =
      getDefense(team);

    defense.games.add(gameID);

    const playType =
      txt(
        value(
          values,
          headerIndexes.play_type
        )
      ).toLowerCase();

    const passAttempt =
      num(
        value(
          values,
          headerIndexes.pass_attempt
        )
      ) === 1;

    const rushAttempt =
      num(
        value(
          values,
          headerIndexes.rush_attempt
        )
      ) === 1;

    const sack =
      num(
        value(
          values,
          headerIndexes.sack
        )
      ) === 1;

    const interception =
      num(
        value(
          values,
          headerIndexes.interception
        )
      ) === 1;

    const fumbleLost =
      num(
        value(
          values,
          headerIndexes.fumble_lost
        )
      ) === 1;

    /*
      PASSING

      Sacks are kept separate from official
      pass attempts.
    */

    if (
      passAttempt &&
      !sack
    ) {
      const passingYards =
        num(
          value(
            values,
            headerIndexes.passing_yards
          )
        );

      const yardsGained =
        num(
          value(
            values,
            headerIndexes.yards_gained
          )
        );

      const yards =
        passingYards !== 0
          ? passingYards
          : yardsGained;

      defense.passAttempts++;
      defense.passYards += yards;

      defense.totalPlays++;
      defense.totalYards += yards;
    } else if (
      !passAttempt &&
      !sack &&
      playType === "pass"
    ) {
      const passingYards =
        num(
          value(
            values,
            headerIndexes.passing_yards
          )
        );

      const yardsGained =
        num(
          value(
            values,
            headerIndexes.yards_gained
          )
        );

      const yards =
        passingYards !== 0
          ? passingYards
          : yardsGained;

      defense.passAttempts++;
      defense.passYards += yards;

      defense.totalPlays++;
      defense.totalYards += yards;
    }

    /*
      RUSHING
    */

    if (rushAttempt) {
      const rushingYards =
        num(
          value(
            values,
            headerIndexes.rushing_yards
          )
        );

      const yardsGained =
        num(
          value(
            values,
            headerIndexes.yards_gained
          )
        );

      const yards =
        rushingYards !== 0
          ? rushingYards
          : yardsGained;

      defense.rushAttempts++;
      defense.rushYards += yards;

      defense.totalPlays++;
      defense.totalYards += yards;
    } else if (
      !rushAttempt &&
      playType === "run"
    ) {
      const rushingYards =
        num(
          value(
            values,
            headerIndexes.rushing_yards
          )
        );

      const yardsGained =
        num(
          value(
            values,
            headerIndexes.yards_gained
          )
        );

      const yards =
        rushingYards !== 0
          ? rushingYards
          : yardsGained;

      defense.rushAttempts++;
      defense.rushYards += yards;

      defense.totalPlays++;
      defense.totalYards += yards;
    }

    /*
      SACKS
    */

    if (sack) {
      defense.sacks++;

      defense.totalPlays++;

      defense.totalYards +=
        num(
          value(
            values,
            headerIndexes.yards_gained
          )
        );
    }

    /*
      TAKEAWAYS
    */

    if (interception) {
      defense.interceptions++;
    }

    if (fumbleLost) {
      defense.fumbleTakeaways++;
    }
  }

  return {
    defenses,

    diagnostics: {
      season,

      rows_read:
        rowsRead,

      regular_season_rows:
        regularSeasonRows,

      rows_with_defense:
        rowsWithDefense,

      defensive_teams:
        defenses.size,

      total_columns:
        headers.length,

      required_columns: {
        game_id:
          headerIndexes?.game_id !== -1,

        season_type:
          headerIndexes?.season_type !== -1,

        defteam:
          headerIndexes?.defteam !== -1,

        play_type:
          headerIndexes?.play_type !== -1,

        pass_attempt:
          headerIndexes?.pass_attempt !== -1,

        rush_attempt:
          headerIndexes?.rush_attempt !== -1,

        passing_yards:
          headerIndexes?.passing_yards !== -1,

        rushing_yards:
          headerIndexes?.rushing_yards !== -1,

        yards_gained:
          headerIndexes?.yards_gained !== -1,

        sack:
          headerIndexes?.sack !== -1,

        interception:
          headerIndexes?.interception !== -1,

        fumble_lost:
          headerIndexes?.fumble_lost !== -1,
      },
    },
  };
}

/* -------------------------------------------------- */
/* METRICS                                            */
/* -------------------------------------------------- */

function getMetrics(
  defense: Defense | null
) {
  if (!defense) return null;

  const games =
    defense.games.size;

  if (!games) return null;

  const takeaways =
    defense.interceptions +
    defense.fumbleTakeaways;

  return {
    games,

    pass_attempts_faced:
      defense.passAttempts,

    pass_yards_allowed:
      defense.passYards,

    pass_yards_allowed_per_game:
      defense.passYards / games,

    pass_yards_per_attempt_allowed:
      defense.passAttempts > 0
        ? defense.passYards /
          defense.passAttempts
        : null,

    rush_attempts_faced:
      defense.rushAttempts,

    rush_yards_allowed:
      defense.rushYards,

    rush_yards_allowed_per_game:
      defense.rushYards / games,

    rush_yards_per_carry_allowed:
      defense.rushAttempts > 0
        ? defense.rushYards /
          defense.rushAttempts
        : null,

    sacks:
      defense.sacks,

    sacks_per_game:
      defense.sacks / games,

    interceptions:
      defense.interceptions,

    fumble_takeaways:
      defense.fumbleTakeaways,

    takeaways,

    takeaways_per_game:
      takeaways / games,

    total_defensive_plays:
      defense.totalPlays,

    yards_per_play_allowed:
      defense.totalPlays > 0
        ? defense.totalYards /
          defense.totalPlays
        : null,
  };
}

/* -------------------------------------------------- */
/* LEAGUE AVERAGES                                    */
/* -------------------------------------------------- */

function average(
  values: Array<number | null>
) {
  const valid =
    values.filter(
      (
        value
      ): value is number =>
        value !== null &&
        Number.isFinite(value)
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / valid.length
  );
}

function getLeagueAverages(
  defenses: Map<string, Defense>
): LeagueAverages {
  const metrics =
    Array.from(
      defenses.values()
    )
      .map(getMetrics)
      .filter(
        Boolean
      ) as NonNullable<
      ReturnType<
        typeof getMetrics
      >
    >[];

  return {
    pass_yards_allowed_per_game:
      average(
        metrics.map(
          (m) =>
            m.pass_yards_allowed_per_game
        )
      ),

    pass_yards_per_attempt_allowed:
      average(
        metrics.map(
          (m) =>
            m.pass_yards_per_attempt_allowed
        )
      ),

    rush_yards_allowed_per_game:
      average(
        metrics.map(
          (m) =>
            m.rush_yards_allowed_per_game
        )
      ),

    rush_yards_per_carry_allowed:
      average(
        metrics.map(
          (m) =>
            m.rush_yards_per_carry_allowed
        )
      ),

    sacks_per_game:
      average(
        metrics.map(
          (m) =>
            m.sacks_per_game
        )
      ),

    takeaways_per_game:
      average(
        metrics.map(
          (m) =>
            m.takeaways_per_game
        )
      ),

    yards_per_play_allowed:
      average(
        metrics.map(
          (m) =>
            m.yards_per_play_allowed
        )
      ),
  };
}

/* -------------------------------------------------- */
/* RATINGS                                            */
/* -------------------------------------------------- */

function lowerBetter(
  value: number | null,
  league: number | null
) {
  if (
    value === null ||
    league === null ||
    value <= 0 ||
    league <= 0
  ) {
    return null;
  }

  return clamp(
    (league / value) * 100,
    60,
    140
  );
}

function higherBetter(
  value: number | null,
  league: number | null
) {
  if (
    value === null ||
    league === null ||
    league <= 0
  ) {
    return null;
  }

  return clamp(
    (value / league) * 100,
    60,
    140
  );
}

function weightedAverage(
  values: Array<{
    value: number | null;
    weight: number;
  }>
) {
  const valid =
    values.filter(
      (
        item
      ): item is {
        value: number;
        weight: number;
      } =>
        item.value !== null
    );

  if (!valid.length) {
    return null;
  }

  const totalWeight =
    valid.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  return valid.reduce(
    (sum, item) =>
      sum +
      item.value *
        (item.weight /
          totalWeight),
    0
  );
}

function getRatings(
  defense: Defense | null,
  league: LeagueAverages
) {
  const metrics =
    getMetrics(defense);

  if (!metrics) {
    return null;
  }

  const passEfficiency =
    lowerBetter(
      metrics.pass_yards_per_attempt_allowed,
      league.pass_yards_per_attempt_allowed
    );

  const passYards =
    lowerBetter(
      metrics.pass_yards_allowed_per_game,
      league.pass_yards_allowed_per_game
    );

  const rushEfficiency =
    lowerBetter(
      metrics.rush_yards_per_carry_allowed,
      league.rush_yards_per_carry_allowed
    );

  const rushYards =
    lowerBetter(
      metrics.rush_yards_allowed_per_game,
      league.rush_yards_allowed_per_game
    );

  const sacks =
    higherBetter(
      metrics.sacks_per_game,
      league.sacks_per_game
    );

  const takeaways =
    higherBetter(
      metrics.takeaways_per_game,
      league.takeaways_per_game
    );

  const yardsPerPlay =
    lowerBetter(
      metrics.yards_per_play_allowed,
      league.yards_per_play_allowed
    );

  return {
    pass:
      weightedAverage([
        {
          value:
            passEfficiency,
          weight: 0.5,
        },
        {
          value:
            passYards,
          weight: 0.3,
        },
        {
          value:
            sacks,
          weight: 0.2,
        },
      ]),

    rush:
      weightedAverage([
        {
          value:
            rushEfficiency,
          weight: 0.65,
        },
        {
          value:
            rushYards,
          weight: 0.35,
        },
      ]),

    overall:
      weightedAverage([
        {
          value:
            passEfficiency,
          weight: 0.25,
        },
        {
          value:
            rushEfficiency,
          weight: 0.2,
        },
        {
          value:
            yardsPerPlay,
          weight: 0.25,
        },
        {
          value:
            sacks,
          weight: 0.15,
        },
        {
          value:
            takeaways,
          weight: 0.15,
        },
      ]),
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

  const currentWeight =
    currentGames /
    (currentGames + 4);

  return (
    current *
      currentWeight +
    prior *
      (1 - currentWeight)
  );
}

function ratingLabel(
  value: number | null
) {
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

function cleanMetrics(
  defense: Defense | null
) {
  const metrics =
    getMetrics(defense);

  if (!metrics) {
    return null;
  }

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

    fumble_takeaways:
      metrics.fumble_takeaways,

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
    /*
      Process one season at a time.

      This reduces peak memory use compared with
      loading both giant files simultaneously.
    */

    const currentData =
      await loadSeasonDefense(
        CURRENT_SEASON
      );

    const priorData =
      await loadSeasonDefense(
        PRIOR_SEASON
      );

    const current =
      currentData.defenses;

    const prior =
      priorData.defenses;

    const currentLeague =
      getLeagueAverages(
        current
      );

    const priorLeague =
      getLeagueAverages(
        prior
      );

    const allTeams =
      Array.from(
        new Set([
          ...current.keys(),
          ...prior.keys(),
        ])
      ).sort();

    const teams =
      allTeams.map(
        (team) => {
          const currentDefense =
            current.get(team) ??
            null;

          const priorDefense =
            prior.get(team) ??
            null;

          const currentMetrics =
            getMetrics(
              currentDefense
            );

          const currentRatings =
            getRatings(
              currentDefense,
              currentLeague
            );

          const priorRatings =
            getRatings(
              priorDefense,
              priorLeague
            );

          const currentGames =
            currentMetrics?.games ??
            0;

          const currentWeight =
            currentGames > 0
              ? currentGames /
                (currentGames + 4)
              : 0;

          const pass =
            blend(
              currentRatings?.pass ??
                null,
              priorRatings?.pass ??
                null,
              currentGames
            );

          const rush =
            blend(
              currentRatings?.rush ??
                null,
              priorRatings?.rush ??
                null,
              currentGames
            );

          const overall =
            blend(
              currentRatings?.overall ??
                null,
              priorRatings?.overall ??
                null,
              currentGames
            );

          return {
            team,

            current_games:
              currentGames,

            stabilization: {
              current_2026_weight_pct:
                round(
                  currentWeight *
                    100
                ),

              prior_2025_weight_pct:
                round(
                  (1 -
                    currentWeight) *
                    100
                ),
            },

            ratings: {
              overall_defense:
                round(overall),

              overall_label:
                ratingLabel(
                  overall
                ),

              pass_defense:
                round(pass),

              pass_label:
                ratingLabel(
                  pass
                ),

              rush_defense:
                round(rush),

              rush_label:
                ratingLabel(
                  rush
                ),
            },

            current_2026:
              cleanMetrics(
                currentDefense
              ),

            prior_2025:
              cleanMetrics(
                priorDefense
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
        "1.5-streaming-pbp-defense",

      source:
        "nflverse play-by-play",

      seasons: {
        current:
          CURRENT_SEASON,

        prior:
          PRIOR_SEASON,
      },

      diagnostics: {
        current_2026:
          currentData.diagnostics,

        prior_2025:
          priorData.diagnostics,

        teams_found:
          teams.length,
      },

      league_averages: {
        current_2026: {
          pass_yards_allowed_per_game:
            round(
              currentLeague.pass_yards_allowed_per_game,
              2
            ),

          pass_yards_per_attempt_allowed:
            round(
              currentLeague.pass_yards_per_attempt_allowed,
              2
            ),

          rush_yards_allowed_per_game:
            round(
              currentLeague.rush_yards_allowed_per_game,
              2
            ),

          rush_yards_per_carry_allowed:
            round(
              currentLeague.rush_yards_per_carry_allowed,
              2
            ),

          sacks_per_game:
            round(
              currentLeague.sacks_per_game,
              2
            ),

          takeaways_per_game:
            round(
              currentLeague.takeaways_per_game,
              2
            ),

          yards_per_play_allowed:
            round(
              currentLeague.yards_per_play_allowed,
              2
            ),
        },

        prior_2025: {
          pass_yards_allowed_per_game:
            round(
              priorLeague.pass_yards_allowed_per_game,
              2
            ),

          pass_yards_per_attempt_allowed:
            round(
              priorLeague.pass_yards_per_attempt_allowed,
              2
            ),

          rush_yards_allowed_per_game:
            round(
              priorLeague.rush_yards_allowed_per_game,
              2
            ),

          rush_yards_per_carry_allowed:
            round(
              priorLeague.rush_yards_per_carry_allowed,
              2
            ),

          sacks_per_game:
            round(
              priorLeague.sacks_per_game,
              2
            ),

          takeaways_per_game:
            round(
              priorLeague.takeaways_per_game,
              2
            ),

          yards_per_play_allowed:
            round(
              priorLeague.yards_per_play_allowed,
              2
            ),
        },
      },

      methodology: {
        rating_center:
          "100 = league average",

        higher_rating:
          "better defense",

        early_season_stabilization:
          "Current season weight = games / (games + 4), with prior season providing the remaining weight.",

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

        opponent_adjusted:
          false,

        injury_adjusted:
          false,

        model_adjustment_active:
          false,
      },

      teams,

      validation_status: {
        defense_data_connected:
          teams.length === 32,

        passing_v2_backtest_complete:
          false,

        defense_adjustment_approved:
          false,

        model_adjustment_active:
          false,

        message:
          "Defense data is connected but does not change RDG projections yet. Defensive features must first improve the frozen Passing V2 model in held-out testing.",
      },

      next_step:
        "Backtest individual opponent pass-defense features against frozen RDG Passing V2 using only defensive information available before each historical game.",

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
          "1.5-streaming-pbp-defense",

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
