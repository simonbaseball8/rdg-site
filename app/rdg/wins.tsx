import { formatOdds } from "./board";
import { betSport, settlement, type TrackedBet } from "./journal";
import { weeklyWins, weekLabel } from "./weekly-wins";
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
export default function Wins({
  bets,
  mode,
  ready,
}: {
  bets: TrackedBet[];
  mode: string;
  ready: boolean;
}) {
  const weeks = weeklyWins(bets);
  const count = weeks.reduce((n, w) => n + w.bets.length, 0);
  return (
    <section className="wins-panel" aria-labelledby="wins-heading">
      <div className="pick-top">
        <div>
          <p className="eyebrow">5+ LEG PARLAYS</p>
          <h2 id="wins-heading">Wins</h2>
        </div>
        <span className="win-count">
          {count} winning {count === 1 ? "slip" : "slips"}
        </span>
      </div>
      <p className="quote-note">
        {mode === "placed" ? "Placed bets" : "Paper bets"} · Current filters
        apply. Weeks run Sunday–Saturday (Eastern), based on when you first
        record the win. Results are self-reported.
      </p>
      {!ready ? (
        <p>Loading wins…</p>
      ) : !weeks.length ? (
        <p>
          No winning 5+ leg slips in this view yet. Track a parlay and enter its
          settled result to add it here.
        </p>
      ) : (
        weeks.map((w) => (
          <details
            className="win-week"
            key={w.start}
            open={w.start === weeks[0].start}
          >
            <summary>
              <strong>{weekLabel(w.start)}</strong>
              <span>
                {w.bets.length} {w.bets.length === 1 ? "win" : "wins"} ·{" "}
                {units(w.profit)} net from winning slips
              </span>
            </summary>
            {w.bets.map((b) => {
              const result = settlement(b);
              const reduced = result.states.filter(
                (s) => s === "push" || s === "void",
              ).length;
              return (
                <article className="win-slip" key={b.id}>
                  <div className="pick-top">
                    <strong>
                      {b.picks.length}-leg parlay · {betSport(b)}
                    </strong>
                    <span>{units(result.profit ?? 0)} net</span>
                  </div>
                  <p>
                    {b.stakeUnits}u stake · {result.returned?.toFixed(2)}u
                    returned, including stake
                    {reduced ? ` · ${reduced} pushed/void legs` : ""}
                  </p>
                  <ol>
                    {b.picks.map((p, i) => (
                      <li key={p.id}>
                        {p.title} <strong>{formatOdds(p.odds)}</strong>
                        <small>
                          {p.matchup} · {result.states[i]}
                        </small>
                      </li>
                    ))}
                  </ol>
                </article>
              );
            })}
          </details>
        ))
      )}
      <p className="quote-note">
        Includes winning slips originally saved with at least five legs;
        pushed/void legs are identified. Overall wins, losses and ROI below
        include losing bets too.
      </p>
    </section>
  );
}
