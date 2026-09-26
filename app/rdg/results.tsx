"use client";
import { useEffect, useState } from "react";
import {
  type TrackedBet,
  type Outcome,
  metrics,
  settlement,
  betSport,
  betMarket,
  outcomes,
  validBet,
} from "./journal";
import {
  readJournal,
  writeJournal,
  journalRequest,
  saveSettlement,
} from "./journal-store";
import { formatOdds } from "./board";
import { checkedTime } from "./pick-details";
import Wins from "./wins";
import LegacyResults from "./legacy-results";
const units = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}u`;
function ResultEditor({
  bet,
  onSaved,
}: {
  bet: TrackedBet;
  onSaved: (m: string) => void;
}) {
  const current = settlement(bet),
    [states, setStates] = useState<Outcome[]>(current.states),
    [override, setOverride] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const msg = await saveSettlement(bet, {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        source: "manual",
        outcomes: states,
        note,
        ...(override.trim() ? { returnUnits: Number(override) } : {}),
      });
      onSaved(msg);
    } catch (e) {
      onSaved(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="result-editor">
      <summary>Enter or correct result</summary>
      <p>
        Use your sportsbook’s settled ticket. Results here are self-reported,
        not automatically verified.
      </p>
      {bet.picks.map((p, i) => (
        <label key={p.id}>
          {p.title}
          <select
            aria-label={`Result for ${p.title}`}
            value={states[i]}
            onChange={(e) =>
              setStates((v) =>
                v.map((x, j) => (i === j ? (e.target.value as Outcome) : x)),
              )
            }
          >
            {outcomes.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      ))}
      <label>
        Actual total return in units (optional, includes stake)
        <input
          type="number"
          min="0"
          step="0.01"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          placeholder="Use original odds"
        />
      </label>
      <small>
        Enter the settled return for boosts, cash-outs, or sportsbook-specific
        void rules. All legs must be settled for an override.
      </small>
      <label>
        Settlement note
        <input
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional ticket note"
        />
      </label>
      <button className="primary-button" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save settlement"}
      </button>
      <p>
        {bet.settlements.length} recorded settlement update(s). Original odds
        remain unchanged.
      </p>
    </details>
  );
}
export default function Results() {
  const [rows, setRows] = useState<TrackedBet[]>([]),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false),
    [sport, setSport] = useState("All sports"),
    [market, setMarket] = useState("All bet types"),
    [kind, setKind] = useState("All slips"),
    [mode, setMode] = useState("paper"),
    [legacy, setLegacy] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    function load() {
      try {
        setRows(readJournal());
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Journal unavailable");
      }
      setReady(true);
    }
    load();
    window.addEventListener("rdg-journal", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("rdg-journal", load);
      window.removeEventListener("storage", load);
    };
  }, []);
  async function sync() {
    setBusy(true);
    try {
      const local = readJournal();
      for (const bet of local) await journalRequest("POST", { bet });
      const data = await journalRequest("GET");
      if (!Array.isArray(data.bets) || !data.bets.every(validBet))
        throw Error(
          "Cloud returned an invalid journal. Device records were kept.",
        );
      const merged = new Map(local.map((b) => [b.id, b]));
      for (const b of data.bets as TrackedBet[]) merged.set(b.id, b);
      writeJournal([...merged.values()]);
      setMessage(
        "Cloud backup synchronized. Access is tied to this browser’s private journal token.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Cloud backup unavailable");
    } finally {
      setBusy(false);
    }
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(readJournal(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `rdg-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5e6) throw Error("Backup is too large.");
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data) || data.length > 1000 || !data.every(validBet))
        throw Error("This is not a valid RDG journal backup.");
      const merged = new Map(readJournal().map((b) => [b.id, b]));
      for (const b of data) if (!merged.has(b.id)) merged.set(b.id, b);
      writeJournal([...merged.values()]);
      setMessage("Backup restored. Existing records were preserved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    }
  }
  const filtered = rows.filter(
    (b) =>
      b.mode === mode &&
      (sport === "All sports" || betSport(b) === sport) &&
      (market === "All bet types" || betMarket(b) === market) &&
      (kind === "All slips" || b.kind === kind),
  );
  const m = metrics(filtered);
  return (
    <section className="results-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">THE RECORD</p>
          <h2>Your original picks. Actual outcomes.</h2>
          <p>
            Track straight bets and entire parlays separately, with frozen odds
            and timestamps.
          </p>
        </div>
      </div>
      <div className="journal-toolbar">
        <button aria-pressed={!legacy} onClick={() => setLegacy(false)}>
          My bet journal
        </button>
        <button aria-pressed={legacy} onClick={() => setLegacy(true)}>
          Legacy model record
        </button>
      </div>
      {legacy ? (
        <LegacyResults />
      ) : (
        <>
          <p className="notice">
            Device journal with optional cloud backup. Export before clearing
            browser data or switching devices. Paper and placed bets are
            separate; settlements are entered from your ticket.
          </p>
          <div className="journal-toolbar">
            <label>
              Record type
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="paper">Paper bets</option>
                <option value="placed">Placed bets</option>
              </select>
            </label>
            <label>
              Sport
              <select value={sport} onChange={(e) => setSport(e.target.value)}>
                {["All sports", ...new Set(rows.map(betSport))].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Bet type
              <select
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              >
                {[
                  "All bet types",
                  "Spread",
                  "Moneyline",
                  "Total",
                  "Player prop",
                  "Mixed markets",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Slip
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {["All slips", "straight", "parlay"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <Wins bets={filtered} mode={mode} ready={ready} />
          <div className="result-stats">
            {[
              ["Wins / losses", `${m.wins} / ${m.losses}`],
              [
                "Win rate",
                m.wins + m.losses
                  ? `${((100 * m.wins) / (m.wins + m.losses)).toFixed(1)}%`
                  : "—",
              ],
              ["Net units", units(m.profit)],
              ["ROI", m.roi === null ? "—" : `${m.roi.toFixed(1)}%`],
              ["Pending", String(m.pending)],
            ].map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <p className="quote-note">
            {m.pushes} pushes · {m.voids} voids. Win rate excludes pending,
            pushed and void bets. ROI = net profit ÷ settled stakes, excluding
            fully void bets and pending bets. A parlay counts as one wager;
            mixed-sport slips have their own category.
          </p>
          <div className="journal-toolbar">
            <button onClick={exportFile} disabled={!ready}>
              Export backup
            </button>
            <label className="import-backup">
              Restore backup
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => void importFile(e.target.files?.[0])}
              />
            </label>
            <button disabled={busy} onClick={sync}>
              {busy ? "Syncing…" : "Sync cloud backup"}
            </button>
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {!ready ? (
            <p>Loading journal…</p>
          ) : !filtered.length ? (
            <div className="empty">
              <h3>No tracked bets in this view</h3>
              <p>
                Use Track this straight or Track this parlay on Today’s Picks.
              </p>
            </div>
          ) : (
            <>
              <div className="table-scroll">
                <table className="journal-summary">
                  <caption>Breakdown by sport and bet type</caption>
                  <thead>
                    <tr>
                      <th>Sport / type</th>
                      <th>W–L</th>
                      <th>Net units</th>
                      <th>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...new Set(
                        filtered.map((b) => `${betSport(b)} · ${betMarket(b)}`),
                      ),
                    ].map((key) => {
                      const stats = metrics(
                        filtered.filter(
                          (b) => `${betSport(b)} · ${betMarket(b)}` === key,
                        ),
                      );
                      return (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>
                            {stats.wins}–{stats.losses}
                          </td>
                          <td>{units(stats.profit)}</td>
                          <td>
                            {stats.roi === null
                              ? "—"
                              : `${stats.roi.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {[...filtered].reverse().map((b) => (
                <article className="tracked-card" key={b.id}>
                  <div className="pick-top">
                    <strong>
                      {b.kind === "straight"
                        ? "Straight bet"
                        : `${b.picks.length}-leg parlay`}{" "}
                      · {betSport(b)}
                    </strong>
                    <span>{settlement(b).status}</span>
                  </div>
                  <p>
                    Saved {checkedTime(b.savedAt)} · {b.stakeUnits}u stake ·{" "}
                    {b.mode}
                  </p>
                  {b.picks.map((p) => (
                    <p key={p.id}>
                      {p.title} <strong>{formatOdds(p.odds)}</strong>
                      <small>
                        {" "}
                        {p.book} · Quote: {checkedTime(p.quoteAt)}
                      </small>
                    </p>
                  ))}
                  <p>
                    Net:{" "}
                    {settlement(b).profit === null
                      ? "Pending"
                      : units(settlement(b).profit!)}{" "}
                    · {betMarket(b)}
                  </p>
                  <ResultEditor bet={b} onSaved={setMessage} />
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
