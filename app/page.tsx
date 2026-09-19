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

type NFLGame = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;
  stats_connected: boolean;

  rdg: {
    projected_home_margin: number;
    projected_winner: string;
    projected_margin: number;

    historical_signal: {
      bucket: string;
      sample: number;
      correct: number;
      historical_winner_accuracy: number;
      signal: string;
    };

    market_analysis: {
      model_favorite: string;
      market_favorite: string;
      model_projected_home_margin: number;
      market_implied_home_margin: number | null;
      model_vs_market_difference: number | null;
      spread_lean: string;
      market_signal: string;

      hard_rock_spread: {
        away_team: string;
        away_line: number | null;
        away_odds: string | null;
        home_team: string;
        home_line: number | null;
        home_odds: string | null;
      };

      hard_rock_moneyline: {
        away_team: string;
        away_odds: string | null;
        home_team: string;
        home_odds: string | null;
      };
    };
  };
};

type NFLAnalysis = {
  sportsbook: string;
  sport: string;
  model: string;
  version: string;
  games_found: number;
  games_with_stats: number;
  priority_reviews: number;
  strong_reviews: number;
  updated_at: string;
  games: NFLGame[];
};

export default function Home() {
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [nfl, setNfl] = useState<NFLAnalysis | null>(null);
  const [nflLoading, setNflLoading] = useState(true);
  const [nflError, setNflError] = useState("");

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

    async function loadNFL() {
      try {
        const response = await fetch("/api/analyze", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(
            `NFL analysis failed: ${response.status}`
          );
        }

        const data = await response.json();
        setNfl(data);
      } catch (err) {
        console.error(err);

        setNflError(
          err instanceof Error
            ? err.message
            : "NFL analysis failed"
        );
      } finally {
        setNflLoading(false);
      }
    }

    loadParlays();
    loadNFL();
  }, []);

  const activeParlays = parlays.filter(
    (parlay) => parlay.status === "pending"
  );

  const rankedGames = [...(nfl?.games || [])].sort((a, b) => {
    const priority: Record<string, number> = {
      "Priority Review": 4,
      "Strong Review": 3,
      Watch: 2,
      Pass: 1,
    };

    const aSignal =
      priority[a.rdg.market_analysis.market_signal] || 0;

    const bSignal =
      priority[b.rdg.market_analysis.market_signal] || 0;

    if (aSignal !== bSignal) {
      return bSignal - aSignal;
    }

    return (
      Math.abs(
        b.rdg.market_analysis.model_vs_market_difference || 0
      ) -
      Math.abs(
        a.rdg.market_analysis.model_vs_market_difference || 0
      )
    );
  });

  const reviewGames = rankedGames.filter(
    (game) =>
      game.rdg.market_analysis.market_signal !== "Pass"
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
          RDG NFL MODEL
        </p>

        <h2 className="mt-3 text-3xl font-bold">
          Live NFL Analysis
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          RDG projections compared against current Hard Rock Bet lines.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat
            title="NFL GAMES"
            value={nfl ? String(nfl.games_found) : "—"}
          />

          <Stat
            title="PRIORITY"
            value={nfl ? String(nfl.priority_reviews) : "—"}
          />

          <Stat
            title="STRONG REVIEWS"
            value={nfl ? String(nfl.strong_reviews) : "—"}
          />

          <Stat
            title="STATS CONNECTED"
            value={
              nfl
                ? `${nfl.games_with_stats}/${nfl.games_found}`
                : "—"
            }
          />
        </section>

        {nflLoading && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
            Running RDG NFL model...
          </div>
        )}

        {nflError && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-400">
            NFL model error: {nflError}
          </div>
        )}

        {!nflLoading &&
          !nflError &&
          reviewGames.length === 0 && (
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <p className="font-bold">
                No notable model/market differences right now.
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Hard Rock lines may change throughout the day.
              </p>
            </div>
          )}

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          {reviewGames.map((game) => (
            <NFLGameCard
              key={game.event_id}
              game={game}
            />
          ))}
        </section>

        {rankedGames.length > 0 && (
          <>
            <div className="mt-12 border-t border-white/10 pt-10">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                FULL NFL BOARD
              </p>

              <h2 className="mt-3 text-2xl font-bold">
                All Games
              </h2>
            </div>

            <section className="mt-6 space-y-3">
              {rankedGames.map((game) => (
                <NFLBoardRow
                  key={game.event_id}
                  game={game}
                />
              ))}
            </section>
          </>
        )}

        <div className="mt-14 border-t border-white/10 pt-10">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-400">
            TRACKED SLIPS
          </p>

          <h2 className="mt-3 text-3xl font-bold">
            Today&apos;s Parlays
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            Saved parlays and betting research from Supabase.
          </p>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat
            title="ACTIVE SLIPS"
            value={String(activeParlays.length)}
          />

          <Stat
            title="SPORTS"
            value="4"
          />

          <Stat
            title="BEST BET"
            value={
              parlays.length > 0 &&
              parlays[0].total_odds
                ? parlays[0].total_odds
                : "—"
            }
          />

          <Stat
            title="TODAY'S RECORD"
            value="0-0"
          />
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

        {!loading &&
          !error &&
          parlays.length === 0 && (
            <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <p className="font-bold">
                No parlays posted yet.
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Parlays added to Supabase will appear here.
              </p>
            </div>
          )}

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          {parlays.map((parlay) => {
            const legs = [
              ...(parlay.parlay_legs || []),
            ].sort(
              (a, b) =>
                a.leg_number - b.leg_number
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
                        <span>
                          {parlay.risk_level} Risk
                        </span>
                      )}

                      {parlay.sportsbook && (
                        <span>
                          • {parlay.sportsbook}
                        </span>
                      )}

                      {parlay.total_odds && (
                        <span>
                          • {parlay.total_odds}
                        </span>
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
                              Leg {leg.leg_number} •{" "}
                              {leg.sport}
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
                              <p className="font-bold">
                                {leg.odds}
                              </p>
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

function NFLGameCard({
  game,
}: {
  game: NFLGame;
}) {
  const market = game.rdg.market_analysis;
  const historical = game.rdg.historical_signal;

  const difference =
    market.model_vs_market_difference;

  const spreadTeam = market.spread_lean;

  const spreadLine =
    spreadTeam === game.home_team
      ? market.hard_rock_spread.home_line
      : market.hard_rock_spread.away_line;

  const gameTime = new Date(
    game.start_date
  ).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="rounded-xl border border-green-500/20 bg-white/[0.04] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-green-400">
            MARKET EDGE • {market.market_signal}
          </p>

          <h3 className="mt-2 text-xl font-bold">
            {game.away_team} @ {game.home_team}
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            {gameTime} • Hard Rock Bet
          </p>
        </div>

        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-400">
          {difference !== null
            ? `${Math.abs(difference).toFixed(1)} PT EDGE`
            : "NO LINE"}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <MiniStat
          title="RDG PROJECTION"
          value={`${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(
            1
          )}`}
        />

        <MiniStat
          title="HARD ROCK SPREAD"
          value={
            market.hard_rock_spread.home_line !== null
              ? `${game.home_team} ${formatSpread(
                  market.hard_rock_spread.home_line
                )}`
              : "—"
          }
        />

        <MiniStat
          title="RDG SPREAD LEAN"
          value={
            spreadLine !== null
              ? `${spreadTeam} ${formatSpread(
                  spreadLine
                )}`
              : "—"
          }
        />

        <MiniStat
          title="MODEL VS MARKET"
          value={
            difference !== null
              ? `${Math.abs(difference).toFixed(1)} pts`
              : "—"
          }
        />
      </div>

      <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
        <p className="text-xs font-bold text-slate-500">
          MARKET COMPARISON
        </p>

        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">
              RDG
            </p>

            <p className="mt-1 font-bold">
              {game.rdg.projected_winner}{" "}
              -{game.rdg.projected_margin.toFixed(1)}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">
              HARD ROCK
            </p>

            <p className="mt-1 font-bold">
              {market.market_favorite}{" "}
              {market.market_favorite === game.home_team
                ? formatSpread(
                    market.hard_rock_spread.home_line
                  )
                : formatSpread(
                    market.hard_rock_spread.away_line
                  )}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-slate-500">
              MODEL HISTORY
            </p>

            <p className="mt-2 text-lg font-bold">
              {historical.historical_winner_accuracy}%
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-slate-500">
              HISTORICAL RECORD
            </p>

            <p className="mt-2 font-bold">
              {historical.correct}/{historical.sample}
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Historical performance for RDG&apos;s{" "}
          {historical.bucket} projected-margin bucket.
          This is not the probability that this individual wager wins.
        </p>
      </div>
    </article>
  );
}

function NFLBoardRow({
  game,
}: {
  game: NFLGame;
}) {
  const market = game.rdg.market_analysis;

  const difference =
    market.model_vs_market_difference;

  return (
    <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 md:grid-cols-5 md:items-center">
      <div>
        <p className="font-bold">
          {game.away_team} @ {game.home_team}
        </p>

        <p className="mt-1 text-xs text-slate-500">
          {market.market_signal}
        </p>
      </div>

      <BoardValue
        title="RDG"
        value={`${game.rdg.projected_winner} by ${game.rdg.projected_margin.toFixed(
          1
        )}`}
      />

      <BoardValue
        title="HARD ROCK"
        value={
          market.hard_rock_spread.home_line !== null
            ? `${game.home_team} ${formatSpread(
                market.hard_rock_spread.home_line
              )}`
            : "—"
        }
      />

      <BoardValue
        title="SPREAD LEAN"
        value={market.spread_lean}
      />

      <BoardValue
        title="DIFFERENCE"
        value={
          difference !== null
            ? `${Math.abs(difference).toFixed(1)} pts`
            : "—"
        }
      />
    </div>
  );
}

function Stat({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-2xl font-bold">
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] font-bold text-slate-500">
        {title}
      </p>

      <p className="mt-1 font-bold">
        {value}
      </p>
    </div>
  );
}

function BoardValue({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-600">
        {title}
      </p>

      <p className="mt-1 text-sm font-semibold">
        {value}
      </p>
    </div>
  );
}

function formatSpread(
  value: number | null
) {
  if (value === null) return "—";

  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}
