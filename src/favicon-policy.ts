export interface FaviconPolicyState { url: string; favicon: string; favicon_source: string; favicon_checked_at: string; favicon_retry_at: string; favicon_failed_attempts: number; }

export function shouldFetchFavicon(item: FaviconPolicyState, cachedFileExists: boolean, now: number, refreshDays: number): boolean {
  const retryAt = Date.parse(item.favicon_retry_at);
  if (Number.isFinite(retryAt) && retryAt > now) return false;
  if (item.favicon && cachedFileExists && item.favicon_checked_at) {
    try { if (!item.favicon_source || new URL(item.favicon_source).origin !== new URL(item.url).origin) return true; }
    catch { return true; }
    const checkedAt = Date.parse(item.favicon_checked_at);
    if (Number.isFinite(checkedAt) && now - checkedAt < refreshDays * 86_400_000) return false;
  }
  return true;
}

export function faviconRetryAt(failures: number, now: number): string {
  const attempts = Math.max(1, Math.floor(failures));
  const delay = Math.min(30 * 86_400_000, 3_600_000 * 2 ** Math.min(attempts - 1, 10));
  return new Date(now + delay).toISOString();
}
