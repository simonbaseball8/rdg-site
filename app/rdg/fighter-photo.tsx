"use client";
import Image from "next/image";
import { useState } from "react";
export function FighterPhoto({
  name,
  photo,
}: {
  name: string;
  photo?: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="fighter-profile">
      {photo && failed !== photo ? (
        <Image
          unoptimized
          src={photo}
          alt={`${name} portrait`}
          width={120}
          height={120}
          loading="lazy"
          onError={() => setFailed(photo)}
        />
      ) : (
        <div
          className="fighter-placeholder"
          role="img"
          aria-label={`Photo unavailable for ${name}`}
        >
          <span>
            {name
              .split(/\s+/)
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </span>
          <small>Photo unavailable</small>
        </div>
      )}
      <strong>{name}</strong>
    </div>
  );
}
