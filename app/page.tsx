"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type Parlay = {
  id: string | number;
  title?: string;
  name?: string;
  subtitle?: string;
  confidence?: string;
  risk_level?: string;
  sport?: string;
  created_at?: string;
};

export default function Home() {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadParlays() {
      const { data, error } = await supabase
        .from("parlays")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        setError(error.message);
      } else {
        setParlays(data || []);
      }

      setLoading(false);
    }

    loadParlays();
  }, []);

  return (
    <main className="min-h-screen bg-[#050807] text-white">
      <header className="border-b border-white/10 px-6 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 font-black text-black">
                RDG
              </div>

              <div>
                <h1 className="font-bold tracking-wide">
                  RESPONSIBLE DEGENERATE GAMBLING
                </h1>
                <p className="text-xs text-gray-500">
                  DATA-DRIVEN BETTING DASHBOARD
                </p>
              </div>
            </div>
          </div>

          <div className="text-xs text-green-400">● LIVE</div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-green-400">
          Today&apos;s Board
        </div>

        <h2 className="text-3xl font-bold">Today&apos;s Parlays</h2>

        <p className="mt-2 text-sm text-gray-400">
          Daily betting research, player props, and parlay tracking.
        </p>

        <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat title="ACTIVE SLIPS" value={parlays.length.toString()} />
          <Stat title="SPORTS" value="4" />
          <Stat title="BEST BET" value="—" />
          <Stat title="TODAY'S RECORD" value="0-0" />
        </section>

        <section className="mt-8">
          {loading && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-gray-400">
              Loading today&apos;s parlays...
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">
              Database error: {error}
            </div>
          )}

          {!loading && !error && parlays.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8">
              <p className="font-semibold">No parlays posted yet.</p>
              <p className="mt-2 text-sm text-gray-500">
                Supabase is connected. Parlays added to the database will appear here.
              </p>
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            {parlays.map((parlay) => (
              <article
                key={parlay.id}
                className="rounded-xl border border-white/10 bg-[#0b100e] p-6"
              >
                <div className="mb-5 flex items-start justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-green-400">
                      {parlay.sport || "PARLAY"}
                    </p>

                    <h3 className="mt-2 text-xl font-bold">
                      {parlay.title || parlay.name || "Today's Parlay"}
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                      {parlay.subtitle || "Daily betting card"}
                    </p>
                  </div>

                  {parlay.confidence && (
                    <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
                      {parlay.confidence}
                    </span>
                  )}
                </div>

                <div className="border-t border-white/10 pt-4 text-sm text-gray-400">
                  Open parlay details
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-12 border-t border-white/10 py-6 text-xs text-gray-600">
          Responsible Degenerate Gambling • Bet responsibly
        </footer>
      </div>
    </main>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b100e] p-4">
      <p className="text-xs text-gray-500">{title}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
