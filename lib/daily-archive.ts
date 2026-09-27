import { createClient } from "@supabase/supabase-js";
export function archiveClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("Daily archive requires database setup.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function cronAuthorized(request: Request) {
  return (
    !!process.env.CRON_SECRET &&
    request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
  );
}
