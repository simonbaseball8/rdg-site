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
type NFLPlayerProp = {
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
  role_change_protection?: { detected: boolean; severity: "NONE" | "MODERATE" | "STRONG"; reasons: string[] } | null;
  sportsbook_lines?: Array<{ sportsbook: string; side: string | null; line: number | null; odds: string | number | null; available: boolean; updated_at: string | null }>;
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

type NFLPlayerPropsAnalysis = {
  success: boolean;
  version: string;
  actionable_props: number;
  grade_counts: Record<string, number>;
  parlay_pool: NFLPlayerProp[];
  props: NFLPlayerProp[];
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
  market_type: "spread" | "moneyline" | "passing_prop";
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
  selection?: "OVER" | "UNDER" | "YES";
  model_probability?: number;
  market_probability?: number | null;
  review?: string;
  prop_market?: string;
  grade?: string;
  role_protection?: string;
  sportsbook_name?: string | null;
  research?: {
    pros: string[];
    cons: string[];
  };
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

function TeamLogo({ sport, team }: { sport: "NFL" | "CFB" | "MLB" | "NHL"; team: string }) {
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
    CFB: {
      // Full FBS ESPN team-id map (2026) plus common aliases.
      // RDG feed aliases (hyphenated provider names)
      // FCS / Division I direct ESPN logo IDs
      "HOLY-CROSS": "107", "HOLY CROSS": "107",
      LAFAYETTE: "322",
      COLUMBIA: "171",
      GEORGETOWN: "46",
      "STONY-BROOK": "2619", "STONY BROOK": "2619",
      FORDHAM: "2230",
      "MONMOUTH-NJ": "2405", MONMOUTH: "2405",
      DARTMOUTH: "159",
      LEHIGH: "2329",
      PENNSYLVANIA: "219", PENN: "219",
      YALE: "43",
      CORNELL: "172",
      DRAKE: "2181",
      DAVIDSON: "2166",
      HOWARD: "47",
      HARVARD: "108",
      BROWN: "225",
      "NORTH-CAROLINA-CENTRAL": "2428", "NORTH CAROLINA CENTRAL": "2428", NCCU: "2428",
      "ALABAMA-STATE": "2011", "ALABAMA STATE": "2011",
      "ALABAMA-A&M": "2010", "ALABAMA A&M": "2010",
      "ALABAMA-AM": "2010",
      "ALBANY": "399",
      "ALCORN-STATE": "2016", "ALCORN STATE": "2016",
      "AUSTIN-PEAY": "2046", "AUSTIN PEAY": "2046",
      "BETHUNE-COOKMAN": "2065", "BETHUNE COOKMAN": "2065",
      "BUCKNELL": "2083",
      "BUTLER": "2086",
      "CAMPBELL": "2097",
      "CENTRAL-ARKANSAS": "2110", "CENTRAL ARKANSAS": "2110",
      "CENTRAL-CONNECTICUT": "2115", "CENTRAL CONNECTICUT": "2115",
      "CHARLESTON-SOUTHERN": "2127", "CHARLESTON SOUTHERN": "2127",
      "COLGATE": "2142",
      "DELAWARE": "48",
      "DELAWARE-STATE": "2169", "DELAWARE STATE": "2169",
      "DUQUESNE": "2184",
      "EAST-TENNESSEE-STATE": "2193", "EAST TENNESSEE STATE": "2193", ETSU: "2193",
      "EASTERN-ILLINOIS": "2197", "EASTERN ILLINOIS": "2197",
      "EASTERN-KENTUCKY": "2198", "EASTERN KENTUCKY": "2198",
      "EASTERN-WASHINGTON": "331", "EASTERN WASHINGTON": "331",
      "ELON": "2210",
      "FLORIDA-A&M": "50", "FLORIDA A&M": "50", "FLORIDA-AM": "50", FAMU: "50",
      "FURMAN": "231",
      "GARDNER-WEBB": "2241", "GARDNER WEBB": "2241",
      "GRAMBLING": "2755", "GRAMBLING-STATE": "2755", "GRAMBLING STATE": "2755",
      "HAMPTON": "2261",
      "HOUSTON-CHRISTIAN": "2277", "HOUSTON CHRISTIAN": "2277",
      "IDAHO": "70",
      "IDAHO-STATE": "304", "IDAHO STATE": "304",
      "ILLINOIS-STATE": "2287", "ILLINOIS STATE": "2287",
      "INCARNATE-WORD": "2916", "INCARNATE WORD": "2916",
      "INDIANA-STATE": "282", "INDIANA STATE": "282",
      "JACKSON-STATE": "2296", "JACKSON STATE": "2296",
      "LAMAR": "2320",
      "LINDENWOOD": "2815",
      "LIU": "112358", "LONG-ISLAND": "112358", "LONG ISLAND": "112358",
      "MAINE": "311",
      "MARIST": "2368",
      "MCNEESE": "2377", "MCNEESE-STATE": "2377", "MCNEESE STATE": "2377",
      "MERCER": "2382",
      "MERRIMACK": "2771",
      "MISSISSIPPI-VALLEY-STATE": "2400", "MISSISSIPPI VALLEY STATE": "2400",
      "MONTANA": "149",
      "MONTANA-STATE": "147", "MONTANA STATE": "147",
      "MOREHEAD-STATE": "2413", "MOREHEAD STATE": "2413",
      "MORGAN-STATE": "2415", "MORGAN STATE": "2415",
      "MURRAY-STATE": "93", "MURRAY STATE": "93",
      "NEW-HAMPSHIRE": "160", "NEW HAMPSHIRE": "160",
      "NICHOLLS": "2447", "NICHOLLS-STATE": "2447", "NICHOLLS STATE": "2447",
      "NORFOLK-STATE": "2450", "NORFOLK STATE": "2450",
      "NORTH-ALABAMA": "2453", "NORTH ALABAMA": "2453",
      "NORTH-DAKOTA": "155", "NORTH DAKOTA": "155",
      "NORTH-DAKOTA-STATE": "2449", "NORTH DAKOTA STATE": "2449", NDSU: "2449",
      "NORTHERN-ARIZONA": "2464", "NORTHERN ARIZONA": "2464",
      "NORTHERN-COLORADO": "2458", "NORTHERN COLORADO": "2458",
      "NORTHERN-IOWA": "2460", "NORTHERN IOWA": "2460",
      "PRESBYTERIAN": "2506",
      "PRINCETON": "163",
      "RHODE-ISLAND": "227", "RHODE ISLAND": "227",
      "RICHMOND": "257",
      "ROBERT-MORRIS": "2523", "ROBERT MORRIS": "2523",
      "SACRAMENTO-STATE": "16", "SACRAMENTO STATE": "16",
      "SACRED-HEART": "2529", "SACRED HEART": "2529",
      "SAINT-FRANCIS": "2598", "SAINT FRANCIS": "2598", "ST-FRANCIS-PA": "2598",
      "SAN-DIEGO": "301",
      "SOUTHEAST-MISSOURI-STATE": "2546", "SOUTHEAST MISSOURI STATE": "2546", SEMO: "2546",
      "SOUTHEASTERN-LOUISIANA": "2545", "SOUTHEASTERN LOUISIANA": "2545",
      "SOUTH-DAKOTA": "233", "SOUTH DAKOTA": "233",
      "SOUTH-DAKOTA-STATE": "2571", "SOUTH DAKOTA STATE": "2571", SDSU: "2571",
      "SOUTHERN": "2582", "SOUTHERN-UNIVERSITY": "2582",
      "SOUTHERN-ILLINOIS": "79", "SOUTHERN ILLINOIS": "79",
      "SOUTHERN-UTAH": "253", "SOUTHERN UTAH": "253",
      "STEPHEN-F-AUSTIN": "2617", "STEPHEN F AUSTIN": "2617", SFA: "2617",
      "STONEHILL": "284",
      "TENNESSEE-STATE": "2634", "TENNESSEE STATE": "2634",
      "TENNESSEE-TECH": "2635", "TENNESSEE TECH": "2635",
      "THE-CITADEL": "2643", CITADEL: "2643",
      "TOWSON": "119",
      "UC-DAVIS": "302", "UC DAVIS": "302",
      "UT-MARTIN": "2630", "UT MARTIN": "2630",
      "UT-RIO-GRANDE-VALLEY": "292", "UT RIO GRANDE VALLEY": "292", UTRGV: "292",
      "VILLANOVA": "222",
      "VMI": "2678",
      "WAGNER": "2681",
      "WEBER-STATE": "2692", "WEBER STATE": "2692",
      "WESTERN-CAROLINA": "2717", "WESTERN CAROLINA": "2717",
      "WESTERN-ILLINOIS": "2710", "WESTERN ILLINOIS": "2710",
      "WILLIAM-&-MARY": "2729", "WILLIAM AND MARY": "2729", "WILLIAM-MARY": "2729",
      "WOFFORD": "2747",
      YOUNGSTOWN: "2754", "YOUNGSTOWN-STATE": "2754", "YOUNGSTOWN STATE": "2754",

      "TEXAS-AM": "245",
      "SOUTH-ALABAMA": "6",
      "MIAMI-FL": "2390",
      "WAKE-FOREST": "154",
      "NEW-MEXICO-STATE": "166",
      "SAM-HOUSTON-STATE": "2534",
      "SAM-HOUSTON": "2534",
      "NOTRE-DAME": "87",
      "TEXAS-TECH": "2641",
      "CENTRAL-MICHIGAN": "2117",
      "LOUISIANA-STATE": "99",
      "LOUISIANA-TECH": "2348",
      "FLORIDA-STATE": "52",
      "OHIO-STATE": "194",
      "PENN-STATE": "213",
      "MICHIGAN-STATE": "127",
      "IOWA-STATE": "66",
      "KANSAS-STATE": "2306",
      "OKLAHOMA-STATE": "197",
      "OREGON-STATE": "204",
      "WASHINGTON-STATE": "265",
      "ARIZONA-STATE": "9",
      "UTAH-STATE": "328",
      "BOISE-STATE": "68",
      "FRESNO-STATE": "278",
      "SAN-DIEGO-STATE": "21",
      "SAN-JOSE-STATE": "23",
      "COLORADO-STATE": "36",
      "BALL-STATE": "2050",
      "KENT-STATE": "2309",
      "GEORGIA-STATE": "2247",
      "GEORGIA-SOUTHERN": "290",
      "APPALACHIAN-STATE": "2026",
      "EAST-CAROLINA": "151",
      "WEST-VIRGINIA": "277",
      "VIRGINIA-TECH": "259",
      "NORTH-CAROLINA": "153",
      "NORTH-CAROLINA-STATE": "152",
      "BOSTON-COLLEGE": "103",
      "SOUTH-CAROLINA": "2579",
      "SOUTH-FLORIDA": "58",
      "WESTERN-KENTUCKY": "98",
      "WESTERN-MICHIGAN": "2711",
      "EASTERN-MICHIGAN": "2199",
      "MIDDLE-TENNESSEE": "2393",
      "NORTH-TEXAS": "249",
      "TEXAS-STATE": "326",
      "OLD-DOMINION": "295",
      "COASTAL-CAROLINA": "324",
      "BOWLING-GREEN": "189",
      "FLORIDA-ATLANTIC": "2226",
      "FLORIDA-INTERNATIONAL": "2229",
      "SOUTHERN-MISS": "2572",
      "NEW-MEXICO": "167",
      "AIR-FORCE": "2005",
      "AIR FORCE": "2005", AF: "2005",
      AKR: "2006", AKRON: "2006",
      ALA: "333", ALABAMA: "333",
      APP: "2026", "APP STATE": "2026", "APPALACHIAN STATE": "2026",
      ARIZ: "12", ARIZONA: "12",
      ASU: "9", "ARIZONA STATE": "9",
      ARK: "8", ARKANSAS: "8",
      ARST: "2032", "ARKANSAS STATE": "2032",
      ARMY: "349",
      AUB: "2", AUBURN: "2",
      BALL: "2050", "BALL STATE": "2050",
      BAY: "239", BAYLOR: "239",
      BOIS: "68", "BOISE STATE": "68",
      BC: "103", "BOSTON COLLEGE": "103",
      BGSU: "189", "BOWLING GREEN": "189",
      BUFF: "2084", BUFFALO: "2084",
      BYU: "252",
      CAL: "25", CALIFORNIA: "25",
      CMU: "2117", "CENTRAL MICHIGAN": "2117",
      CHAR: "2429", CHARLOTTE: "2429",
      CIN: "2132", CINCINNATI: "2132",
      CLEM: "228", CLEMSON: "228",
      CCU: "324", "COASTAL CAROLINA": "324",
      COLO: "38", COLORADO: "38",
      CSU: "36", "COLORADO STATE": "36",
      CONN: "41", UCONN: "41", CONNECTICUT: "41",
      DUKE: "150",
      ECU: "151", "EAST CAROLINA": "151",
      EMU: "2199", "EASTERN MICHIGAN": "2199",
      FAU: "2226", "FLORIDA ATLANTIC": "2226",
      FIU: "2229", "FLORIDA INTERNATIONAL": "2229",
      FLA: "57", FLORIDA: "57",
      FSU: "52", "FLORIDA STATE": "52",
      FRES: "278", "FRESNO STATE": "278",
      UGA: "61", GEORGIA: "61",
      GASO: "290", "GEORGIA SOUTHERN": "290",
      GAST: "2247", "GEORGIA STATE": "2247",
      GT: "59", "GEORGIA TECH": "59",
      HAW: "62", HAWAII: "62",
      HOU: "248", HOUSTON: "248",
      ILL: "356", ILLINOIS: "356",
      IU: "84", INDIANA: "84",
      IOWA: "2294",
      ISU: "66", "IOWA STATE": "66",
      JAXST: "55", "JACKSONVILLE STATE": "55",
      JMU: "256", "JAMES MADISON": "256",
      KU: "2305", KANSAS: "2305",
      KSU: "2306", "KANSAS STATE": "2306",
      KENT: "2309", "KENT STATE": "2309",
      UK: "96", KENTUCKY: "96",
      LIB: "2335", LIBERTY: "2335",
      LT: "2348", "LOUISIANA TECH": "2348",
      ULL: "309", LOUISIANA: "309", "LOUISIANA-LAFAYETTE": "309",
      ULM: "2433", "LOUISIANA-MONROE": "2433",
      LSU: "99",
      LOU: "97", LOUISVILLE: "97",
      MARSH: "276", MARSHALL: "276",
      MD: "120", MARYLAND: "120",
      MEM: "235", MEMPHIS: "235",
      MIA: "2390", MIAMI: "2390", "MIAMI (FL)": "2390",
      OHM: "193", "MIAMI (OH)": "193", "MIAMI OHIO": "193",
      MICH: "130", MICHIGAN: "130",
      MSU: "127", "MICHIGAN STATE": "127",
      MTSU: "2393", "MIDDLE TENNESSEE": "2393",
      MINN: "135", MINNESOTA: "135",
      MISS: "145", "OLE MISS": "145", MISSISSIPPI: "145",
      MSST: "344", "MISSISSIPPI STATE": "344",
      MIZ: "142", MIZZOU: "142", MISSOURI: "142",
      NAVY: "2426",
      NEB: "158", NEBRASKA: "158",
      NEV: "2440", NEVADA: "2440",
      UNM: "167", "NEW MEXICO": "167",
      NMSU: "166", "NEW MEXICO STATE": "166",
      UNC: "153", "NORTH CAROLINA": "153",
      NCST: "152", "NC STATE": "152",
      UNT: "249", "NORTH TEXAS": "249",
      NIU: "2459", "NORTHERN ILLINOIS": "2459",
      NW: "77", NORTHWESTERN: "77",
      ND: "87", "NOTRE DAME": "87",
      OHIO: "195",
      OSU: "194", "OHIO STATE": "194",
      OU: "201", OKLAHOMA: "201",
      OKST: "197", "OKLAHOMA STATE": "197",
      ODU: "295", "OLD DOMINION": "295",
      ORE: "2483", OREGON: "2483",
      ORST: "204", "OREGON STATE": "204",
      PSU: "213", "PENN STATE": "213",
      PITT: "221", PITTSBURGH: "221",
      PUR: "2509", PURDUE: "2509",
      RICE: "242",
      RUTG: "164", RUTGERS: "164",
      SHSU: "2534", "SAM HOUSTON": "2534", "SAM HOUSTON STATE": "2534",
      "SAN DIEGO STATE": "21",
      SJSU: "23", "SAN JOSE STATE": "23",
      SMU: "2567",
      USA: "6", "SOUTH ALABAMA": "6",
      SC: "2579", "SOUTH CAROLINA": "2579",
      USF: "58", "SOUTH FLORIDA": "58",
      USM: "2572", "SOUTHERN MISS": "2572", "SOUTHERN MISSISSIPPI": "2572",
      STAN: "24", STANFORD: "24",
      SYR: "183", SYRACUSE: "183",
      TCU: "2628",
      TEM: "218", TEMPLE: "218",
      TENN: "2633", TENNESSEE: "2633",
      TEX: "251", TEXAS: "251",
      TAMU: "245", "TEXAS A&M": "245",
      TXST: "326", "TEXAS STATE": "326",
      TTU: "2641", "TEXAS TECH": "2641",
      TOL: "2649", TOLEDO: "2649",
      TROY: "2653",
      TULN: "2655", TULANE: "2655",
      TLSA: "202", TULSA: "202",
      UAB: "5",
      UCF: "2116",
      UCLA: "26",
      USC: "30",
      UTAH: "254",
      USU: "328", "UTAH STATE": "328",
      UTEP: "2638",
      UTSA: "2636",
      VAN: "238", VANDERBILT: "238",
      VT: "259", "VIRGINIA TECH": "259",
      UVA: "258", VIRGINIA: "258",
      WAKE: "154", "WAKE FOREST": "154",
      WASH: "264", WASHINGTON: "264",
      WSU: "265", "WASHINGTON STATE": "265",
      WVU: "277", "WEST VIRGINIA": "277",
      WKU: "98", "WESTERN KENTUCKY": "98",
      WMU: "2711", "WESTERN MICHIGAN": "2711",
      WISC: "275", WISCONSIN: "275",
      WYO: "2751", WYOMING: "2751",
      KENN: "338", "KENNESAW STATE": "338",
      DEL: "48",
      MOST: "2623", "MISSOURI STATE": "2623",
    },
    NHL: {
      ANA: "ana", BOS: "bos", BUF: "buf", CAR: "car", CBJ: "cbj", CGY: "cgy", CHI: "chi", COL: "col", DAL: "dal", DET: "det",
      EDM: "edm", FLA: "fla", LAK: "la", LA: "la", MIN: "min", MTL: "mtl", NJD: "nj", NJ: "nj", NSH: "nsh", NYI: "nyi", NYR: "nyr",
      OTT: "ott", PHI: "phi", PIT: "pit", SEA: "sea", SJS: "sj", SJ: "sj", STL: "stl", TBL: "tb", TB: "tb", TOR: "tor", UTA: "utah", VAN: "van", VGK: "vgk", WPG: "wpg", WSH: "wsh"
    }
  };

  const key = team.trim().toUpperCase();
  const normalizedCfbKey =
    sport === "CFB"
      ? key
          .replace(/_/g, "-")
          .replace(/\s+/g, " ")
          .trim()
      : key;

  const spacedCfbKey =
    sport === "CFB"
      ? normalizedCfbKey.replace(/-/g, " ")
      : normalizedCfbKey;

  const mappedCode =
    aliases[sport]?.[normalizedCfbKey] ||
    aliases[sport]?.[spacedCfbKey];

  if (sport === "CFB" && !mappedCode) {
    const initials = spacedCfbKey
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 3);

    return (
      <span
        title={`${team} logo unavailable`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[9px] font-black text-slate-300"
      >
        {initials || "CFB"}
      </span>
    );
  }

  const code = mappedCode || key.toLowerCase();
  const url =
    sport === "CFB"
      ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${code}.png`
      : `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${code}.png`;

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
  const [lastUpdatedDisplay, setLastUpdatedDisplay] = useState("Updating...");
  const [nflPlayerProps, setNflPlayerProps] =
    useState<NFLPlayerPropsAnalysis | null>(null);
const [activeSport, setActiveSport] =
  useState<"ALL" | "NFL" | "CFB" | "MLB" | "NHL" | "NBA">("NFL");

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
    setLastUpdatedDisplay(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date())
    );

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

    async function loadNFLPlayerProps() {
      try {
        const response = await fetch("/api/nfl-player-props", { cache: "no-store" });
        if (!response.ok) throw new Error(`NFL player props failed: ${response.status}`);
        setNflPlayerProps(await response.json());
      } catch (err) {
        console.error(err);
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
    loadNFLPlayerProps();
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

  const nowMs = Date.now();

  function americanImpliedProbability(odds: string | number | null) {
    if (odds === null || odds === undefined) return null;
    const value = Number(odds);
    if (!Number.isFinite(value) || value === 0) return null;

    return value > 0
      ? (100 / (value + 100)) * 100
      : (Math.abs(value) / (Math.abs(value) + 100)) * 100;
  }

  // SPREAD CANDIDATES
  const candidates: BetCandidate[] =
    rankedGames
      .map((game) => {
        if (!game.stats_connected) return null;
        if (new Date(game.start_date).getTime() <= nowMs) return null;

        const market = game.rdg.market_analysis;
        const historical = game.rdg.historical_signal;
        const difference = market.model_vs_market_difference;

        if (difference === null) return null;

        const edge = Math.abs(difference);
        if (edge < 2) return null;

        const team = market.spread_lean;
        const isHome = team === game.home_team;
        const isAway = team === game.away_team;

        if (!isHome && !isAway) return null;

        const line = isHome
          ? market.hard_rock_spread.home_line
          : market.hard_rock_spread.away_line;

        const odds = isHome
          ? market.hard_rock_spread.home_odds
          : market.hard_rock_spread.away_odds;

        if (line === null) return null;

        let score = edge * 10;

        if (historical.historical_winner_accuracy >= 70) score += 10;
        else if (historical.historical_winner_accuracy >= 60) score += 6;
        else if (historical.historical_winner_accuracy >= 55) score += 3;

        if (historical.sample >= 30) score += 3;
        if (game.rdg.projected_winner === team) score += 4;

        return {
          event_id: `spread-${game.event_id}`,
          correlation_key: `${game.away_team}@${game.home_team}`.toUpperCase(),
          market_type: "spread" as const,
          matchup: `${game.away_team} @ ${game.home_team}`,
          team,
          line,
          odds,
          display_bet: `${team} ${formatSpread(line)}`,
          projected_winner: game.rdg.projected_winner,
          projected_margin: game.rdg.projected_margin,
          difference: Number(edge.toFixed(2)),
          historical_accuracy: historical.historical_winner_accuracy,
          historical_sample: historical.sample,
          historical_correct: historical.correct,
          historical_bucket: historical.bucket,
          score: Number(score.toFixed(2)),
          sportsbook_name: "Hard Rock Bet",
        } as BetCandidate;
      })
      .filter((candidate): candidate is BetCandidate => candidate !== null)
      .sort((a, b) => b.score - a.score);

  // MONEYLINE CANDIDATES
  // The team model is a margin model, not a calibrated moneyline probability
  // model. Moneylines therefore use projected winner/margin, historical
  // winner-bucket performance, and current price as a conservative ranking
  // filter. We do not label this as a true model probability edge.
  const moneylineCandidates: BetCandidate[] =
    rankedGames
      .map((game) => {
        if (!game.stats_connected) return null;
        if (new Date(game.start_date).getTime() <= nowMs) return null;

        const market = game.rdg.market_analysis;
        const historical = game.rdg.historical_signal;
        const team = game.rdg.projected_winner;

        const isHome = team === game.home_team;
        const isAway = team === game.away_team;
        if (!isHome && !isAway) return null;

        const odds = isHome
          ? market.hard_rock_moneyline.home_odds
          : market.hard_rock_moneyline.away_odds;

        if (odds === null || odds === undefined) return null;

        const numericOdds = Number(odds);
        if (!Number.isFinite(numericOdds)) return null;

        // Avoid very expensive favorites that add little parlay value.
        if (numericOdds < -250) return null;

        if (
          historical.historical_winner_accuracy < 55 ||
          historical.sample < 30 ||
          game.rdg.projected_margin < 3
        ) {
          return null;
        }

        const implied = americanImpliedProbability(odds);
        if (implied === null) return null;

        // Ranking only: this is NOT an individual-game win probability.
        const historicalVsPrice =
          historical.historical_winner_accuracy - implied;

        let score =
          game.rdg.projected_margin * 5 +
          Math.max(0, historicalVsPrice) * 3;

        if (historical.historical_winner_accuracy >= 70) score += 14;
        else if (historical.historical_winner_accuracy >= 60) score += 8;

        if (numericOdds >= -160) score += 6;
        if (numericOdds > 0) score += 5;

        return {
          event_id: `moneyline-${game.event_id}`,
          correlation_key: `${game.away_team}@${game.home_team}`.toUpperCase(),
          market_type: "moneyline" as const,
          matchup: `${game.away_team} @ ${game.home_team}`,
          team,
          line: 0,
          odds: String(odds),
          display_bet: `${team} MONEYLINE`,
          projected_winner: game.rdg.projected_winner,
          projected_margin: game.rdg.projected_margin,
          difference: Number(game.rdg.projected_margin.toFixed(2)),
          historical_accuracy: historical.historical_winner_accuracy,
          historical_sample: historical.sample,
          historical_correct: historical.correct,
          historical_bucket: historical.bucket,
          score: Number(score.toFixed(2)),
          market_probability: Number(implied.toFixed(2)),
          sportsbook_name: "Hard Rock Bet",
        } as BetCandidate;
      })
      .filter((candidate): candidate is BetCandidate => candidate !== null)
      .sort((a, b) => b.score - a.score);

  // UNIFIED NFL PLAYER PROP CANDIDATES (V6.2)
  const propMarketScale: Record<string, number> = {
    player_pass_yds: 30, player_pass_tds: 0.75, player_rush_yds: 15,
    player_reception_yds: 15, player_receptions: 1.5, player_anytime_td: 10,
  };
  const gradeRank: Record<string, number> = { "A+": 4, A: 3, "B+": 2, B: 1 };

  const passingPropCandidates: BetCandidate[] =
    (nflPlayerProps?.parlay_pool || [])
      .filter((prop) => prop.grade !== "PASS" && prop.pick !== "PASS" && (!prop.start_time || new Date(prop.start_time).getTime() > nowMs))
      .map((prop) => {
        const away = prop.matchup.away || "AWAY";
        const home = prop.matchup.home || "HOME";
        const scale = propMarketScale[prop.provider_market] || 1;
        const normalizedEdge = Math.abs(prop.edge || 0) / scale;
        const rank = gradeRank[prop.grade] || 0;
        const matchingPrices = (prop.sportsbook_lines || [])
          .filter((book) => {
            if (!book.available || book.odds === null || book.odds === undefined) return false;
            const side = String(book.side || "").toUpperCase();
            const sideMatches = prop.pick === "YES" ? side === "YES" : side === prop.pick;
            const lineMatches = prop.sportsbook_line === null || book.line === null || Number(book.line) === Number(prop.sportsbook_line);
            return sideMatches && lineMatches;
          })
          .map((book) => ({ sportsbook: book.sportsbook, odds: String(book.odds), numericOdds: Number(book.odds) }))
          .filter((book) => Number.isFinite(book.numericOdds))
          .sort((a, b) => b.numericOdds - a.numericOdds);
        const bestPrice = matchingPrices[0] || null;
        const rolePenalty = prop.role_change_protection?.severity === "STRONG" ? 20 : prop.role_change_protection?.severity === "MODERATE" ? 10 : 0;
        const score = rank * 100 + Math.min(normalizedEdge, 3) * 25 + Math.min(prop.sportsbook_count || 0, 6) * 2 - rolePenalty;
        const line = prop.sportsbook_line ?? 0;
        const lineText = prop.sportsbook_line !== null ? ` ${prop.sportsbook_line}` : "";
        return {
          event_id: `prop-${prop.event_id}-${prop.player_id}-${prop.provider_market}`,
          correlation_key: `${away}@${home}`.toUpperCase(), market_type: "passing_prop" as const,
          matchup: `${away} @ ${home}`, team: prop.player_name, line, odds: bestPrice?.odds || null,
          display_bet: `${prop.player_name} ${prop.pick}${lineText}${bestPrice?.odds ? ` (${Number(bestPrice.odds) > 0 ? "+" : ""}${bestPrice.odds})` : ""}`,
          projected_winner: "", projected_margin: prop.rdg_projection, difference: Number(Math.abs(prop.edge || 0).toFixed(2)),
          historical_accuracy: 0, historical_sample: 0, historical_correct: 0, historical_bucket: prop.grade_meaning,
          score: Number(score.toFixed(2)), player_name: prop.player_name, selection: prop.pick === "PASS" ? undefined : prop.pick,
          market_probability: prop.market_no_vig_probability, review: prop.grade, prop_market: prop.market, grade: prop.grade,
          role_protection: prop.role_change_protection?.severity || "NONE", sportsbook_name: bestPrice?.sportsbook || null,
          research: prop.research ? { pros: prop.research.pros || [], cons: prop.research.cons || [] } : undefined,
        } as BetCandidate;
      })
      .sort((a, b) => b.score - a.score);

  const spreadSaferCandidates = candidates.filter((candidate) =>
    candidate.difference >= 3.5 &&
    candidate.historical_accuracy >= 55 &&
    candidate.historical_sample >= 30
  );

  const spreadBalancedCandidates = candidates.filter((candidate) =>
    candidate.difference >= 3 &&
    candidate.historical_sample >= 30
  );

  const spreadHigherRiskCandidates =
    candidates.filter((candidate) => candidate.difference >= 2);

  const moneylineSaferCandidates = moneylineCandidates.filter((candidate) =>
    candidate.projected_margin >= 6 &&
    candidate.historical_accuracy >= 60 &&
    Number(candidate.odds || -999) >= -220
  );

  const moneylineBalancedCandidates = moneylineCandidates.filter((candidate) =>
    candidate.projected_margin >= 4 &&
    candidate.historical_accuracy >= 55 &&
    Number(candidate.odds || -999) >= -250
  );

  const moneylineHigherRiskCandidates =
    moneylineCandidates.filter((candidate) => candidate.projected_margin >= 3);

  const propSaferCandidates = passingPropCandidates.filter((candidate) => candidate.grade === "A+" || candidate.grade === "A");
  const propBalancedCandidates = passingPropCandidates.filter((candidate) => candidate.grade === "A+" || candidate.grade === "A" || candidate.grade === "B+");
  const propHigherRiskCandidates = passingPropCandidates.filter((candidate) => candidate.grade !== "PASS");

  const saferCandidates = [
    ...spreadSaferCandidates,
    ...moneylineSaferCandidates,
    ...propSaferCandidates,
  ].sort((a, b) => b.score - a.score);

  const balancedCandidates = [
    ...spreadBalancedCandidates,
    ...moneylineBalancedCandidates,
    ...propBalancedCandidates,
  ].sort((a, b) => b.score - a.score);

  const higherRiskCandidates = [
    ...spreadHigherRiskCandidates,
    ...moneylineHigherRiskCandidates,
    ...propHigherRiskCandidates,
  ].sort((a, b) => b.score - a.score);

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
    const sorted = [...pool].sort((a, b) => b.score - a.score);
    const selected: BetCandidate[] = [];
    const usedGames = new Set<string>();
    const marketCounts = new Map<string, number>();

    // Keep parlays balanced across spreads, moneylines and player props.
    // For 3+ legs, no single market type can take more than roughly one-third
    // of the card until each available market type has been represented.
    const availableTypes = (["spread", "moneyline", "passing_prop"] as const)
      .filter((type) => sorted.some((candidate) => candidate.market_type === type));

    const targetMaxPerType = Math.max(1, Math.ceil(count / 3));

    while (selected.length < count) {
      const unusedTypes = availableTypes.filter(
        (type) => (marketCounts.get(type) || 0) === 0
      );

      let eligible = sorted.filter(
        (candidate) => !usedGames.has(candidate.correlation_key)
      );

      // First cycle through every available market type so props cannot dominate.
      if (unusedTypes.length > 0 && selected.length < availableTypes.length) {
        const diversified = eligible.filter((candidate) =>
          unusedTypes.includes(candidate.market_type)
        );
        if (diversified.length > 0) eligible = diversified;
      } else {
        // After each type is represented, cap each category as evenly as possible.
        const capped = eligible.filter(
          (candidate) =>
            (marketCounts.get(candidate.market_type) || 0) < targetMaxPerType
        );
        if (capped.length > 0) eligible = capped;
      }

      const available = eligible
        .map((candidate) => {
          const usage = nflCandidateUsage.get(candidate.event_id) || 0;
          const marketUsage = marketCounts.get(candidate.market_type) || 0;

          return {
            candidate,
            adjustedScore:
              candidate.score -
              usage * 12 -
              marketUsage * 30,
          };
        })
        .sort((a, b) => b.adjustedScore - a.adjustedScore);

      if (available.length === 0) break;

      const pick = available[0].candidate;
      selected.push(pick);
      usedGames.add(pick.correlation_key);
      marketCounts.set(
        pick.market_type,
        (marketCounts.get(pick.market_type) || 0) + 1
      );
      nflCandidateUsage.set(
        pick.event_id,
        (nflCandidateUsage.get(pick.event_id) || 0) + 1
      );
    }

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

  /*
    CROSS-SPORT MONDAY / THURSDAY PARLAY EDITIONS
    Monday edition covers Monday-Wednesday; Thursday edition covers Thursday-Sunday.
    This uses the qualifying model signals already loaded on this page.
  */
  type CrossSportCandidate = {
    id: string;
    sport: "NFL" | "CFB" | "MLB" | "NHL";
    event_key: string;
    start_time: string;
    display_bet: string;
    matchup: string;
    odds: string | null;
    score: number;
    detail: string;
  };

  // Fixed twice-weekly editions:
  // Monday edition = Monday through Wednesday
  // Thursday edition = Thursday through Sunday
  // The active edition changes only when Thursday or Monday begins.
  const editionNow = new Date();
  const editionDay = editionNow.getDay(); // Sun=0, Mon=1 ... Sat=6

  const editionStart = new Date(editionNow);
  editionStart.setHours(0, 0, 0, 0);

  if (editionDay === 0) {
    // Sunday belongs to the Thursday edition.
    editionStart.setDate(editionStart.getDate() - 3);
  } else if (editionDay >= 1 && editionDay <= 3) {
    // Monday-Wednesday: move back to Monday.
    editionStart.setDate(editionStart.getDate() - (editionDay - 1));
  } else {
    // Thursday-Saturday: move back to Thursday.
    editionStart.setDate(editionStart.getDate() - (editionDay - 4));
  }

  const isMondayEdition = editionStart.getDay() === 1;
  const editionEnd = new Date(editionStart);
  editionEnd.setDate(editionEnd.getDate() + (isMondayEdition ? 2 : 3));
  editionEnd.setHours(23, 59, 59, 999);

  const editionLabel = isMondayEdition ? "MONDAY EDITION" : "THURSDAY EDITION";
  const editionDateRange = `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(editionStart)}–${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(editionEnd)}`;

  const isInEditionWindow = (dateValue: string | null | undefined) => {
    if (!dateValue) return false;
    const time = new Date(dateValue).getTime();
    return (
      Number.isFinite(time) &&
      time > nowMs &&
      time >= editionStart.getTime() &&
      time <= editionEnd.getTime()
    );
  };

  const crossSportCandidates: CrossSportCandidate[] = [];

  // NFL spreads, moneylines and unified V6.2 player props.
  [...candidates, ...moneylineCandidates, ...passingPropCandidates].forEach((candidate) => {
    let startTime: string | null = null;

    if (candidate.market_type === "passing_prop") {
      const prop = (nflPlayerProps?.parlay_pool || []).find(
        (item) => `prop-${item.event_id}-${item.player_id}-${item.provider_market}` === candidate.event_id
      );
      startTime = prop?.start_time || null;
    } else {
      const rawEventId = candidate.event_id.replace(/^spread-/, "").replace(/^moneyline-/, "");
      const game = (nfl?.games || []).find((item) => item.event_id === rawEventId);
      startTime = game?.start_date || null;
    }

    if (!isInEditionWindow(startTime)) return;

    crossSportCandidates.push({
      id: `NFL-${candidate.event_id}`,
      sport: "NFL",
      event_key: `NFL-${candidate.correlation_key}`,
      start_time: startTime as string,
      display_bet: candidate.display_bet,
      matchup: candidate.matchup,
      odds: candidate.odds,
      score: candidate.score,
      detail:
        candidate.market_type === "passing_prop"
          ? `${candidate.grade || candidate.review || "RDG"} • ${candidate.prop_market || "Player Prop"}`
          : candidate.market_type === "moneyline"
            ? `Projected margin ${candidate.projected_margin.toFixed(1)} • ${candidate.historical_accuracy.toFixed(1)}% historical bucket`
            : `${candidate.difference.toFixed(1)} pt model/market difference`,
    });
  });

  // College Football qualifying spreads.
  (cfb?.games || []).forEach((game) => {
    if (!isInEditionWindow(game.start_date) || !game.rdg || game.rdg.signal === "Pass") return;
    const team = game.rdg.spread_lean;
    if (!team) return;

    const isHome = team === game.home_team;
    const isAway = team === game.away_team;
    if (!isHome && !isAway) return;

    const line = isHome ? game.hard_rock.spread.home_line : game.hard_rock.spread.away_line;
    const odds = isHome ? game.hard_rock.spread.home_odds : game.hard_rock.spread.away_odds;
    if (line === null) return;

    const edge = Math.abs(Number(game.rdg.model_vs_market_difference ?? 0));
    const signalBonus =
      game.rdg.signal === "Priority Review" ? 30 :
      game.rdg.signal === "Strong Review" ? 20 :
      game.rdg.signal === "Watch" ? 8 : 0;

    crossSportCandidates.push({
      id: `CFB-${game.event_id}`,
      sport: "CFB",
      event_key: `CFB-${game.event_id}`,
      start_time: game.start_date,
      display_bet: `${team} ${formatSpread(line)}`,
      matchup: `${game.away_team} @ ${game.home_team}`,
      odds,
      score: edge * 10 + signalBonus,
      detail: `${game.rdg.signal} • ${edge.toFixed(1)} pt model/market difference`,
    });
  });

  // MLB qualifying moneylines and experimental totals.
  (mlb?.games || []).forEach((game) => {
    if (!isInEditionWindow(game.start_date) || !game.rdg) return;

    const team = game.rdg.projected_winner;
    const isHome = team === game.home_team;
    const isAway = team === game.away_team;

    if (team && (isHome || isAway)) {
      const modelProbability = Number(
        isHome ? game.rdg.model_home_probability : game.rdg.model_away_probability
      );
      const marketProbability = isHome
        ? game.hard_rock.moneyline.no_vig_home_probability
        : game.hard_rock.moneyline.no_vig_away_probability;
      const odds = isHome
        ? game.hard_rock.moneyline.home_odds
        : game.hard_rock.moneyline.away_odds;
      const price = americanOddsNumber(odds);

      if (
        Number.isFinite(modelProbability) &&
        typeof marketProbability === "number" &&
        price !== null &&
        price >= -350 &&
        price <= 150
      ) {
        const edge = modelProbability - marketProbability;
        if (modelProbability >= 55 || edge >= 3) {
          crossSportCandidates.push({
            id: `MLB-ML-${game.event_id}`,
            sport: "MLB",
            event_key: `MLB-${game.event_id}`,
            start_time: game.start_date,
            display_bet: `${team} ML`,
            matchup: `${game.away_team} @ ${game.home_team}`,
            odds,
            score: modelProbability + Math.max(0, edge) * 3,
            detail: `Model ${modelProbability.toFixed(1)}% • ${edge.toFixed(1)}% vs market`,
          });
        }
      }
    }

    const total = game.rdg.total_model;
    if (total?.signal === "Experimental Review" && total.lean && total.market_total !== null) {
      const isOver = total.lean === "Over";
      const odds = isOver ? game.hard_rock.total.over_odds : game.hard_rock.total.under_odds;
      const modelProbability = Number(
        isOver ? total.model_over_probability : total.model_under_probability
      );
      const marketProbability = isOver
        ? total.no_vig_over_probability
        : total.no_vig_under_probability;
      const price = americanOddsNumber(odds);

      if (
        Number.isFinite(modelProbability) &&
        typeof marketProbability === "number" &&
        price !== null &&
        price >= -180 &&
        price <= 130
      ) {
        const edge = modelProbability - marketProbability;
        if (edge >= 8) {
          crossSportCandidates.push({
            id: `MLB-TOTAL-${game.event_id}`,
            sport: "MLB",
            event_key: `MLB-${game.event_id}`,
            start_time: game.start_date,
            display_bet: `${total.lean} ${total.market_total}`,
            matchup: `${game.away_team} @ ${game.home_team}`,
            odds,
            score: modelProbability + edge * 3,
            detail: `Experimental total review • ${edge.toFixed(1)}% vs market`,
          });
        }
      }
    }
  });

  // NHL qualifying regular-season moneylines.
  (nhl?.games || []).forEach((game) => {
    if (
      game.game_type !== 2 ||
      !game.odds_available ||
      game.signal === "Pass" ||
      game.signal === "Preseason" ||
      !isInEditionWindow(game.start_time_utc)
    ) {
      return;
    }

    const team = game.moneyline_lean || game.rdg_projected_winner;
    const isHome = team === game.home_team;
    const odds = isHome
      ? game.hard_rock?.moneyline?.home_odds
      : game.hard_rock?.moneyline?.away_odds;
    const modelProbability = isHome ? game.rdg_home_probability : game.rdg_away_probability;
    const marketProbability = isHome
      ? game.hard_rock?.moneyline?.no_vig_home_probability
      : game.hard_rock?.moneyline?.no_vig_away_probability;
    const edge =
      typeof game.model_market_edge === "number"
        ? Math.abs(game.model_market_edge)
        : typeof marketProbability === "number"
          ? Math.abs(modelProbability - marketProbability)
          : 0;

    const signalBonus =
      game.signal === "Priority Review" ? 30 :
      game.signal === "Strong Review" ? 20 :
      game.signal === "Watch" ? 8 : 0;

    crossSportCandidates.push({
      id: `NHL-${game.event_id}`,
      sport: "NHL",
      event_key: `NHL-${game.event_id}`,
      start_time: game.start_time_utc,
      display_bet: `${team} ML`,
      matchup: game.matchup,
      odds: odds ?? null,
      score: modelProbability + edge * 3 + signalBonus,
      detail: `${game.signal} • Model ${modelProbability.toFixed(1)}%`,
    });
  });

  crossSportCandidates.sort((a, b) => b.score - a.score);

  function buildCrossSportParlay(count: number, offset = 0) {
    const selected: CrossSportCandidate[] = [];
    const usedEvents = new Set<string>();
    const sportCounts = new Map<string, number>();

    const ranked = crossSportCandidates
      .map((candidate, index) => ({
        candidate,
        baseRank: candidate.score - Math.abs(index - offset) * 0.15,
      }))
      .sort((a, b) => b.baseRank - a.baseRank);

    while (selected.length < count) {
      const available = ranked
        .filter(({ candidate }) => !usedEvents.has(candidate.event_key))
        .map(({ candidate, baseRank }) => ({
          candidate,
          adjusted:
            baseRank -
            (sportCounts.get(candidate.sport) || 0) * 8,
        }))
        .sort((a, b) => b.adjusted - a.adjusted);

      if (available.length === 0) break;

      const pick = available[0].candidate;
      selected.push(pick);
      usedEvents.add(pick.event_key);
      sportCounts.set(pick.sport, (sportCounts.get(pick.sport) || 0) + 1);
    }

    return selected;
  }

  const crossSportBest = buildCrossSportParlay(2, 0);
  const crossSportThree = buildCrossSportParlay(3, 1);
  const crossSportFour = buildCrossSportParlay(4, 2);
  const crossSportFive = buildCrossSportParlay(5, 3);

  return (
    <main className="min-h-screen bg-[#050b10] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#071019]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/rdg-logo.png"
              alt="Responsible Degenerate Gambling"
              className="h-11 w-auto object-contain sm:h-12"
            />
            <div className="hidden border-l border-white/10 pl-3 sm:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Responsible</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Degenerate Gambling</p>
            </div>
          </div>

          <div className="hidden items-center gap-7 text-sm font-semibold text-slate-400 md:flex">
            <button onClick={() => setActiveSport("ALL")} className={activeSport === "ALL" ? "text-emerald-400" : "transition hover:text-white"}>Home</button>
            <button onClick={() => setActiveSport("NFL")} className={activeSport === "NFL" ? "text-emerald-400" : "transition hover:text-white"}>NFL</button>
            <button onClick={() => setActiveSport("CFB")} className={activeSport === "CFB" ? "text-emerald-400" : "transition hover:text-white"}>College Football</button>
            <button onClick={() => setActiveSport("MLB")} className={activeSport === "MLB" ? "text-emerald-400" : "transition hover:text-white"}>MLB</button>
            <button onClick={() => setActiveSport("NHL")} className={activeSport === "NHL" ? "text-emerald-400" : "transition hover:text-white"}>NHL</button>
          </div>

          <div className="rounded-lg border border-emerald-400/70 px-4 py-2 text-xs font-black text-white shadow-[0_0_20px_rgba(52,211,153,0.08)]">
            RDG LIVE
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <section className="relative mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_78%_20%,rgba(30,64,175,0.22),transparent_34%),radial-gradient(circle_at_12%_15%,rgba(16,185,129,0.12),transparent_30%),linear-gradient(135deg,#07131d_0%,#071019_55%,#061018_100%)] px-6 py-8 shadow-[0_22px_60px_rgba(0,0,0,0.28)] sm:px-8 sm:py-10">
          <div className="relative z-10 max-w-3xl">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">RDG SPORTS ANALYTICS</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">Better data. Smarter parlays.</h1>
            <p className="mt-3 max-w-2xl text-base text-slate-400 sm:text-lg">Explore RDG model picks, player props, current sportsbook lines, and automatically built parlays without digging through a wall of data.</p>
          </div>

          <div className="relative z-10 mt-7 flex gap-2 overflow-x-auto pb-1">
            {[
              ["ALL", "All Sports"],
              ["NFL", "NFL"],
              ["CFB", "College Football"],
              ["MLB", "MLB"],
              ["NHL", "NHL"],
              ["NBA", "NBA"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setActiveSport(value as "ALL" | "NFL" | "CFB" | "MLB" | "NHL" | "NBA")}
                className={
                  activeSport === value
                    ? "whitespace-nowrap rounded-full border border-emerald-400 bg-emerald-400/15 px-5 py-2 text-xs font-black text-emerald-300"
                    : "whitespace-nowrap rounded-full border border-white/15 bg-black/15 px-5 py-2 text-xs font-bold text-slate-300 transition hover:border-emerald-400/40 hover:text-white"
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative z-10 mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">NFL Props</p>
              <p className="mt-1 text-xl font-black text-white">{nflPlayerProps?.actionable_props ?? "—"}</p>
              <p className="mt-1 text-[10px] text-slate-500">Current qualifying plays</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">NFL Games</p>
              <p className="mt-1 text-xl font-black text-white">{nfl?.games_found ?? "—"}</p>
              <p className="mt-1 text-[10px] text-slate-500">Current board</p>
            </div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-400">Elite A+ Props</p>
              <p className="mt-1 text-xl font-black text-white">{nflPlayerProps?.grade_counts?.["A+"] ?? "—"}</p>
              <p className="mt-1 text-[10px] text-slate-500">V6.3 elite grade</p>
            </div>
          </div>
        </section>

        {activeSport === "ALL" && (
          <section className="mb-10">
            <div className="overflow-hidden rounded-2xl border border-amber-400/25 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.10),transparent_34%),linear-gradient(135deg,rgba(16,185,129,0.05),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_55px_rgba(0,0,0,0.24)] sm:p-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <span className="inline-flex rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                    {editionLabel} • {editionDateRange}
                  </span>
                  <h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">
                    🏆 Best Parlays Across All Sports
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                    RDG scans qualifying NFL, College Football, MLB, and NHL games starting within the next 96 hours.
                    Started games and games outside the four-day window are automatically excluded.
                  </p>
                </div>

                <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-5 py-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                    Eligible Plays
                  </p>
                  <p className="mt-1 text-2xl font-black text-white">{crossSportCandidates.length}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{editionDateRange}</p>
                </div>
              </div>
            </div>

            {crossSportCandidates.length === 0 ? (
              <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-6">
                <p className="font-bold">No qualifying cross-sport plays in this edition.</p>
                <p className="mt-2 text-sm text-slate-500">RDG will not force weaker legs just to create a parlay.</p>
              </div>
            ) : (
              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                {[
                  ["BEST 2-LEG", "Strongest cross-sport combination", crossSportBest, 2],
                  ["BALANCED 3-LEG", "Diversified across qualifying sports", crossSportThree, 3],
                  ["4-LEG PARLAY", "Wider edition model mix", crossSportFour, 4],
                  ["5-LEG • HIGHER RISK", "Extended edition model mix", crossSportFive, 5],
                ].map(([title, subtitle, picks, required]) => {
                  const selections = picks as CrossSportCandidate[];
                  const needed = required as number;
                  const qualified = selections.length >= needed;

                  return (
                    <article
                      key={title as string}
                      className={
                        title === "BEST 2-LEG"
                          ? "rounded-2xl border-2 border-amber-400/60 bg-amber-400/[0.07] p-6 shadow-[0_0_32px_rgba(251,191,36,0.10)]"
                          : "rounded-2xl border border-white/10 bg-white/[0.035] p-6"
                      }
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">{subtitle as string}</p>
                          <h3 className="mt-2 text-xl font-black">{title as string}</h3>
                        </div>
                        <span className={qualified ? "rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400" : "rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-400"}>
                          {qualified ? "QUALIFIED" : "NOT ENOUGH LEGS"}
                        </span>
                      </div>

                      <div className="mt-6 space-y-3">
                        {selections.map((pick, index) => (
                          <div key={pick.id} className="rounded-xl border border-white/10 bg-black/25 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black text-emerald-300">
                                {pick.sport}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                LEG {index + 1}
                              </span>
                            </div>
                            <p className="mt-3 text-lg font-black text-white">{pick.display_bet}</p>
                            <p className="mt-1 text-xs text-slate-500">{pick.matchup}</p>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="text-slate-400">{pick.detail}</span>
                              <span className="font-bold text-emerald-400">
                                {pick.odds ? `${Number(pick.odds) > 0 ? "+" : ""}${pick.odds}` : "Odds —"}
                              </span>
                            </div>
                            <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-600">
                              {new Intl.DateTimeFormat("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              }).format(new Date(pick.start_time))}
                            </p>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-slate-400">
              The Monday/Thursday builder ranks existing RDG model signals across sports. It does not guarantee wins and will leave cards incomplete when there are not enough qualifying independent events.
            </div>
          </section>
        )}

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
        {activeSport === "NBA" && (
          <section className="mb-10 overflow-hidden rounded-2xl border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.07),rgba(255,255,255,0.015))] p-6 shadow-[0_18px_55px_rgba(0,0,0,0.22)] sm:p-8">
            <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
              RDG NBA MODEL
            </span>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-white">
              NBA Command Center
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              NBA moneylines, spreads, totals, and player props will be added here as the RDG NBA models and odds pipeline are built and validated.
            </p>
            <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
              <p className="text-sm font-black text-amber-300">NBA MODEL BUILD IN PROGRESS</p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                NBA selections will not enter Best Parlays Across All Sports until the underlying markets have been tested and meet RDG qualification standards.
              </p>
            </div>

            <div className="mt-8">
              <p className="text-xs font-black uppercase tracking-[0.20em] text-emerald-400">
                NBA TEAMS
              </p>
              <h3 className="mt-2 text-2xl font-black text-white">All 30 Teams</h3>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {[
                  ["ATL", "Atlanta Hawks"], ["BOS", "Boston Celtics"], ["BKN", "Brooklyn Nets"],
                  ["CHA", "Charlotte Hornets"], ["CHI", "Chicago Bulls"], ["CLE", "Cleveland Cavaliers"],
                  ["DAL", "Dallas Mavericks"], ["DEN", "Denver Nuggets"], ["DET", "Detroit Pistons"],
                  ["GS", "Golden State Warriors"], ["HOU", "Houston Rockets"], ["IND", "Indiana Pacers"],
                  ["LAC", "LA Clippers"], ["LAL", "Los Angeles Lakers"], ["MEM", "Memphis Grizzlies"],
                  ["MIA", "Miami Heat"], ["MIL", "Milwaukee Bucks"], ["MIN", "Minnesota Timberwolves"],
                  ["NO", "New Orleans Pelicans"], ["NY", "New York Knicks"], ["OKC", "Oklahoma City Thunder"],
                  ["ORL", "Orlando Magic"], ["PHI", "Philadelphia 76ers"], ["PHX", "Phoenix Suns"],
                  ["POR", "Portland Trail Blazers"], ["SAC", "Sacramento Kings"], ["SA", "San Antonio Spurs"],
                  ["TOR", "Toronto Raptors"], ["UTA", "Utah Jazz"], ["WSH", "Washington Wizards"],
                ].map(([code, team]) => (
                  <div
                    key={team}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"
                  >
                    <img
                      src={`https://a.espncdn.com/i/teamlogos/nba/500/${code.toLowerCase()}.png`}
                      alt={`${team} logo`}
                      className="h-10 w-10 shrink-0 object-contain"
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-white">{team}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-slate-500">{code}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
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
                <div className="flex items-center gap-2 font-bold">
                  <TeamLogo sport="CFB" team={game.away_team} />
                  <span>{game.away_team}</span>
                  <span className="text-slate-500">@</span>
                  <TeamLogo sport="CFB" team={game.home_team} />
                  <span>{game.home_team}</span>
                </div>

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
                  Built from qualified NFL spreads, moneylines, and V6.2 player props across passing, rushing, receiving, receptions, and touchdowns.
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
  const qualified = candidates.length >= required;
  const [expandedPicks, setExpandedPicks] = useState<Set<string>>(new Set());

  function toggleWhy(key: string) {
    setExpandedPicks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <article
      className={
        featured
          ? "overflow-hidden rounded-2xl border border-emerald-400/40 bg-[#0c1513] shadow-[0_18px_50px_rgba(0,0,0,0.24)] lg:col-span-2"
          : "overflow-hidden rounded-2xl border border-white/10 bg-[#0d1317]"
      }
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            {subtitle}
          </p>
          <h3 className="mt-1 text-xl font-black text-white">{title}</h3>
        </div>

        <span
          className={
            qualified
              ? "rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-400"
              : "rounded-full bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-400"
          }
        >
          {qualified ? "READY" : `${candidates.length}/${required} LEGS`}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="p-5">
          <div className="rounded-xl border border-dashed border-white/10 p-5 text-center">
            <p className="font-bold text-slate-300">No qualifying picks right now</p>
            <p className="mt-1 text-xs text-slate-500">
              RDG will wait for a better betting opportunity.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          {candidates.map((candidate, index) => {
            const isProp = candidate.market_type === "passing_prop";
            const isMoneyline = candidate.market_type === "moneyline";
            const marketLabel = isProp
              ? candidate.prop_market || "PLAYER PROP"
              : isMoneyline
                ? "MONEYLINE"
                : "SPREAD";

            const oddsText = candidate.odds
              ? `${Number(candidate.odds) > 0 ? "+" : ""}${candidate.odds}`
              : "—";

            return (
              <div key={`${candidate.event_id}-${index}`} className="px-5 py-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-black text-slate-300">
                    {index + 1}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isProp && <TeamLogo sport="NFL" team={candidate.team} />}
                      <span
                        className={
                          isProp
                            ? "text-[10px] font-black uppercase tracking-wider text-cyan-400"
                            : "text-[10px] font-black uppercase tracking-wider text-sky-400"
                        }
                      >
                        {marketLabel}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-xl font-black text-white">{candidate.display_bet}</p>
                      <span className="text-base font-bold text-emerald-400">{oddsText}</span>
                    </div>

                    <p className="mt-1 text-xs text-slate-500">{candidate.matchup}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {isProp ? (
                        <>
                          <span className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-slate-400">
                            RDG projection{" "}
                            <strong className="ml-1 text-white">
                              {candidate.projected_margin.toFixed(1)}
                            </strong>
                          </span>
                          {(candidate.grade || candidate.review) && (
                            <span className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-slate-400">
                              Grade{" "}
                              <strong className="ml-1 text-white">
                                {candidate.grade || candidate.review}
                              </strong>
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-slate-400">
                          RDG projects{" "}
                          <strong className="ml-1 text-white">
                            {candidate.projected_winner} by {candidate.projected_margin.toFixed(1)}
                          </strong>
                        </span>
                      )}

                      {!isMoneyline && (
                        <span className="rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-400">
                          +{candidate.difference.toFixed(1)} edge
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleWhy(`${candidate.event_id}-${index}`)}
                      className="mt-4 flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-xs font-bold text-slate-300 transition hover:border-emerald-400/30 hover:text-white"
                    >
                      <span>Why RDG selected this pick</span>
                      <span className="text-emerald-400">
                        {expandedPicks.has(`${candidate.event_id}-${index}`) ? "−" : "+"}
                      </span>
                    </button>

                    {expandedPicks.has(`${candidate.event_id}-${index}`) && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
                            PROS
                          </p>
                          <div className="mt-2 space-y-2 text-xs text-slate-300">
                            {isProp ? (
                              candidate.research?.pros?.length ? (
                                candidate.research.pros.map((reason, reasonIndex) => (
                                  <p key={`pro-${reasonIndex}`}>• {reason}</p>
                                ))
                              ) : (
                                <p>• Detailed player and matchup research is loading for this pick.</p>
                              )
                            ) : isMoneyline ? (
                              <>
                                <p>• RDG projects <strong className="text-white">{candidate.projected_winner}</strong> by {candidate.projected_margin.toFixed(1)}</p>
                                <p>• Historical bucket: <strong className="text-white">{candidate.historical_accuracy.toFixed(1)}%</strong> ({candidate.historical_correct}/{candidate.historical_sample})</p>
                                <p>• Current price: <strong className="text-white">{oddsText}</strong></p>
                              </>
                            ) : (
                              <>
                                <p>• Model/market difference: <strong className="text-white">{candidate.difference.toFixed(1)} pts</strong></p>
                                <p>• RDG projects <strong className="text-white">{candidate.projected_winner}</strong> by {candidate.projected_margin.toFixed(1)}</p>
                                <p>• Historical bucket: <strong className="text-white">{candidate.historical_accuracy.toFixed(1)}%</strong></p>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-400">
                            CONS
                          </p>
                          <div className="mt-2 space-y-2 text-xs text-slate-300">
                            {isProp ? (
                              candidate.research?.cons?.length ? (
                                candidate.research.cons.map((reason, reasonIndex) => (
                                  <p key={`con-${reasonIndex}`}>• {reason}</p>
                                ))
                              ) : (
                                <p>• No specific statistical counter-signal was strong enough to display.</p>
                              )
                            ) : isMoneyline ? (
                              <>
                                <p>• Historical bucket results do not predict this individual game.</p>
                                <p>• Moneyline value can change as sportsbook odds move.</p>
                                <p>• Upsets remain possible even when RDG projects the winner.</p>
                              </>
                            ) : (
                              <>
                                <p>• The spread can move before kickoff and change the value of the pick.</p>
                                <p>• Model/market difference is not the probability the wager wins.</p>
                                <p>• Game script and late availability news can change the matchup.</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-white/10 bg-black/10 px-5 py-4">
        {qualified ? (
          <p className="text-xs text-slate-400">
            <span className="font-bold text-emerald-400">{required}-leg card ready.</span>{" "}
            Built from the current qualifying NFL plays.
          </p>
        ) : (
          <p className="text-xs text-amber-400">
            Only {candidates.length} of {required} legs qualify right now. No picks were forced.
          </p>
        )}
      </div>
    </article>
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
        <div className="mt-6 space-y-3">{candidates.map((c, i) => <div key={c.event_id} className="rounded-lg border border-white/10 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase text-slate-500">{required > 1 ? `LEG ${i + 1}` : c.signal}</p><div className="mt-1 flex justify-between gap-4"><div><div className="flex items-center gap-2"><TeamLogo sport="CFB" team={c.team} /><p className="text-lg font-bold">{c.display_bet}</p></div><p className="mt-1 text-xs text-slate-500">{c.matchup}</p></div><div className="text-right"><p className="font-bold text-green-400">{c.edge.toFixed(1)} pts</p><p className="text-[10px] uppercase text-slate-500">Model vs Market</p></div></div><p className="mt-3 text-xs text-slate-500">{c.sample_status} • Hard Rock {c.odds || "—"}</p></div>)}</div>
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
  const [expandedPicks, setExpandedPicks] = useState<Set<string>>(new Set());

  function toggleWhy(key: string) {
    setExpandedPicks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <article
      className={
        featured
          ? "overflow-hidden rounded-2xl border border-emerald-400/40 bg-[#0c1513] shadow-[0_18px_50px_rgba(0,0,0,0.24)] lg:col-span-2"
          : "overflow-hidden rounded-2xl border border-white/10 bg-[#0d1317]"
      }
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            {subtitle}
          </p>
          <h3 className="mt-1 text-xl font-black text-white">{title}</h3>
        </div>

        <span
          className={
            qualified
              ? "rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-400"
              : "rounded-full bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-400"
          }
        >
          {qualified ? "READY" : `${candidates.length}/${required} LEGS`}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="p-5">
          <div className="rounded-xl border border-dashed border-white/10 p-5 text-center">
            <p className="font-bold text-slate-300">No qualifying picks right now</p>
            <p className="mt-1 text-xs text-slate-500">
              RDG will wait for a better betting opportunity.
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          {candidates.map((candidate, index) => {
            const isTotal = candidate.market_type === "total";
            const model = candidate.model_probability;
            const market = candidate.market_probability;
            const detail =
              isTotal && candidate.projected_total !== null && candidate.projected_total !== undefined
                ? `RDG projects ${candidate.projected_total.toFixed(1)} total runs`
                : candidate.starter
                  ? `Starter: ${candidate.starter}`
                  : candidate.matchup;

            return (
              <div
                key={`${candidate.event_id}-${candidate.team}-${index}`}
                className="px-5 py-5"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-black text-slate-300">
                    {index + 1}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {candidate.market_type === "moneyline" && (
                        <TeamLogo sport="MLB" team={candidate.team} />
                      )}
                      <span className="text-[10px] font-black uppercase tracking-wider text-sky-400">
                        {isTotal ? "GAME TOTAL" : "MONEYLINE"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-xl font-black text-white">
                        {isTotal ? `${candidate.display_bet} Runs` : candidate.display_bet}
                      </p>
                      {candidate.odds && (
                        <span className="text-base font-bold text-emerald-400">
                          {candidate.odds}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-slate-500">{candidate.matchup}</p>
                    <p className="mt-2 text-xs text-slate-400">{detail}</p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-slate-400">
                        RDG <strong className="ml-1 text-white">{model.toFixed(1)}%</strong>
                      </span>
                      {market !== null && (
                        <span className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-slate-400">
                          Market <strong className="ml-1 text-white">{market.toFixed(1)}%</strong>
                        </span>
                      )}
                      <span className="rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-400">
                        +{candidate.edge.toFixed(1)}% edge
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleWhy(`${candidate.event_id}-${candidate.team}-${index}`)}
                      className="mt-4 flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-xs font-bold text-slate-300 transition hover:border-emerald-400/30 hover:text-white"
                    >
                      <span>Why RDG selected this pick</span>
                      <span className="text-emerald-400">
                        {expandedPicks.has(`${candidate.event_id}-${candidate.team}-${index}`) ? "−" : "+"}
                      </span>
                    </button>

                    {expandedPicks.has(`${candidate.event_id}-${candidate.team}-${index}`) && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">PROS</p>
                          <div className="mt-2 space-y-2 text-xs text-slate-300">
                            {isTotal ? (
                              <>
                                <p>• RDG projects <strong className="text-white">{candidate.projected_total?.toFixed(2) ?? "—"} runs</strong> compared with the sportsbook line.</p>
                                <p>• Model/market edge: <strong className="text-white">{candidate.edge.toFixed(1)}%</strong></p>
                                {market !== null && <p>• Market baseline: <strong className="text-white">{market.toFixed(1)}%</strong></p>}
                              </>
                            ) : (
                              <>
                                <p>• RDG model: <strong className="text-white">{model.toFixed(1)}%</strong></p>
                                {market !== null && <p>• Market baseline: <strong className="text-white">{market.toFixed(1)}%</strong></p>}
                                <p>• Model/market edge: <strong className="text-white">{candidate.edge.toFixed(1)}%</strong></p>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-400">CONS</p>
                          <div className="mt-2 space-y-2 text-xs text-slate-300">
                            {isTotal ? (
                              <>
                                <p>• Game totals can change quickly with pitching, weather, and lineup news.</p>
                                <p>• The total model is still experimental.</p>
                                <p>• Model edge does not guarantee the wager will win.</p>
                              </>
                            ) : (
                              <>
                                <p>• Starting pitcher and lineup changes can materially change the matchup.</p>
                                <p>• Sportsbook prices can move before first pitch.</p>
                                <p>• Model probability is an estimate, not a guaranteed outcome.</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-white/10 bg-black/10 px-5 py-4">
        {qualified ? (
          <p className="text-xs text-slate-400">
            <span className="font-bold text-emerald-400">{required}-leg parlay ready.</span>{" "}
            RDG selected these from the current qualifying plays.
          </p>
        ) : (
          <p className="text-xs text-amber-400">
            Only {candidates.length} of {required} legs qualify right now. No picks were forced.
          </p>
        )}
      </div>
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
