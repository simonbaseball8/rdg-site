import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "6.0-rushing-v6-role-aware-development";
const MIN_CARRIES = 5;
const MIN_PRIOR_GAMES = 3;

type PlayerGame = {
  season: number;
  week: number;
  gameId: string;
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  carries: number;
  rushYards: number;
};

type History = { games: PlayerGame[] };

function num(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function avg(v: number[]): number {
  return v.length ? v.reduce((a,b)=>a+b,0)/v.length : 0;
}
function clamp(x:number, lo:number, hi:number) {
  return Math.max(lo, Math.min(hi,x));
}
function parseCSV(text:string): Record<string,string>[] {
  const lines=text.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const split=(line:string)=>{
    const out:string[]=[]; let cur=""; let quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c === '"'){
        if(quoted && line[i+1] === '"'){cur+='"';i++;}
        else quoted=!quoted;
      } else if(c==="," && !quoted){out.push(cur);cur="";}
      else cur+=c;
    }
    out.push(cur); return out;
  };
  const headers=split(lines[0]);
  return lines.slice(1).map(line=>{
    const vals=split(line); const row:Record<string,string>={};
    headers.forEach((h,i)=>row[h]=vals[i]??"");
    return row;
  });
}

async function loadSeason(season:number):Promise<PlayerGame[]> {
  const url=`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
  const r=await fetch(url,{
    headers:{"User-Agent":"RDG-Rushing-V6/6.0"},
    next:{revalidate:3600},
  });
  if(!r.ok) throw new Error(`nflverse ${season} failed: ${r.status}`);
  const rows=parseCSV(await r.text());
  const games:PlayerGame[]=[];
  for(const row of rows){
    const seasonType=(row.season_type||"").toUpperCase();
    if(seasonType && seasonType!=="REG") continue;
    const carries=num(row.carries);
    if(carries<MIN_CARRIES) continue;
    const playerId=row.player_id||row.player_display_name||row.player_name||"";
    if(!playerId) continue;
    games.push({
      season,
      week:num(row.week),
      gameId:row.game_id||`${season}-${row.week}-${row.recent_team||row.team}-${playerId}`,
      playerId,
      playerName:row.player_display_name||row.player_name||playerId,
      position:(row.position||row.position_group||"").toUpperCase(),
      team:row.recent_team||row.team||"",
      carries,
      rushYards:num(row.rushing_yards),
    });
  }
  return games.sort((a,b)=>a.week-b.week||a.gameId.localeCompare(b.gameId));
}

function addHistory(map:Map<string,History>, g:PlayerGame){
  const h=map.get(g.playerId)??{games:[]};
  h.games.push(g); map.set(g.playerId,h);
}
function metrics(errors:number[]){
  if(!errors.length) return {n:0,mae:null,rmse:null,mean_error:null};
  return {
    n:errors.length,
    mae:Number(avg(errors.map(Math.abs)).toFixed(2)),
    rmse:Number(Math.sqrt(avg(errors.map(e=>e*e))).toFixed(2)),
    mean_error:Number(avg(errors).toFixed(2)),
  };
}

function projectV5(all:PlayerGame[], position:string){
  const recent=all.slice(-4), lastTwo=all.slice(-2);
  const careerYpg=avg(all.map(g=>g.rushYards));
  const recentYpg=avg(recent.map(g=>g.rushYards));
  const lastTwoYpg=avg(lastTwo.map(g=>g.rushYards));
  const careerCarries=avg(all.map(g=>g.carries));
  const recentCarries=avg(recent.map(g=>g.carries));
  const trend=clamp(careerCarries>0?recentCarries/careerCarries:1,.80,1.20);
  const qb=position==="QB";
  let yards=qb
    ?.80*careerYpg+.15*recentYpg+.05*lastTwoYpg
    :.65*careerYpg+.25*recentYpg+.10*lastTwoYpg;
  yards*=qb?1+.10*(trend-1):1+.20*(trend-1);
  return clamp(yards,careerYpg*(qb?.80:.70),careerYpg*(qb?1.20:1.30));
}

function projectV6(all:PlayerGame[], position:string){
  const qb=position==="QB";
  const recent4=all.slice(-4);
  const last2=all.slice(-2);
  const last1=all.slice(-1);

  const careerYpg=avg(all.map(g=>g.rushYards));
  const recent4Ypg=avg(recent4.map(g=>g.rushYards));
  const last2Ypg=avg(last2.map(g=>g.rushYards));

  if(qb){
    // Keep QB conservative; clean sportsbook test suggested QB was not V5's main problem.
    const careerCarries=avg(all.map(g=>g.carries));
    const recentCarries=avg(recent4.map(g=>g.carries));
    const trend=clamp(careerCarries>0?recentCarries/careerCarries:1,.80,1.20);
    let p=.80*careerYpg+.15*recent4Ypg+.05*last2Ypg;
    p*=1+.10*(trend-1);
    return {
      projection:clamp(p,careerYpg*.80,careerYpg*1.20),
      expectedCarries:null,
      stableYpc:null,
      roleTrend:trend,
    };
  }

  // V6 RB/non-QB: predict workload first, but shrink efficiency heavily.
  // This reacts to role changes without allowing volatile recent YPC to dominate.
  const careerCarries=avg(all.map(g=>g.carries));
  const recent4Carries=avg(recent4.map(g=>g.carries));
  const last2Carries=avg(last2.map(g=>g.carries));
  const last1Carries=avg(last1.map(g=>g.carries));

  const roleTrendRaw=careerCarries>0
    ? (.45*recent4Carries+.35*last2Carries+.20*last1Carries)/careerCarries
    : 1;
  const roleTrend=clamp(roleTrendRaw,.55,1.45);

  // Workload reacts faster than V5, but is still anchored.
  let expectedCarries =
    .35*careerCarries+
    .35*recent4Carries+
    .20*last2Carries+
    .10*last1Carries;

  // Extra controlled response when the role has clearly changed.
  if(roleTrend < .80 || roleTrend > 1.20){
    expectedCarries =
      .20*careerCarries+
      .40*recent4Carries+
      .25*last2Carries+
      .15*last1Carries;
  }
  expectedCarries=clamp(expectedCarries,careerCarries*.55,careerCarries*1.45);

  const careerYpc=careerCarries>0?careerYpg/careerCarries:0;
  const recentCarriesTotal=recent4.reduce((s,g)=>s+g.carries,0);
  const recentYardsTotal=recent4.reduce((s,g)=>s+g.rushYards,0);
  const recentYpc=recentCarriesTotal>0?recentYardsTotal/recentCarriesTotal:careerYpc;

  // Efficiency is noisy: 85% long-term, 15% recent, with a tight cap.
  const stableYpc=clamp(
    .85*careerYpc+.15*recentYpc,
    careerYpc*.85,
    careerYpc*1.15
  );

  const workloadProjection=expectedCarries*stableYpc;

  // Blend some direct yardage history back in to avoid repeating V4.
  const directAnchor=.55*careerYpg+.30*recent4Ypg+.15*last2Ypg;
  let projection=.65*workloadProjection+.35*directAnchor;

  // Wider than V5 only when workload evidence supports the move.
  const move=roleTrend<.80||roleTrend>1.20?.40:.25;
  projection=clamp(projection,careerYpg*(1-move),careerYpg*(1+move));

  return {projection,expectedCarries,stableYpc,roleTrend};
}

export async function GET(){
  try{
    const [season2024,season2025]=await Promise.all([loadSeason(2024),loadSeason(2025)]);
    const history=new Map<string,History>();
    for(const g of season2024) addHistory(history,g);

    const baselineErrors:number[]=[];
    const v5Errors:number[]=[];
    const v6Errors:number[]=[];
    const rbV5:number[]=[]; const rbV6:number[]=[];
    const qbV5:number[]=[]; const qbV6:number[]=[];
    const predictions:any[]=[];
    let skipped=0;

    const weeks=[...new Set(season2025.map(g=>g.week))].sort((a,b)=>a-b);
    for(const week of weeks){
      const weekGames=season2025.filter(g=>g.week===week);
      for(const game of weekGames){
        const h=history.get(game.playerId);
        if(!h||h.games.length<MIN_PRIOR_GAMES){skipped++;continue;}
        const all=h.games;
        const career=avg(all.map(g=>g.rushYards));
        const v5=projectV5(all,game.position||"UNKNOWN");
        const v6=projectV6(all,game.position||"UNKNOWN");
        const eBase=career-game.rushYards;
        const e5=v5-game.rushYards;
        const e6=v6.projection-game.rushYards;
        baselineErrors.push(eBase); v5Errors.push(e5); v6Errors.push(e6);
        if(game.position==="RB"){rbV5.push(e5);rbV6.push(e6);}
        if(game.position==="QB"){qbV5.push(e5);qbV6.push(e6);}
        predictions.push({
          week,player:game.playerName,team:game.team,position:game.position,
          actual_rushing_yards:game.rushYards,actual_carries:game.carries,
          prior_games:all.length,
          baseline_projection:Number(career.toFixed(1)),
          v5_projection:Number(v5.toFixed(1)),
          v6_projection:Number(v6.projection.toFixed(1)),
          v6_expected_carries:v6.expectedCarries===null?null:Number(v6.expectedCarries.toFixed(2)),
          v6_stable_ypc:v6.stableYpc===null?null:Number(v6.stableYpc.toFixed(2)),
          v6_role_trend:Number(v6.roleTrend.toFixed(3)),
        });
      }
      for(const g of weekGames) addHistory(history,g);
    }

    const baseline=metrics(baselineErrors), v5=metrics(v5Errors), v6=metrics(v6Errors);
    const rb5=metrics(rbV5), rb6=metrics(rbV6), qb5=metrics(qbV5), qb6=metrics(qbV6);

    return NextResponse.json({
      success:true,
      version:VERSION,
      purpose:"Develop Rushing V6 to improve RB role/workload handling after the clean V5 sportsbook backtest exposed weak RB performance.",
      model_status:"DEVELOPMENT TEST ONLY — NOT LIVE",
      data_source:"nflverse weekly player stats",
      development_guardrail:"2024 initializes history and 2025 is evaluated chronologically. No sportsbook API calls are made.",
      samples:{
        training_2024_player_games:season2024.length,
        testing_2025_player_games:season2025.length,
        held_out_predictions:predictions.length,
        skipped_no_prior_history:skipped,
      },
      baseline:{description:"All prior rushing yards per game",...baseline},
      rushing_v5:{description:"Exact V5 logic reproduced for same-sample comparison",...v5},
      rushing_v6:{
        description:"Role-aware workload projection + heavily stabilized YPC + direct-yardage anchor",
        ...v6,
      },
      position_comparison:{
        RB:{v5:rb5,v6:rb6,mae_improvement:rb5.mae!==null&&rb6.mae!==null?Number((rb5.mae-rb6.mae).toFixed(2)):null},
        QB:{v5:qb5,v6:qb6,mae_improvement:qb5.mae!==null&&qb6.mae!==null?Number((qb5.mae-qb6.mae).toFixed(2)):null},
      },
      comparison:{
        v6_vs_v5_mae_improvement:v5.mae!==null&&v6.mae!==null?Number((v5.mae-v6.mae).toFixed(2)):null,
        v6_vs_baseline_mae_improvement:baseline.mae!==null&&v6.mae!==null?Number((baseline.mae-v6.mae).toFixed(2)):null,
        v6_beats_v5_mae:v5.mae!==null&&v6.mae!==null?v6.mae<v5.mae:false,
        v6_beats_v5_rmse:v5.rmse!==null&&v6.rmse!==null?v6.rmse<v5.rmse:false,
      },
      methodology:{
        rb_workload:"35% career + 35% recent-4 + 20% last-2 + 10% last-game carries; shifts faster to recent usage when role trend is outside 0.80-1.20.",
        rb_efficiency:"85% career YPC + 15% recent-4 YPC, capped to ±15% of career YPC.",
        rb_final:"65% workload×stabilized-YPC + 35% direct rushing-yardage anchor.",
        qb:"Keeps conservative V5-style QB logic because the clean sportsbook test showed the larger weakness was RB rushing.",
        leakage_control:"Every 2025 week is predicted before that week's results are added.",
        important:"This is projection development only. If V6 improves materially, it still needs a clean sportsbook-line backtest before production.",
      },
      sample_predictions:predictions.slice(0,40),
    });
  }catch(error:any){
    return NextResponse.json({success:false,version:VERSION,error:error?.message||String(error)},{status:500});
  }
}
