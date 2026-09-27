export function summarizeHours(periods:any[],starts:string) {
  const t=Date.parse(starts),finish=t+3*3600000;
  const rows=periods.filter(p=>Date.parse(p.startTime)<finish&&Date.parse(p.endTime)>t).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  let covered=t;
  for(const p of rows){if(Date.parse(p.startTime)>covered)return null;covered=Math.max(covered,Date.parse(p.endTime));}
  if(!rows.length||covered<finish)return null;
  const wind=(s:unknown)=>typeof s==='string'&&/mph/i.test(s)?Math.max(...(s.match(/\d+(?:\.\d+)?/g)??[]).map(Number)):NaN;
  const winds=rows.map(p=>wind(p.windSpeed)),temps=rows.map(p=>typeof p.temperature!=='number'?NaN:p.temperatureUnit==='F'?p.temperature:p.temperatureUnit==='C'?p.temperature*9/5+32:NaN),rain=rows.map(p=>p.probabilityOfPrecipitation?.value);
  if(!winds.every(n=>Number.isFinite(n)&&n>=0&&n<=250)||!temps.every(Number.isFinite)||!rain.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100))return null;
  return {windMph:Math.max(...winds),temperatureF:Math.round(temps[0]),rainChance:Math.max(...rain),summary:[...new Set(rows.map(p=>String(p.shortForecast??'')))].join('; ')};
}
