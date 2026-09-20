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

  passPlays: number;
  passYards: number;

  rushPlays: number;
  rushYards: number;

  sacks: number;
  interceptions: number;
  fumblesLost: number;

  totalPlays: number;
  totalYards: number;
};

function txt(v: any) {
  return String(v ?? "").trim();
}

function n(v: any) {
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

function team(v: any) {
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
    const c = input[i];

    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;

      row.push(value);

      if (row.some((x) => x.length)) {
        rows.push(row);
      }

      row = [];
      value = "";
    } else {
      value += c;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0];

  return rows.slice(1).map((values) => {
    const out: Row = {};

    headers.forEach((header, i) => {
      out[header] = values[i] ?? "";
    });

    return out;
  });
}

/* -------------------------------------------------- */
/* LOAD PBP                                           */
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

  /*
    GitHub normally decompresses gzip automatically through fetch.
    If the response is still compressed in your Vercel environment,
    we'll see that immediately from the route error/result.
  */

  const body = await response.text();

  return parseCSV(body);
}

/* -------------------------------------------------- */
/* AGGREGATION                                        */
/* -------------------------------------------------- */

function emptyDefense(teamName: string, season: number): Defense {
  return {
    team: teamName,
    season,
    games: new Set(),

    passPlays: 0,
    passYards: 0,

    rushPlays: 0,
    rushYards: 0,

    sacks: 0,
    interceptions: 0,
    fumblesLost: 0,

    totalPlays: 0,
    totalYards: 0,
  };
}

function aggregateDefense(rows: Row[], season: number) {
  const defenses = new Map<string, Defense>();

  function get(defTeam: string) {
    if (!defenses.has(defTeam)) {
      defenses.set(defTeam, emptyDefense(defTeam, season));
    }

    return defenses.get(defTeam)!;
  }

  for (const row of rows) {
    if (n(row.season) !== season) continue;

    if (txt(row.season_type).toUpperCase() !== "REG") continue;

    const defTeam = team(row.defteam);
    const gameID = txt(row.game_id);

    if (!defTeam || !gameID) continue;

    const defense = get(defTeam);

    defense.games.add(gameID);

    const pass = n(row.pass_attempt) === 1;
    const rush = n(row.rush_attempt) === 1;
    const sack = n(row.sack) === 1;

    /*
      nflfastR passing_yards / rushing_yards are play-level
      yardage variables.

      Sacks are kept separate from normal pass attempts here.
    */

    if (pass) {
      defense.passPlays++;
      defense.passYards += n(row.passing_yards);

      defense.totalPlays++;
      defense.totalYards += n(row.passing_yards);
    }

    if (rush) {
      defense.rushPlays++;
      defense.rushYards += n(row.rushing_yards);

      defense.totalPlays++;
      defense.totalYards += n(row.rushing_yards);
    }

    if (sack) {
      defense.sacks++;
    }

    /*
      Defensive takeaways.
    */

    if (n(row.interception) === 1) {
      defense.interceptions++;
    }

    if (n(row.fumble_lost) === 1) {
      defense.fumblesLost++;
    }
  }

  return defenses;
}

/* -------------------------------------------------- */
/* METRICS                                            */
/* -------------------------------------------------- */

function metrics(d: Defense | null) {
  if (!d) return null;

  const games = d.games.size;

  if (!games) return null;

  const passYPG =
    d.passYards / games;

  const rushYPG =
    d.rushYards / games;

  const passYPA =
    d.passPlays > 0
      ? d.passYards / d.passPlays
      : null;

  const rushYPC =
    d.rushPlays > 0
      ? d.rushYards / d.rushPlays
      : null;

  const sacksPG =
    d.sacks / games;

  const takeaways =
    d.interceptions +
    d.fumblesLost;

  const takeawaysPG =
    takeaways / games;

  const yardsPerPlay =
    d.totalPlays > 0
      ? d.totalYards / d.totalPlays
      : null;

  return {
    games,

    pass_yards_allowed_per_game: passYPG,
    pass_yards_per_attempt_allowed: passYPA,

    rush_yards_allowed_per_game: rushYPG,
    rush_yards_per_carry_allowed: rushYPC,

    sacks_per_game: sacksPG,

    interceptions: d.interceptions,
    fumbles_lost_forced: d.fumblesLost,

    takeaways_per_game: takeawaysPG,

    yards_per_play_allowed: yardsPerPlay,
  };
}

/* -------------------------------------------------- */
/* LEAGUE AVERAGES                                    */
/* -------------------------------------------------- */

function avg(values: Array<number | null>) {
  const good = values.filter(
    (x): x is number =>
      x !== null &&
      Number.isFinite(x)
  );

  if (!good.length) return null;

  return (
    good.reduce((a, b) => a + b, 0) /
    good.length
  );
}

function leagueAverage(
  defenses: Map<string, Defense>
) {
  const all = Array.from(defenses.values())
    .map(metrics)
    .filter(Boolean) as NonNullable<
    ReturnType<typeof metrics>
  >[];

  return {
    pass_yards_allowed_per_game:
      avg(
        all.map(
          (x) =>
            x.pass_yards_allowed_per_game
        )
      ),

    pass_yards_per_attempt_allowed:
      avg(
        all.map(
          (x) =>
            x.pass_yards_per_attempt_allowed
        )
      ),

    rush_yards_allowed_per_game:
      avg(
        all.map(
          (x) =>
            x.rush_yards_allowed_per_game
        )
      ),

    rush_yards_per_carry_allowed:
      avg(
        all.map(
          (x) =>
            x.rush_yards_per_carry_allowed
        )
      ),

    sacks_per_game:
      avg(
        all.map(
          (x) =>
            x.sacks_per_game
        )
      ),

    takeaways_per_game:
      avg(
        all.map(
          (x) =>
            x.takeaways_per_game
        )
      ),

    yards_per_play_allowed:
      avg(
        all.map(
          (x) =>
            x.yards_per_play_allowed
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

function ratings(
  d: Defense | null,
  league: ReturnType<typeof leagueAverage>
) {
  const m = metrics(d);

  if (!m) return null;

  const passYards = lowerBetter(
    m.pass_yards_allowed_per_game,
    league.pass_yards_allowed_per_game
  );

  const passEfficiency = lowerBetter(
    m.pass_yards_per_attempt_allowed,
    league.pass_yards_per_attempt_allowed
  );

  const rushYards = lowerBetter(
    m.rush_yards_allowed_per_game,
    league.rush_yards_allowed_per_game
  );

  const rushEfficiency = lowerBetter(
    m.rush_yards_per_carry_allowed,
    league.rush_yards_per_carry_allowed
  );

  const sacks = higherBetter(
    m.sacks_per_game,
    league.sacks_per_game
  );

  const takeaways = higherBetter(
    m.takeaways_per_game,
    league.takeaways_per_game
  );

  const ypp = lowerBetter(
    m.yards_per_play_allowed,
    league.yards_per_play_allowed
  );

  const passParts = [
    { value: passEfficiency, weight: 0.50 },
    { value: passYards, weight: 0.30 },
    { value: sacks, weight: 0.20 },
  ].filter(
    (x): x is { value: number; weight: number } =>
      x.value !== null
  );

  const rushParts = [
    { value: rushEfficiency, weight: 0.65 },
    { value: rushYards, weight: 0.35 },
  ].filter(
    (x): x is { value: number; weight: number } =>
      x.value !== null
  );

  const overallParts = [
    { value: passEfficiency, weight: 0.25 },
    { value: rushEfficiency, weight: 0.20 },
    { value: ypp, weight: 0.25 },
    { value: sacks, weight: 0.15 },
    { value: takeaways, weight: 0.15 },
  ].filter(
    (x): x is { value: number; weight: number } =>
      x.value !== null
  );

  function weighted(
    parts: Array<{
      value: number;
      weight: number;
    }>
  ) {
    if (!parts.length) return null;

    const totalWeight =
      parts.reduce(
        (s, x) => s + x.weight,
        0
      );

    return (
      parts.reduce(
        (s, x) =>
          s +
          x.value *
            (x.weight / totalWeight),
        0
      )
    );
  }

  return {
    pass: weighted(passParts),
    rush: weighted(rushParts),
    overall: weighted(overallParts),
  };
}

/* -------------------------------------------------- */
/* EARLY-SEASON STABILIZATION                         */
/* -------------------------------------------------- */

function blend(
  current: number | null,
  prior: number | null,
  games: number
) {
  if (current === null && prior === null) {
    return null;
  }

  if (current === null) return prior;
  if (prior === null) return current;

  const currentWeight =
    games / (games + 4);

  return (
    current * currentWeight +
    prior * (1 - currentWeight)
  );
}

function label(value: number | null) {
  if (value === null) return "NO_DATA";

  if (value >= 115) return "ELITE";
  if (value >= 105) return "STRONG";

  if (value <= 85) return "WEAK";
  if (value <= 95) return "BELOW_AVERAGE";

  return "AVERAGE";
}

/* -------------------------------------------------- */
/* OUTPUT FORMAT                                      */
/* -------------------------------------------------- */

function cleanMetrics(
  d: Defense | null
) {
  const m = metrics(d);

  if (!m) return null;

  return {
    games: m.games,

    pass_yards_allowed_per_game:
      round(
        m.pass_yards_allowed_per_game
      ),

    pass_yards_per_attempt_allowed:
      round(
        m.pass_yards_per_attempt_allowed,
        2
      ),

    rush_yards_allowed_per_game:
      round(
        m.rush_yards_allowed_per_game
      ),

    rush_yards_per_carry_allowed:
      round(
        m.rush_yards_per_carry_allowed,
        2
      ),

    sacks_per_game:
      round(
        m.sacks_per_game,
        2
      ),

    takeaways_per_game:
      round(
        m.takeaways_per_game,
        2
      ),

    yards_per_play_allowed:
      round(
        m.yards_per_play_allowed,
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
      currentRows,
      priorRows,
    ] = await Promise.all([
      loadPBP(CURRENT_SEASON),
      loadPBP(PRIOR_SEASON),
    ]);

    const current =
      aggregateDefense(
        currentRows,
        CURRENT_SEASON
      );

    const prior =
      aggregateDefense(
        priorRows,
        PRIOR_SEASON
      );

    const currentLeague =
      leagueAverage(current);

    const priorLeague =
      leagueAverage(prior);

    const teams = Array.from(
      new Set([
        ...current.keys(),
        ...prior.keys(),
      ])
    )
      .sort()
      .map((teamName) => {
        const currentDefense =
          current.get(teamName) ?? null;

        const priorDefense =
          prior.get(teamName) ?? null;

        const currentMetrics =
          metrics(currentDefense);

        const currentRatings =
          ratings(
            currentDefense,
            currentLeague
          );

        const priorRatings =
          ratings(
            priorDefense,
            priorLeague
          );

        const games =
          currentMetrics?.games ?? 0;

        const pass = blend(
          currentRatings?.pass ?? null,
          priorRatings?.pass ?? null,
          games
        );

        const rush = blend(
          currentRatings?.rush ?? null,
          priorRatings?.rush ?? null,
          games
        );

        const overall = blend(
          currentRatings?.overall ?? null,
          priorRatings?.overall ?? null,
          games
        );

        const currentWeight =
          games > 0
            ? games / (games + 4)
            : 0;

        return {
          team: teamName,

          current_games: games,

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
              round(overall),

            overall_label:
              label(overall),

            pass_defense:
              round(pass),

            pass_label:
              label(pass),

            rush_defense:
              round(rush),

            rush_label:
              label(rush),
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
      });

    teams.sort(
      (a, b) =>
        (b.ratings.overall_defense ??
          -999) -
        (a.ratings.overall_defense ??
          -999)
    );

    return NextResponse.json({
      success: true,

      version:
        "1.1-pbp-defense",

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
          "passing yards allowed",
          "yards per pass attempt",
          "sacks",
        ],

        rush_defense_inputs: [
          "rushing yards allowed",
          "yards per carry",
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
                  : round(value, 2),
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
                  : round(value, 2),
              ]
            )
          ),
      },

      pbp_rows: {
        current_2026:
          currentRows.length,

        prior_2025:
          priorRows.length,
      },

      teams_found:
        teams.length,

      teams,

      validation_status: {
        defense_data_connected:
          true,

        passing_v2_backtest_complete:
          false,

        defense_adjustment_approved:
          false,

        message:
          "Defensive ratings remain descriptive until they are tested against the frozen RDG Passing V2 model.",
      },

      next_step:
        "Backtest pass-defense features against frozen Passing V2.",

      generated_at:
        new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(
      "NFL defense stats v1.1 error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        version:
          "1.1-pbp-defense",

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
