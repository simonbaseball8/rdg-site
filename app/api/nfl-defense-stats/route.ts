import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";

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

function txt(value: any): string {
  return String(value ?? "").trim();
}

function num(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) {
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

function normalizeTeam(value: any): string {
  const team =
    txt(value).toUpperCase();

  const aliases: Record<
    string,
    string
  > = {
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

function parseCSV(
  input: string
): {
  headers: string[];
  rows: Row[];
} {
  const rawRows: string[][] = [];

  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (
    let i = 0;
    i < input.length;
    i++
  ) {
    const char = input[i];

    if (char === '"') {
      if (
        quoted &&
        input[i + 1] === '"'
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
      row.push(value);
      value = "";
    } else if (
      (char === "\n" ||
        char === "\r") &&
      !quoted
    ) {
      if (
        char === "\r" &&
        input[i + 1] === "\n"
      ) {
        i++;
      }

      row.push(value);

      if (
        row.some(
          (item) =>
            item.length > 0
        )
      ) {
        rawRows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (
    value.length ||
    row.length
  ) {
    row.push(value);
    rawRows.push(row);
  }

  if (!rawRows.length) {
    return {
      headers: [],
      rows: [],
    };
  }

  const headers =
    rawRows[0].map(
      (header) =>
        header
          .replace(/^\uFEFF/, "")
          .trim()
    );

  const rows =
    rawRows
      .slice(1)
      .map((values) => {
        const output: Row = {};

        headers.forEach(
          (
            header,
            index
          ) => {
            output[header] =
              values[index] ??
              "";
          }
        );

        return output;
      });

  return {
    headers,
    rows,
  };
}

/* -------------------------------------------------- */
/* LOAD + DECOMPRESS NFLVERSE                         */
/* -------------------------------------------------- */

async function loadPBP(
  season: number
) {
  const response =
    await fetch(
      PBP_URL(season),
      {
        cache: "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Unable to load ${season} nflverse PBP: ${response.status}`
    );
  }

  /*
    GitHub returns the actual gzip bytes.

    We therefore read the response as an ArrayBuffer
    instead of calling response.text().
  */

  const compressed =
    Buffer.from(
      await response.arrayBuffer()
    );

  /*
    gzip magic bytes should be:
    1F 8B
  */

  const isGzip =
    compressed.length >= 2 &&
    compressed[0] === 0x1f &&
    compressed[1] === 0x8b;

  let csvText: string;

  if (isGzip) {
    const decompressed =
      gunzipSync(compressed);

    csvText =
      decompressed.toString(
        "utf8"
      );
  } else {
    /*
      Fallback in case the host ever begins
      automatically decompressing the file.
    */

    csvText =
      compressed.toString(
        "utf8"
      );
  }

  const parsed =
    parseCSV(csvText);

  return {
    season,

    rows:
      parsed.rows,

    headers:
      parsed.headers,

    diagnostics: {
      compressed_bytes:
        compressed.length,

      gzip_detected:
        isGzip,

      decompressed_characters:
        csvText.length,

      columns:
        parsed.headers.length,

      rows:
        parsed.rows.length,

      has_game_id:
        parsed.headers.includes(
          "game_id"
        ),

      has_season_type:
        parsed.headers.includes(
          "season_type"
        ),

      has_posteam:
        parsed.headers.includes(
          "posteam"
        ),

      has_defteam:
        parsed.headers.includes(
          "defteam"
        ),

      has_play_type:
        parsed.headers.includes(
          "play_type"
        ),

      has_pass_attempt:
        parsed.headers.includes(
          "pass_attempt"
        ),

      has_rush_attempt:
        parsed.headers.includes(
          "rush_attempt"
        ),

      has_passing_yards:
        parsed.headers.includes(
          "passing_yards"
        ),

      has_rushing_yards:
        parsed.headers.includes(
          "rushing_yards"
        ),

      has_yards_gained:
        parsed.headers.includes(
          "yards_gained"
        ),

      has_sack:
        parsed.headers.includes(
          "sack"
        ),

      has_interception:
        parsed.headers.includes(
          "interception"
        ),

      has_fumble_lost:
        parsed.headers.includes(
          "fumble_lost"
        ),
    },
  };
}

/* -------------------------------------------------- */
/* EMPTY DEFENSE                                      */
/* -------------------------------------------------- */

function emptyDefense(
  team: string,
  season: number
): Defense {
  return {
    team,
    season,

    games:
      new Set<string>(),

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

function aggregateDefense(
  rows: Row[],
  season: number
) {
  const defenses =
    new Map<
      string,
      Defense
    >();

  function getDefense(
    team: string
  ) {
    if (
      !defenses.has(team)
    ) {
      defenses.set(
        team,
        emptyDefense(
          team,
          season
        )
      );
    }

    return defenses.get(
      team
    )!;
  }

  for (const row of rows) {
    /*
      Each downloaded file is already
      season-specific.

      We only remove postseason plays.
    */

    const seasonType =
      txt(
        row.season_type
      ).toUpperCase();

    if (
      seasonType &&
      seasonType !== "REG"
    ) {
      continue;
    }

    const defensiveTeam =
      normalizeTeam(
        row.defteam
      );

    const gameID =
      txt(
        row.game_id
      );

    if (
      !defensiveTeam ||
      !gameID
    ) {
      continue;
    }

    const defense =
      getDefense(
        defensiveTeam
      );

    defense.games.add(
      gameID
    );

    const playType =
      txt(
        row.play_type
      ).toLowerCase();

    const passAttempt =
      num(
        row.pass_attempt
      ) === 1;

    const rushAttempt =
      num(
        row.rush_attempt
      ) === 1;

    const sack =
      num(
        row.sack
      ) === 1;

    const interception =
      num(
        row.interception
      ) === 1;

    const fumbleLost =
      num(
        row.fumble_lost
      ) === 1;

    /*
      PASS ATTEMPTS

      Use pass_attempt when available.
      Sacks remain separate.
    */

    if (
      passAttempt &&
      !sack
    ) {
      const yards =
        num(
          row.passing_yards
        ) ||
        num(
          row.yards_gained
        );

      defense.passAttempts +=
        1;

      defense.passYards +=
        yards;

      defense.totalPlays +=
        1;

      defense.totalYards +=
        yards;
    }

    /*
      FALLBACK FOR PASS PLAYS
    */

    if (
      !passAttempt &&
      !sack &&
      playType === "pass"
    ) {
      const yards =
        num(
          row.passing_yards
        ) ||
        num(
          row.yards_gained
        );

      defense.passAttempts +=
        1;

      defense.passYards +=
        yards;

      defense.totalPlays +=
        1;

      defense.totalYards +=
        yards;
    }

    /*
      RUSH ATTEMPTS
    */

    if (rushAttempt) {
      const yards =
        num(
          row.rushing_yards
        ) ||
        num(
          row.yards_gained
        );

      defense.rushAttempts +=
        1;

      defense.rushYards +=
        yards;

      defense.totalPlays +=
        1;

      defense.totalYards +=
        yards;
    }

    /*
      FALLBACK FOR RUN PLAYS
    */

    if (
      !rushAttempt &&
      playType === "run"
    ) {
      const yards =
        num(
          row.rushing_yards
        ) ||
        num(
          row.yards_gained
        );

      defense.rushAttempts +=
        1;

      defense.rushYards +=
        yards;

      defense.totalPlays +=
        1;

      defense.totalYards +=
        yards;
    }

    /*
      SACKS
    */

    if (sack) {
      defense.sacks +=
        1;

      defense.totalPlays +=
        1;

      /*
        Sack yardage is normally negative.
        This helps our overall yards/play
        calculation.
      */

      defense.totalYards +=
        num(
          row.yards_gained
        );
    }

    /*
      TAKEAWAYS
    */

    if (interception) {
      defense.interceptions +=
        1;
    }

    if (fumbleLost) {
      defense.fumblesLost +=
        1;
    }
  }

  return defenses;
}

/* -------------------------------------------------- */
/* TEAM METRICS                                       */
/* -------------------------------------------------- */

function getMetrics(
  defense: Defense | null
) {
  if (!defense) {
    return null;
  }

  const games =
    defense.games.size;

  if (!games) {
    return null;
  }

  const passYPG =
    defense.passYards /
    games;

  const passYPA =
    defense.passAttempts >
    0
      ? defense.passYards /
        defense.passAttempts
      : null;

  const rushYPG =
    defense.rushYards /
    games;

  const rushYPC =
    defense.rushAttempts >
    0
      ? defense.rushYards /
        defense.rushAttempts
      : null;

  const sacksPG =
    defense.sacks /
    games;

  const takeaways =
    defense.interceptions +
    defense.fumblesLost;

  const takeawaysPG =
    takeaways /
    games;

  const yardsPerPlay =
    defense.totalPlays >
    0
      ? defense.totalYards /
        defense.totalPlays
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

function average(
  values: Array<
    number | null
  >
) {
  const valid =
    values.filter(
      (
        value
      ): value is number =>
        value !== null &&
        Number.isFinite(
          value
        )
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    valid.length
  );
}

function getLeagueAverages(
  defenses: Map<
    string,
    Defense
  >
) {
  const all =
    Array.from(
      defenses.values()
    )
      .map(
        (defense) =>
          getMetrics(
            defense
          )
      )
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
        all.map(
          (m) =>
            m.pass_yards_allowed_per_game
        )
      ),

    pass_yards_per_attempt_allowed:
      average(
        all.map(
          (m) =>
            m.pass_yards_per_attempt_allowed
        )
      ),

    rush_yards_allowed_per_game:
      average(
        all.map(
          (m) =>
            m.rush_yards_allowed_per_game
        )
      ),

    rush_yards_per_carry_allowed:
      average(
        all.map(
          (m) =>
            m.rush_yards_per_carry_allowed
        )
      ),

    sacks_per_game:
      average(
        all.map(
          (m) =>
            m.sacks_per_game
        )
      ),

    takeaways_per_game:
      average(
        all.map(
          (m) =>
            m.takeaways_per_game
        )
      ),

    yards_per_play_allowed:
      average(
        all.map(
          (m) =>
            m.yards_per_play_allowed
        )
      ),
  };
}

/* -------------------------------------------------- */
/* RATING HELPERS                                     */
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
    (league / value) *
      100,
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
    (value / league) *
      100,
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
  const valid =
    parts.filter(
      (
        part
      ): part is {
        value: number;
        weight: number;
      } =>
        part.value !== null
    );

  if (!valid.length) {
    return null;
  }

  const weight =
    valid.reduce(
      (sum, part) =>
        sum + part.weight,
      0
    );

  return valid.reduce(
    (sum, part) =>
      sum +
      part.value *
        (part.weight /
          weight),
    0
  );
}

/* -------------------------------------------------- */
/* DEFENSIVE RATINGS                                  */
/* -------------------------------------------------- */

function getRatings(
  defense: Defense | null,
  league: ReturnType<
    typeof getLeagueAverages
  >
) {
  const metrics =
    getMetrics(
      defense
    );

  if (!metrics) {
    return null;
  }

  const passYards =
    lowerBetter(
      metrics.pass_yards_allowed_per_game,
      league.pass_yards_allowed_per_game
    );

  const passEfficiency =
    lowerBetter(
      metrics.pass_yards_per_attempt_allowed,
      league.pass_yards_per_attempt_allowed
    );

  const rushYards =
    lowerBetter(
      metrics.rush_yards_allowed_per_game,
      league.rush_yards_allowed_per_game
    );

  const rushEfficiency =
    lowerBetter(
      metrics.rush_yards_per_carry_allowed,
      league.rush_yards_per_carry_allowed
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

  const pass =
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
    ]);

  const rush =
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
    ]);

  const overall =
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
    ]);

  return {
    pass,
    rush,
    overall,
  };
}

/* -------------------------------------------------- */
/* EARLY-SEASON STABILIZATION                         */
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
      (1 -
        currentWeight)
  );
}

function label(
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
/* OUTPUT METRICS                                     */
/* -------------------------------------------------- */

function cleanMetrics(
  defense: Defense | null
) {
  const metrics =
    getMetrics(
      defense
    );

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
    const [
      currentData,
      priorData,
    ] = await Promise.all([
      loadPBP(
        CURRENT_SEASON
      ),

      loadPBP(
        PRIOR_SEASON
      ),
    ]);

    const current =
      aggregateDefense(
        currentData.rows,
        CURRENT_SEASON
      );

    const prior =
      aggregateDefense(
        priorData.rows,
        PRIOR_SEASON
      );

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
          ...Array.from(
            current.keys()
          ),

          ...Array.from(
            prior.keys()
          ),
        ])
      ).sort();

    const teams =
      allTeams.map(
        (teamName) => {
          const currentDefense =
            current.get(
              teamName
            ) ?? null;

          const priorDefense =
            prior.get(
              teamName
            ) ?? null;

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

          const games =
            currentMetrics?.games ??
            0;

          const currentWeight =
            games > 0
              ? games /
                (games + 4)
              : 0;

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

          const overall =
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
                round(
                  overall
                ),

              overall_label:
                label(
                  overall
                ),

              pass_defense:
                round(
                  pass
                ),

              pass_label:
                label(
                  pass
                ),

              rush_defense:
                round(
                  rush
                ),

              rush_label:
                label(
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
        "1.4-pbp-gzip-defense",

      seasons: {
        current:
          CURRENT_SEASON,

        prior:
          PRIOR_SEASON,
      },

      source:
        "nflverse play-by-play",

      file_diagnostics: {
        current_2026:
          currentData.diagnostics,

        prior_2025:
          priorData.diagnostics,
      },

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
        current_defensive_teams:
          current.size,

        prior_defensive_teams:
          prior.size,

        teams_found:
          teams.length,
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
          "Defensive data is descriptive only until held-out testing shows it improves the frozen RDG Passing V2 model.",
      },

      next_step:
        "Backtest pass-defense features against frozen RDG Passing V2.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense v1.4 error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.4-pbp-gzip-defense",

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
