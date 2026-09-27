import { archiveClient, cronAuthorized } from "../../../../lib/daily-archive";
import { archiveGrades } from "../../../../lib/archive-grading";
import { gradePicks } from "../../../../lib/final-scores";
import { automaticSettlement } from "../../../rdg/auto-grade";
import { validBet } from "../../../rdg/journal";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!cronAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = archiveClient();
    const { data, error } = await db
      .from("rdg_daily_slips")
      .select("id,snapshot,settlements,revision")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(63);
    if (error) throw error;
    const rows = data.filter(row => validBet({...row.snapshot, settlements:row.settlements}));
    const bets = rows.map(row => ({...row.snapshot, settlements:row.settlements}));
    const grades = await archiveGrades(bets, gradePicks);
    let updated=0, failed=0;
    for(let i=0;i<rows.length;i+=6) await Promise.all(rows.slice(i,i+6).map(async (row,j)=>{
      try {
        const bet=bets[i+j];
        const result=automaticSettlement(bet,grades.outcomes[i+j],new Date().toISOString());
        if(!result)return;
        const {data:written,error}=await db.from("rdg_daily_slips")
          .update({settlements:[...bet.settlements,result],revision:row.revision+1})
          .eq("id",row.id).eq("revision",row.revision).select("id");
        if(error)throw error;
        if(written?.length)updated++;else failed++;
      }catch{failed++;}
    }));
    return Response.json({updated,failed,checked:rows.length,invalid_records:data.length-rows.length,warnings:grades.warnings});
  } catch {
    return Response.json(
      {
        error:
          "Daily archive grading unavailable; existing records were retained.",
      },
      { status: 503 },
    );
  }
}
