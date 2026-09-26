"use client";
import { useState } from "react";
import { isHardRock, type Pick } from "./board";
import { saveBet } from "./journal-store";
export function checkedTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not supplied";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}
export function PickFreshness({ pick: p }: { pick: Pick }) {
  return (
    <div className="pick-freshness">
      <span className={p.referencePrice ? "price-reference" : "price-florida"}>
        {p.referencePrice
          ? "Indiana reference · verify Florida"
          : isHardRock(p.book)
            ? "Florida feed · confirm in app"
            : `${p.book} · not a Florida quote`}
      </span>
      <dl>
        <dt>Odds updated</dt>
        <dd>{checkedTime(p.quoteAt)}</dd>
        <dt>Feed received</dt>
        <dd>{checkedTime(p.feedAt)}</dd>
        <dt>Injury report fetched</dt>
        <dd>{p.injuriesAt ? checkedTime(p.injuriesAt) : "Not connected"}</dd>
        <dt>Confirmed lineup checked</dt>
        <dd>{p.lineupsAt ? checkedTime(p.lineupsAt) : "Not connected"}</dd>
      </dl>
    </div>
  );
}
export function TrackButton({ picks }: { picks: Pick[] }) {
  const [open, setOpen] = useState(false),
    [units, setUnits] = useState("1"),
    [mode, setMode] = useState<"paper" | "placed">("paper"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  async function track() {
    setBusy(true);
    try {
      if (picks.some((p) => !p.eligible || Date.parse(p.starts) <= Date.now()))
        throw Error("This selection is no longer eligible. Refresh the board.");
      const stakeUnits = Number(units);
      if (!Number.isFinite(stakeUnits) || stakeUnits <= 0 || stakeUnits > 10000)
        throw Error("Enter a stake from 0.01 to 10,000 units.");
      const msg = await saveBet({
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        kind: picks.length === 1 ? "straight" : "parlay",
        mode,
        stakeUnits,
        picks: structuredClone(picks),
        settlements: [],
      });
      setMessage(msg);
      setSaved(true);
      setOpen(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="track-bet">
      <button
        className="secondary-button"
        disabled={saved || busy}
        onClick={() => setOpen(!open)}
      >
        {saved
          ? "Tracked in Results"
          : picks.length === 1
            ? "Track this straight"
            : "Track this parlay"}
      </button>
      {open && (
        <div className="tracking-form">
          <label>
            Record as
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="paper">Paper bet — research only</option>
              <option value="placed">
                Placed bet — prices match my ticket
              </option>
            </select>
          </label>
          <label>
            Stake in units
            <input
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
          </label>
          <small>
            1 unit = your normal bet size. Original displayed odds are saved.
            Only mark placed if every price matches your ticket. This does not
            place a bet.
          </small>
          <button className="primary-button" disabled={busy} onClick={track}>
            {busy ? "Saving…" : "Save original picks"}
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="tracking-message">
          {message}
        </p>
      )}
    </div>
  );
}
