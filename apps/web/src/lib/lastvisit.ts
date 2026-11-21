const KEY = "gm:last-visit";

/** Timestamp of the previous session, or null on first visit. */
export function readLastVisit(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

/** Record the current visit — call once after reading the previous value. */
export function stampLastVisit(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // private mode etc. — absence is fine
  }
}

/** "7 hours ago" — compact human delta for the home pane. */
export function formatSince(ts: number, now = Date.now()): string {
  const mins = Math.max(1, Math.round((now - ts) / 60000));
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
