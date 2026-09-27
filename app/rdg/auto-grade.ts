import { canonicalTeamKey } from "./team-aliases.ts";
import { type Pick } from "./board.ts";
import {
  settlement,
  type TrackedBet,
  type Settlement,
  type Outcome,
} from "./journal.ts";
export type FinalGame = {
  id: string;
  starts: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  final: boolean;
};
export function gradePick(p: Pick, games: FinalGame[]): Outcome {
  const spec = p.grading;
  if (!spec || p.market === "Player prop") return "pending";
  const teams = p.matchup.split(/\s+@\s+|\s+vs\.?\s+/i);
  if (teams.length !== 2) return "pending";
  const key = (s: string) => canonicalTeamKey(p.sport, s);
  const matches = games.filter(
    (g) =>
      key(g.away) === key(teams[0]) &&
      key(g.home) === key(teams[1]) &&
      Math.abs(Date.parse(g.starts) - Date.parse(p.starts)) <= 90 * 60000,
  );
  // Ambiguous doubleheaders, postponed starts and incomplete scores need review.
  if (matches.length !== 1) return "pending";
  const g = matches[0];
  if (
    !g.final ||
    !Number.isFinite(g.homeScore) ||
    !Number.isFinite(g.awayScore) ||
    g.homeScore < 0 ||
    g.awayScore < 0
  )
    return "pending";
  let delta: number;
  if (
    p.market === "Total" &&
    typeof spec.line === "number" &&
    Number.isFinite(spec.line) &&
    (spec.side === "Over" || spec.side === "Under")
  ) {
    delta =
      (g.homeScore + g.awayScore - spec.line) * (spec.side === "Over" ? 1 : -1);
  } else if ((p.market === "Moneyline" || p.market === "Spread") && spec.team) {
    const home = key(spec.team) === key(g.home),
      away = key(spec.team) === key(g.away);
    if (home === away) return "pending";
    if (
      p.market === "Spread" &&
      (typeof spec.line !== "number" || !Number.isFinite(spec.line))
    )
      return "pending";
    delta =
      (home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore) +
      (p.market === "Spread" ? spec.line! : 0);
  } else return "pending";
  return delta > 0 ? "won" : delta < 0 ? "lost" : "push";
}
export function automaticSettlement(
  b: TrackedBet,
  grades: Outcome[],
  at: string,
): Settlement | null {
  // A manually entered result/cash-out is authoritative until the user changes it.
  if (
    b.settlements.some((s) => s.source === "manual") ||
    grades.length !== b.picks.length
  )
    return null;
  const before = settlement(b).states;
  const after = grades.map((g, i) => (g === "pending" ? before[i] : g));
  if (after.every((g, i) => g === before[i])) return null;
  return {
    id: crypto.randomUUID(),
    at,
    source: "automatic",
    outcomes: after,
    note: "ESPN final scores. Game markets only; player props, postponed/ambiguous games and sportsbook-specific rules need manual review.",
  };
}
