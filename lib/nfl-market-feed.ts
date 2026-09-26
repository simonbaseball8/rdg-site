import { loadOddsMarket } from "./odds-api.ts";
export type NflMarketEvent = {
  sportsbook?: string;
  requires_florida_verification?: boolean;
  event_id?: string;
  start_date?: string;
  team1: string;
  team2: string;
  odds: Array<{
    market: string;
    team: string;
    american_odds: string | number;
    line?: number | null;
  }>;
};
export type NflMarketFeed = {
  events: NflMarketEvent[];
  available: boolean;
  warning: string | null;
};

// Predictions come from stats. A missing/failed price feed must not hide them.
// No prices are synthesized when the market provider is unavailable.
export async function loadNflMarketFeed(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<NflMarketFeed> {
  const unavailable = {
    events: [],
    available: false,
    warning:
      "Hard Rock odds are unavailable. Game predictions remain available; priced parlays require the odds feed.",
  };
  if (!apiKey) return unavailable;
  try {
    const { events } = await loadOddsMarket("NFL", apiKey, fetcher);
    return { events, available: true, warning: null };
  } catch {
    return unavailable;
  }
}
