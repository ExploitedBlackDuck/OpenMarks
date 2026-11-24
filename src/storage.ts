import { App, TFile, normalizePath, parseYaml, stringifyYaml } from 'obsidian';
import { BOOKMARK_ROOT, DEFAULT_COLLECTION, makeBookmark, normalizeUrl, safeFilename, stableId } from './model.ts';
import type { Bookmark, BookmarkDraft } from './model.ts';

const FIELDS = ['type', 'id', 'title', 'url', 'domain', 'description', 'collection', 'tags', 'favorite', 'status', 'created', 'last_opened', 'favicon', 'favicon_source', 'favicon_checked_at', 'favicon_retry_at', 'favicon_etag', 'favicon_last_modified', 'favicon_failed_attempts', 'preview_image', 'preview_source'] as const;
type MetadataField = typeof FIELDS[number];
const OPERATIONAL_FAVICON_FIELDS = new Set<MetadataField>(['favicon_source', 'favicon_checked_at', 'favicon_retry_at', 'favicon_etag', 'favicon_last_modified', 'favicon_failed_attempts']);

export interface BookmarkLoadIssue {
  path: string;
  reason: string;
  kind: 'invalid-note' | 'duplicate-url' | 'duplicate-id';
  url?: string;
}

export class BookmarkNoteError extends Error {
  constructor(message: string) { super(message); this.name = 'BookmarkNoteError'; }
}

function frontmatterBounds(content: string): { start: number; end: number } {
  if (!/^---\r?\n/.test(content)) throw new BookmarkNoteError('Missing YAML frontmatter opening delimiter.');
  const start = content.startsWith('---\r\n') ? 5 : 4;
  const delimiter = /\r?\n---(?=\r?\n|$)/g;
  delimiter.lastIndex = start;
  const match = delimiter.exec(content);
  if (!match) throw new BookmarkNoteError('Missing YAML frontmatter closing delimiter.');
  return { start, end: match.index };
}

function frontmatterFrom(content: string): Record<string, unknown> {
  const { start, end } = frontmatterBounds(content);
  let value: unknown;
  try { value = parseYaml(content.slice(start, end)); }
  catch (error) { throw new BookmarkNoteError(`Invalid YAML frontmatter: ${error instanceof Error ? error.message : 'could not parse YAML.'}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BookmarkNoteError('YAML frontmatter must contain a mapping of bookmark properties.');
  return value as Record<string, unknown>;
}

function legacyId(url: string, path: string): string {
  return `legacy-${stableId(`${url}\n${path}`)}`;
}

function requireOptionalString(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime()) && ['created', 'last_opened', 'favicon_checked_at', 'favicon_retry_at'].includes(key)) {
    return key === 'created' ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (typeof value !== 'string') throw new BookmarkNoteError(`The “${key}” property must be text.`);
  return value;
}

function asBookmark(meta: Record<string, unknown>, path: string, body = ''): Bookmark | null {
  if (meta.type !== 'bookmark') throw new BookmarkNoteError('This note is inside the OpenMarks bookmark folder but is missing type: bookmark.');
  if (typeof meta.url !== 'string' || !meta.url.trim()) throw new BookmarkNoteError('The “url” property is missing or is not text.');
  const id = requireOptionalString(meta, 'id') ?? legacyId(meta.url, path);
  const title = requireOptionalString(meta, 'title');
  const description = requireOptionalString(meta, 'description');
  const collection = requireOptionalString(meta, 'collection');
  const created = requireOptionalString(meta, 'created');
  const lastOpened = requireOptionalString(meta, 'last_opened');
  const favicon = requireOptionalString(meta, 'favicon');
  const faviconSource = requireOptionalString(meta, 'favicon_source');
  const faviconCheckedAt = requireOptionalString(meta, 'favicon_checked_at');
  const faviconRetryAt = requireOptionalString(meta, 'favicon_retry_at');
  const faviconEtag = requireOptionalString(meta, 'favicon_etag');
  const faviconLastModified = requireOptionalString(meta, 'favicon_last_modified');
  if (meta.favicon_failed_attempts != null && (!Number.isInteger(meta.favicon_failed_attempts) || Number(meta.favicon_failed_attempts) < 0)) throw new BookmarkNoteError('The “favicon_failed_attempts” property must be a non-negative integer.');
  const previewImage = requireOptionalString(meta, 'preview_image');
  const previewSource = requireOptionalString(meta, 'preview_source');
  if (meta.favorite != null && typeof meta.favorite !== 'boolean') throw new BookmarkNoteError('The “favorite” property must be true or false.');
  if (meta.tags != null && typeof meta.tags !== 'string' && !Array.isArray(meta.tags)) throw new BookmarkNoteError('The “tags” property must be a list of text values.');
  if (Array.isArray(meta.tags) && meta.tags.some((tag) => typeof tag !== 'string')) throw new BookmarkNoteError('Every tag must be text.');
  if (meta.status != null && !['unread', 'read', 'archived'].includes(String(meta.status))) throw new BookmarkNoteError('The “status” property must be unread, read, or archived.');
  try {
    const mark = makeBookmark({
      id, url: meta.url, title, description, collection: collection ?? DEFAULT_COLLECTION,
      tags: Array.isArray(meta.tags) ? meta.tags as string[] : typeof meta.tags === 'string' ? [meta.tags] : [],
      favorite: meta.favorite === true,
      status: (meta.status as Bookmark['status'] | undefined) ?? 'unread',
      created, last_opened: lastOpened ?? '', favicon: favicon ?? '', favicon_source: faviconSource ?? '',
      favicon_checked_at: faviconCheckedAt ?? '', favicon_retry_at: faviconRetryAt ?? '', favicon_etag: faviconEtag ?? '',
      favicon_last_modified: faviconLastModified ?? '', favicon_failed_attempts: Number(meta.favicon_failed_attempts ?? 0),
      path, preview_image: previewImage ?? '', preview_source: previewSource ?? '',
    });
    mark.notes = body;
    return mark;
  } catch (error) {
    throw new BookmarkNoteError(error instanceof Error ? error.message : 'Bookmark properties are invalid.');
  }
}

function frontmatterBody(content: string): string {
  const { start } = frontmatterBounds(content);
  const close = /\r?\n---(?=\r?\n|$)/g;
  close.lastIndex = start;
  const match = close.exec(content);
  return match ? content.slice(match.index + match[0].length).replace(/^\r?\n/, '').trimStart() : '';
}

function isBookmarkPath(path: string): boolean { return path.startsWith(`${BOOKMARK_ROOT}/`) && path.toLowerCase().endsWith('.md'); }

function compareDuplicateOwner(a: Bookmark, b: Bookmark): number {
  return a.created.localeCompare(b.created) || a.id.localeCompare(b.id);
}

function orderedUrlRecords(ids: Set<string>, records: Map<string, Bookmark>): Bookmark[] {
  return [...ids].map((id) => records.get(id)).filter((item): item is Bookmark => Boolean(item)).sort(compareDuplicateOwner);
}

function formatFrontmatter(item: Bookmark): string {
  const fm: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (OPERATIONAL_FAVICON_FIELDS.has(field)) continue;
    const key = field as keyof Bookmark;
    const value = field === 'type' ? 'bookmark' : item[key];
    if (value === '' && ['last_opened', 'favicon', 'favicon_source', 'favicon_checked_at', 'favicon_retry_at', 'favicon_etag', 'favicon_last_modified', 'preview_image', 'preview_source'].includes(field)) continue;
    fm[field] = value;
  }
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n${item.notes ? `${item.notes}\n` : ''}`;
}

export class BookmarkStore {
  private records = new Map<string, Bookmark>();
  private byUrl = new Map<string, Set<string>>();
  private byPath = new Map<string, string>();
  private issuesByPath = new Map<string, BookmarkLoadIssue>();
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(private app: App, public defaultCollection = DEFAULT_COLLECTION) {}

  all(): Bookmark[] { return [...this.records.values()]; }
  get(id: string): Bookmark | undefined { return this.records.get(id); }
  getByPath(path: string): Bookmark | undefined { const id = this.byPath.get(path); return id ? this.records.get(id) : undefined; }
  get issues(): BookmarkLoadIssue[] { return [...this.issuesByPath.values()]; }

  findByUrl(url: string): Bookmark | undefined {
    let normalized: string;
    try { normalized = normalizeUrl(url); } catch { return undefined; }
    const ids = this.byUrl.get(normalized);
    return ids ? orderedUrlRecords(ids, this.records)[0] : undefined;
  }

  findAllByUrl(url: string): Bookmark[] {
    let normalized: string;
    try { normalized = normalizeUrl(url); } catch { return []; }
    return [...(this.byUrl.get(normalized) ?? [])].map((id) => this.records.get(id)).filter((item): item is Bookmark => Boolean(item));
  }

  async load(): Promise<void> {
    await this.serial(async () => {
      this.records.clear(); this.byUrl.clear(); this.byPath.clear(); this.issuesByPath.clear();
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!isBookmarkPath(file.path)) continue;
        await this.loadFile(file);
      }
      this.reportDuplicateUrls();
    });
  }

  async stripLegacyFaviconMetadata(paths: readonly string[]): Promise<string[]> {
    return this.serial(async () => {
      const failed: string[] = [];
      for (const path of [...new Set(paths)]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            if (fm.type !== 'bookmark') return;
            for (const field of OPERATIONAL_FAVICON_FIELDS) delete fm[field];
          });
          await this.loadFile(file);
        } catch { failed.push(path); }
      }
      return failed;
    });
  }

  async readFile(file: TFile): Promise<Bookmark | null> {
    const snapshot = await this.readSnapshot(file);
    return snapshot.item;
  }

  private async readSnapshot(file: TFile): Promise<{ item: Bookmark; frontmatter: Record<string, unknown> }> {
    const content = await this.app.vault.cachedRead(file);
    const meta = frontmatterFrom(content);
    const item = asBookmark(meta, file.path, frontmatterBody(content));
    if (!item) throw new BookmarkNoteError('Could not read bookmark metadata.');
    return { item, frontmatter: meta };
  }

  async create(draft: BookmarkDraft): Promise<Bookmark> {
    return this.serial(async () => {
      const normalized = makeBookmark({ ...draft, collection: draft.collection?.trim() || this.defaultCollection });
      const duplicate = this.findByUrl(normalized.url);
      if (duplicate) throw new Error(`This URL is already saved as “${duplicate.title}”.`);
      let id = normalized.id; let suffix = 1;
      while (this.records.has(id)) id = `${normalized.id}-${suffix++}`;
      normalized.id = id;
      await this.ensureFolder(BOOKMARK_ROOT);
      const path = await this.allocatePath(normalized.title, id);
      normalized.path = path;
      const content = formatFrontmatter(normalized);
      const file = await this.app.vault.create(path, content);
      const saved = await this.readFile(file).catch((): null => null);
      if (!saved) {
        const recovered = await this.loadFile(file);
        if (recovered) return recovered;
        throw new Error(`The bookmark note was created at ${path}, but could not be indexed. It was preserved and added to the recovery list.`);
      }
      this.addRecord(saved);
      return saved;
    });
  }

  async update(id: string, patch: Partial<BookmarkDraft>, expectedNotes?: string, original?: Bookmark): Promise<Bookmark> {
    return this.serial(() => this.updateUnlocked(id, patch, expectedNotes, original));
  }

  async delete(id: string): Promise<void> {
    await this.serial(async () => {
      const item = this.records.get(id);
      if (!item) return;
      const file = this.app.vault.getAbstractFileByPath(item.path);
      if (!(file instanceof TFile)) throw new Error('Bookmark note is missing or was moved outside the OpenMarks folder.');
      await this.app.fileManager.trashFile(file);
      this.removeRecord(id);
      this.issuesByPath.delete(item.path);
    });
  }

  async merge(keepId: string, removeId: string): Promise<Bookmark> {
    return this.serial(async () => {
      const keep = this.records.get(keepId); const remove = this.records.get(removeId);
      if (!keep || !remove) throw new Error('Both bookmarks must exist.');
      const merged = await this.updateUnlocked(keepId, {
        tags: [...new Set([...keep.tags, ...remove.tags])],
        notes: [keep.notes, remove.notes].filter(Boolean).join('\n\n'),
        favorite: keep.favorite || remove.favorite,
      }, keep.notes);
      await this.deleteUnlocked(removeId);
      return merged;
    });
  }

  async refreshFromFile(file: TFile): Promise<Bookmark | null> {
    return this.serial(async () => {
      if (!isBookmarkPath(file.path)) return null;
      return this.loadFile(file);
    });
  }

  async handleRename(file: TFile, oldPath: string): Promise<Bookmark | null> {
    return this.serial(async () => {
      if (oldPath.startsWith(`${BOOKMARK_ROOT}/`)) this.removeByPath(oldPath);
      if (!isBookmarkPath(file.path)) return null;
      const loaded = await this.loadFile(file);
      return loaded;
    });
  }

  async handleDelete(path: string): Promise<void> {
    await this.serial(async () => { this.removeByPath(path); this.issuesByPath.delete(path); });
  }

  async moveCollection(id: string, collection: string): Promise<Bookmark> { return this.update(id, { collection }); }

  private async updateUnlocked(id: string, patch: Partial<BookmarkDraft>, expectedNotes?: string, original?: Bookmark): Promise<Bookmark> {
    const current = this.records.get(id);
    if (!current) throw new Error('Bookmark no longer exists.');
    const file = this.app.vault.getAbstractFileByPath(current.path);
    if (!(file instanceof TFile)) throw new Error('Bookmark note is missing or was moved outside the OpenMarks folder.');
    const snapshot = await this.readSnapshot(file);
    const latest = snapshot.item;
    if (!latest || latest.id !== id) throw new Error('Bookmark changed while OpenMarks was preparing the update. Reload the library and try again.');
    for (const field of Object.keys(patch) as (keyof Bookmark)[]) {
      if (field !== 'notes' && JSON.stringify(latest[field]) !== JSON.stringify((original ?? current)[field])) {
        throw new BookmarkNoteError(`The “${field}” property changed outside OpenMarks. Reopen the editor before saving.`);
      }
    }
    const notesAtEditStart = expectedNotes ?? current.notes;
    if (Object.prototype.hasOwnProperty.call(patch, 'notes') && latest.notes !== notesAtEditStart) {
      throw new BookmarkNoteError('The note body changed outside OpenMarks while this edit was open. Your notes were preserved. Reopen the editor and retry.');
    }
    const next = makeBookmark({ ...latest, ...patch, id: latest.id, url: patch.url ?? latest.url }, latest);
    if (patch.url !== undefined && next.url !== latest.url) {
      next.favicon = ''; next.favicon_source = ''; next.favicon_checked_at = ''; next.favicon_retry_at = '';
      next.favicon_etag = ''; next.favicon_last_modified = ''; next.favicon_failed_attempts = 0;
    }
    const duplicate = this.findByUrl(next.url);
    if (duplicate && duplicate.id !== id) throw new Error(`This URL is already saved as “${duplicate.title}”.`);
    const fields = new Set<MetadataField>(Object.keys(patch).filter((key): key is MetadataField => FIELDS.includes(key as MetadataField) && key !== 'type' && key !== 'id'));
    if (patch.url !== undefined) for (const field of ['domain', 'favicon', 'favicon_source', 'favicon_checked_at', 'favicon_retry_at', 'favicon_etag', 'favicon_last_modified', 'favicon_failed_attempts'] as const) fields.add(field);
    fields.delete('notes' as MetadataField);
    try {
      await this.writePatchedProperties(file, next, fields, snapshot.frontmatter);
      if (Object.prototype.hasOwnProperty.call(patch, 'notes')) await this.replaceBody(file, next.notes, latest.notes);
    } catch (error) {
      await this.loadFile(file);
      throw error;
    }
    const saved = await this.readFile(file);
    if (!saved) throw new Error('Updated bookmark could not be read back. The note remains in the vault.');
    this.replaceRecord(id, saved);
    return saved;
  }

  private async deleteUnlocked(id: string): Promise<void> {
    const item = this.records.get(id); if (!item) return;
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) throw new Error('Bookmark note is missing or was moved outside the OpenMarks folder.');
    await this.app.fileManager.trashFile(file);
    this.removeRecord(id); this.issuesByPath.delete(item.path);
  }

  private async replaceBody(file: TFile, notes: string, expectedNotes: string): Promise<void> {
    await this.app.vault.process(file, (content) => {
      const bounds = frontmatterBounds(content);
      const close = /\r?\n---(?=\r?\n|$)/g; close.lastIndex = bounds.start;
      const match = close.exec(content);
      if (!match) throw new BookmarkNoteError('Bookmark frontmatter changed during the note update.');
      const currentBody = content.slice(match.index + match[0].length).replace(/^\r?\n/, '').trimStart();
      if (currentBody !== expectedNotes) throw new BookmarkNoteError('The note body changed while OpenMarks was saving. Your notes were preserved. Reopen the editor and retry.');
      return `${content.slice(0, match.index + match[0].length)}\n${notes ? `${notes}\n` : ''}`;
    });
  }

  private async loadFile(file: TFile): Promise<Bookmark | null> {
    try {
      const item = await this.readFile(file);
      if (!item) throw new BookmarkNoteError('Could not read bookmark metadata.');
      const conflict = this.records.get(item.id);
      if (conflict && conflict.path !== item.path) {
        this.removeByPath(file.path);
        this.issuesByPath.set(file.path, { path: file.path, kind: 'duplicate-id', reason: `This note uses the same bookmark ID as “${conflict.path}”. The file was left unchanged.` });
        return null;
      }
      const previousId = this.byPath.get(file.path);
      const previous = previousId ? this.records.get(previousId) : undefined;
      if (previous && previous.id !== item.id) this.removeRecord(previous.id);
      else if (previous && previous.id === item.id) this.removeRecord(previous.id);
      else if (this.records.has(item.id)) this.removeRecord(item.id);
      this.issuesByPath.delete(file.path);
      this.addRecord(item);
      return item;
    } catch (error) {
      this.removeByPath(file.path);
      this.issuesByPath.set(file.path, { path: file.path, kind: 'invalid-note', reason: error instanceof Error ? error.message : 'Could not read bookmark note.' });
      return null;
    }
  }

  private addRecord(item: Bookmark): void {
    this.records.set(item.id, item);
    this.byPath.set(item.path, item.id);
    const urls = this.byUrl.get(item.url) ?? new Set<string>();
    urls.add(item.id); this.byUrl.set(item.url, urls);
    this.refreshUrlDuplicates(item.url);
  }

  private replaceRecord(id: string, item: Bookmark): void {
    this.removeRecord(id); this.addRecord(item);
  }

  private removeRecord(id: string): void {
    const old = this.records.get(id); if (!old) return;
    this.records.delete(id);
    if (this.byPath.get(old.path) === id) this.byPath.delete(old.path);
    const urls = this.byUrl.get(old.url); urls?.delete(id);
    if (urls?.size === 0) this.byUrl.delete(old.url);
    this.refreshUrlDuplicates(old.url);
  }

  private removeByPath(path: string): void {
    const id = this.byPath.get(path);
    if (id) this.removeRecord(id);
    this.issuesByPath.delete(path);
  }

  private reportDuplicateUrls(): void {
    for (const [path, issue] of this.issuesByPath) if (issue.kind === 'duplicate-url') this.issuesByPath.delete(path);
    for (const ids of this.byUrl.values()) {
      if (ids.size < 2) continue;
      const records = orderedUrlRecords(ids, this.records);
      const owner = records[0];
      for (const item of records.slice(1)) this.issuesByPath.set(item.path, { path: item.path, kind: 'duplicate-url', url: item.url, reason: `This URL is also saved by “${owner.title}” (${owner.id}), selected by earliest creation date and stable ID. Both notes were kept; review or remove the duplicate manually.` });
    }
  }

  private refreshUrlDuplicates(url: string): void {
    for (const [path, issue] of this.issuesByPath) if (issue.kind === 'duplicate-url' && issue.url === url) this.issuesByPath.delete(path);
    const ids = this.byUrl.get(url);
    if (!ids || ids.size < 2) return;
    const records = orderedUrlRecords(ids, this.records);
    const owner = records[0];
    for (const item of records.slice(1)) this.issuesByPath.set(item.path, { path: item.path, kind: 'duplicate-url', url, reason: `This URL is also saved by “${owner.title}” (${owner.id}), selected by earliest creation date and stable ID. Both notes were kept; review or remove the duplicate manually.` });
  }

  private async allocatePath(title: string, id: string): Promise<string> {
    const base = safeFilename(title, id);
    const dot = base.lastIndexOf('.md');
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    let candidate = normalizePath(`${BOOKMARK_ROOT}/${base}`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) candidate = normalizePath(`${BOOKMARK_ROOT}/${stem} (${suffix++}).md`);
    return candidate;
  }

  private async writePatchedProperties(file: TFile, item: Bookmark, fields: Set<MetadataField>, expected: Record<string, unknown>): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (fm.type !== 'bookmark') throw new BookmarkNoteError('Bookmark type changed before the update was written.');
      for (const field of fields) {
        if (JSON.stringify(fm[field]) !== JSON.stringify(expected[field])) throw new BookmarkNoteError(`The “${field}” property changed outside OpenMarks while this edit was in progress. Reload and retry your change.`);
        if (OPERATIONAL_FAVICON_FIELDS.has(field)) { delete fm[field]; continue; }
        const key = field as keyof Bookmark;
        const value = item[key];
        if (value === '' && ['last_opened', 'favicon', 'favicon_source', 'preview_image', 'preview_source'].includes(field)) delete fm[field];
        else fm[field] = value;
      }
    });
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = '';
    for (const part of normalizePath(path).split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.then((): void => undefined, (): void => undefined);
    return pending;
  }
}

export { frontmatterFrom };
