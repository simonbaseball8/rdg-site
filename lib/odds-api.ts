import { canonicalTeamKey } from "../app/rdg/team-aliases.ts";

export const SPORT_KEYS = {
  NFL: "americanfootball_nfl",
  CFB: "americanfootball_ncaaf",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
} as const;
export type OddsSport = keyof typeof SPORT_KEYS;
export type MarketEvent = {
  event_id: string;
  sport: string;
  start_date: string;
  team1: string;
  team2: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  odds: {
    market: string;
    team: string;
    american_odds: number;
    line?: number;
    updated_at?: string;
  }[];
};
export type ApiEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: {
    key: string;
    last_update?: string;
    markets?: {
      key: string;
      last_update?: string;
      outcomes?: { name: string; price: number; point?: number }[];
    }[];
  }[];
};
function teamName(sport: OddsSport, name: string) {
  if (sport !== "NFL") return name;
  const key = canonicalTeamKey("NFL", name).toUpperCase();
  return ({ WSH: "WAS", LAR: "LA" } as Record<string, string>)[key] ?? key;
}
export function adaptOddsEvents(
  sport: OddsSport,
  data: ApiEvent[],
): MarketEvent[] {
  return data
    .filter(
      (e) =>
        e.id &&
        e.away_team &&
        e.home_team &&
        Number.isFinite(Date.parse(e.commence_time)),
    )
    .map((e) => ({
      event_id: e.id,
      sport,
      start_date: e.commence_time,
      commence_time: e.commence_time,
      team1: teamName(sport, e.away_team),
      team2: teamName(sport, e.home_team),
      away_team: teamName(sport, e.away_team),
      home_team: teamName(sport, e.home_team),
      odds: (e.bookmakers ?? [])
        .filter((b) => b.key === "hardrockbet_fl")
        .flatMap((b) =>
          (b.markets ?? []).flatMap((m) => {
            const market = (
              {
                h2h: "moneyline",
                spreads: "spread",
                totals: "total",
              } as Record<string, string>
            )[m.key];
            if (!market) return [];
            return (m.outcomes ?? [])
              .filter(
                (o) =>
                  Number.isFinite(o.price) &&
                  Math.abs(o.price) >= 100 &&
                  (market === "moneyline" || Number.isFinite(o.point)),
              )
              .map((o) => ({
                market,
                team: market === "total" ? o.name : teamName(sport, o.name),
                american_odds: o.price,
                line: o.point,
                updated_at: m.last_update ?? b.last_update,
              }));
          }),
        ),
    }));
}
export async function loadOddsMarket(
  sport: OddsSport,
  apiKey = process.env.ODDS_API_KEY,
  fetcher: typeof fetch = fetch,
) {
  if (!apiKey)
    throw new Error(
      "ODDS_API_KEY is missing. Enable it for this deployment in Vercel.",
    );
  const query = new URLSearchParams({
    apiKey,
    bookmakers: "hardrockbet_fl",
    markets: "h2h,spreads,totals",
    oddsFormat: "american",
    dateFormat: "iso",
  });
  let response: Response;
  try {
    response = await fetcher(
      `https://api.the-odds-api.com/v4/sports/${SPORT_KEYS[sport]}/odds?${query}`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(20000) },
    );
  } catch {
    throw new Error("The Odds API could not be reached. Please retry.");
  }
  // Never echo a provider URL or response body containing credentials.
  if (!response.ok)
    throw new Error(
      `The Odds API returned ${response.status}${response.status === 401 ? ": check ODDS_API_KEY" : response.status === 429 ? ": request limit reached" : ""}.`,
    );
  const data = await response.json();
  if (!Array.isArray(data))
    throw new Error("The Odds API returned an invalid event list.");
  return {
    events: adaptOddsEvents(sport, data),
    provider: "The Odds API",
    sportsbook: "Hard Rock Bet (FL)",
  };
}
