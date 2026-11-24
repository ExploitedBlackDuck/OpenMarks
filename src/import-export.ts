import { makeBookmark } from './model.ts';
import type { Bookmark, BookmarkDraft } from './model.ts';

export interface ImportRow { draft: BookmarkDraft; sourceLine: number; }
export interface ImportPreview { rows: ImportRow[]; invalid: { sourceLine: number; reason: string }[]; duplicates: { sourceLine: number; url: string; existing?: Bookmark }[]; }
export interface ExportVaultWriter {
  createFolder(path: string): Promise<void>;
  create(path: string, data: string): Promise<unknown>;
  adapter?: { exists(path: string): Promise<boolean> };
}

export async function saveExportToVault(vault: ExportVaultWriter, format: 'html' | 'json' | 'csv', text: string, timestamp = Date.now()): Promise<string> {
  try { await vault.createFolder('_openmarks'); } catch { /* Existing vault data folder. */ }
  try { await vault.createFolder('_openmarks/exports'); } catch { /* Existing export folder. */ }
  const date = new Date(timestamp);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const base = `_openmarks/exports/openmarks-export-${day}`;
  for (let suffix = 1; suffix <= 1000; suffix++) {
    const path = `${base}${suffix === 1 ? '' : `-${suffix}`}.${format}`;
    if (vault.adapter && await vault.adapter.exists(path)) continue;
    try { await vault.create(path, text); return path; }
    catch (error) {
      if (vault.adapter && await vault.adapter.exists(path)) continue;
      throw error;
    }
  }
  throw new Error('Could not allocate a unique export filename.');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch; }
    else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((x) => x.trim()).filter(Boolean);
  return typeof value === 'string' ? value.split(/[|;]/).map((x) => x.trim()).filter(Boolean) : [];
}

function importedDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function rowDraft(value: Record<string, unknown>): BookmarkDraft {
  const url = String(value.url ?? value.URL ?? value.href ?? value.link ?? '').trim();
  return {
    url, title: String(value.title ?? value.name ?? '').trim(),
    description: String(value.description ?? value.desc ?? ''), collection: String(value.collection ?? value.folder ?? value.group ?? 'Unsorted'),
    tags: splitTags(value.tags ?? value.tag), notes: String(value.notes ?? ''), favorite: value.favorite === true || value.favorite === 'true',
    status: value.status === 'archived' || value.status === 'read' ? value.status : 'unread',
    created: importedDate(String(value.created ?? value.createdAt ?? value.date ?? '')),
  };
}

export function parseCsvBookmarks(text: string): ImportRow[] {
  const matrix = parseCsv(text); if (!matrix.length) return [];
  const headers = matrix[0].map((x) => x.trim().toLowerCase());
  const urlIndex = headers.findIndex((h) => ['url', 'href', 'link'].includes(h));
  if (urlIndex < 0) throw new Error('CSV needs a URL, href, or link column.');
  return matrix.slice(1).map((cells, i) => ({ draft: rowDraft(Object.fromEntries(headers.map((h, n) => [h, cells[n] ?? '']))), sourceLine: i + 2 })).filter((row) => Boolean(row.draft.url));
}

export function parseBookmarkHtml(text: string): ImportRow[] {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const rows: ImportRow[] = [];
  const isOpenMarksExport = /openmarks\s+bookmarks/i.test(doc.title ?? '')
    || doc.querySelector('meta[name="generator"]')?.getAttribute('content')?.toLowerCase().includes('openmarks') === true;
  let sourceLine = 0;
  const walk = (list: Element, folders: string[]): void => {
    const children = [...list.children];
    for (let index = 0; index < children.length; index++) {
      const node = children[index];
      if (node.tagName !== 'DT') continue;
      const heading = [...node.children].find((child) => child.tagName === 'H3');
      if (heading) {
        const nested = [...node.children].find((child) => child.tagName === 'DL')
          ?? children.slice(index + 1).find((child) => child.tagName === 'DL');
        if (nested) walk(nested, [...folders, (heading.textContent ?? '').trim()].filter(Boolean));
        continue;
      }
      const anchor = [...node.children].find((child) => child.tagName === 'A' && child.hasAttribute('href')) as HTMLAnchorElement | undefined;
      if (!anchor) continue;
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) continue;
      const explicitCollection = anchor.getAttribute('collection')?.trim();
      let tags = splitTags((anchor.getAttribute('tags') ?? '').replace(/,/g, '|'));
      let collection = explicitCollection || folders.join('/') || 'Unsorted';
      if (isOpenMarksExport && !explicitCollection && !folders.length) {
        const legacyCollectionIndex = tags.findIndex((tag) => tag.includes('/'));
        if (legacyCollectionIndex >= 0) collection = tags.splice(legacyCollectionIndex, 1)[0];
      }
      const description = node.nextElementSibling?.tagName === 'DD' ? node.nextElementSibling.textContent ?? '' : '';
      const addDate = Number(anchor.getAttribute('add_date'));
      const timestamp = addDate * 1000;
      const created = Number.isFinite(timestamp) && timestamp > 0 && Math.abs(timestamp) <= 8.64e15 ? localCalendarDate(timestamp) : undefined;
      rows.push({ draft: { url: href, title: anchor.textContent?.trim() ?? '', description: description.trim(), collection, tags, created }, sourceLine: ++sourceLine });
    }
  };
  const root = doc.querySelector('dl');
  if (root) walk(root, []);
  return rows;
}

function localCalendarDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseBookmarkJson(text: string): ImportRow[] {
  const parsed: unknown = JSON.parse(text);
  const values = Array.isArray(parsed) ? parsed : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).bookmarks) ? (parsed as { bookmarks: unknown[] }).bookmarks : null;
  if (!values) throw new Error('JSON must be an array of bookmarks or an object with a bookmarks array.');
  return values.map((entry, index) => {
    if (!entry || typeof entry !== 'object') return { draft: { url: '' }, sourceLine: index + 1 };
    const row = rowDraft(entry as Record<string, unknown>);
    // Anybox exports vary by version. This accepts common URL/title/tags/folder fields without assuming private fields.
    return { draft: row, sourceLine: index + 1 };
  });
}

export function parsePlainTextUrls(text: string): ImportRow[] {
  return text.split(/\r?\n/).map((line, index) => ({ url: line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ''), sourceLine: index + 1 })).filter((row) => /^https?:\/\//i.test(row.url)).map((row) => ({ draft: { url: row.url }, sourceLine: row.sourceLine }));
}

export function parseMarkdownBookmarks(text: string, sourceLine = 1): ImportRow[] {
  if (!text.startsWith('---')) throw new Error('Markdown bookmark must begin with YAML frontmatter.');
  const end = text.indexOf('\n---', 3);
  if (end < 0) throw new Error('Markdown bookmark frontmatter is incomplete.');
  const yaml = text.slice(4, end);
  const scalar = (key: string): string => {
    const match = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
    if (!match) return '';
    const raw = match[1].trim();
    try { const parsed: unknown = JSON.parse(raw); return typeof parsed === 'string' ? parsed : raw; } catch { return raw.replace(/^['"]|['"]$/g, ''); }
  };
  const url = scalar('url');
  if (!url) throw new Error('Markdown bookmark frontmatter needs a url field.');
  const tagsBlock = yaml.match(/^tags:\s*\n((?:\s+-.*\n?)*)/mi)?.[1] ?? '';
  const tags = [...tagsBlock.matchAll(/^\s+-\s*(.+)$/gm)].map((match) => match[1].trim().replace(/^['"]|['"]$/g, ''));
  const body = text.slice(end + 4).trim();
  return [{ draft: { url, title: scalar('title'), description: scalar('description'), collection: scalar('collection'), tags, favorite: scalar('favorite') === 'true', notes: body }, sourceLine }];
}

export function previewImport(rows: ImportRow[], existing: Bookmark[]): ImportPreview {
  const byUrl = new Map<string, Bookmark>();
  for (const item of [...existing].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  const staged = new Set<string>(); const valid: ImportRow[] = []; const invalid: ImportPreview['invalid'] = []; const duplicates: ImportPreview['duplicates'] = [];
  for (const row of rows) {
    try {
      const normalized = makeBookmark(row.draft);
      const prior = byUrl.get(normalized.url);
      if (prior || staged.has(normalized.url)) duplicates.push({ sourceLine: row.sourceLine, url: normalized.url, existing: prior });
      else { staged.add(normalized.url); valid.push({ ...row, draft: { ...row.draft, url: normalized.url } }); }
    } catch (error) { invalid.push({ sourceLine: row.sourceLine, reason: error instanceof Error ? error.message : 'Invalid bookmark.' }); }
  }
  return { rows: valid, invalid, duplicates };
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch)); }
function escapeCsv(value: string): string {
  // Prefix formula-like cells so opening an export in a spreadsheet does not execute bookmark text.
  const safe = /^[\t\r\n ]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportCsv(bookmarks: Bookmark[]): string {
  return ['title,url,description,collection,tags,favorite,status,created,notes', ...bookmarks.map((b) => [b.title, b.url, b.description, b.collection, b.tags.join('|'), String(b.favorite), b.status, b.created, b.notes].map(escapeCsv).join(','))].join('\r\n');
}

// Preview paths are vault-local and preview retrieval is disabled; keep exports portable without them.
export function exportJson(bookmarks: Bookmark[]): string { return JSON.stringify(bookmarks.map(({ path, preview_image, preview_source, ...item }) => item), null, 2); }

export function exportBookmarkHtml(bookmarks: Bookmark[]): string {
  type Folder = { folders: Map<string, Folder>; bookmarks: Bookmark[] };
  const root: Folder = { folders: new Map(), bookmarks: [] };
  for (const bookmark of bookmarks) {
    const path = bookmark.collection.trim() || 'Unsorted';
    let folder = root;
    for (const segment of path.split('/').filter(Boolean)) {
      if (!folder.folders.has(segment)) folder.folders.set(segment, { folders: new Map(), bookmarks: [] });
      folder = folder.folders.get(segment)!;
    }
    folder.bookmarks.push(bookmark);
  }
  const render = (folder: Folder): string => {
    const nested = [...folder.folders].map(([name, child]) => `<DT><H3>${escapeHtml(name)}</H3>\n<DL><p>\n${render(child)}\n</DL><p>`);
    const items = folder.bookmarks.map((bookmark) => `<DT><A HREF="${escapeHtml(bookmark.url)}" TAGS="${escapeHtml(bookmark.tags.join(','))}" ADD_DATE="${Math.floor(new Date(bookmark.created + 'T12:00:00').getTime() / 1000) || 0}">${escapeHtml(bookmark.title)}</A>\n<DD>${escapeHtml(bookmark.description)}</DD>`);
    return [...nested, ...items].join('\n');
  };
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<META NAME="generator" CONTENT="OpenMarks">\n<TITLE>OpenMarks bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${render(root)}\n</DL><p>\n`;
}
