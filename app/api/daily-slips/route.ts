import { validBet } from "../../rdg/journal";
import { archiveClient } from "../../../lib/daily-archive";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { data, error } = await archiveClient()
      .from("rdg_daily_slips")
      .select("snapshot,settlements,created_at")
      .order("created_at", { ascending: false })
      .limit(270);
    if (error) throw error;
    const bets = data.map(r=>({...r.snapshot,settlements:r.settlements}));
    if (!bets.every(validBet)) throw Error("Invalid archive record");
    return Response.json(
      {
        bets,
        latest_saved_at: data[0]?.created_at ?? null,
        notice:
          "Published model record. Fixed 1u research stakes; no wagers are placed.",
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "Shared daily archive is awaiting database setup. Device snapshots and personal results still work.",
      },
      { status: 503 },
    );
  }
}
