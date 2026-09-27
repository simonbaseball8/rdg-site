import { validBet } from "../../../rdg/journal";
import { gradePicks } from "../../../../lib/final-scores";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return Response.json({ error: "Origin mismatch" }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 100000)
    return Response.json({ error: "Request too large" }, { status: 413 });
  try {
    const { bet } = JSON.parse(raw);
    if (!validBet(bet))
      return Response.json({ error: "Invalid bet" }, { status: 400 });
    return Response.json(await gradePicks(bet.picks), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "Final scores are unavailable. Saved results were kept." },
      { status: 503 },
    );
  }
}
