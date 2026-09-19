import { NextResponse } from "next/server";
import { getRdgNflAnalysis } from "../../../lib/rdg-nfl";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const analysis = await getRdgNflAnalysis();

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("RDG Analyze Error:", error);

    return NextResponse.json(
      {
        error: "RDG live analysis failed",
        details:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
