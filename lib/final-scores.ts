import { easternDate, type Pick } from "../app/rdg/board";
import { gradePick, type FinalGame } from "../app/rdg/auto-grade";
const paths: Record<string, string> = {
  NFL: "football/nfl",
  CFB: "football/college-football",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  NBA: "basketball/nba",
};
export async function gradePicks(picks: Pick[]) {
  const now = Date.now();
  const targets = new Map<string, { sport: string; date: string }>();
  for (const p of picks)
    if (
      paths[p.sport] &&
      p.grading &&
      Date.parse(p.starts) < now &&
      Date.parse(p.starts) > now - 31 * 86400000
    ) {
      const date = easternDate(p.starts).replaceAll("-", "");
      targets.set(`${p.sport}:${date}`, { sport: p.sport, date });
    }
  const scores = new Map<string, FinalGame[]>();
  const warnings: string[] = [];
  // Bound public route fan-out and use provider cache across visitors.
  if (targets.size > 12)
    throw Error("Check at most 12 sport/date combinations at once.");
  await Promise.all(
    [...targets].map(async ([key, t]) => {
      try {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${paths[t.sport]}/scoreboard?dates=${t.date}&limit=1000${t.sport === "CFB" ? "&groups=80" : ""}`,
          { next: { revalidate: 300 }, signal: AbortSignal.timeout(12000) },
        );
        if (!response.ok) throw Error("Scores unavailable");
        const data = await response.json();
        if (!Array.isArray(data.events)) throw Error("Scores unavailable");
        const games: FinalGame[] = data.events.flatMap((e: any) =>
          (e.competitions ?? []).flatMap((c: any) => {
            const home = c.competitors?.find((p: any) => p.homeAway === "home"),
              away = c.competitors?.find((p: any) => p.homeAway === "away");
            if (!home?.team?.displayName || !away?.team?.displayName) return [];
            const score = (s: unknown) =>
              typeof s === "string" && s.trim() !== ""
                ? Number(s)
                : typeof s === "number"
                  ? s
                  : NaN;
            return [
              {
                id: e.id,
                starts: c.date ?? e.date,
                home: home.team.displayName,
                away: away.team.displayName,
                homeScore: score(home.score),
                awayScore: score(away.score),
                final:
                  c.status?.type?.completed === true &&
                  /^STATUS_FINAL/.test(c.status?.type?.name ?? ""),
              },
            ];
          }),
        );
        scores.set(key, games);
      } catch {
        warnings.push(
          `${t.sport} ${t.date}: final scores unavailable; results left unchanged.`,
        );
      }
    }),
  );
  return {
    outcomes: picks.map((p) =>
      gradePick(
        p,
        scores.get(`${p.sport}:${easternDate(p.starts).replaceAll("-", "")}`) ??
          [],
      ),
    ),
    warnings,
  };
}
