"use client";
import { validBet, type TrackedBet, type Settlement } from "./journal";
const KEY = "rdg-journal-v1",
  TOKEN = "rdg-journal-token-v1";
export function readJournal(): TrackedBet[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.every(validBet))
    throw Error(
      "Saved journal could not be read. Export or restore a valid backup before adding bets.",
    );
  return rows;
}
export function writeJournal(rows: TrackedBet[]) {
  localStorage.setItem(KEY, JSON.stringify(rows));
  window.dispatchEvent(new Event("rdg-journal"));
}
function token() {
  let t = localStorage.getItem(TOKEN);
  if (!t) {
    t = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem(TOKEN, t);
  }
  return t;
}
export async function journalRequest(method: string, body?: unknown) {
  const r = await fetch("/api/journal", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error ?? "Cloud journal unavailable");
  return data;
}
export async function saveBet(bet: TrackedBet) {
  if (!validBet(bet))
    throw Error("This bet is incomplete and cannot be tracked.");
  const rows = readJournal();
  if (rows.some((b) => b.id === bet.id)) return "Already tracked";
  writeJournal([...rows, bet]);
  try {
    await journalRequest("POST", { bet });
    return "Saved on this device and backed up to cloud";
  } catch {
    return "Saved on this device only. Export a backup from Results.";
  }
}
export async function saveSettlement(bet: TrackedBet, s: Settlement) {
  const rows = readJournal();
  const current = rows.find((b) => b.id === bet.id);
  if (!current) throw Error("Tracked bet not found.");
  const updated = { ...current, settlements: [...current.settlements, s] };
  if (!validBet(updated)) throw Error("Settlement is invalid.");
  writeJournal(rows.map((b) => (b.id === bet.id ? updated : b)));
  try {
    await journalRequest("POST", { bet: updated });
    return "Result saved and backed up";
  } catch {
    return "Result saved on this device only. Export a backup.";
  }
}
