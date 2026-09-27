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

export async function checkFinalScores() {
  const { automaticSettlement } = await import("./auto-grade");
  const now = Date.now();
  const rows = readJournal().filter(
    (b) =>
      !b.settlements.some((s) => s.source === "manual") &&
      b.picks.some(
        (p) =>
          p.grading &&
          Date.parse(p.starts) < now &&
          Date.parse(p.starts) > now - 31 * 86400000,
      ),
  );
  let changed = 0,
    failed = 0;
  const batch = rows.slice(-30);
  for (let i = 0; i < batch.length; i += 4)
    await Promise.all(
      batch.slice(i, i + 4).map(async (b) => {
        try {
          const response = await fetch("/api/journal/grade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bet: b }),
            signal: AbortSignal.timeout(20000),
          });
          if (!response.ok) {
            failed++;
            return;
          }
          const data = await response.json();
          const current = readJournal().find((r) => r.id === b.id);
          if (
            !current ||
            !Array.isArray(data.outcomes) ||
            !data.outcomes.every((o: unknown) =>
              ["pending", "won", "lost", "push"].includes(String(o)),
            )
          )
            return;
          const result = automaticSettlement(
            current,
            data.outcomes,
            new Date().toISOString(),
          );
          if (result) {
            await saveSettlement(current, result);
            changed++;
          }
          if (data.warnings?.length) failed++;
        } catch {
          failed++;
        }
      }),
    );
  return `${changed} slip(s) updated from final scores.${failed ? " Some scores were unavailable; saved results were kept." : ""} Props and unsupported/older snapshots need manual review. Checks cover up to 30 recent slips per run.`;
}
