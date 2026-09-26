import {
  decimalOdds,
  fresh,
  oddsNumber,
  type Feeds,
  type Pick,
  type Sport,
} from "./board.ts";

type Quote = { side: string; line: number | null; odds: unknown };
type Game = {
  quote_times?: Record<string, string | null>;
  event_id: string;
  start_date?: string;
  start_time_utc?: string;
  away_team: string;
  home_team: string;
  sportsbook?: string;
  requires_florida_verification?: boolean;
  total?: Quote[];
  hard_rock?: {
    total?: {
      over: number | null;
      under: number | null;
      over_odds: unknown;
      under_odds: unknown;
    };
  };
  starting_pitchers?: {
    away?: { name?: string } | null;
    home?: { name?: string } | null;
  };
  rdg?: {
    total_model?: {
      lean: string | null;
      market_total: number | null;
      projected_total_runs: number | null;
      model_over_probability: number | null;
      model_under_probability: number | null;
      signal: string;
    };
  };
};

// Show actual offered sides. Only an existing totals model may nominate a side.
export function totalPicks(feeds: Feeds, now: number): Pick[] {
  const picks: Pick[] = [];
  for (const sport of ["NFL", "CFB", "MLB", "NHL"] as Sport[]) {
    const feed = feeds[sport];
    const games = (feed?.data as { games?: Game[] } | undefined)?.games ?? [];
    for (const g of games) {
      const t = g.hard_rock?.total;
      const quotes =
        g.total ??
        (t
          ? [
              { side: "Over", line: t.over, odds: t.over_odds },
              { side: "Under", line: t.under, odds: t.under_odds },
            ]
          : []);
      const quoteTime = Date.parse(g.quote_times?.total ?? "");
      const recentQuote = quoteTime <= now && now - quoteTime < 15 * 60_000;
      const model = sport === "MLB" ? g.rdg?.total_model : undefined;
      for (const q of quotes) {
        if (
          !/^(over|under)$/i.test(q.side) ||
          typeof q.line !== "number" ||
          !Number.isFinite(q.line) ||
          q.line <= 0
        )
          continue;
        const odds = oddsNumber(q.odds);
        if (odds === null) continue;
        const side = q.side.toLowerCase() === "over" ? "Over" : "Under";
        const probability =
          side === "Over"
            ? model?.model_over_probability
            : model?.model_under_probability;
        const decimal = decimalOdds(odds);
        const projected = model?.projected_total_runs;
        const eligible =
          recentQuote &&
          !!model &&
          model.lean === side &&
          model.market_total === q.line &&
          model.signal === "Experimental Review" &&
          q.line % 1 === 0.5 &&
          typeof projected === "number" &&
          Number.isFinite(projected) &&
          typeof probability === "number" &&
          probability > 0 &&
          probability < 100 &&
          decimal !== null &&
          (probability / 100) * decimal > 1 &&
          !!g.starting_pitchers?.away?.name &&
          !!g.starting_pitchers?.home?.name &&
          fresh(feed, now);
        const unit =
          sport === "MLB" ? "runs" : sport === "NHL" ? "goals" : "points";
        picks.push({
          id: `${sport.toLowerCase()}-total-${g.event_id}-${side.toLowerCase()}`,
          event: `${sport}-${g.event_id}`,
          sport,
          starts: g.start_date ?? g.start_time_utc ?? "",
          matchup: `${g.away_team} @ ${g.home_team}`,
          title: `${side} ${q.line} total ${unit}`,
          market: "Total",
          odds,
          book: g.sportsbook ?? "No verified sportsbook",
          referencePrice: g.requires_florida_verification === true,
          score: eligible ? 2 : 0,
          reasons:
            typeof projected === "number" && Number.isFinite(projected)
              ? [
                  `RDG projects ${projected.toFixed(2)} combined runs against a ${q.line}-run line.`,
                  `Source signal: ${model?.signal}.`,
                ]
              : [
                  `Combined score of both teams: ${side.toLowerCase()} ${q.line} ${unit}.`,
                ],
          concerns: model
            ? [
                "Experimental team-based totals estimate; not a proven betting edge. Only half-run lines enter automatic picks; whole-run push probabilities are not modeled.",
                "Confirm starting pitchers, lineups, weather and the exact offered total.",
              ]
            : [
                "Totals prediction model is not connected for this sport; research only, excluded from automatic parlays.",
              ],
          eligible,
        });
      }
    }
  }
  return picks;
}
