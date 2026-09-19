"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type ParlayLeg = {
  id: number;
  parlay_id: number;
  leg_number: number;
  sport: string;
  player: string | null;
  team: string | null;
  opponent: string | null;
  bet_type: string;
  odds: string | null;
  confidence: number | null;
  reasoning: string | null;
  key_risk: string | null;
  status: string;
};

type Parlay = {
  id: number;
  bet_date: string;
  name: string;
  category: string;
  risk_level: string | null;
  confidence: number | null;
  sportsbook: string | null;
  total_odds: string | null;
  status: string;
  notes: string | null;
  parlay_legs?: ParlayLeg[];
};

export default function Home() {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadParlays() {
      const { data, error } = await supabase
        .from("parlays")
        .select(`
          *,
          parlay_legs (*)
        `)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        setError(error.message);
      } else {
        setParlays((data as Parlay[]) || []);
      }

      setLoading(false);
    }

    loadParlays();
  }, []);

  const activeParlays = parlays.filter(
    (parlay) => parlay.status === "pending"
  );

  return (
    <main className="min-h-screen bg-[#020806] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500 font-black text-black">
              RDG
            </div>

            <div>
              <h1 className="font-bold uppercase tracking-wide">
                Responsible Degenerate Gambling
              </h1>
              <p className="text-xs uppercase text-slate-500">
                Data-Driven Betting Dashboard
              </p>
            </div>
          </div>

          <div className="text-xs font-bold text-green-400">
            ● LIVE
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
          Today&apos;s Board
        </p>

        <h2 className="mt-3 text-3xl font-bold">
          Today&apos;s Parlays
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          Daily betting research, player props, and parlay tracking.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat title="ACTIVE SLIPS" value={String(activeParlays.length)} />
          <Stat title="SPORTS" value="4" />
          <Stat
            title="BEST BET"
            value={
              parlays.length > 0 && parlays[0].total_odds
                ? parlays[0].total_odds
                : "—"
            }
          />
          <Stat title="TODAY'S RECORD" value="0-0" />
        </section>

        {loading && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            Loading parlays...
          </div>
        )}

        {error && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
            Database error: {error}
          </div>
        )}

        {!loading && !error && parlays.length === 0 && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            <p className="font-bold">No parlays posted yet.</p>
            <p className="mt-2 text-sm text-slate-500">
              Parlays added to Supabase will appear here.
            </p>
          </div>
        )}

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          {parlays.map((parlay) => {
            const legs = [...(parlay.parlay_legs || [])].sort(
              (a, b) => a.leg_number - b.leg_number
            );

            return (
              <article
                key={parlay.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-6"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-green-400">
                      {parlay.category || "PARLAY"}
                    </p>

                    <h3 className="mt-2 text-xl font-bold">
                      {parlay.name}
                    </h3>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                      {parlay.risk_level && (
                        <span>{parlay.risk_level} Risk</span>
                      )}

                      {parlay.sportsbook && (
                        <span>• {parlay.sportsbook}</span>
                      )}

                      {parlay.total_odds && (
                        <span>• {parlay.total_odds}</span>
                      )}
                    </div>
                  </div>

                  {parlay.confidence !== null && (
                    <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
                      {parlay.confidence}%
                    </span>
                  )}
                </div>

                <div className="mt-6 space-y-3">
                  {legs.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No legs added yet.
                    </p>
                  ) : (
                    legs.map((leg) => (
                      <div
                        key={leg.id}
                        className="rounded-lg border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-bold uppercase text-green-400">
                              Leg {leg.leg_number} • {leg.sport}
                            </p>

                            <p className="mt-1 font-bold">
                              {leg.player
                                ? `${leg.player} — ${leg.bet_type}`
                                : `${leg.team || ""} ${leg.bet_type}`}
                            </p>

                            {leg.opponent && (
                              <p className="mt-1 text-xs text-slate-500">
                                vs {leg.opponent}
                              </p>
                            )}
                          </div>

                          <div className="text-right">
                            {leg.odds && (
                              <p className="font-bold">{leg.odds}</p>
                            )}

                            {leg.confidence !== null && (
                              <p className="mt-1 text-xs text-green-400">
                                {leg.confidence}% confidence
                              </p>
                            )}
                          </div>
                        </div>

                        {leg.reasoning && (
                          <div className="mt-4 border-t border-white/10 pt-3">
                            <p className="text-xs font-bold text-slate-400">
                              WHY THIS BET
                            </p>
                            <p className="mt-1 text-sm text-slate-300">
                              {leg.reasoning}
                            </p>
                          </div>
                        )}

                        {leg.key_risk && (
                          <p className="mt-3 text-xs text-amber-400">
                            Risk: {leg.key_risk}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {parlay.notes && (
                  <p className="mt-4 text-sm text-slate-400">
                    {parlay.notes}
                  </p>
                )}
              </article>
            );
          })}
        </section>

        <footer className="mt-12 border-t border-white/10 py-6 text-xs text-slate-600">
          Responsible Degenerate Gambling • Bet responsibly
        </footer>
      </div>
    </main>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
