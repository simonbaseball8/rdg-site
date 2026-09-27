import { validBet } from "../../rdg/journal";
import { archiveClient } from "../../../lib/daily-archive";
export const dynamic = "force-dynamic";
export async function GET() {
  const fail = (code: string, message: string) => Response.json(
    { code, error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim())
    return fail("MISSING_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL is missing from this deployment.");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
    return fail("MISSING_SERVER_KEY", "SUPABASE_SERVICE_ROLE_KEY is missing from this deployment.");
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== "https:") throw Error();
  } catch { return fail("INVALID_DATABASE_URL", "The configured Supabase URL is not a valid HTTPS project URL."); }

  try {
    const { data, error } = await archiveClient()
      .from("rdg_daily_slips")
      .select("snapshot,settlements,created_at")
      .order("created_at", { ascending: false })
      .limit(270);
    if (error) {
      // Return fixed diagnostic messages only, never provider details or credentials.
      if (["PGRST205", "42P01"].includes(error.code))
        return fail("MISSING_ARCHIVE_TABLE", "The connected database cannot find rdg_daily_slips. Check the project where the migration was run.");
      if (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(error.code) || /invalid api key|invalid jwt/i.test(error.message))
        return fail("DATABASE_AUTH_FAILED", "The database rejected the server credential or table permissions. Verify the server key belongs to the configured project.");
      if (/fetch failed|network|timeout/i.test(error.message))
        return fail("DATABASE_UNREACHABLE", "The configured database could not be reached. Check the project URL and whether the Supabase project is active.");
      return fail("DATABASE_QUERY_FAILED", "The database query failed. Check the archive schema and server configuration.");
    }
    const bets = data.map(r=>({...r.snapshot,settlements:r.settlements}));
    if (!bets.every(validBet)) return fail("INVALID_ARCHIVE_RECORD", "An archive record needs review; saved data has not been changed.");
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
        code: "DATABASE_CLIENT_FAILED",
        error: "Database client setup failed. Verify the project URL and server key in this deployment.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
