"use client";

import { useState } from "react";
import Image from "next/image";
import { MatchupLogos } from "./rdg/team-logos";
import ExpansionBoard from "./rdg/expansion-board";
import SportSlates from "./rdg/sport-slates";
import NflPredictions from "./rdg/nfl-predictions";
import type { NFLAnalysis } from "./rdg/types";
import {
  buildIdeas,
  estimatedReturn,
  formatOdds,
  fresh,
  LABELS,
  normalizeBoard,
  SPORTS,
  upcoming,
  type Pick,
  type SportFilter,
} from "./rdg/board";
import { useBoard } from "./rdg/use-board";
import Results from "./rdg/results";
import { PickFreshness, TrackButton } from "./rdg/pick-details";
import {
  actionable,
  passesFilters,
  replacements,
  matchupTeams,
} from "./rdg/pick-controls";
import "./rdg/dashboard.css";

type View = "today" | "explore" | "results";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
function gameTime(starts: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(starts));
}
function Icon({
  name,
}: {
  name: "arrow" | "refresh" | "check" | "layers" | "search" | "chart";
}) {
  const paths = {
    arrow: "M5 12h14m-6-6 6 6-6 6",
    refresh:
      "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17",
    check: "m5 12 4 4L19 6",
    layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
    search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    chart: "M4 3v17h17M8 16v-4m5 4V7m5 9V4",
  };
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function Research({ picks }: { picks: Pick[] }) {
  return (
    <details className="research">
      <summary>
        Why this pick? <span aria-hidden="true">+</span>
      </summary>
      <div className="research-body">
        {picks.map((p) => (
          <div key={p.id}>
            <h4>{p.title}</h4>
            <ul>
              {p.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <PickFreshness pick={p} />
            <p className="risk-heading">What could change this pick?</p>
            <ul className="concerns">
              {p.concerns.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
function IdeaCard({
  picks: originalPicks,
  index,
  stake,
  pool,
  now,
  mix,
}: {
  picks: Pick[];
  index: number;
  stake: number;
  pool: Pick[];
  now: number;
  mix: Parameters<typeof buildIdeas>[3];
}) {
  const [changes, setChanges] = useState<Record<number, string>>({});
  const [replacing, setReplacing] = useState<number | null>(null);
  const picks = originalPicks.map(
    (p, i) => pool.find((c) => c.id === changes[i] && actionable(c, now)) ?? p,
  );
  const alternatives =
    replacing === null
      ? []
      : replacements(pool, picks, replacing, now, mix ?? "balanced");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const total = estimatedReturn(picks, stake);
  const reference = picks.some((p) => p.referencePrice);
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `RDG ${picks.length}-leg idea — verify in Hard Rock Bet\n${picks.map((p) => `${p.title} (${formatOdds(p.odds)}) — ${p.matchup} — ${p.book}${p.referencePrice ? " — VERIFY FLORIDA LINE" : ""} — ${gameTime(p.starts)}`).join("\n")}\nEstimated return incl. stake: ${total === null ? "Unavailable" : money(total)} on ${money(stake)}. Not a sportsbook quote.`,
      );
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <article className={`idea-card ${index === 0 ? "featured" : ""}`}>
      <div className="card-top">
        <span className="eyebrow">
          {index === 0 ? "FIRST LOOK" : `ANOTHER COMBINATION · 0${index + 1}`}
        </span>
        <span className="draft-badge">
          {reference ? "Reference · verify Florida" : "Review in app"}
        </span>
      </div>
      <div className="card-title">
        <h3>{picks.length}-leg parlay idea</h3>
        <p>
          {new Set(picks.map((p) => p.sport)).size > 1
            ? "Across sports"
            : LABELS[picks[0].sport]}{" "}
          <span> / </span> Hard Rock Bet
        </p>
      </div>
      <ol className="leg-list">
        {picks.map((p, i) => (
          <li key={p.id}>
            <span className="leg-number">{String(i + 1).padStart(2, "0")}</span>
            <div className="leg-main">
              <div className="leg-meta">
                <MatchupLogos sport={p.sport} matchup={p.matchup} />
                <span className={`sport-label sport-${p.sport.toLowerCase()}`}>
                  {p.sport}
                </span>
                <span>{p.market}</span>
              </div>
              <h4>{p.title}</h4>
              <p>{p.matchup}</p>
              {p.referencePrice && (
                <p className="reference-label">
                  Indiana reference · verify Florida line
                </p>
              )}
              <time dateTime={p.starts}>{gameTime(p.starts)}</time>
              <small
                className={
                  p.referencePrice ? "price-reference" : "price-florida"
                }
              >
                {p.referencePrice ? "Reference price" : "Florida feed"}
              </small>
              <button
                className="replace-leg"
                onClick={() => setReplacing(replacing === i ? null : i)}
              >
                Replace this leg
              </button>
              {replacing === i && (
                <div className="replacement-list">
                  <label>
                    Choose a replacement
                    <select
                      aria-label={`Replacement for leg ${i + 1}`}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setChanges((v) => ({ ...v, [i]: e.target.value }));
                          setReplacing(null);
                          setCopied(false);
                        }
                      }}
                    >
                      <option value="">Select a qualifying pick</option>
                      {alternatives.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title} ({formatOdds(a.odds)}) · {a.matchup}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!alternatives.length && (
                    <p>No replacement meets your filters from another game.</p>
                  )}
                </div>
              )}
            </div>
            <strong className="leg-odds">{formatOdds(p.odds)}</strong>
          </li>
        ))}
      </ol>
      <div className="return-box">
        <div>
          <span>Estimated return</span>
          <small>{money(stake)} stake included</small>
        </div>
        <strong>{total === null ? "—" : money(total)}</strong>
      </div>
      <p className="quote-note">
        Calculated from individual prices. Confirm the final payout in Hard
        Rock.
      </p>
      <Research picks={picks} />
      <TrackButton
        key={picks.map((p) => p.id + String(p.odds)).join("|")}
        picks={picks}
      />
      <button className="copy-button" onClick={copy}>
        {copied ? (
          <>
            <Icon name="check" /> Copied
          </>
        ) : (
          <>
            Copy picks <Icon name="arrow" />
          </>
        )}
      </button>
      {copyError && (
        <p className="copy-error" role="status">
          Copy is unavailable. Select the picks above to copy them.
        </p>
      )}
    </article>
  );
}
export default function Home() {
  const [view, setView] = useState<View>("today");
  const [sport, setSport] = useState<SportFilter>("ALL");
  const expansionSport = sport === "NBA" || sport === "UFC";
  const hero =
    sport === "NBA"
      ? {
          src: "/rdg-basketball-hero.webp",
          alt: "Professional basketball arena and hardwood court",
        }
      : sport === "UFC"
        ? {
            src: "/rdg-mma-hero.webp",
            alt: "Mixed martial arts arena and fighting cage",
          }
        : sport === "MLB"
          ? {
              src: "/rdg-baseball-hero.webp",
              alt: "Baseball stadium and diamond under evening floodlights",
            }
          : sport === "NHL"
            ? {
                src: "/rdg-hockey-hero.webp",
                alt: "Ice hockey rink inside a professional arena",
              }
            : {
                src: "/rdg-stadium-hero.webp",
                alt: "Football on stadium turf under the evening lights",
              };
  const [horizon, setHorizon] = useState<"today" | "week">("week");
  const [mix, setMix] = useState<
    | "balanced"
    | "props"
    | "games"
    | "no-spreads"
    | "moneylines"
    | "spreads"
    | "totals"
  >("balanced");
  const [maxFavorite, setMaxFavorite] = useState("");
  const [excludedTeams, setExcludedTeams] = useState<string[]>([]);
  const [excludeChoice, setExcludeChoice] = useState("");
  const [propTypes, setPropTypes] = useState<string[]>([]);
  const [slipMarkets, setSlipMarkets] = useState<string[]>([]);
  const [allowReference, setAllowReference] = useState(false);
  const [size, setSize] = useState(2);
  const [stake, setStake] = useState("10");
  const [showStraights, setShowStraights] = useState(false);
  const [query, setQuery] = useState("");
  const [market, setMarket] = useState("All bets");
  const { loading, reload, now, relevant } = useBoard(
    sport,
    view !== "results",
  );
  const loaded = relevant.some((r) => r.feed);
  const visibleFeeds = Object.fromEntries(
    relevant.filter((r) => r.feed && !r.feed.error).map((r) => [r.key, r.feed]),
  );
  const nfl = visibleFeeds.NFL?.data as NFLAnalysis | undefined;
  const nflError = relevant.find((r) => r.key === "NFL")?.feed?.error;
  const allPicks = now
    ? normalizeBoard(visibleFeeds, now, allowReference).filter(
        (p) =>
          upcoming(p.starts, now, horizon) &&
          (sport === "ALL" || sport === p.sport),
      )
    : [];
  const controlledPicks = allPicks.filter((p) =>
    passesFilters(p, {
      maxFavorite: maxFavorite ? Number(maxFavorite) : null,
      excludedTeams,
      markets: slipMarkets,
      propTypes,
    }),
  );
  const straightPicks = controlledPicks.filter((p) => actionable(p, now));
  const teams = [...new Set(allPicks.flatMap(matchupTeams))].sort();
  const picks = controlledPicks.filter(
    (p) =>
      (market === "All bets" || p.market === market) &&
      `${p.title} ${p.matchup}`.toLowerCase().includes(query.toLowerCase()),
  );
  const ideas = buildIdeas(controlledPicks, size, now, mix);
  const errors = relevant.filter((r) => r.feed?.error);
  const stale = relevant.some(
    (r) => r.feed && !r.feed.error && !fresh(r.feed, now),
  );
  const loadedTimes = relevant.flatMap((r) =>
    r.feed && !r.feed.error ? [r.feed.loadedAt] : [],
  );
  const loadedTime = loadedTimes.length ? Math.min(...loadedTimes) : null;
  const stakeNumber = Number(stake);
  const validStake =
    Number.isFinite(stakeNumber) && stakeNumber > 0 && stakeNumber <= 10000;
  const nav: {
    id: View;
    label: string;
    icon: "layers" | "search" | "chart";
  }[] = [
    { id: "today", label: "Today’s Picks", icon: "layers" },
    { id: "explore", label: "Explore", icon: "search" },
    { id: "results", label: "Results", icon: "chart" },
  ];
  return (
    <div className="rdg-app">
      <a href="#main-content" className="skip-link">
        Skip to picks
      </a>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => setView("today")}
            aria-label="RDG home"
          >
            <Image
              className="brand-image"
              src="/rdg-logo.png"
              alt="Responsible Degenerate Gambling"
              width={166}
              height={85}
              preload
            />
          </button>
          <nav aria-label="Main navigation">
            {nav.map((item) => (
              <button
                key={item.id}
                aria-current={view === item.id ? "page" : undefined}
                onClick={() => setView(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <span className="header-tag">SPORTS. STATS. PERSPECTIVE.</span>
        </div>
      </header>
      <main id="main-content" className="dashboard">
        {view !== "results" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="tiny-line" /> YOUR DAILY SPORTS SHORTLIST
                </p>
                <h1>
                  Less noise.
                  <br />
                  <span>More perspective.</span>
                </h1>
                <p className="hero-description">
                  Find your picks. Understand the reasoning.
                  <br className="desktop-break" /> Build a slip you can actually
                  follow.
                </p>
                <div className="hero-foot">
                  <span className="book-pill">Hard Rock Bet</span>
                  <span>Six sports. One clear view.</span>
                </div>
              </div>
              <div className="hero-image">
                <Image
                  key={hero.src}
                  src={hero.src}
                  alt={hero.alt}
                  fill
                  sizes="(max-width: 700px) 100vw, 50vw"
                  preload
                  unoptimized
                />
                <div className="image-caption">
                  <span>THE RDG APPROACH</span>
                  <p>
                    Research first.
                    <br />
                    Every leg matters.
                  </p>
                </div>
              </div>
            </section>
            <div className="board-toolbar">
              <div className="sport-tabs" aria-label="Choose a sport">
                {(["ALL", ...SPORTS] as const).map((s) => (
                  <button
                    key={s}
                    aria-pressed={sport === s}
                    onClick={() => setSport(s)}
                  >
                    {LABELS[s]}
                  </button>
                ))}
              </div>
              <button
                className="refresh-button"
                aria-label={loading ? "Loading feeds" : "Refresh"}
                disabled={loading}
                onClick={reload}
              >
                <Icon name="refresh" />
                <span>{loading ? "Loading…" : "Refresh"}</span>
              </button>
            </div>
            <div className="board-meta">
              <span>
                <span
                  className={`status-dot ${loading || errors.length || stale ? "waiting" : ""}`}
                />
                {loading
                  ? "Loading selected feeds…"
                  : loadedTime
                    ? `Feed loaded ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(loadedTime)}`
                    : "Waiting for data"}
              </span>
              <span>
                Pregame research ·{" "}
                {horizon === "today" ? "Today, Eastern time" : "Next 7 days"}
              </span>
            </div>
            {errors.length > 0 && (
              <div className="notice warning" role="status">
                {errors
                  .map((r) =>
                    r.key === "props"
                      ? "NFL props"
                      : r.key === "injuries"
                        ? "NFL injuries"
                        : r.key,
                  )
                  .join(", ")}{" "}
                unavailable.{" "}
                {errors
                  .map((r) => r.feed?.error)
                  .filter(Boolean)
                  .join(" ")}
              </div>
            )}
            {stale && (
              <div className="notice warning" role="status">
                This board is over 15 minutes old. Refresh before building a new
                slip.
              </div>
            )}
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {expansionSport
                    ? "YOUR RESEARCH BOARD"
                    : view === "today"
                      ? "THE SHORTLIST"
                      : "YOUR RESEARCH BOARD"}
                </p>
                <h2>
                  {view === "today"
                    ? "A clearer way to pick."
                    : "Look a little closer."}
                </h2>
                <p>
                  {expansionSport
                    ? "Live matchups and available prices. Model recommendations are not connected for this sport."
                    : view === "today"
                      ? "Parlay ideas from existing model signals. Check every leg before placing."
                      : "Browse individual picks and the evidence behind them."}
                </p>
              </div>
              <div className="segmented" aria-label="Game date range">
                <button
                  aria-pressed={horizon === "today"}
                  onClick={() => setHorizon("today")}
                >
                  Today
                </button>
                <button
                  aria-pressed={horizon === "week"}
                  onClick={() => setHorizon("week")}
                >
                  Next 7 days
                </button>
              </div>
            </div>
            {!expansionSport && (
              <details className="pick-filters">
                <summary>Customize your picks</summary>
                <div className="filter-fields">
                  <fieldset>
                    <legend>Include bet types</legend>
                    {["Moneyline", "Spread", "Total", "Player prop"].map(
                      (m) => (
                        <label key={m}>
                          <input
                            type="checkbox"
                            checked={slipMarkets.includes(m)}
                            onChange={(e) =>
                              setSlipMarkets((v) =>
                                e.target.checked
                                  ? [...v, m]
                                  : v.filter((x) => x !== m),
                              )
                            }
                          />
                          {m}
                        </label>
                      ),
                    )}
                    <small>No boxes selected = all bet types.</small>
                  </fieldset>
                  <fieldset>
                    <legend>Player prop types</legend>
                    {[
                      ["player_rush_yds", "Rushing yards"],
                      ["player_pass_yds", "Passing yards"],
                      ["player_pass_tds", "Passing touchdowns"],
                      ["player_reception_yds", "Receiving yards"],
                      ["player_receptions", "Receptions"],
                      ["player_anytime_td", "Anytime touchdown"],
                      ["pitcher_strikeouts", "Pitcher strikeouts"],
                      ["batter_hits", "Batter hits"],
                      ["batter_total_bases", "Batter total bases"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={propTypes.includes(key)}
                          onChange={(e) =>
                            setPropTypes((v) =>
                              e.target.checked
                                ? [...v, key]
                                : v.filter((x) => x !== key),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <small>
                      No boxes selected = all props. Choose “Player props” under
                      Parlay style for prop-only slips. Only qualifying
                      available lines enter a parlay.
                    </small>
                  </fieldset>
                  <label>
                    Maximum favorite price
                    <select
                      aria-label="Maximum favorite price"
                      value={maxFavorite}
                      onChange={(e) => setMaxFavorite(e.target.value)}
                    >
                      <option value="">No limit</option>
                      {[150, 200, 300, 500, 1000].map((n) => (
                        <option key={n} value={n}>
                          No heavier than -{n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Exclude team
                    <select
                      aria-label="Exclude team"
                      value={excludeChoice}
                      onChange={(e) => {
                        const t = e.target.value;
                        setExcludeChoice("");
                        if (t) setExcludedTeams((v) => [...new Set([...v, t])]);
                      }}
                    >
                      <option value="">Choose a team</option>
                      {teams
                        .filter((t) => !excludedTeams.includes(t))
                        .map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="excluded-teams">
                  {excludedTeams.map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        setExcludedTeams((v) => v.filter((x) => x !== t))
                      }
                    >
                      Restore {t} ×
                    </button>
                  ))}
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setSlipMarkets([]);
                    setMaxFavorite("");
                    setExcludedTeams([]);
                  }}
                >
                  Reset filters
                </button>
              </details>
            )}
            {expansionSport ? (
              <ExpansionBoard
                feeds={visibleFeeds}
                sport={sport}
                now={now}
                horizon={horizon}
              />
            ) : view === "today" ? (
              <>
                <label
                  className={`notice reference-toggle ${allowReference ? "is-enabled" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={allowReference}
                    onChange={(e) => setAllowReference(e.target.checked)}
                  />{" "}
                  <span className="reference-toggle-copy">
                    <strong>Include standard Hard Rock reference prices</strong>
                    <small>
                      Show more qualifying parlays when Florida prices are
                      unavailable. Verify these lines in the Florida app.
                    </small>
                  </span>
                  <span className="reference-toggle-state" aria-hidden="true">
                    {allowReference ? "ON" : "OFF"}
                  </span>
                </label>
                <div className="slip-controls">
                  <div className="control-group">
                    <span>Legs per parlay</span>
                    <div className="leg-options">
                      {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <button
                          key={n}
                          aria-label={`${n} legs`}
                          aria-pressed={size === n}
                          onClick={() => setSize(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <small>More legs = harder to hit</small>
                  </div>
                  <label className="mix-control">
                    Parlay style
                    <select
                      aria-label="Parlay style"
                      value={mix}
                      onChange={(e) => setMix(e.target.value as typeof mix)}
                    >
                      <option value="balanced">Balanced mix</option>
                      <option value="props">Player props</option>
                      <option value="games">Game picks</option>
                      <option value="no-spreads">No spreads</option>
                      <option value="moneylines">Moneylines only</option>
                      <option value="spreads">Spreads only</option>
                      <option value="totals">Totals (over / under)</option>
                    </select>
                  </label>
                  {mix === "totals" && (
                    <p className="quote-note">
                      Automatic totals currently use the experimental MLB model.
                      Find available football and hockey totals in Explore; NBA
                      totals are on the NBA research board.
                    </p>
                  )}
                  <label className="stake-input">
                    Example stake{" "}
                    <span>
                      ${" "}
                      <input
                        aria-label="Example stake in dollars"
                        type="number"
                        min="1"
                        max="10000"
                        step="1"
                        value={stake}
                        onChange={(e) => setStake(e.target.value)}
                        aria-invalid={!validStake}
                      />
                    </span>
                  </label>
                </div>
                {size >= 6 && (
                  <p className="notice">
                    {size}-leg slips need {size} qualifying games. More legs
                    increase the chance that one loss defeats the whole slip; no
                    weaker legs are added to fill it.
                  </p>
                )}
                {sport === "CFB" && (
                  <p className="notice">
                    College picks include spreads and moneylines. Choose
                    Moneylines only to focus on outright winners, or Balanced
                    mix for both. Moneylines require a projected margin of at
                    least 3 points and sufficient team data; these are research
                    picks, not proven value bets.
                  </p>
                )}
                {!validStake && (
                  <p className="copy-error" role="status">
                    Enter a stake greater than $0 and no more than $10,000 to
                    estimate a return.
                  </p>
                )}
                {(!loaded || loading) && ideas.length === 0 ? (
                  <Loading />
                ) : ideas.length ? (
                  <div className="idea-grid">
                    {ideas.map((idea, i) => (
                      <IdeaCard
                        key={JSON.stringify([
                          idea.map((p) => [p.id, p.odds]),
                          mix,
                          maxFavorite,
                          excludedTeams,
                          slipMarkets,
                          allowReference,
                          controlledPicks.map((p) => [
                            p.id,
                            p.odds,
                            p.eligible,
                          ]),
                        ])}
                        picks={idea}
                        index={i}
                        stake={validStake ? stakeNumber : 0}
                        pool={controlledPicks}
                        now={now}
                        mix={mix}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <span className="empty-symbol">
                      <Icon name="layers" />
                    </span>
                    <h3>
                      No complete {size}-leg ideas{" "}
                      {horizon === "today" ? "for today" : "in this window"}.
                    </h3>
                    <p>
                      {sport === "CFB" && mix === "props"
                        ? "College player props are not connected. Choose Balanced mix or Moneylines only for college picks, or All sports for available player props."
                        : errors.length
                          ? "Some data is unavailable. Try refreshing or browse the available research."
                          : nfl?.market_data_available === false &&
                              sport === "NFL"
                            ? "NFL predictions are available below, but Hard Rock prices are unavailable for this deployment. Parlays need actual prices."
                            : "There aren’t enough eligible picks from separate games. No extra legs have been forced."}
                    </p>
                    <div className="empty-actions">
                      {sport === "CFB" && (
                        <button onClick={() => setSport("ALL")}>
                          Show all sports
                        </button>
                      )}
                      {mix !== "balanced" && (
                        <button onClick={() => setMix("balanced")}>
                          Use balanced mix
                        </button>
                      )}
                      {horizon === "today" && (
                        <button
                          className="primary-button"
                          onClick={() => setHorizon("week")}
                        >
                          Check the next 7 days <Icon name="arrow" />
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() => setView("explore")}
                      >
                        Explore individual picks
                      </button>
                    </div>
                  </div>
                )}
                <div className="method-strip">
                  <div>
                    <span>01</span>
                    <h3>Separate games</h3>
                    <p>
                      One selection per game within each idea. Correlation is
                      not modeled.
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <h3>Clear pricing</h3>
                    <p>
                      Hard Rock legs only. Estimated returns always include your
                      stake.
                    </p>
                  </div>
                  <div>
                    <span>03</span>
                    <h3>No forced picks</h3>
                    <p>
                      If a full combination doesn’t qualify, it stays off the
                      shortlist.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="explore-controls">
                  <label className="search-input">
                    <Icon name="search" />
                    <input
                      aria-label="Search player, team or matchup"
                      placeholder="Search player, team or matchup…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Bet type"
                    value={market}
                    onChange={(e) => setMarket(e.target.value)}
                  >
                    {[
                      "All bets",
                      "Spread",
                      "Moneyline",
                      "Total",
                      "Player prop",
                    ].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <span>{picks.length} picks</span>
                </div>
                {(!loaded || loading) && picks.length === 0 ? (
                  <Loading />
                ) : picks.length ? (
                  <div className="explore-grid">
                    {picks.map((p) => (
                      <article className="pick-card" key={p.id}>
                        <div className="pick-team-logos">
                          <MatchupLogos sport={p.sport} matchup={p.matchup} />
                        </div>
                        <div className="pick-top">
                          <span
                            className={`sport-label sport-${p.sport.toLowerCase()}`}
                          >
                            {p.sport} · {p.market}
                          </span>
                          <span className="draft-badge">
                            {p.eligible ? "Parlay candidate" : "Research only"}
                          </span>
                        </div>
                        <h3>{p.title}</h3>
                        <p>{p.matchup}</p>
                        {p.referencePrice && (
                          <p className="reference-label">
                            Indiana reference · verify Florida line
                          </p>
                        )}
                        <time dateTime={p.starts}>{gameTime(p.starts)}</time>
                        <div className="pick-price">
                          <span>{p.book}</span>
                          <strong>{formatOdds(p.odds)}</strong>
                        </div>
                        <Research picks={[p]} />
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <h3>No picks match this view.</h3>
                    <p>Try a different sport, date range or search.</p>
                  </div>
                )}
              </>
            )}
            {!expansionSport && (
              <section className="straight-section">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">ONE PICK AT A TIME</p>
                    <h2>Straight bets</h2>
                    <p>
                      Individual qualifying picks using your sport, date and
                      custom filters.
                    </p>
                  </div>
                  <span>{straightPicks.length} available</span>
                </div>
                {straightPicks.length ? (
                  <div className="explore-grid">
                    {straightPicks.slice(0, showStraights ? 12 : 3).map((p) => (
                      <article className="pick-card" key={p.id}>
                        <MatchupLogos sport={p.sport} matchup={p.matchup} />
                        <p>
                          {p.sport} · {p.market}
                        </p>
                        <h3>{p.title}</h3>
                        <p>
                          {p.matchup} · {gameTime(p.starts)}
                        </p>
                        <strong>{formatOdds(p.odds)}</strong>
                        <p className="straight-reason">{p.reasons[0]}</p>
                        <Research picks={[p]} />
                        <TrackButton key={p.id + String(p.odds)} picks={[p]} />
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="notice">
                    No qualifying straight bets match these filters.
                  </p>
                )}
                {straightPicks.length > 3 && (
                  <button
                    className="secondary-button"
                    onClick={() => setShowStraights((v) => !v)}
                  >
                    {showStraights
                      ? "Show fewer straight bets"
                      : "Show more straight bets"}
                  </button>
                )}
              </section>
            )}
            {(sport === "NFL" || sport === "ALL") && (
              <NflPredictions
                data={nfl}
                now={now}
                horizon={horizon}
                error={nflError}
                onRetry={reload}
                loading={loading}
              />
            )}
            <SportSlates
              feeds={visibleFeeds}
              sport={sport}
              now={now}
              horizon={horizon}
            />
            <details className="data-notes">
              <summary>What’s included in this research?</summary>
              <p>
                These ideas use the existing RDG models, not a newly validated
                profit model. NFL player props require a recent matching Hard
                Rock quote and an available injury feed. Injury designations can
                block props; team injury effects and weather adjustments are not
                modeled here. Small-sample college football remains
                research-only. Quote timestamps are displayed when supplied by
                the provider; confirmed lineups remain unverified.
              </p>
              <p>
                Feed-loaded time is when RDG received the response, not the
                sportsbook quote time. Rankings are research signals, not win
                probabilities. Separate games can still share risks, and
                different slips may overlap. Confirm final lines and payouts in
                Hard Rock Bet.
              </p>
            </details>
          </>
        )}
        {view === "results" && <Results />}
        <footer className="site-footer">
          <span className="footer-brand">
            RDG<span>↗</span>
          </span>
          <p>Research, not guarantees. No model promises a profit.</p>
          <span>21+ · Bet within your limits.</span>
        </footer>
      </main>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading-grid" role="status" aria-label="Loading picks">
      {[1, 2, 3].map((n) => (
        <div key={n} className="skeleton-card">
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
