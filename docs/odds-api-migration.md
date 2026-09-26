# Odds provider migration

All active sportsbook feeds now use The Odds API and explicitly request Hard Rock Bet Florida (`hardrockbet_fl`). Set `ODDS_API_KEY` in Vercel Preview and Production. Oddize and SportsGameOdds credentials are no longer required by active routes.

The Odds API supplies prices, not the historical statistics used by the models. NFL still uses nflverse, MLB uses MLB Stats API, NHL uses public NHL data, and college football uses CFBD CORE. `CFBD_API_KEY` remains necessary for college football model predictions; without it the UI displays the available college odds and explains that statistics are unavailable. NHL preseason games are visible as research but excluded from regular-season model parlays.

The builder defaults to all sports and a balanced mix, prioritizes qualifying props, diversifies games/sports across cards, and supports props-only and game-only views. No identical pick is reused across cards, and a card cannot contain two selections from the same game, even across provider IDs. NFL props are evaluated against the Hard Rock FL line when present. MLB props now join the board with exact-book, exact-line, timestamp and history gates. Model qualifications are retained; no picks are fabricated to fill a card.

Game odds requests cache for five minutes. NFL and MLB prop response cache lifetimes are five minutes without stale-while-revalidate. NFL prop injury/role protections and 15-minute quote freshness remain enforced. MLB lineup/probable pitcher confirmation remains a manual review requirement. These changes do not validate profitability, add weather adjustments, or calibrate joint parlay probabilities.

Verification: provider adapter tests cover all four sport keys, Florida-only prices, spreads/totals, failure redaction, and empty markets; builder tests cover props/game filters and sport diversity. Browser fixtures cover college odds without stats, visible NHL preseason games, parlay controls and mobile layout. Live deployment checks are required to establish actual provider coverage.

Live preview validation on September 26: all seven board endpoints returned HTTP 200. NFL produced qualifying Hard Rock FL props and spread ideas. College returned 79 events but lacked CFBD statistics. MLB returned 13 model games and 65 actionable prop research rows; none had eligible Hard Rock FL quotes. NHL returned 14 preseason games with no matched Hard Rock FL moneylines. No non-NFL Hard Rock prices were confirmed in these responses; feed success must not be represented as parlay availability.

## Coverage resolution

The bounded `/api/odds-status` probe confirmed standard `hardrockbet` prices for CFB, MLB and NHL, while `hardrockbet_fl` was returned only for NFL. Standard Hard Rock is the Indiana feed per provider documentation. The adapter now prefers Florida and explicitly labels standard-book fallback quotes as Indiana references for non-NFL sports. The dashboard requires an unchecked-by-default opt-in before including these quotes in parlay ideas; labels persist on legs and copied slips. NFL remains Florida-only. MLB props can use labeled standard-book references under the same opt-in. No Arizona/Ohio quotes are substituted.

Production CFB statistics were confirmed working; the missing setting was Preview access to the existing CFBD key. NHL preseason remains visible, with odds, but outside the regular-season parlay model.
