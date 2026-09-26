import { decimalOdds, oddsNumber, SPORTS, type Pick } from "./board.ts";
export type Outcome = "pending" | "won" | "lost" | "push" | "void";
export type Settlement = {
  id: string;
  at: string;
  outcomes: Outcome[];
  returnUnits?: number;
  source: "manual";
  note: string;
};
export type TrackedBet = {
  id: string;
  savedAt: string;
  kind: "straight" | "parlay";
  mode: "paper" | "placed";
  stakeUnits: number;
  picks: Pick[];
  settlements: Settlement[];
};
export const outcomes: Outcome[] = ["pending", "won", "lost", "push", "void"];
export function validBet(value: unknown): value is TrackedBet {
  if (!value || typeof value !== "object") return false;
  const b = value as TrackedBet;
  return (
    typeof b.id === "string" &&
    /^[a-zA-Z0-9-]{8,80}$/.test(b.id) &&
    Number.isFinite(Date.parse(b.savedAt)) &&
    (b.mode === "paper" || b.mode === "placed") &&
    Number.isFinite(b.stakeUnits) &&
    b.stakeUnits > 0 &&
    b.stakeUnits <= 10000 &&
    Array.isArray(b.picks) &&
    b.picks.length >= 1 &&
    b.picks.length <= 8 &&
    b.kind === (b.picks.length === 1 ? "straight" : "parlay") &&
    b.picks.every(
      (p) =>
        p &&
        SPORTS.includes(p.sport) &&
        typeof p.id === "string" &&
        typeof p.title === "string" &&
        p.title.length <= 300 &&
        typeof p.matchup === "string" &&
        p.matchup.length <= 300 &&
        typeof p.book === "string" &&
        ["Spread", "Moneyline", "Player prop"].includes(p.market) &&
        Number.isFinite(Date.parse(p.starts)) &&
        oddsNumber(p.odds) !== null &&
        Array.isArray(p.reasons) &&
        p.reasons.every((r) => typeof r === "string") &&
        Array.isArray(p.concerns) &&
        p.concerns.every((r) => typeof r === "string"),
    ) &&
    Array.isArray(b.settlements) &&
    b.settlements.length <= 100 &&
    b.settlements.every((s) => validSettlement(s, b.picks.length))
  );
}
export function validSettlement(s: Settlement, size: number) {
  return (
    s &&
    typeof s.id === "string" &&
    /^[a-zA-Z0-9-]{8,80}$/.test(s.id) &&
    Number.isFinite(Date.parse(s.at)) &&
    s.source === "manual" &&
    typeof s.note === "string" &&
    s.note.length <= 1000 &&
    Array.isArray(s.outcomes) &&
    s.outcomes.length === size &&
    s.outcomes.every((o) => outcomes.includes(o)) &&
    (s.returnUnits === undefined ||
      (s.outcomes.every((o) => o !== "pending") &&
        Number.isFinite(s.returnUnits) &&
        s.returnUnits >= 0 &&
        s.returnUnits <= 1e9))
  );
}
export function settlement(b: TrackedBet) {
  const latest = b.settlements.at(-1);
  const states = latest?.outcomes ?? b.picks.map(() => "pending" as Outcome);
  const status: Outcome = states.includes("lost")
    ? "lost"
    : states.includes("pending")
      ? "pending"
      : states.every((s) => s === "void")
        ? "void"
        : states.every((s) => s === "void" || s === "push")
          ? "push"
          : "won";
  let returned: number | null = null;
  if (status !== "pending")
    returned =
      latest?.returnUnits ??
      (status === "lost"
        ? 0
        : b.stakeUnits *
          b.picks.reduce(
            (v, p, i) =>
              v * (states[i] === "won" ? (decimalOdds(p.odds) ?? 1) : 1),
            1,
          ));
  return {
    status,
    returned,
    profit: returned === null ? null : returned - b.stakeUnits,
    states,
  };
}
export function metrics(bets: TrackedBet[]) {
  let wins = 0,
    losses = 0,
    pushes = 0,
    voids = 0,
    pending = 0,
    profit = 0,
    risked = 0;
  for (const b of bets) {
    const s = settlement(b);
    if (s.status === "pending") {
      pending++;
      continue;
    }
    if (s.status === "won") wins++;
    if (s.status === "lost") losses++;
    if (s.status === "push") pushes++;
    if (s.status === "void") voids++;
    profit += s.profit ?? 0;
    if (s.status !== "void") risked += b.stakeUnits;
  }
  return {
    wins,
    losses,
    pushes,
    voids,
    pending,
    profit,
    risked,
    roi: risked ? (100 * profit) / risked : null,
  };
}
export function betSport(b: TrackedBet) {
  const sports = new Set(b.picks.map((p) => p.sport));
  return sports.size === 1 ? b.picks[0].sport : "Mixed sports";
}
export function betMarket(b: TrackedBet) {
  const markets = new Set(b.picks.map((p) => p.market));
  return markets.size === 1 ? b.picks[0].market : "Mixed markets";
}
