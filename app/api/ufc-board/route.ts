import { expansionBoard } from "../../../lib/expansion-sports";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  try {
    return Response.json(await expansionBoard("UFC"), {
      headers: { "Cache-Control": "public, s-maxage=300, must-revalidate" },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "UFC feed unavailable" },
      { status: 503 },
    );
  }
}
