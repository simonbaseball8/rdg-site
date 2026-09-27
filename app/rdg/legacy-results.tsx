"use client";

import { useEffect, useState } from "react";
import { LABELS, SPORTS, type SportFilter } from "./board";
type Row = { sport: string | null; status: string | null; tier: string | null };

export default function Results() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [sport, setSport] = useState<SportFilter>("ALL");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    async function load() {
      setStatus("loading");
      try {
        // Loaded only when Results is opened; no sportsbook requests here.
        const { supabase } = await import("../supabase");
        const all: Row[] = [];
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from("rdg_picks")
            .select("sport, status, tier")
            .order("id", { ascending: true })
            .range(offset, offset + 999);
          if (error) throw error;
          all.push(...(data ?? []));
          if (!data || data.length < 1000) break;
        }
        if (alive) {
          setRows(all);
          setStatus("done");
        }
      } catch {
        if (alive) setStatus("error");
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [attempt]);
  const selected = rows.filter(
    (row) =>
      SPORTS.includes(row.sport as (typeof SPORTS)[number]) &&
      (sport === "ALL" || row.sport === sport),
  );
  const wins = selected.filter((r) => r.status === "won").length;
  const losses = selected.filter((r) => r.status === "lost").length;
  const pushes = selected.filter((r) => r.status === "push").length;
  const pending = selected.filter((r) => r.status === "pending").length;
  const winRate =
    wins + losses ? `${((wins / (wins + losses)) * 100).toFixed(1)}%` : "—";
  return (
    <section className="results-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">THE RECORD</p>
          <h2>Results, without the spin.</h2>
          <p>Saved individual picks from your existing tracker.</p>
        </div>
      </div>
      <div className="sport-tabs" aria-label="Filter results by sport">
        {(["ALL", ...SPORTS] as const).map((s) => (
          <button
            key={s}
            aria-pressed={sport === s}
            onClick={() => setSport(s)}
          >
            {LABELS[s]}
          </button>
        ))}
      </div>
      {status === "loading" ? (
        <div className="empty" role="status">
          Loading recorded results…
        </div>
      ) : status === "error" ? (
        <div className="empty" role="alert">
          <h3>Results are unavailable</h3>
          <p>Your tracking database could not be loaded.</p>
          <button
            className="primary-button"
            onClick={() => setAttempt((a) => a + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="result-stats">
            {[
              ["Record", `${wins}–${losses}–${pushes}`],
              ["Win rate", winRate],
              ["Settled picks", String(wins + losses + pushes)],
              ["Pending", String(pending)],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {!selected.length && (
            <div className="empty">
              <h3>No recorded picks yet</h3>
              <p>Results will appear here after this sport has saved picks.</p>
            </div>
          )}
          <div className="notice">
            Win rate excludes pushes. These are individual picks, not parlay
            results. Profit and ROI are unavailable because this view does not
            have recorded stakes and settlement payouts.
          </div>
        </>
      )}
    </section>
  );
}
