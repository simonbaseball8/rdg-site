"use client";
import { useEffect, useState } from "react";
import { metrics, validBet, type TrackedBet, settlement } from "./journal";
import Wins from "./wins";
import { formatOdds } from "./board";
export default function PublishedResults() {
  const [ready, setReady] = useState(false);
  const [bets, setBets] = useState<TrackedBet[]>([]),
    [message, setMessage] = useState("Loading published daily slips…");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/daily-slips", { signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!Array.isArray(d.bets) || !d.bets.every(validBet))
          throw Error("Daily archive unavailable");
        setBets(d.bets);
        setMessage(d.notice);
        setReady(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  const m = metrics(bets);
  if (!ready)
    return (
      <p className="notice" role="status">
        {message}
      </p>
    );
  return (
    <section>
      <p className="notice">{message}</p>
      <Wins bets={bets} mode="model" ready={true} />
      <div className="result-stats">
        {[
          ["Wins / losses", `${m.wins} / ${m.losses}`],
          ["Pending", m.pending],
          ["Net units", `${m.profit.toFixed(2)}u`],
          ["ROI", m.roi === null ? "—" : `${m.roi.toFixed(1)}%`],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="quote-note">
        All published wins and losses are included. Game markets use final
        scores; props remain pending. Original snapshots never change. Showing
        the latest 270 slips.
      </p>
      {bets.map((b) => (
        <details className="tracked-card" key={b.id}>
          <summary>
            {b.savedAt.slice(0, 10)} · {b.picks.length}-leg parlay ·{" "}
            {settlement(b).status}
          </summary>
          {b.picks.map((p, i) => (
            <p key={p.id}>
              {p.title} {formatOdds(p.odds)} · {p.matchup} ·{" "}
              {settlement(b).states[i]}
            </p>
          ))}
        </details>
      ))}
    </section>
  );
}
