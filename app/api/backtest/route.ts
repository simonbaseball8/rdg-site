import { NextResponse } from "next/server";

type Game = {
  season: number;
  week: number;
  game_type: string;
  away_team: string;
  home_team: string;
  away_score: number;
  home_score: number;
};

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0].split(",");

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};

    headers.forEach((header, i) => {
      row[header.trim()] = values[i]?.trim() ?? "";
    });

    return row;
  });
}

export async function GET() {
  try {
    const url =
      "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Historical game data request failed",
          status: response.status,
        },
        { status: 500 }
      );
    }

    const csv = await response.text();
    const rows = parseCSV(csv);

    const games: Game[] = rows
      .filter((row) => {
        const season = Number(row.season);

        return (
          (season === 2024 || season === 2025) &&
          row.game_type === "REG" &&
          row.away_score !== "" &&
          row.home_score !== ""
        );
      })
      .map((row) => ({
        season: Number(row.season),
        week: Number(row.week),
        game_type: row.game_type,
        away_team: row.away_team,
        home_team: row.home_team,
        away_score: Number(row.away_score),
        home_score: Number(row.home_score),
      }));

    const games2024 = games.filter(
      (game) => game.season === 2024
    );

    const games2025 = games.filter(
      (game) => game.season === 2025
    );

    return NextResponse.json({
      backtest_version: "RDG Backtest v0.1",

      purpose:
        "Load completed regular-season NFL games for RDG model calibration",

      total_games: games.length,

      seasons: {
        2024: games2024.length,
        2025: games2025.length,
      },

      sample_games: games.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Backtest route failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
