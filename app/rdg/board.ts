import { totalPicks } from "./totals.ts";
import { canonicalTeamKey } from "./team-aliases.ts";
import type {
  CFBAnalysis,
  MLBAnalysis,
  NFLAnalysis,
  NFLInjuriesResponse,
  NFLPlayerPropsAnalysis,
  NHLAnalysis,
} from "./types";

export const SPORTS = ["NFL", "CFB", "MLB", "NHL", "NBA", "UFC"] as const;
export type Sport = (typeof SPORTS)[number];
export type SportFilter = Sport | "ALL";
export type Market = "Spread" | "Moneyline" | "Total" | "Player prop";
export type Pick = {
  propType?: string;
  quoteAt?: string | null;
  feedAt?: string | null;
  injuriesAt?: string | null;
  lineupsAt?: string | null;
  referencePrice?: boolean;
  id: string;
  event: string;
  sport: Sport;
  starts: string;
  matchup: string;
  title: string;
  market: Market;
  odds: number | null;
  book: string;
  score: number;
  reasons: string[];
  concerns: string[];
  eligible: boolean;
};
export type Feed = { data: unknown; loadedAt: number; error?: string };
export type Feeds = Partial<
  Record<Sport | "props" | "mlbProps" | "injuries", Feed>
>;
export const FRESH_FOR_MS = 15 * 60_000;
export const LABELS: Record<SportFilter, string> = {
  ALL: "All sports",
  NFL: "NFL",
  CFB: "College football",
  MLB: "MLB",
  NHL: "NHL",
  NBA: "NBA",
  UFC: "UFC / MMA",
};

export function oddsNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (String(value).trim().toUpperCase() === "EVEN") return 100;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
}
export function decimalOdds(value: unknown): number | null {
  const n = oddsNumber(value);
  return n === null ? null : n > 0 ? 1 + n / 100 : 1 + 100 / -n;
}
export function formatOdds(value: unknown) {
  const n = oddsNumber(value);
  return n === null ? "Unavailable" : `${n > 0 ? "+" : ""}${n}`;
}
export function estimatedReturn(picks: Pick[], stake: number): number | null {
  if (!Number.isFinite(stake) || stake <= 0 || !picks.length) return null;
  let total = stake;
  for (const pick of picks) {
    const odds = decimalOdds(pick.odds);
    if (odds === null) return null;
    total *= odds;
  }
  return Number.isFinite(total) ? total : null;
}
export function easternDate(time: number | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}
export function upcoming(
  starts: string,
  now: number,
  horizon: "today" | "week",
) {
  const t = Date.parse(starts);
  return (
    Number.isFinite(t) &&
    t > now &&
    (horizon === "today"
      ? easternDate(t) === easternDate(now)
      : t <= now + 7 * 86400_000)
  );
}
export function fresh(feed: Feed | undefined, now: number) {
  return (
    !!feed &&
    !feed.error &&
    now >= feed.loadedAt &&
    now - feed.loadedAt < FRESH_FOR_MS
  );
}
export function isHardRock(book: string) {
  return /^hardrock(?:bet)?(?:fl|florida)?$/.test(
    book.toLowerCase().replace(/[^a-z]/g, ""),
  );
}
function playerKey(name: string) {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}
function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function strength(signal: string) {
  return signal === "Priority Review" ? 4 : signal === "Strong Review" ? 3 : 0;
}
function validProbability(n: unknown): n is number {
  return finite(n) && n > 0 && n < 100;
}

// Adapters preserve source model signals. Scores are ordering aids, never probabilities.
export function normalizeBoard(
  feeds: Feeds,
  now: number,
  allowReference = false,
): Pick[] {
  const picks: Pick[] = [];
  const nfl = feeds.NFL?.data as NFLAnalysis | undefined;
  const injuries = feeds.injuries?.data as NFLInjuriesResponse | undefined;
  const injuryReady = fresh(feeds.injuries, now) && injuries?.success === true;
  const reports = injuryReady
    ? (injuries.current_injuries ?? injuries.injuries ?? [])
    : [];
  const context = [
    "Weather adjustments are not connected to this board.",
    "Recheck the offered line and late lineup news before betting.",
  ];
  for (const g of nfl?.games ?? []) {
    if (!g.stats_connected || !g.rdg?.market_analysis) continue;
    const m = g.rdg.market_analysis;
    const diff = m.model_vs_market_difference;
    const team = m.spread_lean;
    const home = team === g.home_team;
    if (team !== g.home_team && team !== g.away_team) continue;
    const line = home
      ? m.hard_rock_spread?.home_line
      : m.hard_rock_spread?.away_line;
    if (!finite(line) || !finite(diff) || Math.abs(diff) < 3) continue;
    const odds = oddsNumber(
      home ? m.hard_rock_spread?.home_odds : m.hard_rock_spread?.away_odds,
    );
    const reviewed = strength(m.market_signal) > 0;
    picks.push({
      id: `nfl-spread-${g.event_id}`,
      event: `NFL-${g.event_id}`,
      sport: "NFL",
      starts: g.start_date,
      matchup: `${g.away_team} @ ${g.home_team}`,
      title: `${team} ${line > 0 ? "+" : ""}${line}`,
      market: "Spread",
      odds,
      book: g.sportsbook ?? "Hard Rock Bet (FL)",
      referencePrice: g.requires_florida_verification === true,
      score: strength(m.market_signal) + Math.min(Math.abs(diff), 10) / 100,
      reasons: [
        `RDG projects ${g.rdg.projected_winner} by ${g.rdg.projected_margin.toFixed(1)} points.`,
        `${Math.abs(diff).toFixed(1)}-point difference between model and market.`,
        `Source signal: ${m.market_signal}.`,
      ],
      concerns: [
        ...context,
        "A points difference is not a calibrated chance of covering.",
        "Team injury impacts have not been quantified in this projection.",
      ],
      eligible: reviewed && odds !== null && fresh(feeds.NFL, now),
    });
  }
  const props = feeds.props?.data as NFLPlayerPropsAnalysis | undefined;
  for (const p of props?.parlay_pool ?? []) {
    if (p.pick === "PASS" || p.grade === "PASS" || !p.start_time) continue;
    const quotes = (p.sportsbook_lines ?? []).filter(
      (q) =>
        q.available &&
        oddsNumber(q.odds) !== null &&
        String(q.side).toUpperCase() === p.pick &&
        (p.pick === "YES" ||
          (p.sportsbook_line !== null && q.line === p.sportsbook_line)),
    );
    // A price from another book must never become a Hard Rock parlay leg.
    const quote = quotes.find((q) => isHardRock(q.sportsbook)) ?? quotes[0];
    const odds = oddsNumber(quote?.odds);
    const priceTime = quote?.updated_at ? Date.parse(quote.updated_at) : NaN;
    const freshPrice =
      Number.isFinite(priceTime) &&
      priceTime <= now &&
      now - priceTime < FRESH_FOR_MS;
    const report = reports.find(
      (r) =>
        r.current_injury !== false &&
        playerKey(r.player_name) === playerKey(p.player_name),
    );
    const unavailable =
      !!report && /out|doubtful|questionable/i.test(report.game_status);
    const strongRoleChange = p.role_change_protection?.severity === "STRONG";
    const concerns = [...(p.research?.cons ?? []), ...context];
    if (!injuryReady)
      concerns.unshift("Injury feed unavailable; excluded from parlay ideas.");
    if (report)
      concerns.unshift(
        `${report.player_name}: ${report.game_status || report.practice_status} — ${report.injury}.`,
      );
    if (!quote || !isHardRock(quote.sportsbook))
      concerns.unshift("No matching Hard Rock price; research only.");
    if (!freshPrice)
      concerns.unshift(
        "Quote time is missing or over 15 minutes old; research only.",
      );
    if (strongRoleChange)
      concerns.unshift("Significant role change; research only.");
    const grade = { "A+": 4, A: 3, "B+": 2, B: 1 }[p.grade] ?? 0;
    picks.push({
      id: `prop-${p.event_id}-${p.player_id}-${p.provider_market}`,
      event: `NFL-${p.event_id}`,
      sport: "NFL",
      starts: p.start_time,
      matchup: `${p.matchup.away ?? "?"} @ ${p.matchup.home ?? "?"}`,
      title: `${p.player_name} · ${p.pick === "YES" ? "Anytime TD" : `${p.pick === "OVER" ? "Over" : "Under"} ${p.sportsbook_line ?? "—"} ${p.market}`}`,
      market: "Player prop",
      propType: p.provider_market,
      odds,
      quoteAt: quote?.updated_at ?? null,
      book: quote?.sportsbook ?? "No quote",
      score: grade,
      reasons: p.research?.pros?.length
        ? p.research.pros
        : [
            `RDG projection: ${p.rdg_projection}.`,
            `Source research grade: ${p.grade}.`,
          ],
      concerns,
      eligible:
        grade >= 2 &&
        !!quote &&
        isHardRock(quote.sportsbook) &&
        freshPrice &&
        injuryReady &&
        !unavailable &&
        !strongRoleChange &&
        fresh(feeds.props, now),
    });
  }
  const mlbProps = feeds.mlbProps?.data as
    | {
        actionable?: Array<{
          event_id: string;
          commence_time: string;
          matchup: string;
          player: string;
          market: string;
          market_name: string;
          market_line: number;
          signal: string;
          rdg_projection: number;
          reasons?: string[];
          history?: { games: number };
          market_data: {
            quotes: Array<{
              sportsbook_key: string;
              sportsbook: string;
              side: string;
              line: number;
              odds: number | null;
              updated_at?: string;
            }>;
          };
        }>;
      }
    | undefined;
  for (const p of mlbProps?.actionable ?? []) {
    const matching = p.market_data.quotes.filter(
      (q) => q.side.toUpperCase() === p.signal && q.line === p.market_line,
    );
    const quote =
      matching.find((q) => q.sportsbook_key === "hardrockbet_fl") ??
      matching.find((q) => q.sportsbook_key === "hardrockbet");
    const referencePrice = quote?.sportsbook_key === "hardrockbet";
    const timestamp = Date.parse(quote?.updated_at ?? "");
    const recent = timestamp <= now && now - timestamp < FRESH_FOR_MS;
    picks.push({
      id: `mlb-prop-${p.event_id}-${p.player}-${p.market}`,
      event: `MLB-${p.event_id}`,
      sport: "MLB",
      starts: p.commence_time,
      matchup: p.matchup,
      title: `${p.player} · ${p.signal === "OVER" ? "Over" : "Under"} ${p.market_line} ${p.market_name}`,
      market: "Player prop",
      propType: p.market,
      odds: oddsNumber(quote?.odds),
      book: referencePrice
        ? "Hard Rock Bet (IN reference)"
        : (quote?.sportsbook ?? "No Hard Rock quote"),
      referencePrice,
      quoteAt: quote?.updated_at ?? null,
      score: 2,
      reasons: p.reasons ?? [`RDG projection: ${p.rdg_projection}`],
      concerns: [
        "Confirm the starting lineup or probable pitcher before betting.",
        ...(!recent
          ? ["No recent matching Hard Rock quote; research only."]
          : []),
      ],
      eligible:
        !!quote &&
        oddsNumber(quote.odds) !== null &&
        recent &&
        (p.history?.games ?? 0) >= 10 &&
        /^(OVER|UNDER)$/.test(p.signal) &&
        fresh(feeds.mlbProps, now),
    });
  }
  const cfb = feeds.CFB?.data as CFBAnalysis | undefined;
  for (const g of cfb?.games ?? []) {
    const r = g.rdg;
    if (!r || !g.stats_connected || !r.spread_lean) continue;
    const home = r.spread_lean === g.home_team;
    if (!home && r.spread_lean !== g.away_team) continue;
    const line = home
      ? g.hard_rock?.spread?.home_line
      : g.hard_rock?.spread?.away_line;
    if (!finite(line)) continue;
    const odds = oddsNumber(
      home ? g.hard_rock.spread.home_odds : g.hard_rock.spread.away_odds,
    );
    picks.push({
      id: `cfb-${g.event_id}`,
      event: `CFB-${g.event_id}`,
      sport: "CFB",
      starts: g.start_date,
      matchup: `${g.away_team} @ ${g.home_team}`,
      title: `${r.spread_lean} ${line > 0 ? "+" : ""}${line}`,
      market: "Spread",
      odds,
      book: g.sportsbook ?? "Hard Rock Bet (FL)",
      referencePrice: g.requires_florida_verification === true,
      score: strength(r.signal),
      reasons: [
        `RDG projects ${r.projected_winner} by ${r.projected_margin.toFixed(1)}.`,
        `Source signal: ${r.signal}.`,
      ],
      concerns: [
        `College football is in research mode (${r.sample_status}).`,
        ...context,
      ],
      eligible:
        strength(r.signal) > 0 &&
        odds !== null &&
        ["Established", "Developing"].includes(r.sample_status) &&
        finite(r.minimum_core_plays) &&
        r.minimum_core_plays >= 75 &&
        fresh(feeds.CFB, now),
    });
  }
  // Straight-up research picks are independent of the ATS/spread signal.
  // Three projected points is a shortlist filter, not a calibrated win probability.
  for (const g of cfb?.games ?? []) {
    const r = g.rdg;
    if (!r || !g.stats_connected) continue;
    const home = r.projected_winner === g.home_team;
    if (!home && r.projected_winner !== g.away_team) continue;
    const odds = oddsNumber(
      home
        ? g.hard_rock?.moneyline?.home_odds
        : g.hard_rock?.moneyline?.away_odds,
    );
    picks.push({
      id: `cfb-ml-${g.event_id}`,
      event: `CFB-${g.event_id}`,
      sport: "CFB",
      starts: g.start_date,
      matchup: `${g.away_team} @ ${g.home_team}`,
      title: `${r.projected_winner} moneyline`,
      market: "Moneyline",
      odds,
      book: g.sportsbook ?? "Hard Rock Bet (FL)",
      referencePrice: g.requires_florida_verification === true,
      score: 3,
      reasons: [
        `RDG projects ${r.projected_winner} to win${finite(r.projected_margin) ? ` by ${r.projected_margin.toFixed(1)}` : ""}.`,
        "Straight-up winner selection; the spread does not need to be covered.",
      ],
      concerns: [
        `College moneyline research (${r.sample_status}); no calibrated win probability or proven edge at this price.`,
        ...context,
      ],
      eligible:
        finite(r.projected_margin) &&
        r.projected_margin >= 3 &&
        odds !== null &&
        ["Established", "Developing"].includes(r.sample_status) &&
        finite(r.minimum_core_plays) &&
        r.minimum_core_plays >= 75 &&
        fresh(feeds.CFB, now),
    });
  }
  const mlb = feeds.MLB?.data as MLBAnalysis | undefined;
  for (const g of mlb?.games ?? []) {
    const r = g.rdg;
    if (!r) continue;
    const team = r.moneyline_lean || r.projected_winner;
    const home = team === g.home_team;
    if (!home && team !== g.away_team) continue;
    const odds = oddsNumber(
      home
        ? g.hard_rock?.moneyline?.home_odds
        : g.hard_rock?.moneyline?.away_odds,
    );
    const probability = home
      ? r.model_home_probability
      : r.model_away_probability;
    const decimal = decimalOdds(odds);
    const positiveModelValue =
      validProbability(probability) &&
      decimal !== null &&
      (probability / 100) * decimal > 1;
    const starters =
      !!g.starting_pitchers?.home?.name && !!g.starting_pitchers?.away?.name;
    picks.push({
      id: `mlb-${g.event_id}`,
      event: `MLB-${g.event_id}`,
      sport: "MLB",
      starts: g.start_date,
      matchup: `${g.away_team} @ ${g.home_team}`,
      title: `${team} moneyline`,
      market: "Moneyline",
      odds,
      book: g.sportsbook ?? "Hard Rock Bet (FL)",
      referencePrice: g.requires_florida_verification === true,
      score: strength(r.signal),
      reasons: [
        `RDG leans ${team}.`,
        `Probable starters: ${g.starting_pitchers?.away?.name ?? "TBD"} / ${g.starting_pitchers?.home?.name ?? "TBD"}.`,
        `Source signal: ${r.signal}.`,
      ],
      concerns: [
        ...context,
        "Probable starters and batting lineups can change.",
        ...(!positiveModelValue
          ? ["Model estimate does not establish value at this price."]
          : []),
      ],
      eligible:
        strength(r.signal) > 0 &&
        starters &&
        positiveModelValue &&
        fresh(feeds.MLB, now),
    });
  }
  const nhl = feeds.NHL?.data as NHLAnalysis | undefined;
  for (const g of nhl?.games ?? []) {
    if (g.game_type !== 2 || !g.model_available) continue;
    const team = g.moneyline_lean || g.selection || g.rdg_projected_winner;
    const home = team === g.home_team;
    if (!home && team !== g.away_team) continue;
    const odds = oddsNumber(
      home
        ? (g.hard_rock?.home_moneyline ?? g.hard_rock?.moneyline?.home_odds)
        : (g.hard_rock?.away_moneyline ?? g.hard_rock?.moneyline?.away_odds),
    );
    const probability = home ? g.rdg_home_probability : g.rdg_away_probability;
    const decimal = decimalOdds(odds);
    const positiveModelValue =
      validProbability(probability) &&
      decimal !== null &&
      (probability / 100) * decimal > 1;
    picks.push({
      id: `nhl-${g.event_id}`,
      event: `NHL-${g.event_id}`,
      sport: "NHL",
      starts: g.start_time_utc,
      matchup: g.matchup,
      title: `${team} moneyline`,
      market: "Moneyline",
      odds,
      book: g.sportsbook ?? "Hard Rock Bet (FL)",
      referencePrice: g.requires_florida_verification === true,
      score: strength(g.signal),
      reasons: [`RDG leans ${team}.`, `Source signal: ${g.signal}.`],
      concerns: ["Starting goalie confirmation is not connected.", ...context],
      eligible:
        g.odds_available &&
        strength(g.signal) > 0 &&
        positiveModelValue &&
        fresh(feeds.NHL, now),
    });
  }
  picks.push(...totalPicks(feeds, now));
  for (const pick of picks) {
    const feed =
      feeds[
        pick.market === "Player prop"
          ? pick.sport === "NFL"
            ? "props"
            : "mlbProps"
          : pick.sport
      ];
    pick.feedAt = feed ? new Date(feed.loadedAt).toISOString() : null;
    pick.injuriesAt =
      pick.sport === "NFL" && injuryReady
        ? ((injuries as unknown as { generated_at?: string })?.generated_at ??
          null)
        : null;
    pick.lineupsAt = null;
    if (pick.market !== "Player prop") {
      const data = feed?.data as
        | {
            games?: Array<{
              event_id: string;
              quote_times?: Record<string, string | null>;
            }>;
          }
        | undefined;
      const game = data?.games?.find(
        (g) => `${pick.sport}-${g.event_id}` === pick.event,
      );
      pick.quoteAt = game?.quote_times?.[pick.market.toLowerCase()] ?? null;
    }
    const quoteTime = Date.parse(pick.quoteAt ?? "");
    if (
      pick.quoteAt &&
      (!Number.isFinite(quoteTime) ||
        quoteTime > now ||
        now - quoteTime >= FRESH_FOR_MS)
    ) {
      pick.eligible = false;
      pick.concerns.unshift(
        "Sportsbook quote is stale; refresh before using this pick.",
      );
    }
    if (pick.sport !== "NFL")
      pick.concerns.push("Injury screening is not connected for this sport.");
  }
  for (const pick of picks)
    if (pick.referencePrice) {
      pick.concerns.unshift(
        "Indiana reference price. Confirm this exact line and price in Hard Rock Florida before betting.",
      );
      if (!allowReference) pick.eligible = false;
    }
  return picks.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export type ParlayMix =
  | "balanced"
  | "props"
  | "games"
  | "no-spreads"
  | "moneylines"
  | "spreads"
  | "totals";
export function buildIdeas(
  picks: Pick[],
  size: number,
  now: number,
  mix: ParlayMix = "balanced",
): Pick[][] {
  if (!Number.isInteger(size) || size < 2 || size > 8) return [];
  const usedPicks = new Set<string>();
  const results: Pick[][] = [];
  const priorMatchups = new Set<string>();
  const marketUses = new Map<Market, number>();
  const sportUses = new Map<Sport, number>();
  const gameKey = (p: Pick) =>
    `${p.sport}-${p.matchup
      .split(/\s+@\s+|\s+vs\.?\s+/i)
      .map((t) => canonicalTeamKey(p.sport, t))
      .sort()
      .join("-")}-${Date.parse(p.starts)}`;
  for (let i = 0; i < 3; i++) {
    const chosen: Pick[] = [];
    const events = new Set<string>();
    const pool = picks.filter(
      (p) =>
        p.eligible &&
        (mix === "balanced" ||
          (mix === "props" && p.market === "Player prop") ||
          (mix === "games" && p.market !== "Player prop") ||
          (mix === "no-spreads" && p.market !== "Spread") ||
          (mix === "moneylines" && p.market === "Moneyline") ||
          (mix === "spreads" && p.market === "Spread") ||
          (mix === "totals" && p.market === "Total")),
    );
    while (pool.length) {
      // Prefer a different game/sport and include a qualifying prop in a balanced card.
      const priority = (p: Pick) =>
        (priorMatchups.has(gameKey(p)) ? 0 : 20) +
        (chosen.some((c) => c.sport === p.sport) ? 0 : 8) +
        (mix === "balanced" &&
        !chosen.some((c) => c.market === "Player prop") &&
        p.market === "Player prop"
          ? 6
          : 0) +
        (chosen.some((c) => c.market === p.market) ? 0 : 3) +
        (p.propType && !chosen.some((c) => c.propType === p.propType) ? 2 : 0) +
        p.score -
        (mix === "balanced"
          ? (marketUses.get(p.market) ?? 0) * 3 +
            (sportUses.get(p.sport) ?? 0) * 2
          : 0) -
        (mix === "balanced" &&
        p.market === "Spread" &&
        chosen.some((c) => c.market === "Spread")
          ? 12
          : 0);
      pool.sort(
        (a, b) =>
          priority(b) - priority(a) ||
          b.score - a.score ||
          a.id.localeCompare(b.id),
      );
      const p = pool.shift()!;
      if (
        !p.eligible ||
        (!isHardRock(p.book) &&
          !(p.referencePrice && p.book === "Hard Rock Bet (IN reference)")) ||
        oddsNumber(p.odds) === null ||
        usedPicks.has(p.id) ||
        events.has(p.event) ||
        !Number.isFinite(Date.parse(p.starts)) ||
        Date.parse(p.starts) <= now
      )
        continue;
      // Provider event IDs can differ; also reject the same matchup at the same start time.
      const matchupKey = `${p.sport}-${p.matchup
        .split(/\s+@\s+|\s+vs\.?\s+/i)
        .map((team) => canonicalTeamKey(p.sport, team))
        .sort()
        .join("-")}-${Date.parse(p.starts)}`;
      if (events.has(matchupKey)) continue;
      chosen.push(p);
      events.add(p.event);
      events.add(matchupKey);
      if (chosen.length === size) break;
    }
    if (chosen.length !== size) break;
    chosen.forEach((p) => {
      usedPicks.add(p.id);
      priorMatchups.add(gameKey(p));
      marketUses.set(p.market, (marketUses.get(p.market) ?? 0) + 1);
      sportUses.set(p.sport, (sportUses.get(p.sport) ?? 0) + 1);
    });
    results.push(chosen);
  }
  return results;
}
