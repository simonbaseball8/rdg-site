export type ParlayLeg = {
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

export type Parlay = {
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

export type NFLGame = {
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

export type NFLAnalysis = {
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
export type NFLPlayerProp = {
  event_id: string;
  start_time: string | null;
  matchup: { away: string | null; home: string | null };
  player_id: string;
  player_name: string;
  position?: string;
  market: string;
  provider_market: string;
  sportsbook_line: number | null;
  rdg_projection: number;
  difference: number;
  edge: number;
  pick: "OVER" | "UNDER" | "YES" | "PASS";
  grade: "A+" | "A" | "B+" | "B" | "PASS";
  grade_meaning: string;
  market_no_vig_probability: number | null;
  sportsbook_count: number;
  role_change_protection?: {
    detected: boolean;
    severity: "NONE" | "MODERATE" | "STRONG";
    reasons: string[];
  } | null;
  sportsbook_lines?: Array<{
    sportsbook: string;
    side: string | null;
    line: number | null;
    odds: string | number | null;
    available: boolean;
    updated_at: string | null;
  }>;
  research?: {
    opponent: string | null;
    player_form: {
      season_games: number;
      season_average: number | null;
      recent_games: number;
      recent_average: number | null;
      recent_values: number[];
      recent_pick_hits: number | null;
    };
    opponent_defense: unknown;
    pros: string[];
    cons: string[];
  };
};

export type NFLPlayerPropsAnalysis = {
  success: boolean;
  version: string;
  actionable_props: number;
  grade_counts: Record<string, number>;
  parlay_pool: NFLPlayerProp[];
  props: NFLPlayerProp[];
};

export type CFBGame = {
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

export type CFBAnalysis = {
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
export type MLBGame = {
  event_id: string;
  game_pk: number | null;
  start_date: string;
  away_team: string;
  home_team: string;
  venue: string | null;
  hard_rock: {
    moneyline: {
      away_odds: string | null;
      home_odds: string | null;
      no_vig_away_probability: number;
      no_vig_home_probability: number;
    };
    run_line: {
      away_line: number | null;
      away_odds: string | null;
      home_line: number | null;
      home_odds: string | null;
    };
    total: {
      over: number | null;
      over_odds: string | null;
      under: number | null;
      under_odds: string | null;
    };
  };
  starting_pitchers: {
    away: {
      name: string;
      stats: {
        era: number | null;
        whip: number | null;
        innings: number | null;
      } | null;
      pitcher_score: number | null;
    } | null;
    home: {
      name: string;
      stats: {
        era: number | null;
        whip: number | null;
        innings: number | null;
      } | null;
      pitcher_score: number | null;
    } | null;
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

export type MLBAnalysis = {
  sportsbook: string;
  sport: string;
  season: number;
  model: string;
  version: string;
  model_status: string;
  games_found: number;
  priority_reviews: number;
  strong_reviews: number;
  watch_reviews: number;
  updated_at: string;
  games: MLBGame[];
};

export type MLBBetCandidate = {
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

export type CFBBetCandidate = {
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

export type NHLGame = {
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

export type NHLAnalysis = {
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

export type NHLBetCandidate = {
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

export type NFLInjury = {
  player_name: string;
  team: string;
  position: string;
  injury: string;
  game_status: string;
  practice_status: string;
  importance_score?: number | null;
  importance_tier?: string | null;
  current_injury?: boolean;
};

export type NFLInjuriesResponse = {
  success: boolean;
  current_injuries?: NFLInjury[];
  injuries?: NFLInjury[];
};
