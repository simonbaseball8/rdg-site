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

## Weekly winning slips and fighter photos

Results includes a Wins showcase for tracked winning parlays originally saved with five or more legs. It follows the current journal filters and keeps paper and placed records separate. Weeks run Sunday–Saturday in America/New_York and use the first recorded winning settlement in the current winning run. Payout corrections update the net amount without moving the win to another week; reversing a win removes it. Pushed/void legs are identified. Showcase net units include only its winning slips; the overall W–L, win rate and ROI include the whole filtered record. Settlements remain manual, not sportsbook-verified.

UFC cards use portraits from ESPN's headshot CDN, keyed by competitor IDs from the matched ESPN UFC event. Unmatched fighters and failed image requests show initials and “Photo unavailable”; no guessed identity or generated face is used. Images load lazily without extra Odds API requests.

## Automatic grading and daily snapshots (2026-09-27)

- New game picks store structured team/line/side fields. `/api/journal/grade` checks ESPN final scoreboards for NFL, CFB, MLB, NHL and NBA. Only a unique exact team matchup within 90 minutes of the original start is accepted. Incomplete scores, old snapshots without structured fields, props, postponed games and ambiguous doubleheaders stay pending. No player participation or sportsbook payout verification is implied.
- Results checks up to 30 recent slips automatically when opened, in batches of four. Manual settlements always take priority; an unavailable score feed never erases an earlier result. Checks only cover the previous 31 days.
- The browser saves the first available same-day 2-, 3- and 5-leg model slips per viewed sport/all-sports board at fixed 1u paper stakes. These are separate `model` records, not placed bets. They require the site to be open and sufficient fresh Florida-priced qualifying picks. Filter changes do not rewrite snapshots.
- `rdg_daily_slips` is a separate shared MODEL archive. Apply `supabase/migrations/20260927_daily_slips.sql` in addition to the private journal migration. Its original snapshots are immutable; settlement history is appended with optimistic concurrency checks.
- Set `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `CRON_SECRET`, and Vercel's production hostname `VERCEL_PROJECT_PRODUCTION_URL` in the production environment. Never expose the service key in client variables. Scheduled save runs 09:30 UTC daily and grading 13:30 UTC daily. Vercel schedules run on production deployments, not this preview branch. The shared scheduler is not active until schema/configuration are in place and this branch is deployed to production.
- Scheduled saving reads existing analysis routes and can consume normal Odds API credits if their cache is cold. It does not request historical paid odds. Grading uses ESPN scoreboards and consumes no Odds API credits.
- Shared archive shows up to 270 published slips with all losses included. Grading revisits the last seven days; older/unresolved and prop results remain pending. The shared record is read-only in the UI.
- The optional 3D card tilt uses pointer position, small rotations and CSS perspective. It is disabled for touch/coarse pointers and reduced-motion users; the header switch persists on the device. No WebGL download is required.

## Visual refresh

The 3D pointer tilt and motion switch have been removed. The page now uses the selected sport’s existing stadium/arena image as a fixed, shaded background, with solid content cards and section bands for contrast. The logo and all tracking features remain in place.

## Prelaunch tracking/data audit — 2026-09-27

- The board's Data quality panel counts missing/stale/future quote timestamps, reference prices, weather gaps/holds and props without automatic settlement using already-loaded feeds. It makes no extra paid API requests. This is a coverage audit, not independent roster verification or a performance backtest.
- Scheduled saving returns the actual inserted count separately from existing immutable snapshots. Provider warning responses are reported, even when HTTP status is 200.
- Scheduled grading groups overlapping slips by game date, sharing scoreboard requests rather than requesting the same scoreboards separately for every slip. Errors and concurrency conflicts are reported. Unavailable grades retain previous outcomes. The current seven-day/63-slip review limit remains; unresolved older bets require review.
- Shared Results validates archived records and shows the latest saved timestamp. That is not a scheduler heartbeat: zero qualifying picks can legitimately mean no new snapshot.

### Activation checklist
1. Apply both existing SQL migrations in the RDG Supabase project: `20260926_bet_journal.sql`, then `20260927_daily_slips.sql`. Neither deletes existing tables or records.
2. Verify production server configuration: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `VERCEL_PROJECT_PRODUCTION_URL`. Keep secrets in the hosting environment, never in chat, screenshots or browser bundles.
3. Verify `/api/daily-slips` returns HTTP 200. An empty `bets` array is a valid ready state; HTTP 503 means database/configuration still needs attention.
4. After reviewing the preview, deploy the branch to production. Preview deployment alone does not enable Vercel cron runs. Confirm schedules and execution logs in Vercel.
5. Invoke the protected save job from the authorized server/hosting environment, then inspect its inserted/already_saved counts and warnings. Retrying must not rewrite original snapshots. A successful run can have zero candidates.
6. After games finish, verify grading updates outcomes, preserves original prices and records both wins and losses. Props remain pending until a reliable settlement source is connected. Do not publish a complete performance claim while unresolved bets remain.

At this stage, production activation has not been performed. Supabase project access/configuration is required to finish the end-to-end check. No historical sportsbook credits were spent for this audit.
