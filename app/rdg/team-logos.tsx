"use client";
import Image from "next/image";
import { useState } from "react";
import type { Sport } from "./board";
import { teamLogoUrl } from "./team-aliases";

export function TeamLogo({ sport, team }: { sport: Sport; team: string }) {
  const src = teamLogoUrl(sport, team);
  const [failed, setFailed] = useState<string | null>(null);
  const initials = team
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3);
  return (
    <span className="team-logo" title={team}>
      {src && failed !== src ? (
        <Image
          unoptimized
          src={src}
          alt={`${team} logo`}
          width={32}
          height={32}
          loading="lazy"
          onError={() => setFailed(src)}
        />
      ) : (
        <span
          className="team-logo-fallback"
          aria-label={`${team} logo unavailable`}
        >
          {team.length <= 4 ? team : initials}
        </span>
      )}
    </span>
  );
}
export function MatchupLogos({
  sport,
  matchup,
}: {
  sport: Sport;
  matchup: string;
}) {
  const teams = matchup.split(/\s+@\s+|\s+vs\.?\s+/i).filter(Boolean);
  return (
    <span className="matchup-logos">
      {teams.slice(0, 2).map((team) => (
        <TeamLogo key={team} sport={sport} team={team} />
      ))}
    </span>
  );
}
