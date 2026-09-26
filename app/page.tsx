"use client";

import { useState } from "react";
import Image from "next/image";
import { MatchupLogos } from "./rdg/team-logos";
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
        Why these picks? <span aria-hidden="true">+</span>
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
            <p className="risk-heading">What to check</p>
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
  picks,
  index,
  stake,
}: {
  picks: Pick[];
  index: number;
  stake: number;
}) {
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
  const [horizon, setHorizon] = useState<"today" | "week">("week");
  const [mix, setMix] = useState<"balanced" | "props" | "games">("balanced");
  const [allowReference, setAllowReference] = useState(false);
  const [size, setSize] = useState(2);
  const [stake, setStake] = useState("10");
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
  const picks = allPicks.filter(
    (p) =>
      (market === "All bets" || p.market === market) &&
      `${p.title} ${p.matchup}`.toLowerCase().includes(query.toLowerCase()),
  );
  const ideas = buildIdeas(allPicks, size, now, mix);
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
                  <span>Four sports. One clear view.</span>
                </div>
              </div>
              <div className="hero-image">
                <svg
                  className="field-art"
                  viewBox="0 0 640 400"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="field-turf" x2="1" y2="1">
                      <stop stopColor="#294f31" />
                      <stop offset="1" stopColor="#14261c" />
                    </linearGradient>
                  </defs>
                  <g transform="translate(310 130) rotate(-24) translate(-320 -200)">
                    <rect
                      x="50"
                      y="20"
                      width="560"
                      height="330"
                      rx="8"
                      fill="url(#field-turf)"
                      stroke="#a1c57e"
                      strokeOpacity=".35"
                    />
                    {[120, 190, 260, 330, 400, 470, 540].map((x, i) => (
                      <g key={x} stroke="#c4e89b" strokeOpacity=".23">
                        <path d={`M${x} 20v330`} />
                        <text
                          x={x + 12}
                          y="88"
                          fill="#d1edb7"
                          stroke="none"
                          fillOpacity=".35"
                          fontSize="22"
                          fontFamily="monospace"
                        >
                          {[20, 30, 40, 50, 40, 30, 20][i]}
                        </text>
                        {[145, 155, 215, 225].map((y) => (
                          <path
                            key={y}
                            d={`M${x - 22} ${y}h8 M${x + 15} ${y}h8`}
                          />
                        ))}
                      </g>
                    ))}
                    <ellipse
                      cx="330"
                      cy="185"
                      rx="49"
                      ry="27"
                      fill="#c9f578"
                      fillOpacity=".08"
                      stroke="#c9f578"
                      strokeOpacity=".55"
                    />
                    <path
                      d="M307 185h46m-35-7v14m12-14v14m12-14v14"
                      stroke="#c9f578"
                      strokeWidth="2"
                      strokeOpacity=".8"
                    />
                  </g>
                </svg>
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
                  {view === "today" ? "THE SHORTLIST" : "YOUR RESEARCH BOARD"}
                </p>
                <h2>
                  {view === "today"
                    ? "A clearer way to pick."
                    : "Look a little closer."}
                </h2>
                <p>
                  {view === "today"
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
            {view === "today" ? (
              <>
                <label className="notice reference-toggle">
                  <input
                    type="checkbox"
                    checked={allowReference}
                    onChange={(e) => setAllowReference(e.target.checked)}
                  />{" "}
                  Include standard Hard Rock reference prices when Florida
                  prices are unavailable. Verify these lines in the Florida app.
                </label>
                <div className="slip-controls">
                  <div className="control-group">
                    <span>Legs per parlay</span>
                    <div className="leg-options">
                      {[2, 3, 4, 5].map((n) => (
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
                    </select>
                  </label>
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
                        key={idea.map((p) => p.id).join("-")}
                        picks={idea}
                        index={i}
                        stake={validStake ? stakeNumber : 0}
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
                      {errors.length
                        ? "Some data is unavailable. Try refreshing or browse the available research."
                        : nfl?.market_data_available === false &&
                            sport === "NFL"
                          ? "NFL predictions are available below, but Hard Rock prices are unavailable for this deployment. Parlays need actual prices."
                          : "There aren’t enough eligible picks from separate games. No extra legs have been forced."}
                    </p>
                    <div className="empty-actions">
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
                    {["All bets", "Spread", "Moneyline", "Player prop"].map(
                      (m) => (
                        <option key={m}>{m}</option>
                      ),
                    )}
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
                research-only. Other sports’ quote timestamps and confirmed
                lineups are not verified by this view.
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
