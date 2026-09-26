// Calendar-day window in the site's displayed timezone, not the server timezone.
export function gameWindow(now = Date.now()) {
  const start = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
  const end = new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0,10);
  return { start, end };
}
