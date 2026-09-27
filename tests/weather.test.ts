import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWeather, weatherFor, type GameWeather } from '../app/rdg/weather.ts';
import { buildIdeas, type Pick, type Feeds } from '../app/rdg/board.ts';
import { summarizeHours } from '../lib/weather-hours.ts';
const now=Date.parse('2026-09-27T12:00Z');
const pick=():Pick=>({id:'p',event:'e',sport:'NFL',starts:'2026-09-27T17:00Z',matchup:'Buffalo Bills @ Baltimore Ravens',title:'Passing yards over',market:'Player prop',propType:'player_pass_yds',odds:-110,book:'Hard Rock Bet (FL)',score:3,reasons:[],concerns:[],eligible:true});
const forecast=():GameWeather=>({sport:'NFL',starts:'2026-09-27T17:00Z',away:'BUF',home:'BAL',venue:'Baltimore',roof:'outdoor',status:'forecast',checkedAt:'2026-09-27T11:59Z',issuedAt:'2026-09-27T11:00Z',windMph:5,rainChance:10,temperatureF:70,summary:'Sunny'});
const feed=(g:GameWeather):Feeds=>({weatherNFL:{loadedAt:now,data:{games:[g]}}});
test('Weather matches exact teams and kickoff; rejects stale, future and incomplete forecasts',()=>{
 const p=pick(),g=forecast();assert.equal(weatherFor(p,feed(g),now)?.venue,'Baltimore');
 for(const patch of [{home:'MIA'},{starts:'2026-09-28T17:00Z'},{checkedAt:'2026-09-27T10:00Z'},{checkedAt:'2026-09-28T12:00Z'},{issuedAt:'2026-09-26T12:00Z'},{issuedAt:'2026-09-28T12:00Z'},{rainChance:null},{rainChance:101}])assert.equal(weatherFor(p,feed({...g,...patch}),now),null);
});
test('Wind and storms hold affected picks; calm and verified indoor picks remain available',()=>{
 for(const patch of [{windMph:15},{summary:'Thunderstorms'},{rainChance:70}]){const p=pick();applyWeather(p,{...forecast(),...patch});assert.equal(p.eligible,false);assert.equal(p.title,'Passing yards over');}
 const calm=pick();applyWeather(calm,forecast());assert.equal(calm.eligible,true);assert.equal(calm.score,3);
 const indoor=pick();applyWeather(indoor,{...forecast(),status:'indoor',roof:'indoor',windMph:40});assert.equal(indoor.eligible,true);
 const retractable=pick();applyWeather(retractable,{...forecast(),roof:'unknown',windMph:30});assert.equal(retractable.eligible,false);
 const rushing=pick();rushing.propType='player_rush_yds';applyWeather(rushing,{...forecast(),windMph:15});assert.equal(rushing.eligible,true);assert.ok(rushing.score<3);
 const missing=pick();applyWeather(missing,null);assert.ok(missing.concerns.some(c=>c.includes('not weather-cleared')));assert.equal(missing.eligible,true);
});
test('Hourly aggregation requires complete three-hour coverage and valid measurements',()=>{
 const rows=Array.from({length:3},(_,i)=>({startTime:`2026-09-27T${17+i}:00Z`,endTime:`2026-09-27T${18+i}:00Z`,windSpeed:i===1?'10 to 20 mph':'5 mph',temperature:20,temperatureUnit:'C',probabilityOfPrecipitation:{value:30},shortForecast:'Cloudy'}));
 assert.deepEqual(summarizeHours(rows,pick().starts),{windMph:20,temperatureF:68,rainChance:30,summary:'Cloudy'});
 assert.equal(summarizeHours(rows.slice(1),pick().starts),null);
 assert.equal(summarizeHours([rows[0],rows[2]],pick().starts),null);
 assert.equal(summarizeHours(rows.map(r=>({...r,temperature:null})),pick().starts),null);
 assert.equal(summarizeHours(rows.map(r=>({...r,probabilityOfPrecipitation:{value:null}})),pick().starts),null);
});
test('Variety cannot displace stronger scores; weather-held picks cannot enter slips',()=>{
 const picks=Array.from({length:8},(_,i)=>({...pick(),id:String(i),event:String(i),matchup:`A${i} @ B${i}`,score:i<6?4:2,market:i<6?'Spread' as const:'Player prop' as const}));
 assert.ok(buildIdeas(picks,2,now).flat().every(p=>p.score===4));
 const held=pick();applyWeather(held,{...forecast(),windMph:30});assert.equal(buildIdeas([held,picks[0]],2,now).length,0);
});
