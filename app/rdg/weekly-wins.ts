import { easternDate } from "./board.ts";
import { settlement, type TrackedBet } from "./journal.ts";

// Calendar arithmetic uses UTC on an Eastern date string, avoiding DST shifts.
export function weekOf(timestamp: string) {
  const day = new Date(`${easternDate(timestamp)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}
export function weekLabel(start: string) {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + 6);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${fmt.format(first)} – ${fmt.format(last)}`;
}
export function weeklyWins(bets: TrackedBet[]) {
  const weeks = new Map<
    string,
    { start: string; bets: TrackedBet[]; profit: number }
  >();
  for (const b of bets) {
    const result = settlement(b);
    if (b.kind !== "parlay" || b.picks.length < 5 || result.status !== "won")
      continue;
    // Date the current winning run began. A payout correction does not move a
    // win to another week, but reversing a win removes it from the showcase.
    let wonAt: string | null = null;
    b.settlements.forEach((s, i) => {
      const won =
        settlement({ ...b, settlements: b.settlements.slice(0, i + 1) })
          .status === "won";
      wonAt = won ? (wonAt ?? s.at) : null;
    });
    if (!wonAt) continue;
    const start = weekOf(wonAt);
    const group = weeks.get(start) ?? { start, bets: [], profit: 0 };
    group.bets.push(b);
    group.profit += result.profit ?? 0;
    weeks.set(start, group);
  }
  return [...weeks.values()].sort((a, b) => b.start.localeCompare(a.start));
}
