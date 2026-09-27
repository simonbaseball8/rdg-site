import { canonicalTeamKey } from "./team-aliases.ts";
import { isHardRock, oddsNumber, type Pick, type ParlayMix } from "./board.ts";
export type PickFilters = {
  maxFavorite: number | null;
  excludedTeams: string[];
  markets: string[];
  propTypes?: string[];
};
export function matchupTeams(p: Pick) {
  return p.matchup.split(/\s+@\s+|\s+vs\.?\s+/i).filter(Boolean);
}
export function sameGame(a: Pick, b: Pick) {
  const key = (p: Pick) =>
    `${p.sport}:${matchupTeams(p)
      .map((t) => canonicalTeamKey(p.sport, t))
      .sort()
      .join(":")}:${Date.parse(p.starts)}`;
  return a.event === b.event || key(a) === key(b);
}
export function passesFilters(p: Pick, f: PickFilters) {
  return (
    (p.market !== "Player prop" ||
      !f.propTypes?.length ||
      f.propTypes.includes(p.propType ?? "")) &&
    (!f.markets.length || f.markets.includes(p.market)) &&
    (f.maxFavorite === null || p.odds === null || p.odds >= -f.maxFavorite) &&
    !f.excludedTeams.some((t) =>
      matchupTeams(p).some(
        (team) =>
          canonicalTeamKey(p.sport, team) === canonicalTeamKey(p.sport, t),
      ),
    )
  );
}
export function actionable(p: Pick, now: number) {
  return (
    p.eligible &&
    oddsNumber(p.odds) !== null &&
    Date.parse(p.starts) > now &&
    (isHardRock(p.book) ||
      (p.referencePrice && p.book === "Hard Rock Bet (IN reference)"))
  );
}
export function matchesMix(p: Pick, mix: ParlayMix) {
  return (
    mix === "balanced" ||
    (mix === "props" && p.market === "Player prop") ||
    (mix === "games" && p.market !== "Player prop") ||
    (mix === "no-spreads" && p.market !== "Spread") ||
    (mix === "moneylines" && p.market === "Moneyline") ||
    (mix === "spreads" && p.market === "Spread") ||
    (mix === "totals" && p.market === "Total")
  );
}
export function replacements(
  pool: Pick[],
  slip: Pick[],
  index: number,
  now: number,
  mix: ParlayMix,
) {
  return pool.filter(
    (p) =>
      actionable(p, now) &&
      matchesMix(p, mix) &&
      p.id !== slip[index]?.id &&
      !slip.some((leg, i) => i !== index && sameGame(p, leg)),
  );
}
