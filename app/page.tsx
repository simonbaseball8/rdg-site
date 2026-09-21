"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type ParlayLeg = {
  id: number;
  parlay_id: number;
  leg_number: number;
  sport: string;
  player: string | null;
  team: string | null;
  opponent: string | null;
  bet_type: string;
  odds: string | null;
  confidence: number | null;
  reasoning: string | null;
  key_risk: string | null;
  status: string;
};

type Parlay = {
  id: number;
  bet_date: string;
  name: string;
  category: string;
  risk_level: string | null;
  confidence: number | null;
  sportsbook: string | null;
  total_odds: string | null;
  status: string;
  notes: string | null;
  parlay_legs?: ParlayLeg[];
};

type NFLGame = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;
  stats_connected: boolean;

  rdg: {
    projected_home_margin: number;
    projected_winner: string;
    projected_margin: number;

    historical_signal: {
      bucket: string;
      sample: number;
      correct: number;
      historical_winner_accuracy: number;
      signal: string;
    };

    market_analysis: {
      model_favorite: string;
      market_favorite: string;
      model_projected_home_margin: number;
      market_implied_home_margin: number | null;
      model_vs_market_difference: number | null;
      spread_lean: string;
      market_signal: string;

      hard_rock_spread: {
        away_team: string;
        away_line: number | null;
        away_odds: string | null;
        home_team: string;
        home_line: number | null;
        home_odds: string | null;
      };

      hard_rock_moneyline: {
        away_team: string;
        away_odds: string | null;
        home_team: string;
        home_odds: string | null;
      };
    };
  };
};

type NFLAnalysis = {
  sportsbook: string;
  sport: string;
  model: string;
  version: string;
  games_found: number;
  schedule_week?: number;
  games_with_stats: number;
  priority_reviews: number;
  strong_reviews: number;
  updated_at: string;
  games: NFLGame[];
};
type NFLPassingProp = {
  event_id: string;
  start_time: string | null;
  matchup: { away: string | null; home: string | null };
  player_id: string;
  player_name: string;
  market: string;
  selection: "OVER" | "UNDER";
  market_line: number;
  rdg_projection: number;
  model_vs_line_yards: number;
  model_probability: number;
  market_no_vig_probability: number | null;
  model_vs_market_probability: number | null;
  review: string;
  sportsbook_lines?: Array<{
    sportsbook: string;
    side: string | null;
    line: number;
    odds: string | number | null;
    available: boolean;
    updated_at: string | null;
  }>;
};

type NFLPassingPropsAnalysis = {
  success: boolean;
  version: string;
  market: string;
  model_status: string;
  qualifying_reviews: number;
  props: NFLPassingProp[];
  updated_at: string;
};

type CFBGame = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;
  stats_connected: boolean;

  hard_rock: {
    spread: {
      away_team: string;
      away_line: number | null;
      away_odds: string | null;
      home_team: string;
      home_line: number | null;
      home_odds: string | null;
    };
  };

  rdg: {
    projected_winner: string;
    projected_margin: number;
    projected_home_margin: number;
    market_implied_home_margin: number | null;
    model_vs_market_difference: number | null;
    spread_lean: string | null;
    signal: string;
    sample_status: string;
    minimum_core_plays: number;
  } | null;
};

type CFBAnalysis = {
  sportsbook: string;
  sport: string;
  season: number;
  model: string;
  version: string;
  model_status: string;
  games_found: number;
  games_with_core: number;
  games_missing_core: number;
  priority_reviews: number;
  strong_reviews: number;
  watch_reviews: number;
  updated_at: string;
  games: CFBGame[];
};
type MLBGame = {
  event_id: string;
  game_pk: number | null;
  start_date: string;
  away_team: string;
  home_team: string;
  venue: string | null;
  hard_rock: {
    moneyline: { away_odds: string | null; home_odds: string | null; no_vig_away_probability: number; no_vig_home_probability: number; };
    run_line: { away_line: number | null; away_odds: string | null; home_line: number | null; home_odds: string | null; };
    total: { over: number | null; over_odds: string | null; under: number | null; under_odds: string | null; };
  };
  starting_pitchers: {
    away: { name: string; stats: { era: number | null; whip: number | null; innings: number | null } | null; pitcher_score: number | null } | null;
    home: { name: string; stats: { era: number | null; whip: number | null; innings: number | null } | null; pitcher_score: number | null } | null;
  };
  rdg: {
    calibrated_team_home_probability: number;
    model_home_probability: number;
    model_away_probability: number;
    projected_winner: string;
    moneyline_lean: string;
    model_market_edge: number;
    signal: string;
    total_model?: {
      status: string;
      projected_away_runs: number | null;
      projected_home_runs: number | null;
      projected_total_runs: number | null;
      market_total: number | null;
      model_over_probability: number | null;
      model_under_probability: number | null;
      no_vig_over_probability: number | null;
      no_vig_under_probability: number | null;
      lean: "Over" | "Under" | null;
      edge: number | null;
      signal: string;
    };
  };
};

type MLBAnalysis = {
  sportsbook: string; sport: string; season: number; model: string; version: string; model_status: string;
  games_found: number; priority_reviews: number; strong_reviews: number; watch_reviews: number; updated_at: string; games: MLBGame[];
};

type MLBBetCandidate = {
  event_id: string;
  matchup: string;
  team: string;
  odds: string | null;
  display_bet: string;
  model_probability: number;
  market_probability: number | null;
  edge: number;
  signal: string;
  starter: string;
  market_type?: "moneyline" | "total";
  total_line?: number | null;
  projected_total?: number | null;
};

type CFBBetCandidate = {
  event_id: string;
  matchup: string;
  team: string;
  line: number;
  odds: string | null;
  display_bet: string;
  edge: number;
  signal: string;
  sample_status: string;
};

type NHLGame = {
  game_id: number;
  event_id: string;
  date: string;
  start_time_utc: string;
  game_type: number;
  game_type_label: string;
  game_state: string;
  matchup: string;
  away_team: string;
  home_team: string;
  model_available: boolean;
  odds_available: boolean;
  rdg_projected_winner: string;
  rdg_home_probability: number;
  rdg_away_probability: number;
  projected_winner_probability: number;
  signal: string;
  note: string;
  model_market_edge?: number | null;
  moneyline_lean?: string | null;
  hard_rock?: {
    moneyline?: {
      away_odds?: string | null;
      home_odds?: string | null;
      no_vig_away_probability?: number | null;
      no_vig_home_probability?: number | null;
    };
  };
};

type NHLAnalysis = {
  success: boolean;
  sport: string;
  version: string;
  model_status: string;
  market: string;
  games_found: number;
  preseason_games: number;
  games_with_model: number;
  games_with_hard_rock_moneylines: number;
  review_summary: {
    priority_reviews: number;
    strong_reviews: number;
    watches: number;
    preseason_watches: number;
  };
  games: NHLGame[];
};

type NHLBetCandidate = {
  event_id: string;
  matchup: string;
  team: string;
  odds: string | null;
  display_bet: string;
  model_probability: number;
  market_probability: number | null;
  edge: number;
  signal: string;
};

type BetCandidate = {
  event_id: string;
  correlation_key: string;
  market_type: "spread" | "passing_prop";
  matchup: string;
  team: string;
  line: number;
  odds: string | null;
  display_bet: string;
  projected_winner: string;
  projected_margin: number;
  difference: number;
  historical_accuracy: number;
  historical_sample: number;
  historical_correct: number;
  historical_bucket: string;
  score: number;
  player_name?: string;
  selection?: "OVER" | "UNDER";
  model_probability?: number;
  market_probability?: number | null;
  review?: string;
  sportsbook_name?: string | null;
};

function diversifiedSelection<T>(items: T[], count: number, offset: number, stride: number) {
  if (count <= 0 || items.length === 0) return [];

  const result: T[] = [];
  const used = new Set<number>();
  let index = ((offset % items.length) + items.length) % items.length;
  let attempts = 0;

  while (result.length < Math.min(count, items.length) && attempts < items.length * 3) {
    if (!used.has(index)) {
      used.add(index);
      result.push(items[index]);
    }
    index = (index + stride) % items.length;
    attempts += 1;
  }

  if (result.length < Math.min(count, items.length)) {
    for (let i = 0; i < items.length && result.length < count; i += 1) {
      if (!used.has(i)) {
        used.add(i);
        result.push(items[i]);
      }
    }
  }

  return result;
}

function TeamLogo({ sport, team }: { sport: "NFL" | "MLB" | "NHL"; team: string }) {
  const aliases: Record<string, Record<string, string>> = {
    NFL: {
      ARI: "ari", ATL: "atl", BAL: "bal", BUF: "buf", CAR: "car", CHI: "chi", CIN: "cin", CLE: "cle",
      DAL: "dal", DEN: "den", DET: "det", GB: "gb", HOU: "hou", IND: "ind", JAX: "jax", JAC: "jax",
      KC: "kc", LV: "lv", LAC: "lac", LAR: "lar", MIA: "mia", MIN: "min", NE: "ne", NO: "no",
      NYG: "nyg", NYJ: "nyj", PHI: "phi", PIT: "pit", SEA: "sea", SF: "sf", TB: "tb", TEN: "ten", WAS: "wsh", WSH: "wsh",
      "ARIZONA CARDINALS": "ari", "ATLANTA FALCONS": "atl", "BALTIMORE RAVENS": "bal", "BUFFALO BILLS": "buf",
      "CAROLINA PANTHERS": "car", "CHICAGO BEARS": "chi", "CINCINNATI BENGALS": "cin", "CLEVELAND BROWNS": "cle",
      "DALLAS COWBOYS": "dal", "DENVER BRONCOS": "den", "DETROIT LIONS": "det", "GREEN BAY PACKERS": "gb",
      "HOUSTON TEXANS": "hou", "INDIANAPOLIS COLTS": "ind", "JACKSONVILLE JAGUARS": "jax", "KANSAS CITY CHIEFS": "kc",
      "LAS VEGAS RAIDERS": "lv", "LOS ANGELES CHARGERS": "lac", "LOS ANGELES RAMS": "lar", "MIAMI DOLPHINS": "mia",
      "MINNESOTA VIKINGS": "min", "NEW ENGLAND PATRIOTS": "ne", "NEW ORLEANS SAINTS": "no", "NEW YORK GIANTS": "nyg",
      "NEW YORK JETS": "nyj", "PHILADELPHIA EAGLES": "phi", "PITTSBURGH STEELERS": "pit", "SEATTLE SEAHAWKS": "sea",
      "SAN FRANCISCO 49ERS": "sf", "TAMPA BAY BUCCANEERS": "tb", "TENNESSEE TITANS": "ten", "WASHINGTON COMMANDERS": "wsh"
    },
    MLB: {
      ARI: "ari", ATH: "ath", ATL: "atl", BAL: "bal", BOS: "bos", CHC: "chc", CWS: "chw", CHW: "chw", CIN: "cin", CLE: "cle",
      COL: "col", DET: "det", HOU: "hou", KC: "kc", LAA: "laa", LAD: "lad", MIA: "mia", MIL: "mil", MIN: "min", NYM: "nym",
      NYY: "nyy", OAK: "oak", PHI: "phi", PIT: "pit", SD: "sd", SEA: "sea", SF: "sf", SFG: "sf", STL: "stl", TB: "tb", TEX: "tex", TOR: "tor", WSH: "wsh"
    },
    NHL: {
      ANA: "ana", BOS: "bos", BUF: "buf", CAR: "car", CBJ: "cbj", CGY: "cgy", CHI: "chi", COL: "col", DAL: "dal", DET: "det",
      EDM: "edm", FLA: "fla", LAK: "la", LA: "la", MIN: "min", MTL: "mtl", NJD: "nj", NJ: "nj", NSH: "nsh", NYI: "nyi", NYR: "nyr",
      OTT: "ott", PHI: "phi", PIT: "pit", SEA: "sea", SJS: "sj", SJ: "sj", STL: "stl", TBL: "tb", TB: "tb", TOR: "tor", UTA: "utah", VAN: "van", VGK: "vgk", WPG: "wpg", WSH: "wsh"
    }
  };

  const key = team.trim().toUpperCase();
  const code = aliases[sport]?.[key] || key.toLowerCase();
  const url = `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${code}.png`;

  return (
    <img
      src={url}
      alt={`${team} logo`}
      className="h-8 w-8 shrink-0 object-contain"
      loading="lazy"
      onError={(event) => { event.currentTarget.style.display = "none"; }}
    />
  );
}

export default function Home() {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [nfl, setNfl] =
    useState<NFLAnalysis | null>(null);

  const [nflLoading, setNflLoading] =
    useState(true);

  const [nflError, setNflError] =
    useState("");
  const [nflPassingProps, setNflPassingProps] =
    useState<NFLPassingPropsAnalysis | null>(null);
  const [nflPassingPropsLoading, setNflPassingPropsLoading] =
    useState(true);
  const [nflPassingPropsError, setNflPassingPropsError] =
    useState("");
const [activeSport, setActiveSport] =
  useState<"NFL" | "CFB" | "MLB" | "NHL">("NFL");

const [cfb, setCfb] =
  useState<CFBAnalysis | null>(null);

const [cfbLoading, setCfbLoading] =
  useState(true);

const [cfbError, setCfbError] =
  useState("");

  const [mlb, setMlb] = useState<MLBAnalysis | null>(null);
  const [mlbLoading, setMlbLoading] = useState(true);
  const [mlbError, setMlbError] = useState("");
  const [nhl, setNhl] = useState<NHLAnalysis | null>(null);
  const [nhlLoading, setNhlLoading] = useState(true);
  const [nhlError, setNhlError] = useState("");
  useEffect(() => {
    async function loadParlays() {
      const { data, error } = await supabase
        .from("parlays")
        .select(`
          *,
          parlay_legs (*)
        `)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        console.error(error);
        setError(error.message);
      } else {
        setParlays(
          (data as Parlay[]) || []
        );
      }

      setLoading(false);
    }

    async function loadNFL() {
      try {
        const response = await fetch(
          "/api/analyze",
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(
            `NFL analysis failed: ${response.status}`
          );
        }

        const data =
          await response.json();

        setNfl(data);
      } catch (err) {
        console.error(err);

        setNflError(
          err instanceof Error
            ? err.message
            : "NFL analysis failed"
        );
      } finally {
        setNflLoading(false);
      }
    }

    async function loadNFLPassingProps() {
      try {
        const response = await fetch("/api/nfl-passing-props", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`NFL passing props failed: ${response.status}`);
        }
        const data = await response.json();
        setNflPassingProps(data);
      } catch (err) {
        console.error(err);
        setNflPassingPropsError(
          err instanceof Error ? err.message : "NFL passing props failed"
        );
      } finally {
        setNflPassingPropsLoading(false);
      }
    }

        async function loadCFB() {
      try {
        const response = await fetch(
          "/api/cfb-picks",
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(
            `CFB analysis failed: ${response.status}`
          );
        }

        const data =
          await response.json();

        setCfb(data);
      } catch (err) {
        console.error(err);

        setCfbError(
          err instanceof Error
            ? err.message
            : "CFB analysis failed"
        );
      } finally {
        setCfbLoading(false);
      }
    }

    async function loadMLB() {
      try {
        const response = await fetch("/api/mlb-picks", { cache: "no-store" });
        if (!response.ok) throw new Error(`MLB analysis failed: ${response.status}`);
        setMlb(await response.json());
      } catch (err) {
        console.error(err);
        setMlbError(err instanceof Error ? err.message : "MLB analysis failed");
      } finally {
        setMlbLoading(false);
      }
    }

    async function loadNHL() {
      try {
        const response = await fetch("/api/nhl-picks", { cache: "no-store" });
        if (!response.ok) throw new Error(`NHL analysis failed: ${response.status}`);
        setNhl(await response.json());
      } catch (err) {
        console.error(err);
        setNhlError(err instanceof Error ? err.message : "NHL analysis failed");
      } finally {
        setNhlLoading(false);
      }
    }

    loadParlays();
    loadNFL();
    loadNFLPassingProps();
    loadCFB();
    loadMLB();
    loadNHL();
  }, []);

  const activeParlays =
    parlays.filter(
      (parlay) =>
        parlay.status === "pending"
    );

  const rankedGames = [
    ...(nfl?.games || []),
  ].sort((a, b) => {
    const priority:
      Record<string, number> = {
      "Priority Review": 4,
      "Strong Review": 3,
      Watch: 2,
      Pass: 1,
    };

    const aSignal =
      priority[
        a.rdg.market_analysis
          .market_signal
      ] || 0;

    const bSignal =
      priority[
        b.rdg.market_analysis
          .market_signal
      ] || 0;

    if (aSignal !== bSignal) {
      return bSignal - aSignal;
    }

    return (
      Math.abs(
        b.rdg.market_analysis
          .model_vs_market_difference ||
          0
      ) -
      Math.abs(
        a.rdg.market_analysis
          .model_vs_market_difference ||
          0
      )
    );
  });

  const reviewGames =
    rankedGames.filter(
      (game) =>
        game.rdg.market_analysis
          .market_signal !== "Pass"
    );

  /*
    RDG BET BUILDER

    This uses the NFL analysis already
    loaded by the page.

    It does NOT make another Oddize
    request.
  */

  const candidates: BetCandidate[] =
    rankedGames
      .map((game) => {
        if (!game.stats_connected) {
          return null;
        }

        const market =
          game.rdg.market_analysis;

        const historical =
          game.rdg.historical_signal;

        const difference =
          market.model_vs_market_difference;

        if (difference === null) {
          return null;
        }

        const edge =
          Math.abs(difference);

        if (edge < 2) {
          return null;
        }

        const team =
          market.spread_lean;

        const isHome =
          team === game.home_team;

        const isAway =
          team === game.away_team;

        if (!isHome && !isAway) {
          return null;
        }

        const line = isHome
          ? market.hard_rock_spread
              .home_line
          : market.hard_rock_spread
              .away_line;

        const odds = isHome
          ? market.hard_rock_spread
              .home_odds
          : market.hard_rock_spread
              .away_odds;

        if (line === null) {
          return null;
        }

        let score = edge * 10;

        if (
          historical
            .historical_winner_accuracy >=
          70
        ) {
          score += 10;
        } else if (
          historical
            .historical_winner_accuracy >=
          60
        ) {
          score += 6;
        } else if (
          historical
            .historical_winner_accuracy >=
          55
        ) {
          score += 3;
        }

        if (
          historical.sample >= 30
        ) {
          score += 3;
        }

        if (
          game.rdg.projected_winner ===
          team
        ) {
          score += 4;
        }

        return {
          event_id: game.event_id,

          correlation_key:
            `${game.away_team}@${game.home_team}`.toUpperCase(),

          market_type: "spread" as const,

          matchup:
            `${game.away_team} @ ${game.home_team}`,

          team,

          line,

          odds,

          display_bet:
            `${team} ${formatSpread(
              line
            )}`,

          projected_winner:
            game.rdg
              .projected_winner,

          projected_margin:
            game.rdg
              .projected_margin,

          difference:
            Number(
              edge.toFixed(2)
            ),

          historical_accuracy:
            historical
              .historical_winner_accuracy,

          historical_sample:
            historical.sample,

          historical_correct:
            historical.correct,

          historical_bucket:
            historical.bucket,

          score:
            Number(
              score.toFixed(2)
            ),
        } as BetCandidate;
      })
      .filter(
        (
          candidate
        ): candidate is BetCandidate =>
          candidate !== null
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  // NFL MIXED PARLAY POOLS
  // Passing props can mix with spreads after passing the RDG review filters.
  // Default correlation guardrail: maximum one leg from the same NFL game.
  const passingPropCandidates: BetCandidate[] =
    (nflPassingProps?.props || [])
      .filter((prop) =>
        prop.review !== "PASS" &&
        prop.model_vs_market_probability !== null &&
        prop.model_vs_market_probability >= 2
      )
      .map((prop) => {
        const away = prop.matchup.away || "AWAY";
        const home = prop.matchup.home || "HOME";
        const edge = prop.model_vs_market_probability || 0;

        // Use the best currently available price for the exact displayed
        // line and selected side. This prevents mixing a line from one
        // market with odds attached to a different line.
        const matchingPrices = (prop.sportsbook_lines || [])
          .filter((book) =>
            book.available &&
            Number(book.line) === Number(prop.market_line) &&
            String(book.side || "").toUpperCase() === prop.selection &&
            book.odds !== null &&
            book.odds !== undefined
          )
          .map((book) => ({
            sportsbook: book.sportsbook,
            odds: String(book.odds),
            numericOdds: Number(book.odds),
          }))
          .filter((book) => Number.isFinite(book.numericOdds))
          .sort((a, b) => b.numericOdds - a.numericOdds);

        const bestPrice = matchingPrices[0] || null;

        let score = edge * 10;
        if (prop.review === "STRONG REVIEW") score += 20;
        else if (prop.review === "REVIEW") score += 10;
        else if (prop.review === "WATCH") score += 4;
        if (prop.model_probability >= 60) score += 8;
        else if (prop.model_probability >= 55) score += 4;

        return {
          event_id: `prop-${prop.event_id}-${prop.player_id}`,
          correlation_key: `${away}@${home}`.toUpperCase(),
          market_type: "passing_prop" as const,
          matchup: `${away} @ ${home}`,
          team: "",
          line: prop.market_line,
          odds: bestPrice?.odds || null,
          display_bet: `${prop.player_name} ${prop.selection} ${prop.market_line}${bestPrice?.odds ? ` (${Number(bestPrice.odds) > 0 ? "+" : ""}${bestPrice.odds})` : ""}`,
          projected_winner: "",
          projected_margin: prop.rdg_projection,
          difference: Number(edge.toFixed(2)),
          historical_accuracy: prop.model_probability,
          historical_sample: 517,
          historical_correct: 0,
          historical_bucket: "V2 residual calibration",
          score: Number(score.toFixed(2)),
          player_name: prop.player_name,
          selection: prop.selection,
          model_probability: prop.model_probability,
          market_probability: prop.market_no_vig_probability,
          review: prop.review,
          sportsbook_name: bestPrice?.sportsbook || null,
        };
      })
      .sort((a, b) => b.score - a.score);

  const spreadSaferCandidates =
    candidates.filter((candidate) =>
      candidate.difference >= 3.5 &&
      candidate.historical_accuracy >= 55 &&
      candidate.historical_sample >= 30
    );

  const spreadBalancedCandidates =
    candidates.filter((candidate) =>
      candidate.difference >= 3 &&
      candidate.historical_sample >= 30
    );

  const spreadHigherRiskCandidates =
    candidates.filter((candidate) => candidate.difference >= 2);

  const propSaferCandidates = passingPropCandidates.filter((candidate) =>
    (candidate.model_probability || 0) >= 58 &&
    candidate.difference >= 8 &&
    candidate.review === "STRONG REVIEW"
  );

  const propBalancedCandidates = passingPropCandidates.filter((candidate) =>
    (candidate.model_probability || 0) >= 55 &&
    candidate.difference >= 5 &&
    (candidate.review === "STRONG REVIEW" || candidate.review === "REVIEW")
  );

  const propHigherRiskCandidates = passingPropCandidates.filter((candidate) =>
    candidate.difference >= 2
  );

  const saferCandidates = [...spreadSaferCandidates, ...propSaferCandidates]
    .sort((a, b) => b.score - a.score);

  const balancedCandidates = [...spreadBalancedCandidates, ...propBalancedCandidates]
    .sort((a, b) => b.score - a.score);

  const higherRiskCandidates = [...spreadHigherRiskCandidates, ...propHigherRiskCandidates]
    .sort((a, b) => b.score - a.score);

  const bestStraight =
    saferCandidates.length > 0
      ? saferCandidates[0]
      : balancedCandidates.length > 0
      ? balancedCandidates[0]
      : null;

  const nflCandidateUsage = new Map<string, number>();

  function buildWeeklyNFLParlay(
    pool: BetCandidate[],
    count: number
  ) {
    // One leg per game by default. This prevents an ordinary parlay from
    // accidentally stacking correlated spreads and player props.
    const uniqueByGame = Array.from(
      new Map(
        [...pool]
          .sort((a, b) => b.score - a.score)
          .map((candidate) => [candidate.correlation_key, candidate])
      ).values()
    );

    const selected = [...uniqueByGame]
      .sort((a, b) => {
        const aUsage = nflCandidateUsage.get(a.event_id) || 0;
        const bUsage = nflCandidateUsage.get(b.event_id) || 0;
        if (aUsage !== bUsage) return aUsage - bUsage;
        return b.score - a.score;
      })
      .slice(0, Math.min(count, uniqueByGame.length));

    selected.forEach((candidate) => {
      nflCandidateUsage.set(
        candidate.event_id,
        (nflCandidateUsage.get(candidate.event_id) || 0) + 1
      );
    });

    return selected;
  }

  const saferTwoLeg = buildWeeklyNFLParlay(saferCandidates, 2);

  const balancedThreePool =
    balancedCandidates.length >= 3
      ? balancedCandidates
      : higherRiskCandidates;

  const balancedThreeLeg = buildWeeklyNFLParlay(balancedThreePool, 3);
  const higherRiskFourLeg = buildWeeklyNFLParlay(higherRiskCandidates, 4);
  const fiveLeg = buildWeeklyNFLParlay(higherRiskCandidates, 5);
  const sixLeg = buildWeeklyNFLParlay(higherRiskCandidates, 6);
  const eightLeg = buildWeeklyNFLParlay(higherRiskCandidates, 8);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_18%,rgba(16,185,129,0.07),transparent_28%),linear-gradient(180deg,#020a07_0%,#020806_42%,#010403_100%)] text-white">
      <header className="border-b border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_38%),linear-gradient(180deg,#03110c_0%,#020806_100%)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-5">
            <div className="relative flex shrink-0 items-center justify-center">
              <div className="pointer-events-none absolute h-24 w-40 rounded-full bg-emerald-500/15 blur-3xl sm:h-28 sm:w-52" />
              <img
                src="/rdg-logo.png"
                alt="Responsible Degenerate Gambling"
                className="relative h-20 w-auto max-w-[260px] object-contain drop-shadow-[0_0_14px_rgba(34,197,94,0.18)] sm:h-28 sm:max-w-[390px] lg:h-32 lg:max-w-[440px]"
              />
            </div>

            <div className="hidden border-l border-white/10 pl-5 md:block">
              <p className="text-3xl font-black italic uppercase tracking-tight text-white lg:text-4xl">
                RDG <span className="text-emerald-400">SPORTS</span>
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 lg:text-xs">
                Data-Driven Betting Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden rounded-xl border border-white/10 bg-black/20 px-5 py-3 text-right lg:block">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                Responsible Betting
              </p>
              <p className="mt-1 text-xs font-bold text-white">
                Data • Discipline • Tracking
              </p>
            </div>
            <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-emerald-400">
              ● LIVE
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="sticky top-0 z-30 -mx-4 mb-8 flex gap-2 overflow-x-auto border-y border-emerald-500/15 bg-[#020806]/95 px-4 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.25)] backdrop-blur sm:-mx-6 sm:px-6">
  <button
    onClick={() => setActiveSport("NFL")}
    className={
      activeSport === "NFL"
        ? "rounded-xl border border-emerald-300/50 bg-emerald-400 px-6 py-3 text-sm font-black text-black shadow-[0_0_22px_rgba(52,211,153,0.18)]"
        : "rounded-xl border border-white/10 bg-white/[0.035] px-6 py-3 text-sm font-bold text-slate-300 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] hover:text-white"
    }
  >
    NFL
  </button>

  <button
    onClick={() => setActiveSport("CFB")}
    className={
      activeSport === "CFB"
        ? "rounded-xl border border-emerald-300/50 bg-emerald-400 px-6 py-3 text-sm font-black text-black shadow-[0_0_22px_rgba(52,211,153,0.18)]"
        : "rounded-xl border border-white/10 bg-white/[0.035] px-6 py-3 text-sm font-bold text-slate-300 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] hover:text-white"
    }
  >
    COLLEGE FOOTBALL
  </button>

  <button
    onClick={() => setActiveSport("MLB")}
    className={activeSport === "MLB" ? "rounded-xl border border-emerald-300/50 bg-emerald-400 px-6 py-3 text-sm font-black text-black shadow-[0_0_22px_rgba(52,211,153,0.18)]" : "rounded-xl border border-white/10 bg-white/[0.035] px-6 py-3 text-sm font-bold text-slate-300 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] hover:text-white"}
  >
    MLB
  </button>

  <button
    onClick={() => setActiveSport("NHL")}
    className={activeSport === "NHL" ? "rounded-xl border border-emerald-300/50 bg-emerald-400 px-6 py-3 text-sm font-black text-black shadow-[0_0_22px_rgba(52,211,153,0.18)]" : "rounded-xl border border-white/10 bg-white/[0.035] px-6 py-3 text-sm font-bold text-slate-300 transition hover:border-emerald-500/30 hover:bg-emerald-500/[0.06] hover:text-white"}
  >
    NHL
  </button>
</div>
        {activeSport === "NFL" && (
          <div className="mb-10 overflow-hidden rounded-2xl border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.07),rgba(255,255,255,0.015))] shadow-[0_18px_55px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
                    RDG NFL MODEL
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Week {nfl?.schedule_week ?? "—"}
                  </span>
                </div>

                <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
                  NFL Command Center
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-400">
                  Live Hard Rock odds, RDG model analysis, defense data, injury reports, and weekly parlay research in one place.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-400">Games</p>
                  <p className="mt-1 text-lg font-black text-white">{nfl?.games_found ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Stats</p>
                  <p className="mt-1 text-lg font-black text-white">{nfl ? `${nfl.games_with_stats}/${nfl.games_found}` : "—"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Strong</p>
                  <p className="mt-1 text-lg font-black text-white">{nfl?.strong_reviews ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Priority</p>
                  <p className="mt-1 text-lg font-black text-white">{nfl?.priority_reviews ?? "—"}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 border-t border-white/10 sm:grid-cols-4">
              <div className="border-r border-white/10 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
                ● Live Odds
              </div>
              <div className="border-r border-white/10 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Defense Stats
              </div>
              <div className="border-r border-white/10 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Injury Reports
              </div>
              <div className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                Weekly Parlays
              </div>
            </div>
          </div>
        )}
        {activeSport === "MLB" && (
          <MLBSection mlb={mlb} loading={mlbLoading} error={mlbError} />
        )}
        {activeSport === "NHL" && (
          <NHLSection nhl={nhl} loading={nhlLoading} error={nhlError} />
        )}
        {activeSport === "CFB" && (
  <div>
    <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
      RDG CFB MODEL • BETA
    </p>

    <h2 className="mt-3 text-3xl font-bold">
      Live College Football Analysis
    </h2>

    <p className="mt-2 text-sm text-slate-400">
      RDG CORE projections compared against current Hard Rock Bet lines.
    </p>

    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
      CFB model is currently uncalibrated beta. Model/market differences
      are not win probabilities.
    </div>

    <section className="mt-8 grid gap-4 md:grid-cols-4">
      <Stat
        title="CFB GAMES"
        value={cfb ? String(cfb.games_found) : "—"}
      />

      <Stat
        title="CORE CONNECTED"
        value={
          cfb
            ? `${cfb.games_with_core}/${cfb.games_found}`
            : "—"
        }
      />

      <Stat
        title="PRIORITY REVIEWS"
        value={
          cfb
            ? String(cfb.priority_reviews)
            : "—"
        }
      />

      <Stat
        title="STRONG REVIEWS"
        value={
          cfb
            ? String(cfb.strong_reviews)
            : "—"
        }
      />
    </section>

    {cfbLoading && (
      <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
        Running RDG College Football model...
      </div>
    )}

    {cfbError && (
      <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
        CFB model error: {cfbError}
      </div>
    )}

    {!cfbLoading && !cfbError && cfb && (
      <>
        <CFBBuilderSection cfb={cfb} />

        <div className="mt-12 border-t border-white/10 pt-10">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
            FULL COLLEGE FOOTBALL BOARD
          </p>

          <h2 className="mt-3 text-2xl font-bold">
            All Games
          </h2>
        </div>

        <section className="mt-6 space-y-3">
          {cfb.games.map((game) => (
            <div
              key={game.event_id}
              className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:grid-cols-5 md:items-center"
            >
              <div>
                <p className="font-bold">
                  {game.away_team} @ {game.home_team}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {game.rdg
                    ? game.rdg.signal
                    : "NO CORE DATA"}
                </p>
              </div>

              <BoardValue
                title="RDG"
                value={
                  game.rdg
                    ? `${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(1)}`
                    : "—"
                }
              />

              <BoardValue
                title="HARD ROCK"
                value={
                  game.hard_rock.spread.home_line !== null
                    ? `${game.home_team} ${formatSpread(
                        game.hard_rock.spread.home_line
                      )}`
                    : "—"
                }
              />

              <BoardValue
                title="SPREAD LEAN"
                value={
                  game.rdg?.spread_lean || "—"
                }
              />

              <BoardValue
                title="MODEL VS MARKET"
                value={
                  game.rdg?.model_vs_market_difference !==
                  null &&
                  game.rdg?.model_vs_market_difference !==
                  undefined
                    ? `${Math.abs(
                        game.rdg.model_vs_market_difference
                      ).toFixed(1)} pts`
                    : "—"
                }
              />
            </div>
          ))}
        </section>
      </>
    )}
  </div>
)}
        {activeSport === "NFL" && (
  <>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
          RDG NFL MODEL
        </p>

        <h2 className="mt-3 text-3xl font-bold">
          Live NFL Analysis
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          RDG projections compared
          against current Hard Rock Bet
          lines.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat
            title="NFL GAMES"
            value={
              nfl
                ? String(
                    nfl.games_found
                  )
                : "—"
            }
          />

          <Stat
            title="PRIORITY"
            value={
              nfl
                ? String(
                    nfl.priority_reviews
                  )
                : "—"
            }
          />

          <Stat
            title="STRONG REVIEWS"
            value={
              nfl
                ? String(
                    nfl.strong_reviews
                  )
                : "—"
            }
          />

          <Stat
            title="STATS CONNECTED"
            value={
              nfl
                ? `${nfl.games_with_stats}/${nfl.games_found}`
                : "—"
            }
          />
        </section>

        {nflLoading && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            Running RDG NFL model...
          </div>
        )}

        {nflError && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
            NFL model error:{" "}
            {nflError}
          </div>
        )}

        {!nflLoading &&
          !nflError &&
          reviewGames.length ===
            0 && (
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <p className="font-bold">
                No notable model/market
                differences right now.
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Hard Rock lines may
                change throughout the
                day.
              </p>
            </div>
          )}

        <NFLFeaturedReviews games={reviewGames} />

        <NFLPassingPropsSection
          data={nflPassingProps}
          loading={nflPassingPropsLoading}
          error={nflPassingPropsError}
        />

        {/* BET BUILDER */}

        {!nflLoading &&
          !nflError &&
          nfl && (
            <>
              <div className="mt-14 border-t border-white/10 pt-10">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
                  RDG AUTOMATIC BET
                  BUILDER
                </p>

                <h2 className="mt-3 text-3xl font-bold">
                  Weekly Model
                  Selections
                </h2>

                <p className="mt-2 max-w-3xl text-sm text-slate-400">
                  Built from qualified NFL spreads and calibrated passing-yard props.
                  RDG allows only one leg per game by default to reduce accidental
                  correlation, and it will not force weaker selections into a parlay.
                </p>
              </div>

              <section className="mt-8 grid gap-5 lg:grid-cols-2">
                <BuilderCard
                  title="BEST STRAIGHT"
                  subtitle="Stricter RDG Filter"
                  candidates={
                    bestStraight
                      ? [bestStraight]
                      : []
                  }
                  required={1}
                />

                <BuilderCard
                  title="TOP RDG PARLAY"
                  subtitle="Strongest Stricter-Filter Combination"
                  candidates={saferTwoLeg}
                  required={2}
                  featured
                />

                <BuilderCard
                  title="BALANCED 3-LEG"
                  subtitle="Balanced Model Filter"
                  candidates={
                    balancedThreeLeg
                  }
                  required={3}
                />

                <BuilderCard
                  title="HIGHER-RISK 4-LEG"
                  subtitle="Wider Model Filter"
                  candidates={
                    higherRiskFourLeg
                  }
                  required={4}
                />

                <BuilderCard title="5-LEG • HIGH RISK" subtitle="Extended Model Filter" candidates={fiveLeg} required={5} />
                <BuilderCard title="6-LEG • HIGH RISK" subtitle="Extended Model Filter" candidates={sixLeg} required={6} />
                <BuilderCard title="8-LEG • LONG SHOT" subtitle="Long-Shot Model Filter" candidates={eightLeg} required={8} />
              </section>

              <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-400">
                Historical percentages
                shown by RDG describe
                straight-up model
                performance within
                historical
                projected-margin
                buckets. They are not
                the probability or
                expected profitability
                of an individual spread
                wager.
              </div>
            </>
          )}

        {/* FULL NFL BOARD */}

        {rankedGames.length > 0 && (
          <>
            <div className="mt-12 border-t border-white/10 pt-10">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                FULL NFL BOARD
              </p>

              <h2 className="mt-3 text-2xl font-bold">
                All Games
              </h2>
            </div>

            <section className="mt-6 space-y-3">
              {rankedGames.map(
                (game) => (
                  <NFLBoardRow
                    key={
                      game.event_id
                    }
                    game={game}
                  />
                )
              )}
            </section>
          </>
        )}

      </>
    )}

<PerformanceDashboard />
        {/* TRACKED SLIPS */}

        <div className="mt-14 border-t border-white/10 pt-10">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
            TRACKED SLIPS
          </p>

          <h2 className="mt-3 text-3xl font-bold">
            Today&apos;s Parlays
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            Saved parlays and betting
            research from Supabase.
          </p>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat
            title="ACTIVE SLIPS"
            value={String(
              activeParlays.length
            )}
          />

          <Stat
            title="SPORTS"
            value="4"
          />

          <Stat
            title="BEST BET"
            value={
              parlays.length > 0 &&
              parlays[0].total_odds
                ? parlays[0]
                    .total_odds
                : "—"
            }
          />

          <Stat
            title="TODAY'S RECORD"
            value="0-0"
          />
        </section>

        {loading && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            Loading parlays...
          </div>
        )}

        {error && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
            Database error: {error}
          </div>
        )}

        {!loading &&
          !error &&
          parlays.length === 0 && (
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <p className="font-bold">
                No parlays posted yet.
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Parlays added to
                Supabase will appear
                here.
              </p>
            </div>
          )}

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          {parlays.map(
            (parlay) => {
              const legs = [
                ...(parlay.parlay_legs ||
                  []),
              ].sort(
                (a, b) =>
                  a.leg_number -
                  b.leg_number
              );

              return (
                <article
                  key={parlay.id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-green-400">
                        {parlay.category ||
                          "PARLAY"}
                      </p>

                      <h3 className="mt-2 text-xl font-bold">
                        {parlay.name}
                      </h3>

                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                        {parlay.risk_level && (
                          <span>
                            {
                              parlay.risk_level
                            }{" "}
                            Risk
                          </span>
                        )}

                        {parlay.sportsbook && (
                          <span>
                            •{" "}
                            {
                              parlay.sportsbook
                            }
                          </span>
                        )}

                        {parlay.total_odds && (
                          <span>
                            •{" "}
                            {
                              parlay.total_odds
                            }
                          </span>
                        )}
                      </div>
                    </div>

                    {parlay.confidence !==
                      null && (
                      <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
                        {
                          parlay.confidence
                        }
                        %
                      </span>
                    )}
                  </div>

                  <div className="mt-6 space-y-3">
                    {legs.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No legs added
                        yet.
                      </p>
                    ) : (
                      legs.map(
                        (leg) => (
                          <div
                            key={
                              leg.id
                            }
                            className="rounded-lg border border-white/10 bg-black/20 p-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-xs font-bold uppercase text-green-400">
                                  Leg{" "}
                                  {
                                    leg.leg_number
                                  }{" "}
                                  •{" "}
                                  {
                                    leg.sport
                                  }
                                </p>

                                <p className="mt-1 font-bold">
                                  {leg.player
                                    ? `${leg.player} — ${leg.bet_type}`
                                    : `${leg.team || ""} ${leg.bet_type}`}
                                </p>

                                {leg.opponent && (
                                  <p className="mt-1 text-xs text-slate-500">
                                    vs{" "}
                                    {
                                      leg.opponent
                                    }
                                  </p>
                                )}
                              </div>

                              <div className="text-right">
                                {leg.odds && (
                                  <p className="font-bold">
                                    {
                                      leg.odds
                                    }
                                  </p>
                                )}

                                {leg.confidence !==
                                  null && (
                                  <p className="mt-1 text-xs text-green-400">
                                    {
                                      leg.confidence
                                    }
                                    %
                                    confidence
                                  </p>
                                )}
                              </div>
                            </div>

                            {leg.reasoning && (
                              <div className="mt-4 border-t border-white/10 pt-3">
                                <p className="text-xs font-bold text-slate-400">
                                  WHY THIS
                                  BET
                                </p>

                                <p className="mt-1 text-sm text-slate-300">
                                  {
                                    leg.reasoning
                                  }
                                </p>
                              </div>
                            )}

                            {leg.key_risk && (
                              <p className="mt-3 text-xs text-amber-400">
                                Risk:{" "}
                                {
                                  leg.key_risk
                                }
                              </p>
                            )}
                          </div>
                        )
                      )
                    )}
                  </div>

                  {parlay.notes && (
                    <p className="mt-4 text-sm text-slate-400">
                      {parlay.notes}
                    </p>
                  )}
                </article>
              );
            }
          )}
        </section>

        <footer className="mt-16 rounded-2xl border border-white/10 bg-white/[0.025] px-6 py-6 text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">RESPONSIBLE DEGENERATE GAMBLING</p>
          <p className="mt-2 text-xs text-slate-500">Data-driven analysis • Track results • Bet responsibly</p>
        </footer>
      </div>
    </main>
  );
}

function BuilderCard({
  title,
  subtitle,
  candidates,
  required,
  featured = false,
}: {
  title: string;
  subtitle: string;
  candidates: BetCandidate[];
  required: number;
  featured?: boolean;
}) {
  const qualified =
    candidates.length >= required;

  const [expandedPicks, setExpandedPicks] = useState<Set<string>>(new Set());

  function togglePickReason(key: string) {
    setExpandedPicks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <article className={featured
      ? "relative overflow-hidden rounded-2xl border-2 border-emerald-400/70 bg-emerald-500/[0.10] p-6 shadow-[0_0_35px_rgba(16,185,129,0.16)] lg:col-span-2"
      : "rounded-xl border border-white/10 bg-white/[0.035] p-6 transition hover:border-green-500/30"
    }>
      {featured && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">RDG FEATURED</p>
            <p className="mt-1 text-sm font-semibold text-white">Strongest current combination under the stricter model filters</p>
          </div>
          <span className="rounded-full bg-emerald-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-black">TOP MODEL FILTER</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-green-400">
            {subtitle}
          </p>

          <h3 className="mt-2 text-xl font-bold">
            {title}
          </h3>
        </div>

        <span
          className={
            qualified
              ? "rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400"
              : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-400"
          }
        >
          {qualified
            ? "QUALIFIED"
            : "NOT ENOUGH LEGS"}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4">
          <p className="font-bold">
            No qualifying selection
          </p>

          <p className="mt-2 text-xs text-slate-500">
            RDG will not force a weaker
            bet into this tier.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {candidates.map(
            (candidate, index) => (
              <div
                key={
                  candidate.event_id
                }
                className="rounded-lg border border-white/10 bg-black/20 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {required > 1 && (
                      <p className="text-[10px] font-bold uppercase text-slate-500">
                        LEG {index + 1}
                      </p>
                    )}

                    <div className="mt-1 flex items-center gap-3">
                      {candidate.market_type === "spread" ? (
                        <TeamLogo sport="NFL" team={candidate.team} />
                      ) : (
                        <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-300">
                          PROP
                        </span>
                      )}
                      <p className="text-lg font-bold">{candidate.display_bet}</p>
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      {
                        candidate.matchup
                      }
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-bold text-green-400">
                      {candidate.difference.toFixed(1)}{candidate.market_type === "passing_prop" ? "%" : " pts"}
                    </p>

                    <p className="mt-1 text-[10px] uppercase text-slate-500">
                      Model vs Market
                    </p>
                  </div>
                </div>

                {candidate.market_type === "passing_prop" ? (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MiniStat
                        title="RDG PROJECTION"
                        value={`${candidate.projected_margin.toFixed(1)} yds`}
                      />
                      <MiniStat
                        title="MODEL PROB."
                        value={`${(candidate.model_probability || 0).toFixed(1)}%`}
                      />
                      <MiniStat
                        title="SPORTSBOOK ODDS"
                        value={candidate.odds ? `${Number(candidate.odds) > 0 ? "+" : ""}${candidate.odds}` : "—"}
                      />
                      <MiniStat
                        title="MARKET PROB."
                        value={candidate.market_probability !== null && candidate.market_probability !== undefined ? `${candidate.market_probability.toFixed(1)}%` : "—"}
                      />
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Passing-yard probability is model-implied from the frozen V2 residual calibration; it is not a historical sportsbook prop win rate.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MiniStat
                        title="RDG PROJECTION"
                        value={`${candidate.projected_winner} by ${candidate.projected_margin.toFixed(1)}`}
                      />
                      <MiniStat
                        title="HARD ROCK ODDS"
                        value={candidate.odds || "—"}
                      />
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Historical {candidate.historical_bucket} bucket: {candidate.historical_correct}/{candidate.historical_sample} ({candidate.historical_accuracy}%) straight-up.
                    </p>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => togglePickReason(`${candidate.event_id}-${index}`)}
                  className="mt-4 flex w-full items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 text-left text-xs font-black uppercase tracking-[0.16em] text-emerald-300 transition hover:border-emerald-400/40 hover:bg-emerald-500/[0.09]"
                >
                  <span>Why this pick?</span>
                  <span>{expandedPicks.has(`${candidate.event_id}-${index}`) ? "▲" : "▼"}</span>
                </button>

                {expandedPicks.has(`${candidate.event_id}-${index}`) && (
                  <div className="mt-3">
                    {candidate.market_type === "passing_prop" ? (
                      <>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-4">
                            <p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-300">
                              ✓ Why RDG Thinks This Is a Good Pick
                            </p>
                            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
                              <p>✓ RDG projects <b className="text-white">{candidate.projected_margin.toFixed(1)} passing yards</b> versus <b className="text-white">{candidate.line.toFixed(1)}</b>, a <b className="text-emerald-300">{candidate.projected_margin - candidate.line >= 0 ? "+" : ""}{(candidate.projected_margin - candidate.line).toFixed(1)}-yard</b> difference.</p>
                              <p>✓ The {candidate.selection} has a <b className="text-white">{(candidate.model_probability || 0).toFixed(1)}% model-implied probability</b> versus a <b className="text-white">{candidate.market_probability !== null && candidate.market_probability !== undefined ? `${candidate.market_probability.toFixed(1)}%` : "—"}</b> no-vig market estimate.</p>
                              <p>✓ That creates a <b className="text-emerald-300">+{candidate.difference.toFixed(1)} percentage-point</b> model-versus-market difference.</p>
                              <p>✓ The selection passed RDG&apos;s current <b className="text-white">{candidate.review || "model review"}</b> filter rather than being added simply to fill a parlay.</p>
                            </div>
                          </div>

                          <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4">
                            <p className="text-sm font-black uppercase tracking-[0.12em] text-red-400">
                              ⚠ Potential Cons / Risks
                            </p>
                            <div className="mt-3 space-y-2 text-sm leading-6 text-red-200">
                              <p>⚠ Passing-yard results are volatile. RDG&apos;s 2025 V2 test MAE was about <b>59.6 yards</b>.</p>
                              <p>⚠ Game script can change passing volume. An early lead can reduce attempts, while pressure or turnovers can disrupt drives.</p>
                              <p>⚠ Injuries or limitations to the QB, offensive line, or key receivers can materially change the projection.</p>
                              <p>⚠ RDG does <b>not currently have a live injury/expected-lineup feed connected to this explanation</b>, so verify current player availability before relying on an injury-specific conclusion.</p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Key Numbers</p>
                            <div className="mt-3 space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Projection</span><b>{candidate.projected_margin.toFixed(1)} yds</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Line</span><b>{candidate.line.toFixed(1)}</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Difference</span><b className="text-emerald-300">{candidate.projected_margin - candidate.line >= 0 ? "+" : ""}{(candidate.projected_margin - candidate.line).toFixed(1)} yds</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Model Prob.</span><b>{(candidate.model_probability || 0).toFixed(1)}%</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Market Prob.</span><b>{candidate.market_probability !== null && candidate.market_probability !== undefined ? `${candidate.market_probability.toFixed(1)}%` : "—"}</b></div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Context</p>
                            <div className="mt-3 space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Player</span><b className="text-right">{candidate.team}</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Game</span><b>{candidate.matchup}</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Sportsbook</span><b>{candidate.sportsbook_name ? candidate.sportsbook_name.toUpperCase() : "Available book"}</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Odds</span><b>{candidate.odds ? `${Number(candidate.odds) > 0 ? "+" : ""}${candidate.odds}` : "—"}</b></div>
                              <div className="flex justify-between gap-4"><span className="text-slate-400">Model</span><b>RDG NFL V2</b></div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Bottom Line</p>
                            <p className="mt-3 text-sm leading-6 text-slate-300">
                              RDG&apos;s numbers favor <b className="text-white">{candidate.team} {candidate.selection} {candidate.line.toFixed(1)}</b>. The model&apos;s estimated advantage is <b className="text-emerald-300">+{candidate.difference.toFixed(1)} percentage points</b> versus the no-vig market estimate. Check late injury and lineup news because those factors are not yet automatically included.
                            </p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-4">
                          <p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-300">✓ Why RDG Likes This Side</p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-200">
                            <p>✓ RDG projects <b className="text-white">{candidate.projected_winner} by {candidate.projected_margin.toFixed(1)}</b>.</p>
                            <p>✓ The model differs from the current spread market by <b className="text-emerald-300">{candidate.difference.toFixed(1)} points</b>.</p>
                            <p>✓ The historical <b>{candidate.historical_bucket}</b> projected-margin bucket went <b>{candidate.historical_correct}/{candidate.historical_sample} ({candidate.historical_accuracy}%)</b> on straight-up projected winners.</p>
                          </div>
                        </div>

                        <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4">
                          <p className="text-sm font-black uppercase tracking-[0.12em] text-red-400">⚠ Potential Cons / Risks</p>
                          <div className="mt-3 space-y-2 text-sm leading-6 text-red-200">
                            <p>⚠ The historical percentage shown is straight-up model performance, not ATS cover probability.</p>
                            <p>⚠ Injuries, inactive starters, weather, and late line movement can materially change the matchup.</p>
                            <p>⚠ RDG does not currently inject live injury status into this explanation, so current availability should be checked separately.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {!qualified &&
        candidates.length > 0 && (
          <p className="mt-4 text-xs text-amber-400">
            Only {candidates.length} of{" "}
            {required} required legs
            currently qualify. RDG did
            not fill the remaining
            spots with weaker
            selections.
          </p>
        )}
    </article>
  );
}

function NFLPassingPropsSection({
  data,
  loading,
  error,
}: {
  data: NFLPassingPropsAnalysis | null;
  loading: boolean;
  error: string;
}) {
  const props = (data?.props || []).filter((prop) => prop.review !== "PASS");

  return (
    <section className="mt-14 border-t border-white/10 pt-10">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-400">
        NFL PLAYER PROPS • PASSING YARDS
      </p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold">RDG Passing Yard Reviews</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Frozen RDG V2 projections compared with current sportsbook passing-yard lines.
          </p>
        </div>
        {data && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
            {props.length} CURRENT REVIEWS
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs leading-5 text-slate-400">
        Model probability is calibrated from historical RDG projection errors. Model vs Market compares that estimate with no-vig sportsbook probability. These are model estimates, not historical prop-bet win rates or guaranteed edges.
      </div>

      {loading && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          Loading NFL passing props...
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
          Passing props error: {error}
        </div>
      )}

      {!loading && !error && props.length === 0 && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <p className="font-bold">No passing-yard props currently pass the RDG review filters.</p>
        </div>
      )}

      {!loading && !error && props.length > 0 && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {props.map((prop) => {
            const edge = prop.model_vs_market_probability;
            const strong = prop.review === "STRONG REVIEW";
            return (
              <article
                key={`${prop.event_id}-${prop.player_id}`}
                className={
                  strong
                    ? "rounded-2xl border border-emerald-400/50 bg-emerald-500/[0.08] p-6 shadow-[0_0_28px_rgba(16,185,129,0.08)]"
                    : "rounded-2xl border border-white/10 bg-white/[0.035] p-6"
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-emerald-400">
                      {prop.review}
                    </p>
                    <h3 className="mt-2 text-xl font-black">{prop.player_name}</h3>
                    <p className="mt-1 text-lg font-bold text-white">
                      {prop.selection} {prop.market_line.toFixed(1)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {prop.matchup.away || "—"} @ {prop.matchup.home || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-emerald-400">
                      {edge !== null ? `${edge >= 0 ? "+" : ""}${edge.toFixed(1)}%` : "—"}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Model vs Market
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat title="RDG PROJECTION" value={prop.rdg_projection.toFixed(1)} />
                  <MiniStat title="MODEL PROB." value={`${prop.model_probability.toFixed(1)}%`} />
                  <MiniStat
                    title="MARKET PROB."
                    value={
                      prop.market_no_vig_probability !== null
                        ? `${prop.market_no_vig_probability.toFixed(1)}%`
                        : "—"
                    }
                  />
                  <MiniStat
                    title="VS LINE"
                    value={`${prop.model_vs_line_yards >= 0 ? "+" : ""}${prop.model_vs_line_yards.toFixed(1)} yds`}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NFLFeaturedReviews({ games }: { games: NFLGame[] }) {
  if (games.length === 0) return null;

  const top = games[0];
  const strong =
    games.find(
      (game, index) =>
        index > 0 &&
        game.rdg.market_analysis.market_signal === "Strong Review"
    ) || games[1] || null;

  const FeaturedCard = ({
    game,
    variant,
  }: {
    game: NFLGame;
    variant: "top" | "strong";
  }) => {
    const market = game.rdg.market_analysis;
    const difference = market.model_vs_market_difference;
    const spreadTeam = market.spread_lean;
    const spreadLine =
      spreadTeam === game.home_team
        ? market.hard_rock_spread.home_line
        : market.hard_rock_spread.away_line;

    const gameTime = new Date(game.start_date).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const isTop = variant === "top";

    return (
      <article
        className={
          isTop
            ? "rounded-2xl border-2 border-emerald-400/80 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.22),transparent_42%),linear-gradient(145deg,rgba(0,110,55,0.28),rgba(1,15,10,0.96))] p-5 shadow-[0_0_35px_rgba(34,197,94,0.16)]"
            : "rounded-2xl border-2 border-sky-500/70 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.20),transparent_42%),linear-gradient(145deg,rgba(3,72,110,0.24),rgba(2,12,20,0.96))] p-5 shadow-[0_0_35px_rgba(14,165,233,0.13)]"
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={isTop
              ? "text-sm font-black uppercase tracking-wider text-emerald-400"
              : "text-sm font-black uppercase tracking-wider text-sky-400"
            }>
              {isTop ? "🏆 TOP RDG PICK" : "★ STRONG REVIEW"}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <TeamLogo sport="NFL" team={game.away_team} />
              <span className="text-xl font-black">{game.away_team}</span>
              <span className="text-slate-500">@</span>
              <TeamLogo sport="NFL" team={game.home_team} />
              <span className="text-xl font-black">{game.home_team}</span>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              {gameTime} • Hard Rock Bet
            </p>
          </div>

          <span className={isTop
            ? "rounded-full border border-emerald-400/50 bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300"
            : "rounded-full border border-sky-400/50 bg-sky-500/15 px-3 py-1 text-xs font-black text-sky-300"
          }>
            {difference !== null
              ? `${Math.abs(difference).toFixed(1)} PT EDGE`
              : "NO LINE"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <MiniStat
            title="RDG PROJECTION"
            value={`${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(1)}`}
          />
          <MiniStat
            title="HARD ROCK SPREAD"
            value={
              market.hard_rock_spread.home_line !== null
                ? `${game.home_team} ${formatSpread(market.hard_rock_spread.home_line)}`
                : "—"
            }
          />
          <MiniStat
            title="RDG SPREAD LEAN"
            value={
              spreadLine !== null
                ? `${spreadTeam} ${formatSpread(spreadLine)}`
                : "—"
            }
          />
          <MiniStat
            title="MODEL VS MARKET"
            value={
              difference !== null
                ? `${Math.abs(difference).toFixed(1)} pts`
                : "—"
            }
          />
        </div>
      </article>
    );
  };

  return (
    <>
      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <FeaturedCard game={top} variant="top" />
        {strong && <FeaturedCard game={strong} variant="strong" />}
      </section>

      {games.length > 2 && (
        <div className="mt-8">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">
            MORE NFL MODEL REVIEWS
          </p>
          <section className="mt-4 grid gap-5 lg:grid-cols-2">
            {games
              .filter((game) => game.event_id !== top.event_id && game.event_id !== strong?.event_id)
              .map((game) => (
                <NFLGameCard key={game.event_id} game={game} />
              ))}
          </section>
        </div>
      )}
    </>
  );
}

function NFLGameCard({
  game,
}: {
  game: NFLGame;
}) {
  const market =
    game.rdg.market_analysis;

  const historical =
    game.rdg.historical_signal;

  const difference =
    market.model_vs_market_difference;

  const spreadTeam =
    market.spread_lean;

  const spreadLine =
    spreadTeam === game.home_team
      ? market.hard_rock_spread
          .home_line
      : market.hard_rock_spread
          .away_line;

  const gameTime = new Date(
    game.start_date
  ).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="rounded-2xl border border-emerald-500/25 bg-[linear-gradient(145deg,rgba(16,185,129,0.07),rgba(255,255,255,0.025))] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition hover:border-emerald-400/45">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-green-400">
            MARKET EDGE •{" "}
            {market.market_signal}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <TeamLogo sport="NFL" team={game.away_team} />
            <span className="text-xl font-bold">{game.away_team}</span>
            <span className="text-slate-500">@</span>
            <TeamLogo sport="NFL" team={game.home_team} />
            <span className="text-xl font-bold">{game.home_team}</span>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            {gameTime} • Hard Rock Bet
          </p>
        </div>

        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
          {difference !== null
            ? `${Math.abs(
                difference
              ).toFixed(1)} PT EDGE`
            : "NO LINE"}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <MiniStat
          title="RDG PROJECTION"
          value={`${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(
            1
          )}`}
        />

        <MiniStat
          title="HARD ROCK SPREAD"
          value={
            market.hard_rock_spread
              .home_line !== null
              ? `${game.home_team} ${formatSpread(
                  market
                    .hard_rock_spread
                    .home_line
                )}`
              : "—"
          }
        />

        <MiniStat
          title="RDG SPREAD LEAN"
          value={
            spreadLine !== null
              ? `${spreadTeam} ${formatSpread(
                  spreadLine
                )}`
              : "—"
          }
        />

        <MiniStat
          title="MODEL VS MARKET"
          value={
            difference !== null
              ? `${Math.abs(
                  difference
                ).toFixed(1)} pts`
              : "—"
          }
        />
      </div>

      <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
        <p className="text-xs font-bold text-slate-500">
          MARKET COMPARISON
        </p>

        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">
              RDG
            </p>

            <p className="mt-1 font-bold">
              {
                game.rdg
                  .projected_winner
              }{" "}
              -
              {game.rdg.projected_margin.toFixed(
                1
              )}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">
              HARD ROCK
            </p>

            <p className="mt-1 font-bold">
              {market.market_favorite}{" "}
              {market.market_favorite ===
              game.home_team
                ? formatSpread(
                    market
                      .hard_rock_spread
                      .home_line
                  )
                : formatSpread(
                    market
                      .hard_rock_spread
                      .away_line
                  )}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-slate-500">
              MODEL HISTORY
            </p>

            <p className="mt-2 text-lg font-bold">
              {
                historical.historical_winner_accuracy
              }
              %
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-slate-500">
              HISTORICAL RECORD
            </p>

            <p className="mt-2 font-bold">
              {historical.correct}/
              {historical.sample}
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Historical performance for
          RDG&apos;s{" "}
          {historical.bucket}{" "}
          projected-margin bucket.
          This is not the probability
          that this individual wager
          wins.
        </p>
      </div>
    </article>
  );
}

function NFLBoardRow({
  game,
}: {
  game: NFLGame;
}) {
  const market =
    game.rdg.market_analysis;

  const difference =
    market.model_vs_market_difference;

  return (
    <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:grid-cols-5 md:items-center">
      <div>
        <div className="flex items-center gap-2 font-bold">
          <TeamLogo sport="NFL" team={game.away_team} />
          <span>{game.away_team}</span><span className="text-slate-500">@</span>
          <TeamLogo sport="NFL" team={game.home_team} />
          <span>{game.home_team}</span>
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {market.market_signal}
        </p>
      </div>

      <BoardValue
        title="RDG"
        value={`${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(
          1
        )}`}
      />

      <BoardValue
        title="HARD ROCK"
        value={
          market.hard_rock_spread
            .home_line !== null
            ? `${game.home_team} ${formatSpread(
                market
                  .hard_rock_spread
                  .home_line
              )}`
            : "—"
        }
      />

      <BoardValue
        title="SPREAD LEAN"
        value={market.spread_lean}
      />

      <BoardValue
        title="DIFFERENCE"
        value={
          difference !== null
            ? `${Math.abs(
                difference
              ).toFixed(1)} pts`
            : "—"
        }
      />
    </div>
  );
}

function CFBBuilderSection({ cfb }: { cfb: CFBAnalysis }) {
  const priority: Record<string, number> = { "Priority Review": 4, "Strong Review": 3, Watch: 2, Pass: 1 };
  const candidates: CFBBetCandidate[] = (cfb.games || [])
    .map((game) => {
      if (!game.rdg || game.rdg.signal === "Pass") return null;
      const team = game.rdg.spread_lean;
      if (!team) return null;
      const isHome = team === game.home_team;
      const isAway = team === game.away_team;
      if (!isHome && !isAway) return null;
      const line = isHome ? game.hard_rock.spread.home_line : game.hard_rock.spread.away_line;
      const odds = isHome ? game.hard_rock.spread.home_odds : game.hard_rock.spread.away_odds;
      if (line === null) return null;
      return {
        event_id: game.event_id,
        matchup: `${game.away_team} @ ${game.home_team}`,
        team,
        line,
        odds,
        display_bet: `${team} ${formatSpread(line)}`,
        edge: Math.abs(Number(game.rdg.model_vs_market_difference ?? 0)),
        signal: game.rdg.signal,
        sample_status: game.rdg.sample_status,
      };
    })
    .filter((x): x is CFBBetCandidate => x !== null)
    .sort((a, b) => (priority[b.signal] || 0) - (priority[a.signal] || 0) || b.edge - a.edge);

  const stricter = candidates.filter((x) => x.signal === "Priority Review" || x.signal === "Strong Review");
  const broader = candidates.filter((x) => x.signal !== "Pass");
  const cards = [
    ["BEST STRAIGHT", "Stricter CFB Filter", stricter.slice(0, 1), 1],
    ["TOP RDG PARLAY", "Priority + Strong Reviews", diversifiedSelection(stricter, 2, 0, 1), 2],
    ["BALANCED 3-LEG", "Diversified Review Mix", diversifiedSelection(broader, 3, 1, 2), 3],
    ["WIDER 4-LEG", "Diversified Review Mix", diversifiedSelection(broader, 4, 2, 3), 4],
    ["5-LEG • HIGH RISK", "Diversified Review Card", diversifiedSelection(broader, 5, 0, 2), 5],
    ["6-LEG • HIGH RISK", "Diversified Review Card", diversifiedSelection(broader, 6, 1, 3), 6],
    ["8-LEG • LONG SHOT", "Diversified Long-Shot Card", diversifiedSelection(broader, 8, 3, 5), 8],
  ] as const;

  return (
    <>
      <div className="mt-14 border-t border-white/10 pt-10">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">RDG CFB BET BUILDER</p>
        <h2 className="mt-3 text-3xl font-bold">Today&apos;s CFB Model Selections</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Built from current Hard Rock spreads and RDG review signals. RDG will not add Pass-rated games just to fill a card.</p>
      </div>
      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        {cards.map(([title, subtitle, picks, required]) => (
          <CFBBuilderCard key={title} title={title} subtitle={subtitle} candidates={[...picks]} required={required} featured={title === "TOP RDG PARLAY"} />
        ))}
      </section>
      <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-400">
        CFB review tiers are model/market signals, not validated betting probabilities or guarantees. Small-sample CORE inputs should be treated with extra caution.
      </div>
    </>
  );
}

function CFBBuilderCard({ title, subtitle, candidates, required, featured = false }: { title: string; subtitle: string; candidates: CFBBetCandidate[]; required: number; featured?: boolean }) {
  const qualified = candidates.length >= required;
  return (
    <article className={featured ? "rounded-2xl border-2 border-emerald-400/70 bg-emerald-500/[0.10] p-6 shadow-[0_0_35px_rgba(16,185,129,0.16)] lg:col-span-2" : "rounded-xl border border-white/10 bg-white/[0.035] p-6 transition hover:border-green-500/30"}>
      {featured && <div className="mb-5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">RDG FEATURED • TOP MODEL FILTER</p><p className="mt-1 text-sm font-semibold">Strongest current combination under the stricter CFB review filters</p></div>}
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-widest text-green-400">{subtitle}</p><h3 className="mt-2 text-xl font-bold">{title}</h3></div>
        <span className={qualified ? "rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400" : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-400"}>{qualified ? "QUALIFIED" : "NOT ENOUGH LEGS"}</span>
      </div>
      {candidates.length === 0 ? <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4"><p className="font-bold">No qualifying selection</p></div> : (
        <div className="mt-6 space-y-3">{candidates.map((c, i) => <div key={c.event_id} className="rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase text-slate-500">{required > 1 ? `LEG ${i + 1}` : c.signal}</p><div className="mt-1 flex justify-between gap-4"><div><p className="text-lg font-bold">{c.display_bet}</p><p className="text-xs text-slate-500">{c.matchup}</p></div><div className="text-right"><p className="font-bold text-green-400">{c.edge.toFixed(1)} pts</p><p className="text-[10px] uppercase text-slate-500">Model vs Market</p></div></div><p className="mt-3 text-xs text-slate-500">{c.sample_status} • Hard Rock {c.odds || "—"}</p></div>)}</div>
      )}
    </article>
  );
}

function NHLSection({ nhl, loading, error }: { nhl: NHLAnalysis | null; loading: boolean; error: string }) {
  const games = nhl?.games || [];
  const regular = games.filter((g) => g.game_type === 2);
  const priority: Record<string, number> = { "Priority Review": 4, "Strong Review": 3, Watch: 2, Preseason: 0, Pass: 0 };
  const candidates: NHLBetCandidate[] = regular.map((game) => {
    if (!game.odds_available || game.signal === "Pass" || game.signal === "Preseason") return null;
    const team = game.moneyline_lean || game.rdg_projected_winner;
    const isHome = team === game.home_team;
    const odds = isHome ? game.hard_rock?.moneyline?.home_odds : game.hard_rock?.moneyline?.away_odds;
    const modelProbability = isHome ? game.rdg_home_probability : game.rdg_away_probability;
    const marketProbability = isHome ? game.hard_rock?.moneyline?.no_vig_home_probability : game.hard_rock?.moneyline?.no_vig_away_probability;
    const edge = typeof game.model_market_edge === "number" ? Math.abs(game.model_market_edge) : (typeof marketProbability === "number" ? Math.abs(modelProbability - marketProbability) : 0);
    return { event_id: game.event_id, matchup: game.matchup, team, odds: odds ?? null, display_bet: `${team} ML`, model_probability: modelProbability, market_probability: typeof marketProbability === "number" ? marketProbability : null, edge, signal: game.signal };
  }).filter((x): x is NHLBetCandidate => x !== null).sort((a,b) => (priority[b.signal] || 0) - (priority[a.signal] || 0) || b.edge - a.edge);
  const stricter = candidates.filter((x) => x.signal === "Priority Review" || x.signal === "Strong Review");
  const broader = candidates.filter((x) => x.signal === "Priority Review" || x.signal === "Strong Review" || x.signal === "Watch");
  const cards = [
    ["BEST STRAIGHT", "Stricter NHL Filter", stricter.slice(0,1), 1], ["TOP RDG PARLAY", "Priority + Strong Reviews", diversifiedSelection(stricter,2,0,1), 2], ["BALANCED 3-LEG", "Diversified Review Mix", diversifiedSelection(broader,3,1,2), 3], ["WIDER 4-LEG", "Diversified Review Mix", diversifiedSelection(broader,4,2,3), 4], ["5-LEG", "Diversified Review Card", diversifiedSelection(broader,5,0,2), 5], ["6-LEG", "Diversified Review Card", diversifiedSelection(broader,6,1,3), 6], ["8-LEG", "Diversified Long-Shot Card", diversifiedSelection(broader,8,3,5), 8]
  ] as const;
  return <div>
    <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">RDG NHL MODEL • v1.0</p>
    <h2 className="mt-3 text-3xl font-bold">Live NHL Analysis</h2>
    <p className="mt-2 text-sm text-slate-400">Chronological team model compared with current Hard Rock moneylines when available.</p>
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">Regular-season calibration is not applied as a normal betting signal to preseason games. Historical accuracy is winner prediction, not betting win rate or profitability.</div>
    <section className="mt-8 grid gap-4 md:grid-cols-4"><Stat title="NHL GAMES" value={nhl ? String(nhl.games_found) : "—"}/><Stat title="MODEL CONNECTED" value={nhl ? `${nhl.games_with_model}/${nhl.games_found}` : "—"}/><Stat title="HARD ROCK LINES" value={nhl ? String(nhl.games_with_hard_rock_moneylines) : "—"}/><Stat title="PRESEASON" value={nhl ? String(nhl.preseason_games) : "—"}/></section>
    {loading && <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">Running RDG NHL model...</div>}
    {error && <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">NHL model error: {error}</div>}
    {!loading && !error && nhl && <>
      <div className="mt-12 border-t border-white/10 pt-10"><p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">FULL NHL BOARD</p><h2 className="mt-3 text-2xl font-bold">All Games</h2></div>
      <section className="mt-6 space-y-3">{games.map((g) => <div key={g.event_id} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:grid-cols-5 md:items-center"><div><div className="flex items-center gap-2 font-bold"><TeamLogo sport="NHL" team={g.away_team} /><span>{g.away_team}</span><span className="text-slate-500">@</span><TeamLogo sport="NHL" team={g.home_team} /><span>{g.home_team}</span></div><p className="mt-1 text-xs text-slate-500">{g.game_type_label} • {g.signal}</p></div><BoardValue title="RDG WINNER" value={g.rdg_projected_winner}/><BoardValue title="MODEL PROB." value={`${g.projected_winner_probability.toFixed(1)}%`}/><BoardValue title="HARD ROCK" value={g.odds_available ? "Available" : "No line"}/><BoardValue title="STATUS" value={g.game_state}/></div>)}</section>
      <div className="mt-14 border-t border-white/10 pt-10"><p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">RDG NHL BET BUILDER</p><h2 className="mt-3 text-3xl font-bold">Today&apos;s NHL Model Selections</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Only regular-season games with qualifying model/market signals can enter the builder. Preseason games are excluded.</p></div>
      <section className="mt-8 grid gap-5 lg:grid-cols-2">{cards.map(([title, subtitle, picks, required]) => <NHLBuilderCard key={title} title={title} subtitle={subtitle} candidates={[...picks]} required={required}/>)}</section>
    </>}
  </div>;
}

function NHLBuilderCard({ title, subtitle, candidates, required }: { title: string; subtitle: string; candidates: NHLBetCandidate[]; required: number }) {
  const qualified = candidates.length >= required;
  return <article className="rounded-2xl border border-emerald-500/25 bg-[linear-gradient(145deg,rgba(16,185,129,0.07),rgba(255,255,255,0.025))] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition hover:border-emerald-400/45"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-green-400">{subtitle}</p><h3 className="mt-2 text-xl font-bold">{title}</h3></div><span className={qualified ? "rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400" : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-400"}>{qualified ? "QUALIFIED" : "NOT ENOUGH LEGS"}</span></div>{candidates.length === 0 ? <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4"><p className="font-bold">No qualifying selection</p><p className="mt-2 text-xs text-slate-500">RDG will not force preseason or weaker games into this card.</p></div> : <div className="mt-6 space-y-3">{candidates.map((c,i)=><div key={c.event_id} className="rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase text-slate-500">{required > 1 ? `LEG ${i+1}` : c.signal}</p><div className="mt-1 flex justify-between gap-4"><div><div className="flex items-center gap-3"><TeamLogo sport="NHL" team={c.team} /><p className="text-lg font-bold">{c.display_bet}</p></div><p className="text-xs text-slate-500">{c.matchup}</p></div><div className="text-right"><p className="font-bold text-green-400">{c.edge.toFixed(1)}%</p><p className="text-[10px] uppercase text-slate-500">Model vs Market</p></div></div><p className="mt-3 text-xs text-slate-500">Model {c.model_probability.toFixed(1)}% • Hard Rock {c.odds || "—"}</p></div>)}</div>}</article>;
}

function americanOddsNumber(odds: string | null) {
  if (!odds) return null;
  const value = Number(String(odds).replace("+", ""));
  return Number.isFinite(value) ? value : null;
}

function MLBSection({ mlb, loading, error }: { mlb: MLBAnalysis | null; loading: boolean; error: string }) {
  const games = (mlb?.games || []).filter((game) => game && game.rdg);
  const priority: Record<string, number> = {
    "Priority Review": 4,
    "Strong Review": 3,
    Watch: 2,
    Pass: 1,
  };

  const ranked = [...games].sort((a, b) => {
    const signalDiff =
      (priority[b.rdg?.signal || "Pass"] || 0) -
      (priority[a.rdg?.signal || "Pass"] || 0);

    if (signalDiff !== 0) return signalDiff;

    return (
      Number(b.rdg?.model_market_edge || 0) -
      Number(a.rdg?.model_market_edge || 0)
    );
  });

  const reviews = ranked.filter((game) => game.rdg?.signal !== "Pass");

  /*
    MONEYLINE POOL
    Keep the projected-winner approach that made the MLB parlays more reasonable.
  */
  const moneylineCandidates: MLBBetCandidate[] = games
    .map((game) => {
      const team = game.rdg?.projected_winner;
      if (!team) return null;

      const isHome = team === game.home_team;
      const isAway = team === game.away_team;
      if (!isHome && !isAway) return null;

      const modelProbability = Number(
        isHome
          ? game.rdg?.model_home_probability
          : game.rdg?.model_away_probability
      );

      const marketProbability = isHome
        ? game.hard_rock?.moneyline?.no_vig_home_probability
        : game.hard_rock?.moneyline?.no_vig_away_probability;

      const odds = isHome
        ? game.hard_rock?.moneyline?.home_odds
        : game.hard_rock?.moneyline?.away_odds;

      const starter = isHome
        ? game.starting_pitchers?.home?.name
        : game.starting_pitchers?.away?.name;

      const price = americanOddsNumber(odds ?? null);

      if (
        !Number.isFinite(modelProbability) ||
        typeof marketProbability !== "number" ||
        price === null
      ) {
        return null;
      }

      if (price < -350 || price > 150) return null;

      const selectedEdge = modelProbability - marketProbability;

      return {
        event_id: game.event_id,
        matchup: `${game.away_team} @ ${game.home_team}`,
        team,
        odds: odds ?? null,
        display_bet: `${team} ML`,
        model_probability: modelProbability,
        market_probability: marketProbability,
        edge: selectedEdge,
        signal:
          modelProbability >= 60
            ? "High Win Probability"
            : modelProbability >= 55
              ? "Model Favorite"
              : "Projected Winner",
        starter: starter || "TBD",
        market_type: "moneyline",
      } as MLBBetCandidate;
    })
    .filter((candidate): candidate is MLBBetCandidate => candidate !== null);

  /*
    TOTALS POOL
    Totals are deliberately restricted because the totals backtest validates
    run projection error, not historical sportsbook Over/Under profitability.

    We only surface the backend's Experimental Review totals, require a normal
    price, and keep them out of the strictest "safer" pool for now.
  */
  const totalCandidates: MLBBetCandidate[] = games
    .map((game) => {
      const total = game.rdg?.total_model;
      if (!total || total.signal !== "Experimental Review") return null;
      if (!total.lean || total.market_total === null) return null;

      const isOver = total.lean === "Over";

      const odds = isOver
        ? game.hard_rock?.total?.over_odds
        : game.hard_rock?.total?.under_odds;

      const modelProbability = Number(
        isOver
          ? total.model_over_probability
          : total.model_under_probability
      );

      const marketProbability = isOver
        ? total.no_vig_over_probability
        : total.no_vig_under_probability;

      const price = americanOddsNumber(odds ?? null);

      if (
        !Number.isFinite(modelProbability) ||
        typeof marketProbability !== "number" ||
        price === null
      ) {
        return null;
      }

      // Keep calibrated totals in a tighter, normal sportsbook range.
      if (price < -180 || price > 130) return null;

      // The backend already requires an 8 percentage-point discrepancy.
      // Keep the same floor here; do not weaken it in the UI.
      const edge = modelProbability - marketProbability;
      if (edge < 8) return null;

      return {
        event_id: game.event_id,
        matchup: `${game.away_team} @ ${game.home_team}`,
        team: `${game.away_team}/${game.home_team}`,
        odds: odds ?? null,
        display_bet: `${total.lean} ${total.market_total}`,
        model_probability: modelProbability,
        market_probability: marketProbability,
        edge,
        signal: "Calibrated Total Review",
        starter: "Game Total",
        market_type: "total",
        total_line: total.market_total,
        projected_total: total.projected_total_runs,
      } as MLBBetCandidate;
    })
    .filter((candidate): candidate is MLBBetCandidate => candidate !== null);

  const byLikelihood = (a: MLBBetCandidate, b: MLBBetCandidate) => {
    const probabilityDiff = b.model_probability - a.model_probability;
    if (Math.abs(probabilityDiff) > 0.25) return probabilityDiff;
    return b.edge - a.edge;
  };

  moneylineCandidates.sort(byLikelihood);
  totalCandidates.sort(byLikelihood);

  /*
    Maximum one leg per MLB game. This prevents a mixed card from stacking
    a moneyline and total from the same event.
  */
  function uniqueEventSelection(
    pool: MLBBetCandidate[],
    count: number,
    offset = 0
  ) {
    const selected: MLBBetCandidate[] = [];
    const usedEvents = new Set<string>();

    if (pool.length === 0) return selected;

    for (let step = 0; step < pool.length * 2 && selected.length < count; step++) {
      const candidate = pool[(offset + step) % pool.length];

      if (!usedEvents.has(candidate.event_id)) {
        usedEvents.add(candidate.event_id);
        selected.push(candidate);
      }
    }

    return selected;
  }

  const saferMoneylines = moneylineCandidates.filter((candidate) => {
    const price = americanOddsNumber(candidate.odds);

    return (
      candidate.model_probability >= 55 &&
      price !== null &&
      price >= -300 &&
      price <= 110
    );
  });

  const balancedMoneylines = moneylineCandidates.filter((candidate) => {
    const price = americanOddsNumber(candidate.odds);

    return (
      candidate.model_probability >= 52 &&
      price !== null &&
      price >= -300 &&
      price <= 125
    );
  });

  const widerMoneylines = moneylineCandidates.filter((candidate) => {
    const price = americanOddsNumber(candidate.odds);

    return (
      candidate.model_probability >= 51 &&
      price !== null &&
      price >= -325 &&
      price <= 130
    );
  });

  /*
    Mixed pools:
    Moneylines remain the foundation. Calibrated totals can replace a leg
    when they pass the stricter totals filter above.
  */
  const balancedMixed = [
    ...balancedMoneylines,
    ...totalCandidates.filter((candidate) => candidate.model_probability >= 55),
  ].sort(byLikelihood);

  const widerMixed = [
    ...widerMoneylines,
    ...totalCandidates.filter((candidate) => candidate.model_probability >= 53),
  ].sort(byLikelihood);

  const highRiskMixed = [
    ...moneylineCandidates.filter((candidate) => {
      const price = americanOddsNumber(candidate.odds);
      return (
        candidate.model_probability >= 50.5 &&
        price !== null &&
        price >= -325 &&
        price <= 150
      );
    }),
    ...totalCandidates.filter((candidate) => candidate.model_probability >= 52),
  ].sort(byLikelihood);

  const bestStraight = saferMoneylines[0] ?? balancedMoneylines[0] ?? null;
  const twoLeg = uniqueEventSelection(saferMoneylines, 2, 0);

  // Starting with the 3-leg card, totals can enter the parlay.
  const threeLeg = uniqueEventSelection(balancedMixed, 3, 0);
  const fourLeg = uniqueEventSelection(widerMixed, 4, 1);
  const fiveLeg = uniqueEventSelection(highRiskMixed, 5, 2);
  const sixLeg = uniqueEventSelection(highRiskMixed, 6, 3);
  const eightLeg = uniqueEventSelection(highRiskMixed, 8, 4);

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
        RDG MLB MODEL • MONEYLINE + CALIBRATED TOTALS
      </p>

      <h2 className="mt-3 text-3xl font-bold">Live MLB Analysis</h2>

      <p className="mt-2 text-sm text-slate-400">
        RDG projected winners plus qualifying Hard Rock game totals. Total-score projections are backtest-calibrated and betting signals remain conservatively filtered.
      </p>

      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        Moneyline probabilities use the calibrated team model. Game-total projections were calibrated on 2023–2024 data and evaluated on 2025. Historical sportsbook total lines/prices were not available, so Over/Under betting accuracy, EV, and profitability are not validated.
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        <Stat title="MLB GAMES" value={mlb ? String(mlb.games_found ?? games.length) : "—"} />
        <Stat title="PRIORITY REVIEWS" value={mlb ? String(mlb.priority_reviews ?? 0) : "—"} />
        <Stat title="TOTAL REVIEWS" value={String(totalCandidates.length)} />
        <Stat title="WATCH REVIEWS" value={mlb ? String(mlb.watch_reviews ?? 0) : "—"} />
      </section>

      {loading && (
        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
          Running RDG MLB model...
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
          MLB model error: {error}
        </div>
      )}

      {!loading && !error && mlb && (
        <>
          {reviews.length > 0 ? (
            <section className="mt-8 grid gap-5 lg:grid-cols-2">
              {reviews.map((game, index) => (
                <MLBGameCard
                  key={`${game.event_id || "mlb"}-${game.game_pk ?? "x"}-${index}`}
                  game={game}
                />
              ))}
            </section>
          ) : (
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
              No MLB moneyline review signals right now.
            </div>
          )}

          {totalCandidates.length > 0 && (
            <>
              <div className="mt-12 border-t border-white/10 pt-10">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-sky-400">
                  CALIBRATED TOTALS
                </p>
                <h2 className="mt-3 text-2xl font-bold">Qualified Over / Under Reviews</h2>
              </div>

              <section className="mt-6 grid gap-4 lg:grid-cols-2">
                {totalCandidates.map((candidate, index) => (
                  <div
                    key={`${candidate.event_id}-total-${index}`}
                    className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-sky-400">
                          CALIBRATED TOTAL REVIEW
                        </p>
                        <p className="mt-2 text-xl font-black">
                          GAME TOTAL — {candidate.display_bet} RUNS {candidate.odds || ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {candidate.matchup}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="font-black text-sky-400">
                          {candidate.edge.toFixed(1)} pp
                        </p>
                        <p className="text-[10px] uppercase text-slate-500">
                          Model vs Market
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <MiniStat
                        title="RDG MODEL"
                        value={`${candidate.model_probability.toFixed(1)}%`}
                      />
                      <MiniStat
                        title="NO-VIG MARKET"
                        value={
                          candidate.market_probability !== null
                            ? `${candidate.market_probability.toFixed(1)}%`
                            : "—"
                        }
                      />
                      <MiniStat
                        title="PROJECTED RUNS"
                        value={
                          candidate.projected_total !== null &&
                          candidate.projected_total !== undefined
                            ? candidate.projected_total.toFixed(2)
                            : "—"
                        }
                      />
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}

          <div className="mt-14 border-t border-white/10 pt-10">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
              RDG MLB MIXED PARLAY BUILDER
            </p>
            <h2 className="mt-3 text-3xl font-bold">
              Today&apos;s MLB Mixed-Market Selections
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Moneylines remain the foundation. Qualified experimental game
              totals can enter 3-leg and larger cards. RDG uses no more than
              one selection from the same game.
            </p>
          </div>

          <section className="mt-8 grid gap-5 lg:grid-cols-2">
            <MLBBuilderCard
              title="BEST STRAIGHT"
              subtitle="PROJECTED WINNER • STRICTER MONEYLINE FILTER"
              candidates={bestStraight ? [bestStraight] : []}
              required={1}
            />

            <MLBBuilderCard
              title="TOP RDG PARLAY"
              subtitle="2-LEG • STRICTER MONEYLINE FILTER"
              featured
              candidates={twoLeg}
              required={2}
            />

            <MLBBuilderCard
              title="BALANCED 3-LEG"
              subtitle="MONEYLINE + QUALIFIED TOTALS"
              candidates={threeLeg}
              required={3}
            />

            <MLBBuilderCard
              title="WIDER 4-LEG"
              subtitle="MIXED MLB MARKETS"
              candidates={fourLeg}
              required={4}
            />

            <MLBBuilderCard
              title="5-LEG • HIGH RISK"
              subtitle="MIXED MLB MARKETS"
              candidates={fiveLeg}
              required={5}
            />

            <MLBBuilderCard
              title="6-LEG • HIGH RISK"
              subtitle="MIXED MLB MARKETS"
              candidates={sixLeg}
              required={6}
            />

            <MLBBuilderCard
              title="8-LEG • LONG SHOT"
              subtitle="MIXED MLB MARKETS"
              candidates={eightLeg}
              required={8}
            />
          </section>

          <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-400">
            Calibrated totals are not treated as validated betting edges.
            They are displayed separately and only enter larger mixed-market
            cards when they clear the stricter totals filter. RDG does not use
            more than one leg from the same MLB game.
          </div>

          <div className="mt-12 border-t border-white/10 pt-10">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
              FULL MLB BOARD
            </p>
            <h2 className="mt-3 text-2xl font-bold">All Games</h2>
          </div>

          <section className="mt-6 space-y-3">
            {ranked.map((game, index) => (
              <MLBBoardRow
                key={`${game.event_id || "mlb-board"}-${game.game_pk ?? "x"}-${index}`}
                game={game}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function MLBBuilderCard({
  title,
  subtitle,
  candidates,
  required,
  featured = false,
}: {
  title: string;
  subtitle: string;
  candidates: MLBBetCandidate[];
  required: number;
  featured?: boolean;
}) {
  const qualified = candidates.length >= required;

  return (
    <article className={featured ? "rounded-2xl border-2 border-emerald-400/70 bg-emerald-500/[0.10] p-6 shadow-[0_0_35px_rgba(16,185,129,0.16)] lg:col-span-2" : "rounded-xl border border-white/10 bg-white/[0.035] p-6 transition hover:border-green-500/30"}>
      {featured && <div className="mb-5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3"><p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">RDG FEATURED • TOP MODEL FILTER</p><p className="mt-1 text-sm font-semibold">Strongest current combination under the stricter MLB review filters</p></div>}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-green-400">
            {subtitle}
          </p>
          <h3 className="mt-2 text-xl font-bold">{title}</h3>
        </div>

        <span
          className={
            qualified
              ? "rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400"
              : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-400"
          }
        >
          {qualified ? "QUALIFIED" : "NOT ENOUGH LEGS"}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4">
          <p className="font-bold">No qualifying selection</p>
          <p className="mt-2 text-xs text-slate-500">
            RDG will not force a Pass-rated MLB game into this tier.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {candidates.map((candidate, index) => (
            <div
              key={`${candidate.event_id}-${candidate.team}-${index}`}
              className="rounded-lg border border-white/10 bg-black/20 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  {required > 1 && (
                    <p className="text-[10px] font-bold uppercase text-slate-500">
                      LEG {index + 1}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-3">
                    {candidate.market_type === "moneyline" && (
                      <TeamLogo sport="MLB" team={candidate.team} />
                    )}
                    <div>
                      {candidate.market_type === "total" && (
                        <p className="text-[10px] font-black uppercase tracking-wider text-sky-400">
                          GAME TOTAL
                        </p>
                      )}
                      <p className="text-lg font-bold">
                        {candidate.market_type === "total"
                          ? `${candidate.display_bet} RUNS`
                          : candidate.display_bet}{" "}
                        {candidate.odds || ""}
                      </p>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {candidate.matchup}
                    {candidate.market_type === "moneyline"
                      ? ` • Starter: ${candidate.starter}`
                      : candidate.projected_total !== null &&
                          candidate.projected_total !== undefined
                        ? ` • RDG projected total: ${candidate.projected_total.toFixed(2)}`
                        : ""}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-bold text-green-400">
                    {candidate.edge.toFixed(1)}%
                  </p>
                  <p className="mt-1 text-[10px] uppercase text-slate-500">
                    Model vs Market
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <MiniStat
                  title="RDG MODEL"
                  value={`${candidate.model_probability.toFixed(1)}%`}
                />
                <MiniStat
                  title="NO-VIG MARKET"
                  value={
                    candidate.market_probability !== null
                      ? `${candidate.market_probability.toFixed(1)}%`
                      : "—"
                  }
                />
              </div>

              <p className="mt-3 text-xs text-slate-500">
                {candidate.signal}.{" "}
                {candidate.market_type === "total"
                  ? "Total model is experimental and not yet validated against historical sportsbook total lines."
                  : "Live pitcher adjustment is experimental."}
              </p>
            </div>
          ))}
        </div>
      )}

      {!qualified && candidates.length > 0 && (
        <p className="mt-4 text-xs text-amber-400">
          Only {candidates.length} of {required} required legs currently qualify. RDG did not fill the remaining spots with Pass-rated games.
        </p>
      )}
    </article>
  );
}

function MLBGameCard({ game }: { game: MLBGame }) {
  const rdg = game.rdg;
  const moneyline = game.hard_rock?.moneyline;
  const lean = rdg?.moneyline_lean || rdg?.projected_winner || "—";
  const leanHome = lean === game.home_team;
  const odds = leanHome ? moneyline?.home_odds : moneyline?.away_odds;
  const probability = leanHome ? rdg?.model_home_probability : rdg?.model_away_probability;
  const edge = Number(rdg?.model_market_edge ?? 0);

  const time = game.start_date
    ? new Date(game.start_date).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time TBD";

  return (
    <article className="rounded-2xl border border-emerald-500/25 bg-[linear-gradient(145deg,rgba(16,185,129,0.07),rgba(255,255,255,0.025))] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition hover:border-emerald-400/45">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-green-400">
            {rdg?.signal || "Pass"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <TeamLogo sport="MLB" team={game.away_team} />
            <span className="text-xl font-bold">{game.away_team}</span>
            <span className="text-slate-500">@</span>
            <TeamLogo sport="MLB" team={game.home_team} />
            <span className="text-xl font-bold">{game.home_team}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {time} • {game.venue || "MLB"}
          </p>
        </div>

        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
          {edge.toFixed(1)}% EDGE
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <MiniStat title="RDG LEAN" value={`${lean}${odds ? ` ${odds}` : ""}`} />
        <MiniStat
          title="RDG MODEL"
          value={typeof probability === "number" ? `${probability.toFixed(1)}%` : "—"}
        />
        <MiniStat title="AWAY STARTER" value={game.starting_pitchers?.away?.name || "TBD"} />
        <MiniStat title="HOME STARTER" value={game.starting_pitchers?.home?.name || "TBD"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniStat title={`${game.away_team} HARD ROCK`} value={moneyline?.away_odds || "—"} />
        <MiniStat title={`${game.home_team} HARD ROCK`} value={moneyline?.home_odds || "—"} />
      </div>
    </article>
  );
}

function MLBBoardRow({ game }: { game: MLBGame }) {
  const rdg = game.rdg;
  const lean = rdg?.moneyline_lean || rdg?.projected_winner || "—";
  const probability =
    lean === game.home_team ? rdg?.model_home_probability : rdg?.model_away_probability;
  const edge = Number(rdg?.model_market_edge ?? 0);

  return (
    <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:grid-cols-5 md:items-center">
      <div>
        <div className="flex items-center gap-2 font-bold">
          <TeamLogo sport="MLB" team={game.away_team} />
          <span>{game.away_team}</span><span className="text-slate-500">@</span>
          <TeamLogo sport="MLB" team={game.home_team} />
          <span>{game.home_team}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">{rdg?.signal || "Pass"}</p>
      </div>

      <BoardValue title="RDG WINNER" value={rdg?.projected_winner || "—"} />
      <BoardValue title="MONEYLINE LEAN" value={lean} />
      <BoardValue
        title="MODEL PROBABILITY"
        value={typeof probability === "number" ? `${probability.toFixed(1)}%` : "—"}
      />
      <BoardValue title="MODEL VS MARKET" value={`${edge.toFixed(1)}%`} />
    </div>
  );
}

function Stat({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-2xl font-bold">
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] font-bold text-slate-500">
        {title}
      </p>

      <p className="mt-1 font-bold">
        {value}
      </p>
    </div>
  );
}

function BoardValue({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-600">
        {title}
      </p>

      <p className="mt-1 text-sm font-semibold">
        {value}
      </p>
    </div>
  );
}

function formatSpread(
  value: number | null
) {
  if (value === null) return "—";

  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}function PerformanceDashboard() {
  type PerformancePick = {
    sport: string | null;
    status: string | null;
    tier: string | null;
  };

  const [picks, setPicks] = useState<PerformancePick[]>([]);
  const [loading, setLoading] = useState(true);
  const [performanceError, setPerformanceError] = useState("");

  useEffect(() => {
    async function loadPerformance() {
      const { data, error } = await supabase
        .from("rdg_picks")
        .select("sport, status, tier");

      if (error) {
        console.error(error);
        setPerformanceError(error.message);
      } else {
        setPicks((data as PerformancePick[]) || []);
      }

      setLoading(false);
    }

    loadPerformance();
  }, []);

  const sports = ["NFL", "MLB", "NHL"];

  const getStats = (sport?: string) => {
    const rows = sport
      ? picks.filter((pick) => pick.sport === sport)
      : picks;

    const wins = rows.filter((pick) => pick.status === "won").length;
    const losses = rows.filter((pick) => pick.status === "lost").length;
    const pushes = rows.filter((pick) => pick.status === "push").length;
    const pending = rows.filter((pick) => pick.status === "pending").length;
    const graded = wins + losses + pushes;
    const decisions = wins + losses;
    const winRate = decisions > 0 ? ((wins / decisions) * 100).toFixed(1) : "—";

    return { rows, wins, losses, pushes, pending, graded, winRate };
  };

  const overall = getStats();

  const tierRows = (sport: string) => {
    const rows = picks.filter(
      (pick) =>
        pick.sport === sport &&
        (pick.status === "won" ||
          pick.status === "lost" ||
          pick.status === "push")
    );

    const tiers = Array.from(
      new Set(rows.map((pick) => pick.tier).filter((tier): tier is string => Boolean(tier)))
    );

    const priority: Record<string, number> = {
      "Priority Review": 4,
      "Strong Review": 3,
      Watch: 2,
      "Small Sample Watch": 1,
    };

    return tiers
      .map((tier) => {
        const tierPicks = rows.filter((pick) => pick.tier === tier);
        const wins = tierPicks.filter((pick) => pick.status === "won").length;
        const losses = tierPicks.filter((pick) => pick.status === "lost").length;
        const pushes = tierPicks.filter((pick) => pick.status === "push").length;
        const decisions = wins + losses;
        const winRate = decisions > 0 ? ((wins / decisions) * 100).toFixed(1) : "—";

        return { tier, wins, losses, pushes, winRate };
      })
      .sort(
        (a, b) =>
          (priority[b.tier] || 0) - (priority[a.tier] || 0) ||
          a.tier.localeCompare(b.tier)
      );
  };

  return (
    <section className="mt-14 border-t border-white/10 pt-10">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
        RDG PERFORMANCE
      </p>

      <h2 className="mt-3 text-3xl font-bold">Tracked Model Results</h2>

      <p className="mt-2 max-w-3xl text-sm text-slate-400">
        Actual saved RDG selections graded after games finish. NFL, MLB, and NHL are
        tracked separately so one sport does not hide another sport&apos;s performance.
      </p>

      {performanceError && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          Performance dashboard error: {performanceError}
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <Stat
          title="OVERALL RECORD"
          value={
            loading
              ? "..."
              : `${overall.wins}-${overall.losses}-${overall.pushes}`
          }
        />
        <Stat title="OVERALL WIN RATE" value={loading ? "..." : overall.winRate === "—" ? "—" : `${overall.winRate}%`} />
        <Stat title="GRADED PICKS" value={loading ? "..." : String(overall.graded)} />
        <Stat title="PENDING PICKS" value={loading ? "..." : String(overall.pending)} />
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {sports.map((sport) => {
          const stats = getStats(sport);
          const tiers = tierRows(sport);

          return (
            <article
              key={sport}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-green-400">
                    {sport} TRACKING
                  </p>
                  <h3 className="mt-2 text-2xl font-bold">
                    {loading ? "..." : `${stats.wins}-${stats.losses}-${stats.pushes}`}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">W-L-P record</p>
                </div>

                <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
                  {loading
                    ? "..."
                    : stats.winRate === "—"
                      ? "NO RESULTS"
                      : `${stats.winRate}%`}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <MiniStat title="GRADED" value={loading ? "..." : String(stats.graded)} />
                <MiniStat title="PENDING" value={loading ? "..." : String(stats.pending)} />
              </div>

              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  REVIEW TIER PERFORMANCE
                </p>

                {loading ? (
                  <p className="mt-3 text-sm text-slate-500">Loading...</p>
                ) : tiers.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No graded picks yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {tiers.map((tier) => (
                      <div
                        key={`${sport}-${tier.tier}`}
                        className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-300">{tier.tier}</p>
                          <p className="mt-1 text-[10px] text-slate-600">
                            {tier.wins}-{tier.losses}-{tier.pushes}
                          </p>
                        </div>
                        <p className="text-xs font-bold text-green-400">
                          {tier.winRate === "—" ? "—" : `${tier.winRate}%`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-400">
        Win rate excludes pushes. Results describe tracked historical selections only and
        do not guarantee future outcomes or profitability.
      </div>
    </section>
  );
}
