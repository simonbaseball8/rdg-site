import { easternDate, type Pick } from '../app/rdg/board.ts';
import type { Outcome, TrackedBet } from '../app/rdg/journal.ts';
// Group shared slips by game date: overlapping slips fetch each scoreboard only once.
export async function archiveGrades(bets:TrackedBet[], grader:(picks:Pick[])=>Promise<{outcomes:Outcome[];warnings:string[]}>) {
  const groups=new Map<string,Array<{bet:number;leg:number;pick:Pick}>>();
  const outcomes:Outcome[][]=bets.map(b=>b.picks.map(()=> 'pending'));
  for(const [bet,b] of bets.entries())for(const [leg,pick] of b.picks.entries()) {
    if(pick.market==='Player prop'||!pick.grading)continue;
    const date=easternDate(pick.starts);const group=groups.get(date)??[];group.push({bet,leg,pick});groups.set(date,group);
  }
  const warnings:string[]=[];const batches=[...groups.values()];
  for(let i=0;i<batches.length;i+=3)await Promise.all(batches.slice(i,i+3).map(async rows=>{
    try {const r=await grader(rows.map(r=>r.pick));
      if(r.outcomes.length!==rows.length)throw Error('Incomplete grades');
      warnings.push(...r.warnings);rows.forEach((row,j)=>{outcomes[row.bet][row.leg]=r.outcomes[j];});
    }catch{warnings.push('Final-score request failed; existing results retained.');}
  }));
  return {outcomes,warnings:[...new Set(warnings)]};
}
