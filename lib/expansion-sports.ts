import { loadOddsMarket } from "./odds-api";
import { canonicalTeamKey } from "../app/rdg/team-aliases";
const key = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
async function json(url: string) {
  const r = await fetch(url, {
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("Statistics temporarily unavailable");
  return r.json();
}
export async function expansionBoard(sport: "NBA" | "UFC") {
  const market = await loadOddsMarket(sport);
  let warning: string | null = null;
  let contextAt: string | null = null;
  let entries: any[] = [];
  let season: string | null = null;
  const now = Date.now();
  try {
    if (sport === "NBA") {
      const data = await json(
        "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings",
      );
      season = data.season?.displayName ?? null;
      entries = (data.children ?? []).flatMap(
        (c: any) => c.standings?.entries ?? [],
      );
    } else {
      // Bounded fixed date window, independent of user query parameters.
      const start = new Date(now)
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "");
      const end = new Date(now + 14 * 86400000)
        .toISOString()
        .slice(0, 10)
        .replaceAll("-", "");
      const data = await json(
        `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${start}-${end}&limit=100`,
      );
      entries = (data.events ?? []).flatMap((e: any) =>
        (e.competitions ?? []).map((c: any) => ({ ...c, card: e.name })),
      );
    }
    contextAt = new Date().toISOString();
  } catch {
    warning = "Statistics are temporarily unavailable; odds remain visible.";
  }
  const games = market.events
    .filter((e) => Date.parse(e.start_date) > now)
    .map((event) => {
      let context: any = null;
      if (sport === "NBA") {
        const team = (name: string) => {
          const row = entries.find(
            (e) =>
              canonicalTeamKey("NBA", e.team?.displayName ?? "") ===
              canonicalTeamKey("NBA", name),
          );
          if (!row) return null;
          const stat = (n: string) => row.stats?.find((s: any) => s.name === n);
          return {
            name,
            record: stat("overall")?.displayValue ?? null,
            games: (stat("wins")?.value ?? 0) + (stat("losses")?.value ?? 0),
            pointsFor: stat("avgPointsFor")?.value ?? null,
            pointsAgainst: stat("avgPointsAgainst")?.value ?? null,
          };
        };
        context = {
          season,
          away: team(event.away_team),
          home: team(event.home_team),
        };
      } else {
        const match = entries.find(
          (c) =>
            Math.abs(Date.parse(c.date) - Date.parse(event.start_date)) <
              18 * 3600000 &&
            [event.away_team, event.home_team].every((name) =>
              c.competitors?.some(
                (p: any) => key(p.athlete?.fullName ?? "") === key(name),
              ),
            ),
        );
        if (match)
          context = {
            card: match.card,
            weightClass: match.type?.abbreviation ?? null,
            rounds: match.format?.regulation?.periods ?? null,
            fighters: match.competitors.map((p: any) => ({
              name: p.athlete?.fullName,
              record:
                p.records?.find((r: any) => r.name === "overall")?.summary ??
                null,
            })),
          };
      }
      return { ...event, context };
    });
  return {
    sport,
    games,
    checked_at: new Date().toISOString(),
    context_checked_at: contextAt,
    stats_warning: warning,
    model_available: false,
    coverage: {
      priced: games.filter((g) => g.odds.length).length,
      florida: games.filter(
        (g) => g.odds.length && !g.requires_florida_verification,
      ).length,
      reference: games.filter(
        (g) => g.odds.length && g.requires_florida_verification,
      ).length,
    },
    notice:
      "Research board only. An independently validated prediction model and injury/lineup screening are not connected. These games do not enter automatic parlay suggestions.",
  };
}
