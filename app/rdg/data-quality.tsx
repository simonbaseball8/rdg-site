import { auditPicks } from './data-audit';
import type { Pick } from './board';
export default function DataQuality({picks,now}:{picks:Pick[];now:number}) {
  const a=auditPicks(picks,now);
  return <details className="notice"><summary>Data quality · {a.total} picks checked</summary>
    <p>Counts describe the displayed sport/date research pool, including picks excluded from suggestions.</p>
    <ul><li>{a.missingQuotes} missing quote timestamps · {a.staleQuotes} stale or future-dated quotes</li>
    <li>{a.referencePrices} reference prices requiring Florida verification</li>
    <li>{a.missingWeather} outdoor picks without usable weather · {a.weatherHolds} weather holds</li>
    <li>{a.manualProps} player props without automatic result settlement</li></ul>
    <p>Player-to-team roster verification and confirmed lineups are not independently audited. Source grades are not validated win probabilities.</p>
  </details>;
}
