import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { validBet, type TrackedBet } from "../../rdg/journal";
export const dynamic = "force-dynamic";
function client(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !/^[-a-f0-9]{72}$/.test(token)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("setup");
  return {
    owner: createHash("sha256").update(token).digest("hex"),
    db: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
const unavailable = () =>
  Response.json(
    {
      error:
        "Cloud journal is not configured yet. Your device journal still works; export a backup from Results.",
    },
    { status: 503 },
  );
export async function GET(request: Request) {
  try {
    const c = client(request);
    if (!c)
      return Response.json(
        { error: "Journal token required" },
        { status: 401 },
      );
    const { data, error } = await c.db
      .from("rdg_bet_journal")
      .select("snapshot,rdg_bet_settlements(payload,created_at)")
      .eq("owner_hash", c.owner)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) return unavailable();
    return Response.json(
      {
        bets: (data ?? []).map((row) => ({
          ...row.snapshot,
          settlements: (row.rdg_bet_settlements ?? [])
            .sort(
              (a: any, b: any) =>
                Date.parse(a.payload.at) - Date.parse(b.payload.at) ||
                a.created_at.localeCompare(b.created_at),
            )
            .map((s: any) => s.payload),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return unavailable();
  }
}
export async function POST(request: Request) {
  try {
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== new URL(request.url).origin
    )
      return Response.json({ error: "Origin mismatch" }, { status: 403 });
    if (Number(request.headers.get("content-length") ?? 0) > 100000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 100000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const bet = body.bet as TrackedBet;
    if (!validBet(bet))
      return Response.json({ error: "Invalid bet snapshot" }, { status: 400 });
    const c = client(request);
    if (!c)
      return Response.json(
        { error: "Journal token required" },
        { status: 401 },
      );
    const { settlements, ...snapshot } = bet;
    const { error } = await c.db.from("rdg_bet_journal").upsert(
      {
        id: bet.id,
        owner_hash: c.owner,
        snapshot: { ...snapshot, settlements: [] },
      },
      { onConflict: "owner_hash,id", ignoreDuplicates: true },
    );
    if (error) return unavailable();
    // First snapshot wins. Never replace the original odds, stake or saved timestamp.
    const { data: original, error: readError } = await c.db
      .from("rdg_bet_journal")
      .select("snapshot")
      .eq("owner_hash", c.owner)
      .eq("id", bet.id)
      .single();
    if (readError || !original) return unavailable();
    if (
      !isDeepStrictEqual(original.snapshot, { ...snapshot, settlements: [] })
    ) {
      return Response.json(
        { error: "Original snapshot cannot be changed" },
        { status: 409 },
      );
    }
    if (settlements.length) {
      const { error: e } = await c.db.from("rdg_bet_settlements").upsert(
        settlements.map((s) => ({
          id: s.id,
          bet_id: bet.id,
          owner_hash: c.owner,
          payload: s,
        })),
        { onConflict: "owner_hash,id", ignoreDuplicates: true },
      );
      if (e) return unavailable();
    }
    return Response.json({ saved: true });
  } catch {
    return unavailable();
  }
}
