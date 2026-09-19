const parlays = [
  {
    icon: "🟢",
    title: "SAFER SLIP",
    subtitle: "3 Legs • Lower Risk",
    confidence: "HIGH",
    legs: [
      ["🏈 NFL", "Player Prop", "Target line shown here"],
      ["⚾ MLB", "Player Prop", "Target line shown here"],
      ["🏒 NHL", "Player Prop", "Target line shown here"],
    ],
  },
  {
    icon: "🔵",
    title: "BALANCED",
    subtitle: "4 Legs • Balanced Risk",
    confidence: "STRONG",
    legs: [
      ["🏈 NFL", "Player Prop", "Target line shown here"],
      ["🏟️ CFB", "Game/Player Prop", "Target line shown here"],
      ["⚾ MLB", "Player Prop", "Target line shown here"],
      ["🏒 NHL", "Player Prop", "Target line shown here"],
    ],
  },
  {
    icon: "🎯",
    title: "PLAYER PROPS",
    subtitle: "4 Legs • Props Only",
    confidence: "STRONG",
    legs: [
      ["🏈 NFL", "Player Prop", "Target line shown here"],
      ["🏈 NFL", "Player Prop", "Target line shown here"],
      ["⚾ MLB", "Player Prop", "Target line shown here"],
      ["🏒 NHL", "Player Prop", "Target line shown here"],
    ],
  },
  {
    icon: "💰",
    title: "BEST VALUE",
    subtitle: "3–5 Legs • Best Available Value",
    confidence: "VALUE",
    legs: [
      ["🏟️ CFB", "Best Value Play", "Target line shown here"],
      ["⚾ MLB", "Best Value Play", "Target line shown here"],
      ["🏒 NHL", "Best Value Play", "Target line shown here"],
    ],
  },
  {
    icon: "🔥",
    title: "DEGENERATE",
    subtitle: "5–6 Legs • Higher Risk",
    confidence: "SPICY",
    legs: [
      ["🏈 NFL", "Player Prop", "Target line shown here"],
      ["🏟️ CFB", "Player/Game Prop", "Target line shown here"],
      ["⚾ MLB", "Player Prop", "Target line shown here"],
      ["🏒 NHL", "Player Prop", "Target line shown here"],
      ["🏈 NFL", "Player Prop", "Target line shown here"],
    ],
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#070909] text-white">
      <header className="border-b border-white/10 bg-black/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 font-black text-black">
                RDG
              </div>
              <div>
                <h1 className="font-black tracking-tight">
                  RESPONSIBLE DEGENERATE GAMBLING
                </h1>
                <p className="text-xs text-emerald-400">
                  DATA BEFORE DEGENERACY.
                </p>
              </div>
            </div>
          </div>

          <div className="hidden text-sm text-zinc-400 md:block">
            Last updated: Today
          </div>
        </div>
      </header>

      <nav className="border-b border-white/10 bg-[#0c0f0e]">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-5 py-3 text-sm font-semibold">
          {["🔥 Today", "⭐ Best Bets", "🏈 NFL", "🏟️ CFB", "⚾ MLB", "🏒 NHL", "📊 Results"].map(
            (item, index) => (
              <button
                key={item}
                className={`whitespace-nowrap rounded-lg px-4 py-2 ${
                  index === 0
                    ? "bg-emerald-500 text-black"
                    : "bg-white/5 text-zinc-300 hover:bg-white/10"
                }`}
              >
                {item}
              </button>
            )
          )}
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
            TODAY&apos;S BOARD
          </div>

          <h2 className="text-4xl font-black tracking-tight md:text-5xl">
            Today&apos;s Parlays
          </h2>

          <p className="mt-3 max-w-2xl text-zinc-400">
            Our daily board across NFL, College Football, MLB and NHL.
            Matchups, injuries, game script, weather and betting value all
            considered.
          </p>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <Stat title="ACTIVE SLIPS" value="5" />
          <Stat title="SPORTS" value="4" />
          <Stat title="BEST BETS" value="—" />
          <Stat title="TODAY'S RECORD" value="0–0" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {parlays.map((parlay) => (
            <article
              key={parlay.title}
              className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1110]"
            >
              <div className="flex items-center justify-between border-b border-white/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">{parlay.icon}</div>
                  <div>
                    <h3 className="font-black tracking-wide">{parlay.title}</h3>
                    <p className="text-xs text-zinc-500">{parlay.subtitle}</p>
                  </div>
                </div>

                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
                  {parlay.confidence}
                </span>
              </div>

              <div className="divide-y divide-white/5">
                {parlay.legs.map((leg, index) => (
                  <div
                    key={`${parlay.title}-${index}`}
                    className="flex items-center justify-between gap-4 p-5"
                  >
                    <div>
                      <p className="mb-1 text-xs font-bold text-zinc-500">
                        LEG {index + 1} • {leg[0]}
                      </p>
                      <p className="font-bold">{leg[1]}</p>
                      <p className="mt-1 text-sm text-zinc-500">{leg[2]}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-xs text-zinc-500">CONFIDENCE</p>
                      <p className="font-bold text-emerald-400">★★★★☆</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between bg-black/30 px-5 py-4">
                <span className="text-xs text-zinc-500">
                  HARD ROCK TARGET LINES
                </span>
                <button className="text-sm font-bold text-emerald-400">
                  View Analysis →
                </button>
              </div>
            </article>
          ))}
        </div>

        <section className="mt-10 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
          <p className="text-xs font-black tracking-widest text-emerald-400">
            RDG PHILOSOPHY
          </p>
          <h3 className="mt-2 text-2xl font-black">Data Before Degeneracy.</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            No bet is guaranteed. RDG evaluates current information, matchup
            data and available betting lines to identify statistically
            supported opportunities. Always bet responsibly.
          </p>
        </section>
      </section>

      <footer className="border-t border-white/10 px-5 py-8 text-center text-xs text-zinc-600">
        RDG • Responsible Degenerate Gambling
      </footer>
    </main>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1110] p-5">
      <p className="text-xs font-bold tracking-wider text-zinc-500">{title}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
