import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBoard, buildIdeas, type Feeds } from '../app/rdg/board.ts';
const now=Date.parse('2026-09-27T12:00Z');
function game(i:number) {return {event_id:String(i),start_date:'2026-09-27T17:00Z',away_team:`Away${i}`,home_team:`Home${i}`,stats_connected:true,sportsbook:'Hard Rock Bet (FL)',quote_times:{moneyline:'2026-09-27T11:59Z'},rdg:{projected_winner:i%2?`Away${i}`:`Home${i}`,projected_margin:2,market_analysis:{spread_lean:'PASS',market_signal:'Pass',hard_rock_moneyline:{away_odds:'+120',home_odds:'-140'}}}};}
function board(games:unknown[],allow=false){return normalizeBoard({NFL:{loadedAt:now,data:{games}}} as Feeds,now,allow).filter(p=>p.market==='Moneyline');}
test('NFL builds eight-leg moneyline slips independently of spread signals and uses the winning side price',()=>{
 const picks=board(Array.from({length:8},(_,i)=>game(i)));
 assert.equal(picks.length,8);assert.equal(picks[0].market,'Moneyline');
 assert.equal(picks.find(p=>p.id==='nfl-ml-0')?.odds,-140);assert.equal(picks.find(p=>p.id==='nfl-ml-1')?.odds,120);
 const slips=buildIdeas(picks,8,now,'moneylines');assert.equal(slips.length,1);assert.equal(new Set(slips[0].map(p=>p.event)).size,8);
 assert.equal(buildIdeas(picks.slice(1),8,now,'moneylines').length,0);
});
test('NFL moneylines preserve quote freshness, reference opt-in and stats gates',()=>{
 for(const quote of [null,'2026-09-27T11:00Z','2026-09-28T12:00Z'])assert.equal(board([{...game(0),quote_times:{moneyline:quote}}])[0].eligible,false);
 assert.equal(board([{...game(0),stats_connected:false}]).length,0);
 const reference={...game(0),sportsbook:'Hard Rock Bet (IN reference)',requires_florida_verification:true};
 assert.equal(board([reference])[0].eligible,false);assert.equal(board([reference],true)[0].eligible,true);
 const missing=game(0);missing.rdg.market_analysis.hard_rock_moneyline.home_odds='';assert.equal(board([missing])[0].eligible,false);
});

test('A/B/C slips are ordered by weakest-leg then average source score',()=>{
 const picks=board(Array.from({length:6},(_,i)=>game(i)));
 picks.forEach((p,i)=>{p.score=[2,4,3,2,4,3][i];});
 const cards=buildIdeas(picks,2,now,'moneylines');
 assert.deepEqual(cards.map(c=>Math.min(...c.map(p=>p.score))),[4,3,2]);
 assert.equal(new Set(cards.flat().map(p=>p.id)).size,6);
});
