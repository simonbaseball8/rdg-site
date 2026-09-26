"use client";
import { useState } from "react";
import type { NFLAnalysis } from "./types";
import { upcoming } from "./board";
import { TeamLogo } from "./team-logos";

export default function NflPredictions({
  data,
  now,
  horizon,
  error,
  onRetry,
  loading,
}: {
  data: NFLAnalysis | undefined;
  now: number;
  horizon: "today" | "week";
  error?: string;
  onRetry: () => void;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const games = (data?.games ?? [])
    .filter((g) => upcoming(g.start_date, now, horizon))
    .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));
  return (
    <section
      className="nfl-predictions"
      aria-labelledby="nfl-predictions-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">NFL GAME PREDICTIONS</p>
          <h2 id="nfl-predictions-heading">The matchup outlook.</h2>
          <p>
            Projected winners and margins, including games that don’t qualify
            for a parlay.
          </p>
        </div>
        <span className="prediction-count">{games.length} upcoming games</span>
      </div>
      {error ? (
        <div className="notice warning" role="status">
          NFL predictions couldn’t load.{" "}
          <button className="text-button" onClick={onRetry}>
            Retry NFL feed
          </button>
        </div>
      ) : !data && loading ? (
        <p className="notice" role="status">
          Loading NFL predictions…
        </p>
      ) : !games.length ? (
        <p className="notice">
          No upcoming NFL games in this date range. Select Next 7 days to see
          the upcoming slate.
        </p>
      ) : (
        <>
          {data?.market_data_available === false && (
            <p className="notice warning">
              Game predictions are available. Hard Rock prices are currently
              unavailable, so these predictions cannot be turned into priced
              parlays yet.
            </p>
          )}
          <div className="prediction-grid">
            {games.slice(0, expanded ? games.length : 4).map((g) => {
              const ready =
                g.stats_connected && Number.isFinite(g.rdg?.projected_margin);
              const winner = g.rdg?.projected_winner;
              return (
                <article className="prediction-card" key={g.event_id}>
                  <time dateTime={g.start_date}>
                    {new Intl.DateTimeFormat("en-US", {
                      timeZone: "America/New_York",
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    }).format(new Date(g.start_date))}
                  </time>
                  <div className="prediction-matchup">
                    <span>
                      <TeamLogo sport="NFL" team={g.away_team} />
                      <strong>{g.away_team}</strong>
                    </span>
                    <span className="at-symbol">@</span>
                    <span>
                      <TeamLogo sport="NFL" team={g.home_team} />
                      <strong>{g.home_team}</strong>
                    </span>
                  </div>
                  <div className="prediction-pick">
                    <span>Projected winner</span>
                    <strong>
                      {ready
                        ? winner === "EVEN"
                          ? "Even matchup"
                          : winner
                        : "Awaiting team stats"}
                    </strong>
                    {ready && winner !== "EVEN" && (
                      <small>
                        by {g.rdg.projected_margin.toFixed(1)} points
                      </small>
                    )}
                  </div>
                  <p>
                    {g.rdg?.market_analysis?.hard_rock_spread?.home_odds
                      ? "Model projection · not a guaranteed result"
                      : "Model projection · sportsbook prices unavailable"}
                  </p>
                </article>
              );
            })}
          </div>
          {games.length > 4 && (
            <button
              className="prediction-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((x) => !x)}
            >
              {expanded
                ? "Show fewer games"
                : `Show all ${games.length} NFL games`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
