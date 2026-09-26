export type NflMarketEvent = {
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
    const response = await fetcher(
      "https://oddize.com/api/v1/odds/latest?sport=nfl&books=hrb",
      {
        headers: { "X-API-Key": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) return unavailable;
    const data = await response.json();
    if (!Array.isArray(data?.events)) return unavailable;
    const events = data.events.filter(
      (event: NflMarketEvent | null) =>
        event &&
        typeof event.team1 === "string" &&
        typeof event.team2 === "string" &&
        Array.isArray(event.odds),
    );
    return { events, available: true, warning: null };
  } catch {
    return unavailable;
  }
}
