import { FRESH_FOR_MS, type Pick } from './board.ts';
export function auditPicks(picks: Pick[], now: number) {
  const missingQuotes=picks.filter(p=>!Number.isFinite(Date.parse(p.quoteAt??''))).length;
  const staleQuotes=picks.filter(p=>{const t=Date.parse(p.quoteAt??'');return Number.isFinite(t)&&(t>now||now-t>=FRESH_FOR_MS);}).length;
  const outdoor=picks.filter(p=>['NFL','CFB','MLB'].includes(p.sport));
  return {total:picks.length,missingQuotes,staleQuotes,
    referencePrices:picks.filter(p=>p.referencePrice).length,
    missingWeather:outdoor.filter(p=>!p.weather||p.weather.status==='unavailable').length,
    weatherHolds:picks.filter(p=>p.concerns.some(c=>c.startsWith('Weather hold:'))).length,
    manualProps:picks.filter(p=>p.market==='Player prop').length};
}
