"use client";
import { useEffect, useState } from "react";
import { easternDate, type Feeds, type SportFilter } from "./board";
import { dailySlips } from "./daily-slips";
import { readJournal, writeJournal } from "./journal-store";
export function useDailySlips(
  feeds: Feeds,
  now: number,
  ready: boolean,
  sport: SportFilter,
) {
  const [notice, setNotice] = useState("");
  const signature = JSON.stringify(feeds);
  useEffect(() => {
    if (!ready || !now || sport === "NBA" || sport === "UFC") return;
    try {
      const rows = readJournal();
      const snapshots = dailySlips(
        JSON.parse(signature),
        now,
        `device-${sport}`,
      );
      const additions = snapshots.filter(
        (b) => !rows.some((r) => r.id === b.id),
      );
      if (additions.length) writeJournal([...rows, ...additions]);
      const saved =
        additions.length ||
        rows.some((b) =>
          b.id.startsWith(`device-${sport}-${easternDate(now)}-`),
        );
      setNotice(
        saved
          ? "Daily model slips saved on this device. View them in Results → Daily model (this device)."
          : "Daily model snapshots will appear when enough qualifying Florida-priced picks are available for today.",
      );
    } catch {
      setNotice(
        "Daily snapshots could not be saved on this device. Export your journal and check browser storage.",
      );
    }
  }, [signature, now, ready, sport]);
  return ready && sport !== "NBA" && sport !== "UFC" ? notice : "";
}
