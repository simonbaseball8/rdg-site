import { summarizeHours } from "./weather-hours.ts";
import stadiums from './stadium-locations.json';
import type { GameWeather } from '../app/rdg/weather';
import { easternDate } from '../app/rdg/board';
type Sport='NFL'|'CFB'|'MLB';
type VenueGame={sport:Sport;starts:string;away:string;home:string;venue:string;roof:GameWeather['roof'];lat?:number;lon?:number};
const agent='RDG weather screening (https://github.com/simonbaseball8/rdg-site)';
async function json(url:string, seconds=900,headers:Record<string,string>={}) {
  const r=await fetch(url,{headers:{'User-Agent':agent,...headers},next:{revalidate:seconds},signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw Error('Weather source unavailable');return r.json();
}
function csvRows(text:string) {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){rows.push(row);row=[];}}else cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);}const headers=rows.shift() ?? [];return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
async function schedule(sport:Sport,now:number):Promise<VenueGame[]> {
  const start=easternDate(now),end=easternDate(now+7*86400000);
  if(sport==='MLB') {
    const data=await json(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&hydrate=venue(location,fieldInfo)`,3600);
    return (data.dates??[]).flatMap((d:any)=>(d.games??[]).map((g:any)=>({sport,starts:g.gameDate,away:g.teams.away.team.name,home:g.teams.home.team.name,venue:g.venue?.name??'Unknown venue',lat:g.venue?.location?.defaultCoordinates?.latitude,lon:g.venue?.location?.defaultCoordinates?.longitude,roof:g.venue?.fieldInfo?.roofType==='Dome'?'indoor':g.venue?.fieldInfo?.roofType==='Open'?'outdoor':'unknown'})));
  }
  if(sport==='NFL') {
    const r=await fetch('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv',{next:{revalidate:3600},signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Schedule unavailable');
    return csvRows(await r.text()).filter(g=>g.gameday>=start&&g.gameday<=end&&/^\d{2}:\d{2}$/.test(g.gametime??'')).map(g=>{
      const venue=stadiums.find(v=>v.id===g.stadium_id);
      // NFL games.csv gametime is Eastern. Choose the offset for this date (DST-safe).
      const noon=new Date(`${g.gameday}T12:00:00Z`);
      const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(noon).find(p=>p.type==='timeZoneName')?.value==='GMT-4'?'-04:00':'-05:00';
      return {sport,starts:`${g.gameday}T${g.gametime}:00${offset}`,away:g.away_team,home:g.home_team,venue:g.stadium||venue?.name||'Unknown venue',lat:venue?.lat,lon:venue?.lon,roof:venue?.roof==='Dome'?'indoor':'unknown'};
    });
  }
  const key=process.env.CFBD_API_KEY;if(!key)throw Error('College venue data unavailable');
  const headers={Authorization:`Bearer ${key}`};
  const [games,venues]=await Promise.all([json(`https://api.collegefootballdata.com/games?year=${start.slice(0,4)}&seasonType=regular`,3600,headers),json('https://api.collegefootballdata.com/venues',86400,headers)]);
  if(!Array.isArray(games)||!Array.isArray(venues))throw Error('College venue data unavailable');
  return games.filter((g:any)=>g.startDate && Date.parse(g.startDate)>now && Date.parse(g.startDate)<now+7*86400000 && !g.startTimeTBD).map((g:any)=>{const v=venues.find((v:any)=>v.id===g.venueId);return {sport,starts:g.startDate,away:g.awayTeam,home:g.homeTeam,venue:v?.name??g.venue??'Unknown venue',lat:v?.latitude,lon:v?.longitude,roof:v?.dome===true?'indoor':'unknown'};});
}
async function forecast(g:VenueGame):Promise<GameWeather> {
  const base:GameWeather={sport:g.sport,starts:g.starts,away:g.away,home:g.home,venue:g.venue,roof:g.roof,status:'unavailable',checkedAt:new Date().toISOString(),summary:'Forecast unavailable for this venue/game window.'};
  if(g.roof==='indoor')return {...base,status:'indoor',summary:'Venue metadata lists a dome; no outdoor adjustment.'};
  if(!Number.isFinite(g.lat)||!Number.isFinite(g.lon))return base;
  try {
    const point=await json(`https://api.weather.gov/points/${g.lat!.toFixed(4)},${g.lon!.toFixed(4)}`,86400);
    const url=point.properties?.forecastHourly;
    if(typeof url!=='string'||!url.startsWith('https://api.weather.gov/gridpoints/'))return base;
    const data=await json(url),p=data.properties;
    const hours=summarizeHours(p?.periods??[],g.starts);
    if(!hours)return base;
    return {...base,...hours,status:'forecast',issuedAt:p.updateTime??p.generatedAt??null,checkedAt:new Date().toISOString()};
  }catch{return base;}
}
export async function weatherFeed(sport:Sport) {
  const now=Date.now(),games=(await schedule(sport,now)).filter(g=>Date.parse(g.starts)>now&&Date.parse(g.starts)<=now+7*86400000).sort((a,b)=>Date.parse(a.starts)-Date.parse(b.starts)).slice(0,60);
  const output:GameWeather[]=[];
  // Parallel batches and cached grid lookups keep this bounded on serverless hosts.
  for(let i=0;i<games.length;i+=10) {
    if(Date.now()-now>34000){output.push(...games.slice(i).map(g=>({...g,status:'unavailable' as const,checkedAt:new Date().toISOString(),summary:'Weather request budget reached; refresh to retry.'})));break;}
    output.push(...await Promise.all(games.slice(i,i+10).map(forecast)));
  }
  return {games:output,checked_at:new Date().toISOString(),source:'National Weather Service',note:'Three-hour game window. Screening thresholds only; no calibrated weather adjustment. Outside-US/missing forecasts remain explicitly unavailable.'};
}
