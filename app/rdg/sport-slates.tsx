"use client";
import { useState } from "react";
import {
  type Feeds,
  type SportFilter,
  type Sport,
  upcoming,
  formatOdds,
  LABELS,
} from "./board";
import type { CFBAnalysis, MLBAnalysis, NHLAnalysis } from "./types";
import { MatchupLogos } from "./team-logos";
type Game = {
  book?: string;
  reference?: boolean;
  id: string;
  starts: string;
  matchup: string;
  message: string;
  awayOdds?: string | number | null;
  homeOdds?: string | number | null;
};
export default function SportSlates({
  feeds,
  sport,
  now,
  horizon,
}: {
  feeds: Feeds;
  sport: SportFilter;
  now: number;
  horizon: "today" | "week";
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <>
      {(["CFB", "MLB", "NHL"] as Sport[])
        .filter((s) => sport === "ALL" || sport === s)
        .map((s) => {
          const data = feeds[s]?.data;
          if (!data) return null;
          let warning: string | undefined;
          let games: Game[] = [];
          if (s === "CFB") {
            const d = data as CFBAnalysis & { stats_warning?: string };
            warning = d.stats_warning;
            games = d.games.map((g) => ({
              id: g.event_id,
              book: g.sportsbook,
              reference: g.requires_florida_verification,
              starts: g.start_date,
              matchup: `${g.away_team} @ ${g.home_team}`,
              message:
                g.stats_connected && g.rdg
                  ? `RDG projected winner: ${g.rdg.projected_winner}`
                  : "Awaiting team statistics",
              awayOdds: g.hard_rock?.moneyline?.away_odds,
              homeOdds: g.hard_rock?.moneyline?.home_odds,
            }));
          }
          if (s === "MLB")
            games = (data as MLBAnalysis).games.map((g) => ({
              id: g.event_id,
              book: g.sportsbook,
              reference: g.requires_florida_verification,
              starts: g.start_date,
              matchup: `${g.away_team} @ ${g.home_team}`,
              message: g.rdg?.projected_winner
                ? `RDG projected winner: ${g.rdg.projected_winner} · ${g.rdg.signal}`
                : "Awaiting model data",
              awayOdds: g.hard_rock?.moneyline?.away_odds,
              homeOdds: g.hard_rock?.moneyline?.home_odds,
            }));
          if (s === "NHL")
            games = (data as NHLAnalysis).games.map((g) => ({
              id: g.event_id,
              book: g.sportsbook,
              reference: g.requires_florida_verification,
              starts: g.start_time_utc,
              matchup: g.matchup,
              message:
                g.game_type !== 2
                  ? `${g.game_type_label} · displayed for research; regular-season model does not qualify these for parlays.`
                  : g.model_available
                    ? `RDG projected winner: ${g.rdg_projected_winner} · ${g.signal}`
                    : "Awaiting model data",
              awayOdds: g.hard_rock?.moneyline?.away_odds,
              homeOdds: g.hard_rock?.moneyline?.home_odds,
            }));
          games = games
            .filter((g) => upcoming(g.starts, now, horizon))
            .sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts));
          return (
            <section
              className="nfl-predictions"
              key={s}
              aria-label={`${LABELS[s]} games`}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{LABELS[s]} GAME BOARD</p>
                  <h2>{games.length} upcoming games</h2>
                </div>
              </div>
              {games.some((g) => g.reference) && (
                <p className="notice warning">
                  Standard Hard Rock prices are shown for reference. Florida
                  lines can differ. Enable reference prices above to include
                  qualifying picks in research parlays.
                </p>
              )}
              {warning && <p className="notice warning">{warning}</p>}
              {games.length > 0 &&
                games.every(
                  (g) => g.awayOdds == null && g.homeOdds == null,
                ) && (
                  <p className="notice warning">
                    The Odds API returned these games without usable Hard Rock
                    Florida moneylines. Priced parlays stay unavailable until
                    qualifying Hard Rock markets are returned.
                  </p>
                )}
              {!games.length && (
                <p className="notice">
                  No upcoming games returned for this date range.
                </p>
              )}
              <div className="prediction-grid">
                {games.slice(0, expanded[s] ? games.length : 4).map((g) => (
                  <article className="prediction-card" key={g.id}>
                    <time dateTime={g.starts}>
                      {new Date(g.starts).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}
                    </time>
                    <MatchupLogos sport={s} matchup={g.matchup} />
                    <h3>{g.matchup}</h3>
                    <p>{g.message}</p>
                    <p>
                      {g.book ?? "Hard Rock Bet (FL)"} moneyline · Away{" "}
                      {formatOdds(g.awayOdds)} / Home {formatOdds(g.homeOdds)}
                    </p>
                  </article>
                ))}
              </div>
              {games.length > 4 && (
                <button
                  className="prediction-toggle"
                  onClick={() => setExpanded((v) => ({ ...v, [s]: !v[s] }))}
                >
                  {expanded[s]
                    ? "Show fewer games"
                    : `Show all ${games.length} games`}
                </button>
              )}
            </section>
          );
        })}
    </>
  );
}
