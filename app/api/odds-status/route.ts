import { SPORT_KEYS, type ApiEvent } from "../../../lib/odds-api";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bounded, cached coverage check: no credentials or raw provider errors are exposed.
// Fixed sport/book lists prevent user-controlled paid API queries.
export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return Response.json({ error: "ODDS_API_KEY is missing" }, { status: 503 });
  const books = "hardrockbet_fl,hardrockbet,hardrockbet_az,hardrockbet_oh";
  function summarize(events: ApiEvent[]) {
    const coverage: Record<string, { events: number; markets: Record<string, number> }> = {};
    for (const event of events) for (const book of event.bookmakers ?? []) {
      const row = coverage[book.key] ??= { events: 0, markets: {} };
      row.events++;
      for (const market of book.markets ?? []) row.markets[market.key] = (row.markets[market.key] ?? 0) + (market.outcomes?.length ?? 0);
    }
    return { events: events.length, books: coverage };
  }
  const sports = await Promise.all(Object.entries(SPORT_KEYS).map(async ([sport,key]) => {
    const query = new URLSearchParams({apiKey,bookmakers:books,markets:sport === "UFC" ? "h2h" : "h2h,spreads,totals",oddsFormat:"american",dateFormat:"iso"});
    try {
      const response = await fetch(`https://api.the-odds-api.com/v4/sports/${key}/odds?${query}`,{ next:{revalidate:900},signal:AbortSignal.timeout(15000) });
      if(!response.ok)return {sport,status:response.status};
      const events=await response.json() as ApiEvent[];
      if(!Array.isArray(events))return{sport,error:"Invalid provider event list"};
      const bulk=summarize(events);
      const sample=events.find(e=>Date.parse(e.commence_time)>Date.now());
      let eventProbe: unknown = null;
      if(!bulk.books.hardrockbet_fl && sample){
        const r=await fetch(`https://api.the-odds-api.com/v4/sports/${key}/events/${encodeURIComponent(sample.id)}/odds?${query}`,{next:{revalidate:900},signal:AbortSignal.timeout(15000)});
        eventProbe=r.ok ? summarize([await r.json()]) : {status:r.status};
      }
      return {sport,status:response.status,bulk,eventProbe,next_priced_events:events.filter(e=>e.bookmakers?.some(b=>b.markets?.some(m=>m.outcomes?.length))).slice(0,5).map(e=>({away:e.away_team,home:e.home_team,starts:e.commence_time}))};
    }catch{return {sport,error:"Provider request failed or timed out"};}
  }));
  return Response.json({provider:"The Odds API",requested_books:books.split(","),college_stats_key_configured:Boolean(process.env.CFBD_API_KEY),checked_at:new Date().toISOString(),sports},{headers:{"Cache-Control":"public, s-maxage=900, must-revalidate"}});
}
