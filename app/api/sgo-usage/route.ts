import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({provider:"The Odds API",message:"SportsGameOdds has been retired. Odds API usage is included in /api/nfl-player-props under api_usage."}); }
