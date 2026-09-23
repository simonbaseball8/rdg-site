import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 900;

const CACHE_SECONDS = 900;

const CURRENT_SEASON = 2026;
const PRIOR_SEASON = 2025;

const CURRENT_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${CURRENT_SEASON}.csv`;

const PRIOR_STATS_URL =
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${PRIOR_SEASON}.csv`;

type Row = Record<string, string>;

type PlayerGame = {
  season: number;
  week: number;
  player_id: string;
  player_name: string;
  team: string;
  attempts: number;
  completions: number;
  yards: number;
};

type PlayerHistory = {
  player_name: string;
  player_id: string;
  current: PlayerGame[];
  prior: PlayerGame[];
};

type SportsbookLine = {
  sportsbook: string;
  side: string | null;
  line: number;
  odds: string | number | null;
  available: boolean;
  updated_at: string | null;
};

type CalibrationPoint = {
  difference: number;
  over: number;
  under: number;
};

/*
  Frozen 2025 out-of-sample V2 residual calibration.

  These are MODEL-IMPLIED probabilities.

  They are NOT historical sportsbook betting win rates.
*/
const CALIBRATION: CalibrationPoint[] = [
  { difference: -50, over: 21.1, under: 78.9 },
  { difference: -40, over: 25.7, under: 74.3 },
  { difference: -30, over: 31.1, under: 68.9 },
  { difference: -25, over: 33.8, under: 66.2 },
  { difference: -20, over: 36.0, under: 64.0 },
  { difference: -15, over: 40.4, under: 59.6 },
  { difference: -10, over: 42.4, under: 57.6 },
  { difference: -5, over: 45.1, under: 54.9 },
  { difference: 0, over: 47.4, under: 52.6 },
  { difference: 5, over: 50.5, under: 49.5 },
  { difference: 10, over: 52.8, under: 47.2 },
  { difference: 15, over: 55.1, under: 44.9 },
  { difference: 20, over: 58.4, under: 41.6 },
  { difference: 25, over: 60.2, under: 39.8 },
  { difference: 30, over: 61.9, under: 38.1 },
  { difference: 40, over: 66.9, under: 33.1 },
  { difference: 50, over: 71.0, under: 29.0 },
];

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(
  value: number,
  digits = 1
): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(
  values: number[]
): number | null {
  if (!values.length) return null;

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function weightedAverage(
  values: Array<{
    value: number;
    weight: number;
  }>
): number | null {
  const valid = values.filter(
    (item) =>
      Number.isFinite(item.value) &&
      Number.isFinite(item.weight) &&
      item.weight > 0
  );

  if (!valid.length) return null;

  const totalWeight =
    valid.reduce(
      (sum, item) =>
        sum + item.weight,
      0
    );

  if (!totalWeight) return null;

  return (
    valid.reduce(
      (sum, item) =>
        sum +
        item.value *
          item.weight,
      0
    ) / totalWeight
  );
}

function normalizeName(
  name: string
): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(
      /\b(jr|sr|ii|iii|iv)\b/g,
      ""
    )
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

function playerNameFromId(
  playerID: string
): string {
  return String(playerID ?? "")
    .replace(
      /_\d+_NFL$/i,
      ""
    )
    .split("_")
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1).toLowerCase()
    )
    .join(" ");
}

function parseCSVLine(
  line: string
): string[] {
  const result: string[] = [];

  let current = "";
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char = line[i];

    if (char === '"') {
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (
      char === "," &&
      !quoted
    ) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result;
}

function parseCSV(
  text: string
): Row[] {
  const lines =
    text
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim().length > 0
      );

  if (!lines.length) {
    return [];
  }

  const headers =
    parseCSVLine(lines[0]);

  return lines
    .slice(1)
    .map((line) => {
      const values =
        parseCSVLine(line);

      const row: Row = {};

      headers.forEach(
        (header, index) => {
          row[header] =
            values[index] ?? "";
        }
      );

      return row;
    });
}

async function fetchCSV(
  url: string
): Promise<Row[]> {
  const response =
    await fetch(url, {
      next: { revalidate: 3600 },
    });

  if (!response.ok) {
    throw new Error(
      `nflverse returned ${response.status} for ${url}`
    );
  }

  return parseCSV(
    await response.text()
  );
}

function passingGames(
  rows: Row[],
  season: number
): PlayerGame[] {
  return rows
    .filter(
      (row) =>
        num(row.season) ===
          season &&
        String(
          row.season_type
        ).toUpperCase() ===
          "REG" &&
        String(
          row.position
        ).toUpperCase() ===
          "QB" &&
        num(row.attempts) >= 10
    )
    .map((row) => ({
      season,

      week:
        num(row.week),

      player_id:
        row.player_id ?? "",

      player_name:
        row.player_display_name ||
        row.player_name ||
        "",

      team:
        row.recent_team ||
        row.team ||
        "",

      attempts:
        num(row.attempts),

      completions:
        num(row.completions),

      yards:
        num(row.passing_yards),
    }))
    .sort(
      (a, b) =>
        a.season -
          b.season ||
        a.week -
          b.week
    );
}

function buildPlayerHistory(
  currentGames: PlayerGame[],
  priorGames: PlayerGame[]
): Map<
  string,
  PlayerHistory
> {
  const map =
    new Map<
      string,
      PlayerHistory
    >();

  for (
    const game
    of [
      ...priorGames,
      ...currentGames,
    ]
  ) {
    const key =
      normalizeName(
        game.player_name
      );

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        player_name:
          game.player_name,

        player_id:
          game.player_id,

        current: [],

        prior: [],
      });
    }

    const player =
      map.get(key)!;

    if (
      game.season ===
      CURRENT_SEASON
    ) {
      player.current.push(
        game
      );
    } else {
      player.prior.push(
        game
      );
    }
  }

  for (
    const player
    of map.values()
  ) {
    player.current.sort(
      (a, b) =>
        a.week - b.week
    );

    player.prior.sort(
      (a, b) =>
        a.week - b.week
    );
  }

  return map;
}

function yardsPerAttempt(
  game: PlayerGame
): number {
  if (
    game.attempts <= 0
  ) {
    return 0;
  }

  return (
    game.yards /
    game.attempts
  );
}

function recencyWeighted(
  games: PlayerGame[],
  selector: (
    game: PlayerGame
  ) => number,
  maxGames = 8
): number | null {
  const selected =
    games.slice(
      -maxGames
    );

  if (!selected.length) {
    return null;
  }

  return weightedAverage(
    selected.map(
      (game, index) => ({
        value:
          selector(game),

        weight:
          index + 1,
      })
    )
  );
}

/*
  FROZEN RDG V2 PASSING MODEL
*/
function projectPassingYardsV2(
  player: PlayerHistory
) {
  const history:
    PlayerGame[] = [
      ...player.prior,
      ...player.current,
    ].sort(
      (a, b) =>
        a.season -
          b.season ||
        a.week -
          b.week
    );

  if (
    history.length < 3
  ) {
    return null;
  }

  const current =
    player.current;

  const prior =
    player.prior.slice(
      -17
    );

  const careerWindow =
    history.slice(-20);

  const priorAttempts =
    average(
      prior.map(
        (game) =>
          game.attempts
      )
    );

  const currentAttempts =
    average(
      current.map(
        (game) =>
          game.attempts
      )
    );

  const recentAttempts =
    recencyWeighted(
      careerWindow,
      (game) =>
        game.attempts,
      8
    );

  let currentWeight = 0;

  if (
    current.length === 1
  ) {
    currentWeight = 0.15;
  } else if (
    current.length === 2
  ) {
    currentWeight = 0.25;
  } else if (
    current.length === 3
  ) {
    currentWeight = 0.35;
  } else if (
    current.length === 4
  ) {
    currentWeight = 0.45;
  } else if (
    current.length >= 5
  ) {
    currentWeight = 0.55;
  }

  let expectedAttempts:
    number | null = null;

  if (
    priorAttempts !== null &&
    currentAttempts !== null
  ) {
    expectedAttempts =
      priorAttempts *
        (1 -
          currentWeight) +
      currentAttempts *
        currentWeight;
  } else {
    expectedAttempts =
      currentAttempts ??
      priorAttempts ??
      recentAttempts;
  }

  if (
    expectedAttempts !==
      null &&
    recentAttempts !== null
  ) {
    expectedAttempts =
      expectedAttempts *
        0.8 +
      recentAttempts *
        0.2;
  }

  const priorYPA =
    average(
      prior.map(
        yardsPerAttempt
      )
    );

  const currentYPA =
    average(
      current.map(
        yardsPerAttempt
      )
    );

  const recentYPA =
    recencyWeighted(
      careerWindow,
      yardsPerAttempt,
      8
    );

  let efficiencyWeight =
    0;

  if (
    current.length === 1
  ) {
    efficiencyWeight =
      0.1;
  } else if (
    current.length === 2
  ) {
    efficiencyWeight =
      0.18;
  } else if (
    current.length === 3
  ) {
    efficiencyWeight =
      0.25;
  } else if (
    current.length === 4
  ) {
    efficiencyWeight =
      0.32;
  } else if (
    current.length >= 5
  ) {
    efficiencyWeight =
      0.4;
  }

  let expectedYPA:
    number | null = null;

  if (
    priorYPA !== null &&
    currentYPA !== null
  ) {
    expectedYPA =
      priorYPA *
        (1 -
          efficiencyWeight) +
      currentYPA *
        efficiencyWeight;
  } else {
    expectedYPA =
      currentYPA ??
      priorYPA ??
      recentYPA;
  }

  if (
    expectedYPA !== null &&
    recentYPA !== null
  ) {
    expectedYPA =
      expectedYPA *
        0.85 +
      recentYPA *
        0.15;
  }

  if (
    expectedAttempts ===
      null ||
    expectedYPA === null
  ) {
    return null;
  }

  expectedAttempts =
    Math.min(
      45,
      Math.max(
        20,
        expectedAttempts
      )
    );

  expectedYPA =
    Math.min(
      9.5,
      Math.max(
        5,
        expectedYPA
      )
    );

  let projection =
    expectedAttempts *
    expectedYPA;

  const totalHistory =
    history.length;

  if (
    totalHistory <= 5
  ) {
    projection =
      projection *
        0.65 +
      225 * 0.35;
  } else if (
    totalHistory <= 10
  ) {
    projection =
      projection *
        0.8 +
      225 * 0.2;
  }

  return {
    projection:
      round(
        projection,
        1
      ),

    expected_attempts:
      round(
        expectedAttempts,
        1
      ),

    expected_yards_per_attempt:
      round(
        expectedYPA,
        2
      ),

    current_games:
      current.length,

    prior_games:
      prior.length,

    total_history_games:
      totalHistory,

    current_season_yards_average:
      current.length
        ? round(
            average(
              current.map(
                (game) =>
                  game.yards
              )
            ) ?? 0,
            1
          )
        : null,

    prior_season_yards_average:
      prior.length
        ? round(
            average(
              prior.map(
                (game) =>
                  game.yards
              )
            ) ?? 0,
            1
          )
        : null,
  };
}


function calibratedProbability(
  difference: number,
  side:
    | "OVER"
    | "UNDER"
): number {
  const field =
    side === "OVER"
      ? "over"
      : "under";

  if (
    difference <=
    CALIBRATION[0]
      .difference
  ) {
    return CALIBRATION[0][
      field
    ];
  }

  const last =
    CALIBRATION[
      CALIBRATION.length -
        1
    ];

  if (
    difference >=
    last.difference
  ) {
    return last[field];
  }

  for (
    let i = 0;
    i <
    CALIBRATION.length -
      1;
    i++
  ) {
    const lower =
      CALIBRATION[i];

    const upper =
      CALIBRATION[
        i + 1
      ];

    if (
      difference >=
        lower.difference &&
      difference <=
        upper.difference
    ) {
      const range =
        upper.difference -
        lower.difference;

      const position =
        (
          difference -
          lower.difference
        ) / range;

      const probability =
        lower[field] +
        (
          upper[field] -
          lower[field]
        ) *
          position;

      return round(
        probability,
        2
      );
    }
  }

  return 50;
}



const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const ODDS_API_SPORT = "americanfootball_nfl";
const NFL_PROP_MARKETS = [
  "player_pass_yds","player_pass_tds","player_pass_completions",
  "player_pass_attempts","player_pass_interceptions","player_rush_yds",
  "player_rush_attempts","player_reception_yds","player_receptions",
  "player_anytime_td"
] as const;

type OddsEvent = { id:string; commence_time?:string; home_team?:string; away_team?:string };

async function oddsFetch(url:string,key:string,revalidate=CACHE_SECONDS){
  const r=await fetch(`${url}${url.includes("?")?"&":"?"}apiKey=${encodeURIComponent(key)}`,{next:{revalidate}});
  const usage={
    used:Number(r.headers.get("x-requests-used"))||null,
    remaining:Number(r.headers.get("x-requests-remaining"))||null,
    last:Number(r.headers.get("x-requests-last"))||null
  };
  if(!r.ok) throw new Error(`The Odds API returned ${r.status}: ${await r.text()}`);
  return {data:await r.json(),usage};
}

function oddsLines(data:any,marketKey:string,playerName:string):SportsbookLine[]{
  const out:SportsbookLine[]=[]; const target=normalizeName(playerName);
  for(const book of (Array.isArray(data?.bookmakers)?data.bookmakers:[])){
    for(const market of (Array.isArray(book?.markets)?book.markets:[])){
      if(String(market?.key??"")!==marketKey) continue;
      for(const o of (Array.isArray(market?.outcomes)?market.outcomes:[])){
        if(normalizeName(String(o?.description??""))!==target) continue;
        const side=String(o?.name??"").toUpperCase();
        const line=Number(o?.point);
        if((side!=="OVER"&&side!=="UNDER")||!Number.isFinite(line)) continue;
        out.push({sportsbook:String(book?.title??book?.key??"Unknown"),side,line,odds:o?.price??null,available:true,updated_at:market?.last_update??null});
      }
    }
  }
  return out;
}

function marketPlayers(data:any,marketKey:string){
  const m=new Map<string,string>();
  for(const book of (Array.isArray(data?.bookmakers)?data.bookmakers:[]))
    for(const market of (Array.isArray(book?.markets)?book.markets:[])){
      if(String(market?.key??"")!==marketKey) continue;
      for(const o of (Array.isArray(market?.outcomes)?market.outcomes:[])){
        const n=String(o?.description??"").trim(), k=normalizeName(n);
        if(k&&n)m.set(k,n);
      }
    }
  return [...m.values()];
}

function rawMarkets(data:any,event:OddsEvent){
  const out:any[]=[];
  for(const book of (Array.isArray(data?.bookmakers)?data.bookmakers:[]))
    for(const market of (Array.isArray(book?.markets)?book.markets:[])){
      const mk=String(market?.key??"");
      if(!NFL_PROP_MARKETS.includes(mk as any))continue;
      for(const o of (Array.isArray(market?.outcomes)?market.outcomes:[]))
        out.push({event_id:event.id,start_time:event.commence_time??null,matchup:{away:event.away_team??null,home:event.home_team??null},market_key:mk,sportsbook:String(book?.title??book?.key??"Unknown"),sportsbook_key:String(book?.key??""),player_name:String(o?.description??"").trim()||null,selection:String(o?.name??"").toUpperCase()||null,line:Number.isFinite(Number(o?.point))?Number(o.point):null,odds:o?.price??null,updated_at:market?.last_update??null});
    }
  return out;
}

function consensusLine(lines:SportsbookLine[]){
  const vals=[...new Map(lines.filter(x=>x.available).map(x=>[`${x.sportsbook}|${x.line}`,x.line])).values()];
  if(!vals.length)return null;
  const counts=new Map<number,number>(); vals.forEach(v=>counts.set(v,(counts.get(v)??0)+1));
  const sorted=[...vals].sort((x,y)=>x-y), mid=Math.floor(sorted.length/2);
  const median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||Math.abs(a[0]-median)-Math.abs(b[0]-median))[0][0];
}

function implied(odds:string|number|null){
  const n=Number(odds); if(!Number.isFinite(n)||n===0)return null;
  return n>0?100/(n+100):Math.abs(n)/(Math.abs(n)+100);
}

function noVig(lines:SportsbookLine[],line:number,side:"OVER"|"UNDER"){
  const books=new Map<string,{over?:SportsbookLine;under?:SportsbookLine}>();
  for(const x of lines){
    if(!x.available||x.line!==line)continue;
    const k=String(x.side??"").toUpperCase(); if(k!=="OVER"&&k!=="UNDER")continue;
    if(!books.has(x.sportsbook))books.set(x.sportsbook,{});
    if(k==="OVER")books.get(x.sportsbook)!.over=x; else books.get(x.sportsbook)!.under=x;
  }
  const probs:number[]=[], paired:any[]=[];
  for(const [sportsbook,p] of books){
    if(!p.over||!p.under)continue;
    const a=implied(p.over.odds),b=implied(p.under.odds); if(a===null||b===null||a+b<=0)continue;
    const ov=a/(a+b),un=b/(a+b); probs.push(side==="OVER"?ov:un);
    paired.push({sportsbook,line,over_odds:p.over.odds,under_odds:p.under.odds,over_no_vig_probability:round(ov*100,2),under_no_vig_probability:round(un*100,2)});
  }
  return {probability:probs.length?round(probs.reduce((a,b)=>a+b,0)/probs.length*100,2):null,paired_books:paired};
}



export async function GET(){
  const apiKey=process.env.ODDS_API_KEY;
  if(!apiKey)return NextResponse.json({success:false,error:"ODDS_API_KEY is missing."},{status:500});
  try{
    const [currentRows,priorRows,eventRes]=await Promise.all([
      fetchCSV(CURRENT_STATS_URL),fetchCSV(PRIOR_STATS_URL),
      oddsFetch(`${ODDS_API_BASE}/sports/${ODDS_API_SPORT}/events?dateFormat=iso`,apiKey,900)
    ]);
    const events:(OddsEvent[])=(Array.isArray(eventRes.data)?eventRes.data:[])
      .filter((e:OddsEvent)=>{const t=new Date(String(e.commence_time??"")).getTime();return Number.isFinite(t)&&t>Date.now();})
      .sort((a:OddsEvent,b:OddsEvent)=>new Date(String(a.commence_time)).getTime()-new Date(String(b.commence_time)).getTime());

    const markets=NFL_PROP_MARKETS.join(",");
    const results=await Promise.all(events.map(async event=>{
      try{
        const r=await oddsFetch(`${ODDS_API_BASE}/sports/${ODDS_API_SPORT}/events/${encodeURIComponent(event.id)}/odds?regions=us&markets=${encodeURIComponent(markets)}&oddsFormat=american&dateFormat=iso`,apiKey);
        return {event,data:r.data,usage:r.usage,error:null};
      }catch(e){return {event,data:null,usage:null,error:e instanceof Error?e.message:"Unknown provider error"};}
    }));

    const currentGames=passingGames(currentRows,CURRENT_SEASON),priorGames=passingGames(priorRows,PRIOR_SEASON);
    const history=buildPlayerHistory(currentGames,priorGames);
    const props:any[]=[],all_market_rows:any[]=[]; const marketCounts:Record<string,number>={};
    let matched=0,unmatched=0,passingEvents=0,errors=0;

    for(const r of results){
      if(r.error||!r.data){errors++;continue;}
      for(const row of rawMarkets(r.data,r.event)){all_market_rows.push(row);marketCounts[row.market_key]=(marketCounts[row.market_key]??0)+1;}
      const players=marketPlayers(r.data,"player_pass_yds"); if(players.length)passingEvents++;
      for(const providerName of players){
        const player=history.get(normalizeName(providerName)); if(!player){unmatched++;continue;}
        const projection=projectPassingYardsV2(player); if(!projection)continue;
        const lines=oddsLines(r.data,"player_pass_yds",providerName); if(!lines.length)continue;
        const line=consensusLine(lines); if(line===null)continue; matched++;
        const diff=projection.projection-line,side:"OVER"|"UNDER"=diff>=0?"OVER":"UNDER";
        const modelProb=calibratedProbability(diff,side),market=noVig(lines,line,side);
        const edge=market.probability!==null?round(modelProb-market.probability,2):null,abs=Math.abs(diff);
        let review="PASS";
        if(edge!==null&&edge>=8&&abs>=20)review="STRONG REVIEW";
        else if(edge!==null&&edge>=5&&abs>=12)review="REVIEW";
        else if(edge!==null&&edge>=2&&abs>=8)review="WATCH";
        else if(market.probability===null&&abs>=20)review="REVIEW";
        else if(market.probability===null&&abs>=10)review="WATCH";
        if(projection.total_history_games<11&&review==="STRONG REVIEW")review="REVIEW";
        if(projection.total_history_games<6&&review==="REVIEW")review="WATCH";
        props.push({event_id:r.event.id,start_time:r.event.commence_time??null,matchup:{away:r.event.away_team??null,home:r.event.home_team??null},player_id:player.player_id||null,player_name:player.player_name||providerName,market:"PASSING YARDS",provider_market:"player_pass_yds",selection:side,market_line:round(line,1),rdg_projection:projection.projection,model_vs_line_yards:round(diff,1),model_probability:modelProb,market_no_vig_probability:market.probability,model_vs_market_probability:edge,review,projection_details:projection,paired_market_books:market.paired_books,sportsbook_lines:lines,important:"Passing yards is currently the only market receiving an RDG model recommendation. Other prop markets are collected until their models are validated."});
      }
    }
    props.sort((a,b)=>(b.model_vs_market_probability??-999)-(a.model_vs_market_probability??-999));
    const usage=[...results].reverse().find(x=>x.usage)?.usage??eventRes.usage;
    return NextResponse.json({
      success:true,version:"5.0-rdg-centralized-nfl-player-props-odds-api",sport:"NFL",provider:"The Odds API",
      architecture:{one_route_for_nfl_props:true,requested_markets:NFL_PROP_MARKETS,note:"One route requests multiple prop markets for every upcoming NFL event."},
      model_status:{passing_yards:"Frozen RDG Passing V2 + Historical Residual Calibration",other_markets:"Sportsbook data only until RDG models are validated."},
      api_usage:{credits_used:usage?.used??null,credits_remaining:usage?.remaining??null,last_request_cost:usage?.last??null},
      sportsbook_events_found:events.length,provider_event_errors:errors,market_outcome_counts:marketCounts,raw_player_prop_outcomes:all_market_rows.length,
      passing_yards:{events_with_props:passingEvents,matched_players:matched,unmatched_players:unmatched,qualifying_reviews:props.filter(x=>x.review!=="PASS").length,props},
      props,all_market_rows,updated_at:new Date().toISOString()
    },{headers:{"Cache-Control":"public, s-maxage=900, stale-while-revalidate=1800"}});
  }catch(error){
    return NextResponse.json({success:false,provider:"The Odds API",error:error instanceof Error?error.message:"Unknown centralized NFL player props error"},{status:500});
  }
}
