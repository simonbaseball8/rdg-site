"use client";
import { useState } from "react";
import { type Feeds, type SportFilter, upcoming, formatOdds } from "./board";
import { FighterPhoto } from "./fighter-photo";
import { MatchupLogos } from "./team-logos";
import { checkedTime } from "./pick-details";
type Game = {
  event_id: string;
  start_date: string;
  away_team: string;
  home_team: string;
  sportsbook: string;
  requires_florida_verification: boolean;
  odds: Array<{
    market: string;
    team: string;
    american_odds: number;
    line?: number;
    updated_at?: string;
  }>;
  context?: {
    season?: string;
    away?: {
      record?: string;
      games: number;
      pointsFor?: number;
      pointsAgainst?: number;
    };
    home?: {
      record?: string;
      games: number;
      pointsFor?: number;
      pointsAgainst?: number;
    };
    card?: string;
    weightClass?: string;
    rounds?: number;
    fighters?: Array<{ name: string; record?: string; photo?: string | null }>;
  } | null;
};
type Board = {
  games: Game[];
  checked_at: string;
  context_checked_at: string | null;
  stats_warning?: string;
  notice: string;
  coverage: { priced: number; florida: number; reference: number };
};
export default function ExpansionBoard({
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
  const [outside, setOutside] = useState(false);
  if (sport !== "NBA" && sport !== "UFC") return null;
  const feed = feeds[sport];
  if (!feed) return <p className="notice">Loading {sport} research board…</p>;
  const data = feed.data as Board | undefined;
  if (!data) return null;
  const inWindow = data.games.filter((g) =>
    upcoming(g.start_date, now, horizon),
  );
  const games = outside
    ? data.games.filter((g) => Date.parse(g.start_date) > now)
    : inWindow;
  return (
    <section className="expansion-board">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {sport === "NBA" ? "NBA MATCHUPS" : "UFC / MMA FIGHT CARDS"}
          </p>
          <h2>{sport === "NBA" ? "Around the court." : "Inside the cage."}</h2>
        </div>
        <span className="draft-badge">Research board</span>
      </div>
      <p className="notice">{data.notice}</p>
      <p className="quote-note">
        Coverage checked {checkedTime(data.checked_at)} ·{" "}
        {data.coverage.florida} Florida-priced matchups ·{" "}
        {data.coverage.reference} reference-priced matchups.{" "}
        {sport === "UFC"
          ? "The odds provider covers MMA; a UFC card name is shown only when matched to ESPN UFC data."
          : ""}
      </p>
      {data.stats_warning && (
        <p className="notice warning">{data.stats_warning}</p>
      )}
      {!inWindow.length && (
        <p className="notice">
          No {sport} matchups in the selected date window.
          {data.games.length ? " Later events are available below." : ""}
        </p>
      )}
      {data.games.some((g) => !upcoming(g.start_date, now, horizon)) && (
        <button
          className="secondary-button"
          onClick={() => setOutside(!outside)}
        >
          {outside ? "Use selected date window" : "Show all upcoming events"}
        </button>
      )}
      <div className="explore-grid">
        {games.slice(0, 40).map((g) => (
          <article key={g.event_id} className="pick-card">
            <p className="eyebrow">
              {sport === "UFC"
                ? (g.context?.card ?? "MMA · UFC card unconfirmed")
                : (g.context?.season ?? "NBA")}
            </p>
            {sport === "NBA" && (
              <MatchupLogos
                sport="NBA"
                matchup={`${g.away_team} @ ${g.home_team}`}
              />
            )}
            {sport === "UFC" && (
              <div className="fighter-matchup">
                {(g.context?.fighters?.length === 2
                  ? g.context.fighters
                  : [{ name: g.away_team }, { name: g.home_team }]
                ).map((f) => (
                  <FighterPhoto
                    key={f.name}
                    name={f.name}
                    photo={"photo" in f ? f.photo : null}
                  />
                ))}
              </div>
            )}
            <h3>
              {g.away_team} {sport === "UFC" ? "vs." : "@"} {g.home_team}
            </h3>
            <p>{checkedTime(g.start_date)}</p>
            {sport === "UFC" ? (
              <>
                <p>
                  {g.context?.weightClass ?? "Weight class unavailable"} ·{" "}
                  {g.context?.rounds
                    ? `${g.context.rounds} scheduled rounds`
                    : "Rounds unavailable"}
                </p>
                {g.context?.fighters?.map((f) => (
                  <p key={f.name}>
                    {f.name}: {f.record ?? "Record unavailable"}
                  </p>
                ))}
                <p className="quote-note">
                  Method-of-victory and round betting markets are not connected.
                </p>
              </>
            ) : (
              <>
                {(["away", "home"] as const).map((side) => {
                  const t = g.context?.[side];
                  return (
                    <p key={side}>
                      {side === "away" ? g.away_team : g.home_team}:{" "}
                      {t?.record ?? "Record unavailable"}
                      {t && t.games > 0
                        ? ` · ${t.pointsFor ?? "—"} PPG / ${t.pointsAgainst ?? "—"} allowed`
                        : " · No completed games in this standings season"}
                    </p>
                  );
                })}
                <p className="quote-note">
                  Player props, injury screening and confirmed starters are not
                  connected.
                </p>
              </>
            )}
            <p
              className={
                g.requires_florida_verification
                  ? "price-reference"
                  : "price-florida"
              }
            >
              {g.odds.length ? g.sportsbook : "No Hard Rock price returned"}
              {g.requires_florida_verification && g.odds.length
                ? " · verify in Florida"
                : ""}
            </p>
            {g.odds.map((o, i) => (
              <div className="market-row" key={i}>
                <span>
                  {o.team}{" "}
                  {o.market === "spread"
                    ? `${(o.line ?? 0) > 0 ? "+" : ""}${o.line}`
                    : o.market === "total"
                      ? `${o.line} total`
                      : "moneyline"}
                </span>
                <strong>{formatOdds(o.american_odds)}</strong>
                <small>Updated {checkedTime(o.updated_at)}</small>
              </div>
            ))}
            <p className="quote-note">
              Statistics fetched {checkedTime(data.context_checked_at)}. No
              model pick assigned.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
