import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { requestUrl } from 'obsidian';
import type { BookmarkDraft } from './model.ts';
import { isPublicWebUrl, safeFaviconBytes, sameOrigin } from './security.ts';

const TIMEOUT_MS = 8000;
const PAGE_LIMIT = 1_000_000;
const FAVICON_RESPONSE_LIMIT = 160_000;
const HOST_REQUEST_INTERVAL_MS = 300;
const hostRequestSlots = new Map<string, number>();

async function waitForHost(rawUrl: string, signal?: AbortSignal): Promise<void> {
  const host = new URL(rawUrl).hostname.toLowerCase();
  const now = Date.now(); const slot = Math.max(now, hostRequestSlots.get(host) ?? now);
  hostRequestSlots.set(host, slot + HOST_REQUEST_INTERVAL_MS);
  while (!signal?.aborted && Date.now() < slot) await new Promise((resolve) => window.setTimeout(resolve, Math.min(100, slot - Date.now())));
  if (signal?.aborted) throw new Error('Network request cancelled.');
}

function withTimeout<T>(request: Promise<T>, message: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    request.then((value) => { window.clearTimeout(timer); resolve(value); }, (error: unknown) => { window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); });
  });
}

export async function requestAfterPacing<T>(pacing: Promise<unknown>, request: () => Promise<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
  await pacing;
  return withTimeout(request(), 'Network request timed out.', timeoutMs);
}

function header(headers: Record<string, string>, name: string): string {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}

export interface PageMetadata { title: string; description: string; favicon: string; faviconCandidates: string[]; }

export async function fetchPageMetadata(rawUrl: string, signal?: AbortSignal): Promise<PageMetadata> {
  if (!isPublicWebUrl(rawUrl)) throw new Error('For privacy and safety, metadata is only retrieved from public web addresses.');
  const url = new URL(rawUrl);
  const response = await requestAfterPacing(waitForHost(url.href, signal), () => requestUrl({ url: url.href, method: 'GET', headers: { 'User-Agent': 'OpenMarks (Obsidian plugin)', Accept: 'text/html,application/xhtml+xml' }, throw: false }));
  const type = header(response.headers, 'content-type');
  const length = Number(header(response.headers, 'content-length'));
  if (length > PAGE_LIMIT) throw new Error('Page response exceeds the 1 MB metadata limit.');
  if (response.status < 200 || response.status >= 300) throw new Error(`Page returned HTTP ${response.status}.`);
  if (!type.toLowerCase().includes('text/html') && !type.toLowerCase().includes('application/xhtml')) throw new Error('The address did not return an HTML page.');
  const html = (await response.text).slice(0, PAGE_LIMIT);
  // Parse into plain data so remote markup cannot create elements or fetch resources.
  const nodes: DefaultTreeAdapterMap['childNode'][] = [...parse(html).childNodes].reverse();
  let title = '';
  const descriptions = new Map<string, string>();
  const links: { rel: string; href: string }[] = [];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node || !('tagName' in node)) continue;
    if (node.tagName === 'title' && !title) {
      title = node.childNodes.map(child => 'value' in child ? child.value : '').join('').trim();
    } else if (node.tagName === 'meta' || node.tagName === 'link') {
      const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
      if (node.tagName === 'link') links.push({ rel: attrs.get('rel') ?? '', href: attrs.get('href') ?? '' });
      else {
        for (const attr of ['name', 'property']) {
          const key = attrs.get(attr)?.toLowerCase();
          if ((key === 'description' || key === 'og:description') && !descriptions.has(key))
            descriptions.set(key, attrs.get('content')?.trim() ?? '');
        }
      }
    }
    for (let index = node.childNodes.length - 1; index >= 0; index--) nodes.push(node.childNodes[index]);
  }
  const description = descriptions.get('description') || descriptions.get('og:description') || '';
  const iconHrefs = links.filter(({ rel, href }) => href && /(?:^|\s)(?:icon|shortcut|apple-touch-icon|mask-icon)(?:\s|$)/i.test(rel)).map(({ href }) => href);
  const faviconCandidates: string[] = [];
  for (const href of [...iconHrefs, '/favicon.ico']) {
    try {
      const candidate = new URL(href, url).href;
      if (sameOrigin(candidate, url.href) && isPublicWebUrl(candidate) && !faviconCandidates.includes(candidate)) faviconCandidates.push(candidate);
    } catch { /* Keep trying safe same-site candidates. */ }
  }
  return { title: title.slice(0, 240), description: description.slice(0, 2000), favicon: faviconCandidates[0] ?? '', faviconCandidates };
}

export interface FaviconValidators { etag?: string; lastModified?: string; cachedPath?: string; }
export interface FaviconDownload { path: string; etag: string; lastModified: string; notModified: boolean; }

export async function faviconCacheName(pageUrl: string): Promise<string> {
  const origin = new TextEncoder().encode(new URL(pageUrl).origin);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', origin));
  return 'site-' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function downloadFavicon(faviconUrl: string, pageUrl: string, id: string, write: (path: string, data: ArrayBuffer) => Promise<void>, validators: FaviconValidators = {}, signal?: AbortSignal): Promise<FaviconDownload> {
  if (!/^[a-z0-9-]{1,128}$/i.test(id) || !sameOrigin(faviconUrl, pageUrl) || !isPublicWebUrl(faviconUrl)) return { path: '', etag: '', lastModified: '', notModified: false };
  const headers: Record<string, string> = { Accept: 'image/*' };
  if (validators.etag) headers['If-None-Match'] = validators.etag;
  if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;
  const response = await requestAfterPacing(waitForHost(faviconUrl, signal), () => requestUrl({ url: faviconUrl, method: 'GET', headers: { 'User-Agent': 'OpenMarks (Obsidian plugin)', ...headers }, throw: false }));
  const etag = header(response.headers, 'etag') || validators.etag || '';
  const lastModified = header(response.headers, 'last-modified') || validators.lastModified || '';
  if (response.status === 304 && validators.cachedPath) return { path: validators.cachedPath, etag, lastModified, notModified: true };
  const length = Number(header(response.headers, 'content-length'));
  if (length > FAVICON_RESPONSE_LIMIT) return { path: '', etag, lastModified, notModified: false };
  if (response.status < 200 || response.status >= 300) return { path: '', etag, lastModified, notModified: false };
  const safe = safeFaviconBytes(await response.arrayBuffer, header(response.headers, 'content-type'));
  if (!safe || safe.bytes.byteLength > FAVICON_RESPONSE_LIMIT) return { path: '', etag, lastModified, notModified: false };
  const path = `_openmarks/favicons/${id}.${safe.extension}`;
  await write(path, safe.bytes);
  return { path, etag, lastModified, notModified: false };
}

export async function enrichDraft(draft: BookmarkDraft): Promise<BookmarkDraft> {
  const meta = await fetchPageMetadata(draft.url);
  return { ...draft, title: draft.title || meta.title, description: draft.description || meta.description };
}
