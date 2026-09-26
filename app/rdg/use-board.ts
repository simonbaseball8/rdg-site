"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FRESH_FOR_MS,
  SPORTS,
  type Feed,
  type Feeds,
  type SportFilter,
} from "./board";

const endpoints = {
  NFL: "/api/analyze",
  CFB: "/api/cfb-picks",
  MLB: "/api/mlb-picks",
  NHL: "/api/nhl-picks",
  props: "/api/nfl-player-props",
  injuries: "/api/nfl-injuries",
} as const;
type Key = keyof typeof endpoints;
const cache = new Map<Key, Feed>();
const inFlight = new Map<Key, Promise<Feed>>();

async function request(key: Key, force: boolean): Promise<Feed> {
  const saved = cache.get(key);
  if (!force && saved && Date.now() - saved.loadedAt < FRESH_FOR_MS)
    return saved;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = (async () => {
    try {
      const response = await fetch(endpoints[key], {
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok)
        throw new Error(`Feed unavailable (${response.status}).`);
      const data = await response.json();
      if (!data || data.success === false)
        throw new Error("Feed unavailable. Try again shortly.");
      const rows =
        key === "props"
          ? data.parlay_pool
          : key === "injuries"
            ? (data.current_injuries ?? data.injuries)
            : data.games;
      if (!Array.isArray(rows))
        throw new Error("The feed returned an unexpected response.");
      const feed = { data, loadedAt: Date.now() };
      cache.set(key, feed);
      return feed;
    } catch (error) {
      cache.delete(key);
      return {
        data: null,
        loadedAt: Date.now(),
        error: error instanceof Error ? error.message : "Feed unavailable.",
      };
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, work);
  return work;
}

export function useBoard(sport: SportFilter, enabled: boolean) {
  const [feeds, setFeeds] = useState<Feeds>({});
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const consumedRefresh = useRef(0);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const start = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const keys: Key[] =
      sport === "ALL"
        ? [...SPORTS, "props", "injuries"]
        : sport === "NFL"
          ? ["NFL", "props", "injuries"]
          : [sport];
    const force = refresh > consumedRefresh.current;
    consumedRefresh.current = refresh;
    async function load() {
      setLoading(true);
      const results = await Promise.all(
        keys.map(async (key) => [key, await request(key, force)] as const),
      );
      if (!cancelled) {
        setFeeds((previous) => ({
          ...previous,
          ...Object.fromEntries(results),
        }));
        setClock(Date.now());
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sport, enabled, refresh]);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  const keys: Key[] =
    sport === "ALL"
      ? [...SPORTS, "props", "injuries"]
      : sport === "NFL"
        ? ["NFL", "props", "injuries"]
        : [sport];
  const relevant = keys.map((key) => ({ key, feed: feeds[key] }));
  return { feeds, loading, reload, now: clock, relevant };
}
