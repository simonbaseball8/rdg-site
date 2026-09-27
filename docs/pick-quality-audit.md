# Parlay selection and weather audit — 2026-09-27

## Changes

- Source score now ranks before diversity. Sport/market/prop variety breaks equal-score ties, rather than overpowering source grades. Scores remain heuristic ordering aids, not comparable calibrated win probabilities.
- College moneylines retain their existing eligibility checks but move to research score 2: projected margin alone does not establish positive expected value at a particular price.
- NFL, college football and MLB pick normalization reads a separate game-time weather feed. The same normalization applies to straight bets, replacements and daily archive candidates.
- Pick details show venue, roof uncertainty, forecast conditions, forecast issue time and check time. Saved picks retain this weather snapshot with their original odds.

## Weather policy

Use the maximum sustained wind and precipitation probability across the first three hours from scheduled start. Require contiguous hourly coverage and valid measurements. Match sport, canonical teams and kickoff (within 90 minutes); reject ambiguous matches, check times older than 45 minutes and forecasts issued over 12 hours ago. No forecast is represented as clear weather.

Precautionary holds: thunderstorms/lightning/ice/blizzard descriptions or wind at least 25 mph exclude outdoor picks. Wind at least 15 mph holds totals, passing/receiving props and MLB props. Precipitation probability at least 70% holds MLB picks, totals and passing/receiving props. Lesser wind/precipitation or extreme temperatures lower ranking. These are conservative review thresholds, not validated forecast-to-performance coefficients. They do not automatically recommend unders or rushing overs.

Missing weather lowers ranking and displays “not weather-cleared”; it does not block the entire board. Verified dome metadata bypasses outdoor weather. Unconfirmed/retractable roofs use outdoor forecasts conservatively. Gusts, field-relative wind, official roof-open announcements and full extra-inning/overtime windows are not modeled. Outdoor games outside NWS coverage remain unavailable.

## Sources and operations

- National Weather Service hourly API: https://www.weather.gov/documentation/services-web-api — no weather API key. Cache hourly responses 15 minutes and grid lookups one day; each outbound request has a seven-second timeout.
- NFL schedule: https://github.com/nflverse/nfldata/blob/master/data/games.csv — kickoff is Eastern; stadium ID identifies the actual scheduled venue, including neutral sites.
- NFL venue coordinates: https://github.com/greerreNFL/Stadiums/blob/main/data/stadiums.csv — extracted factual ID/name/coordinates/roof metadata; source blob 5b9ccbd0a63702679058c5a32b37994416d62f59. Unknown/new stadiums have no assumed location.
- MLB Stats API schedule with hydrated venue location and roof metadata.
- CollegeFootballData games and venues APIs, using the existing server-side CFBD_API_KEY. Schedule cached one hour, venues one day. These calls use that subscription's allowance; they are not Odds API calls. Current implementation covers regular-season college schedules only.
- Up to 60 games per sport, earliest first; ten parallel forecast lookups per batch with a bounded request budget. Remaining forecasts explicitly unavailable.

## Validation and limits

Regression tests cover matching and freshness, wind/storm holds, indoor handling, unknown roofs, missing data, complete forecast coverage, and quality-before-variety selection. Existing pricing, grading, reference-price, injury and duplicate-game gates remain in place.

No historical out-of-sample profitability test has been performed for these weather thresholds or new ranking. No paid historical Odds API queries were run. Results tracking is the basis for evaluating performance; this change does not demonstrate a higher win rate or guaranteed profit.
