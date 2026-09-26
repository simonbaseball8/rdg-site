# RDG controls, tracking and new-sport status

## Available on the preview
- 2–8 leg suggestions, each from distinct games. No forced legs.
- Moneyline/spread/prop filters, favorite-price cap, team exclusions, and a replacement selector that retains the active constraints.
- Independent straight-bet shortlist, including when no full parlay qualifies.
- Pick explanations and odds-source, feed-received, injury-fetch and lineup timestamps. Missing sources remain explicitly unavailable; feed retrieval is not called a quote update.
- Personal bet journal. Track buttons copy original picks/odds and save time before prices can change. Separate paper research from placed tickets. Place nothing automatically.
- User-entered settlement per leg: won, lost, push or void. Push/void legs contribute a 1.0 payout multiplier; fully void wagers are excluded from ROI stakes. Actual settled return can override the calculation for cash-outs, promotions or book-specific rules.
- Sport / bet-type / straight-versus-parlay filters; aggregate net units and ROI. Mixed-sport slips are their own group and are never counted once per leg. Pending bets do not enter ROI.
- JSON export/import. Device storage errors are surfaced, not treated as successful saves.

## Enable cloud backup
1. In the existing Supabase project's SQL editor, run `supabase/migrations/20260926_bet_journal.sql` once.
2. The Vercel deployment must have `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY` (already used by the older tracker).
3. On Results, choose **Sync cloud backup**. Records saved on the device are uploaded first.

The migration is additive; it does not change `rdg_picks`. RLS denies direct anonymous and authenticated access to both new tables. Server requests are scoped by a SHA-256 hash of a browser-generated secret token. Original snapshots and settlement history are append-only, enforced with database triggers. Clearing the browser token loses access to that cloud journal; use JSON export/restore to transfer records. This is not an account-based or shared public performance system. Results are self-reported, not independently verified sportsbook settlements. Automatic grading of props and syncing actual betting tickets are not connected.

## Coverage check: September 26, 2026
The live subscription returned 41 NBA events, with Ohio Hard Rock prices for 8; no Florida or Indiana NBA prices. MMA returned 59 events, with Indiana Hard Rock moneylines for 18; no Florida prices. These are a point-in-time check, not a promise of future coverage.

NBA and UFC/MMA tabs show available odds as research only and do not enter automatic parlay suggestions. NBA shows current ESPN standings with the actual season label; zero-game seasons are labeled explicitly. UFC records, weight classes and scheduled rounds appear only when both fighters and event dates match ESPN UFC data; unconfirmed MMA events are not called UFC cards. Fight method-of-victory and round betting markets are not connected. Neither sport has a validated RDG prediction model, injury screening or player-prop model yet.

Sources:
- https://the-odds-api.com/liveapi/guides/v4/
- https://the-odds-api.com/sports-odds-data/bookmaker-apis.html
- https://the-odds-api.com/sports-odds-data/betting-markets.html
- https://site.api.espn.com/apis/v2/sports/basketball/nba/standings
- https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard

## Totals and prop controls

Explore now exposes offered over/under totals for NFL, college football, MLB and NHL. NBA totals remain on its research board. Only the existing MLB totals model can nominate automatic total legs: its experimental signal, positive estimated value, matching half-run line, named probable starters and a recent sportsbook quote are required. Whole-run lines remain research-only because the current probability model does not estimate pushes. Other sports do not have a totals prediction model connected and their offered sides never become automatic picks.

The totals-only parlay style, Total market filter and results journal support these legs. Player prop type filters cover the existing NFL passing/rushing/receiving yards, receptions, passing touchdowns, anytime touchdowns and MLB pitcher strikeouts, hits and total bases. These filters do not create unavailable markets or bypass injury/role/price checks. No additional paid API calls are introduced by these controls.
