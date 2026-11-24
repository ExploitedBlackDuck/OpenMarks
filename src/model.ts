export type BookmarkStatus = 'unread' | 'read' | 'archived';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  domain: string;
  description: string;
  collection: string;
  tags: string[];
  favorite: boolean;
  status: BookmarkStatus;
  created: string;
  last_opened: string;
  favicon: string;
  favicon_source: string;
  favicon_checked_at: string;
  favicon_retry_at: string;
  favicon_etag: string;
  favicon_last_modified: string;
  favicon_failed_attempts: number;
  preview_image: string;
  preview_source: string;
  notes: string;
  path: string;
}

export interface BookmarkDraft extends Partial<Bookmark> {
  url: string;
  title?: string;
}

export interface SearchFilters {
  openedOnly?: boolean;
  query?: string;
  collection?: string;
  tag?: string;
  favorite?: boolean;
  status?: BookmarkStatus | 'all';
  createdAfter?: string;
  sort?: 'created' | 'title' | 'domain' | 'opened';
  descending?: boolean;
}

export const DEFAULT_COLLECTION = 'Unsorted';
export const BOOKMARK_ROOT = '_openmarks/bookmarks';
export const FAVICON_ROOT = '_openmarks/favicons';

export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Enter a URL.');
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error('That URL is not valid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs can be saved.');
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error('URLs must have a host and cannot contain embedded credentials.');
  if (parsed.pathname === '/') parsed.pathname = '/';
  return parsed.toString();
}

/** Retained only for deterministic IDs on older notes that lack an id property. */
export function stableId(url: string): string {
  let hash = 2166136261;
  for (const char of url.toLowerCase()) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function newBookmarkId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('Secure random IDs are unavailable in this environment.');
}

export function safeFilename(title: string, id: string): string {
  const stem = title.normalize('NFKC').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/^\.+/, '').replace(/[.\s]+$/g, '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const safeId = id.normalize('NFKC').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/^\.+/, '').replace(/[.\s]+$/g, '').trim().slice(0, 100);
  const filenameId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safeId) ? safeId.slice(0, 8) : safeId.slice(0, 24);
  return `${stem || 'Bookmark'} ${filenameId || 'bookmark'}.md`;
}

export function localIconPath(value: unknown): string {
  if (typeof value !== 'string' || /[:\\?#%\x00-\x1f]/.test(value) || !/\.(?:png|ico|jpe?g|gif|webp)$/i.test(value)) return '';
  return value.split('/').every(part => part && part !== '.' && part !== '..') ? value : '';
}

export function makeBookmark(draft: BookmarkDraft, existing: Partial<Bookmark> = {}): Bookmark {
  const url = normalizeUrl(draft.url);
  const parsed = new URL(url);
  const title = (draft.title ?? existing.title ?? parsed.hostname).trim().slice(0, 240) || parsed.hostname;
  return {
    id: draft.id ?? existing.id ?? newBookmarkId(), title, url, domain: parsed.hostname,
    description: (draft.description ?? existing.description ?? '').slice(0, 2000),
    collection: (draft.collection ?? existing.collection ?? DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION,
    tags: [...new Set((draft.tags ?? existing.tags ?? []).map((tag) => tag.trim()).filter(Boolean))],
    favorite: draft.favorite ?? existing.favorite ?? false,
    status: draft.status ?? existing.status ?? 'unread',
    created: draft.created ?? existing.created ?? new Date().toISOString().slice(0, 10),
    last_opened: draft.last_opened ?? existing.last_opened ?? '',
    favicon: localIconPath(draft.favicon ?? existing.favicon), favicon_source: draft.favicon_source ?? existing.favicon_source ?? '',
    favicon_checked_at: draft.favicon_checked_at ?? existing.favicon_checked_at ?? '', favicon_retry_at: draft.favicon_retry_at ?? existing.favicon_retry_at ?? '',
    favicon_etag: draft.favicon_etag ?? existing.favicon_etag ?? '', favicon_last_modified: draft.favicon_last_modified ?? existing.favicon_last_modified ?? '',
    favicon_failed_attempts: draft.favicon_failed_attempts ?? existing.favicon_failed_attempts ?? 0,
    preview_image: draft.preview_image ?? existing.preview_image ?? '', preview_source: draft.preview_source ?? existing.preview_source ?? '',
    notes: draft.notes ?? existing.notes ?? '', path: draft.path ?? existing.path ?? '',
  };
}

export function searchBookmarks(bookmarks: Bookmark[], filters: SearchFilters): Bookmark[] {
  const query = (filters.query ?? '').trim().toLocaleLowerCase();
  const results = bookmarks.filter((item) => {
    if (filters.collection && item.collection !== filters.collection && !item.collection.startsWith(`${filters.collection}/`)) return false;
    if (filters.tag && !item.tags.some((tag) => tag.toLocaleLowerCase() === filters.tag!.toLocaleLowerCase())) return false;
    if (filters.openedOnly && !item.last_opened) return false;
    if (filters.favorite === true && !item.favorite) return false;
    if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.createdAfter && item.created < filters.createdAfter) return false;
    if (!query) return true;
    const haystack = [item.title, item.url, item.domain, item.description, item.collection, item.notes, ...item.tags].join('\n').toLocaleLowerCase();
    return query.split(/\s+/).every((term) => haystack.includes(term));
  });
  const key = filters.sort ?? 'created';
  const direction = filters.descending === false ? 1 : -1;
  return results.sort((a, b) => direction * (key === 'title' ? a.title.localeCompare(b.title) : key === 'domain' ? a.domain.localeCompare(b.domain) : key === 'opened' ? a.last_opened.localeCompare(b.last_opened) : a.created.localeCompare(b.created)));
}
