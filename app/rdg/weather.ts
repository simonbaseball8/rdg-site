import { canonicalTeamKey } from './team-aliases.ts';
import type { Pick, Sport, Feeds } from './board.ts';
export type GameWeather = {
  sport: Sport; starts: string; away: string; home: string; venue: string;
  roof: 'indoor' | 'outdoor' | 'unknown'; status: 'forecast' | 'indoor' | 'unavailable';
  checkedAt: string; issuedAt?: string | null; temperatureF?: number | null;
  windMph?: number | null; rainChance?: number | null; summary: string;
};
export function weatherFor(p: Pick, feeds: Feeds, now: number): GameWeather | null {
  if (!['NFL','CFB','MLB'].includes(p.sport)) return null;
  const feed=feeds[`weather${p.sport}` as keyof Feeds];
  const games=(feed?.data as {games?:GameWeather[]} | undefined)?.games ?? [];
  const names=p.matchup.split(/\s+@\s+|\s+vs\.?\s+/i);
  const key=(s:string)=>canonicalTeamKey(p.sport,s);
  const matches=games.filter(g=>g.sport===p.sport && names.length===2 && key(names[0])===key(g.away)&&key(names[1])===key(g.home)&&Math.abs(Date.parse(p.starts)-Date.parse(g.starts))<90*60000);
  if(matches.length!==1)return null;
  const g=matches[0],checked=Date.parse(g.checkedAt),issued=Date.parse(g.issuedAt ?? '');
  if(!Number.isFinite(checked)||checked>now||now-checked>45*60000)return null;
  if(g.status==='forecast'&&(!Number.isFinite(issued)||issued>now||now-issued>12*3600000))return null;
  if(g.status==='forecast' && (![g.temperatureF,g.windMph,g.rainChance].every(n=>typeof n==='number'&&Number.isFinite(n)) || g.windMph!<0 || g.windMph!>250 || g.rainChance!<0 || g.rainChance!>100)) return null;
  return g;
}
export function applyWeather(p: Pick, weather: GameWeather | null) {
  if(!['NFL','CFB','MLB'].includes(p.sport))return;
  p.weather=weather ?? undefined;
  if(!weather || weather.status==='unavailable') {
    p.concerns.push('Game-time weather unavailable; this pick is not weather-cleared. Recheck before betting.');
    p.score=Math.max(0,p.score-0.25);return;
  }
  if(weather.status==='indoor'&&weather.roof==='indoor') {
    p.reasons.push(`Venue metadata lists an indoor/dome venue: ${weather.venue}.`);return;
  }
  const wind=weather.windMph,precip=weather.rainChance,temp=weather.temperatureF;
  p.reasons.push(`Game-window forecast: ${temp ?? '—'}°F, wind up to ${wind ?? '—'} mph, precipitation chance up to ${precip ?? '—'}%.`);
  if(weather.roof==='unknown')p.concerns.push('Roof status is unconfirmed; outdoor forecast is used conservatively.');
  const storm=/thunder|lightning|ice storm|freezing rain|blizzard/i.test(weather.summary);
  const severeWind=typeof wind==='number'&&wind>=25;
  const passing=p.market==='Player prop'&&['player_pass_yds','player_pass_tds','player_reception_yds','player_receptions'].includes(p.propType ?? '');
  const windSensitive=p.market==='Total'||passing||(p.sport==='MLB'&&p.market==='Player prop');
  const windFlag=typeof wind==='number'&&wind>=15&&windSensitive;
  const rainFlag=typeof precip==='number'&&precip>=70&&(p.sport==='MLB'||passing||p.market==='Total');
  if(storm||severeWind||windFlag||rainFlag) {
    p.eligible=false;
    p.concerns.unshift('Weather hold: excluded from automatic parlays and straight-bet suggestions until conditions improve or are reviewed.');
    if(storm)p.concerns.push('Thunderstorms/ice in the game window: delay or interruption risk.');
    if(windFlag||severeWind)p.concerns.push('Wind exceeds the RDG review threshold. No automatic switch to an under or rushing over.');
    if(rainFlag)p.concerns.push('High precipitation probability in the game window.');
  } else if((typeof wind==='number'&&wind>=10)||(typeof precip==='number'&&precip>=40)||(typeof temp==='number'&&(temp<=32||temp>=95))) {
    p.score=Math.max(0,p.score-0.5);
    p.concerns.push('Weather caution: reduced ranking; changing wind, precipitation or temperature may affect this pick.');
  }
  p.concerns.push('Weather rules are precautionary screening thresholds, not a backtested change to win probability or projected yards. Wind direction relative to the field and gusts are not modeled.');
}
