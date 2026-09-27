import { archiveClient, cronAuthorized } from "../../../../lib/daily-archive";
import { dailySlips } from "../../../rdg/daily-slips";
import { type Feeds } from "../../../rdg/board";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!cronAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = archiveClient();
    const probe = await db.from("rdg_daily_slips").select("id").limit(1);
    if (probe.error) throw Error("Database setup required");
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (!host || !/^[a-zA-Z0-9.-]+$/.test(host))
      throw Error("Production hostname unavailable");
    const routes = {
      NFL: "analyze",
      CFB: "cfb-picks",
      MLB: "mlb-picks",
      NHL: "nhl-picks",
      props: "nfl-player-props",
      injuries: "nfl-injuries",
      mlbProps: "mlb-props",
      weatherNFL: "weather?sport=NFL",
      weatherCFB: "weather?sport=CFB",
      weatherMLB: "weather?sport=MLB",
    };
    const feeds: Feeds = {};
    const warnings: string[] = [];
    await Promise.all(
      Object.entries(routes).map(async ([key, path]) => {
        try {
          const r = await fetch(`https://${host}/api/${path}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(45000),
          });
          if (!r.ok) throw Error("Feed unavailable");
          const data = await r.json();
          if (data.success === false) throw Error("Feed unavailable");
          if (data.warning || data.market_data_warning) warnings.push(key);
          feeds[key as keyof Feeds] = { data, loadedAt: Date.now() };
        } catch {
          warnings.push(key);
        }
      }),
    );
    const bets = dailySlips(feeds, Date.now(), "published");
    let inserted = 0;
    if (bets.length) {
      const { data: saved, error } = await db.from("rdg_daily_slips").upsert(
        bets.map((b) => ({
          id: b.id,
          snapshot: { ...b, settlements: [] },
          settlements: [],
        })),
        { onConflict: "id", ignoreDuplicates: true },
      ).select("id");
      if (error) throw Error("Save failed");
      inserted = saved?.length ?? 0;
    }
    return Response.json({
      candidates: bets.length,
      inserted,
      already_saved: bets.length - inserted,
      unavailable_feeds: warnings,
      note: "First snapshot wins. No qualifying full slips means no fabricated record.",
    });
  } catch {
    return Response.json(
      {
        error:
          "Daily archive could not be saved. Check database and production hostname configuration.",
      },
      { status: 503 },
    );
  }
}
