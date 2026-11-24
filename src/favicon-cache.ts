import { localIconPath } from './model.ts';
import type { Bookmark } from './model.ts';

export interface FaviconCacheRecord {
  origin: string;
  source: string;
  iconPath: string;
  lastSuccessAt: string;
  lastAttemptAt: string;
  etag: string;
  lastModified: string;
  retryAt: string;
  failures: number;
}

export type FaviconCacheIndex = Record<string, FaviconCacheRecord>;

export class DeferredFaviconSet {
  private ids = new Set<string>();
  defer(ids: readonly string[]): void { ids.forEach((id) => this.ids.add(id)); }
  shouldSkip(id: string): boolean { return this.ids.has(id); }
  release(ids: readonly string[]): void { ids.forEach((id) => this.ids.delete(id)); }
  clear(): void { this.ids.clear(); }
}

export const LEGACY_FAVICON_FIELDS = [
  'favicon_source', 'favicon_checked_at', 'favicon_retry_at', 'favicon_etag', 'favicon_last_modified', 'favicon_failed_attempts',
] as const;

export function faviconOrigin(rawUrl: string): string {
  try { return new URL(rawUrl).origin; } catch { return ''; }
}

export function faviconOriginChanged(previousUrl: string, nextUrl: string): boolean {
  return faviconOrigin(previousUrl) !== faviconOrigin(nextUrl);
}

export function emptyFaviconRecord(origin: string, iconPath = ''): FaviconCacheRecord {
  return { origin, source: '', iconPath, lastSuccessAt: '', lastAttemptAt: '', etag: '', lastModified: '', retryAt: '', failures: 0 };
}

export function normalizeFaviconCacheIndex(value: unknown): FaviconCacheIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: FaviconCacheIndex = {};
  for (const [origin, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    let parsed: URL;
    try { parsed = new URL(origin); } catch { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) continue;
    const record = raw as Partial<FaviconCacheRecord>;
    const text = (field: keyof FaviconCacheRecord): string => typeof record[field] === 'string' ? record[field] as string : '';
    result[origin] = {
      origin, source: text('source'), iconPath: localIconPath(text('iconPath')), lastSuccessAt: text('lastSuccessAt'),
      lastAttemptAt: text('lastAttemptAt'), etag: text('etag'), lastModified: text('lastModified'),
      retryAt: text('retryAt'), failures: Number.isSafeInteger(record.failures) && Number(record.failures) >= 0 ? Number(record.failures) : 0,
    };
  }
  return result;
}

export async function persistCacheState(save: () => Promise<void>, onError: (error: unknown) => void): Promise<boolean> {
  try { await save(); return true; }
  catch (error) { onError(error); return false; }
}

export class CoalescedAsyncWriter {
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<boolean> | null = null;
  private failures = 0;
  private stopped = false;
  constructor(
    private save: () => Promise<void>,
    private onError: (error: unknown) => void,
    private delayMs = 2000,
    private retryBaseMs = 1000,
    private retryLimitMs = 60_000,
    private maxRetries = 5,
  ) {}

  request(): void {
    if (this.stopped) return;
    if (this.failures > this.maxRetries) this.failures = 0;
    this.dirty = true;
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.inFlight) {
      const saved = await this.inFlight;
      if (saved && this.dirty) await this.flush();
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const write = persistCacheState(this.save, this.onError);
    this.inFlight = write;
    const saved = await write;
    this.inFlight = null;
    if (!saved) {
      this.dirty = true;
      this.failures++;
      if (this.failures <= this.maxRetries) {
        const retryDelay = Math.min(this.retryBaseMs * 2 ** (this.failures - 1), this.retryLimitMs);
        this.schedule(retryDelay);
      }
      return;
    }
    this.failures = 0;
    this.schedule();
  }

  async stopAndFlush(): Promise<void> {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.flush();
  }

  private schedule(delayMs = this.delayMs): void {
    if (this.stopped || this.timer || this.inFlight || !this.dirty) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delayMs);
  }
}

export async function persistBeforeLegacyCleanup<T>(persist: () => Promise<void>, cleanup: () => Promise<T>): Promise<T> {
  await persist();
  return cleanup();
}

export function isManagedFaviconPath(path: string): boolean {
  return /^_openmarks\/favicons\/site-[a-z0-9-]+\.(?:ico|png|jpe?g|webp|gif|svg)$/i.test(path);
}

export function legacyFaviconRecord(item: Bookmark): FaviconCacheRecord | null {
  const origin = faviconOrigin(item.url);
  if (!origin) return null;
  const hasLegacy = Boolean(item.favicon_source || item.favicon_checked_at || item.favicon_retry_at || item.favicon_etag || item.favicon_last_modified || item.favicon_failed_attempts);
  if (!hasLegacy && !item.favicon) return null;
  return {
    origin, source: item.favicon_source, iconPath: item.favicon, lastSuccessAt: item.favicon_checked_at,
    lastAttemptAt: item.favicon_checked_at || item.favicon_retry_at, etag: item.favicon_etag,
    lastModified: item.favicon_last_modified, retryAt: item.favicon_retry_at, failures: item.favicon_failed_attempts,
  };
}

export function mergeFaviconCacheRecords(current: FaviconCacheRecord | undefined, incoming: FaviconCacheRecord): FaviconCacheRecord {
  if (!current) return { ...incoming };
  const newestSuccess = incoming.lastSuccessAt > current.lastSuccessAt ? incoming : current;
  const newestAttempt = incoming.lastAttemptAt > current.lastAttemptAt ? incoming : current;
  return {
    origin: incoming.origin,
    source: newestSuccess.source || newestAttempt.source || current.source || incoming.source,
    iconPath: newestSuccess.iconPath || current.iconPath || incoming.iconPath,
    lastSuccessAt: newestSuccess.lastSuccessAt || current.lastSuccessAt || incoming.lastSuccessAt,
    lastAttemptAt: newestAttempt.lastAttemptAt || current.lastAttemptAt || incoming.lastAttemptAt,
    etag: newestSuccess.etag || current.etag || incoming.etag,
    lastModified: newestSuccess.lastModified || current.lastModified || incoming.lastModified,
    retryAt: incoming.retryAt > current.retryAt ? incoming.retryAt : current.retryAt,
    failures: Math.max(current.failures, incoming.failures),
  };
}

export function migrateLegacyFaviconIndex(index: FaviconCacheIndex, bookmarks: readonly Bookmark[]): { index: FaviconCacheIndex; pathsToClean: string[] } {
  const next = structuredClone(index);
  const pathsToClean: string[] = [];
  for (const item of bookmarks) {
    const legacy = legacyFaviconRecord(item);
    if (!legacy) continue;
    next[legacy.origin] = mergeFaviconCacheRecords(next[legacy.origin], legacy);
    if (Boolean(item.favicon_source || item.favicon_checked_at || item.favicon_retry_at || item.favicon_etag || item.favicon_last_modified || item.favicon_failed_attempts)) pathsToClean.push(item.path);
  }
  return { index: next, pathsToClean: [...new Set(pathsToClean)] };
}
