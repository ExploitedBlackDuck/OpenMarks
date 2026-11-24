import { Notice, Platform, Plugin, TFile, normalizePath } from 'obsidian';
import { FAVICON_ROOT, normalizeUrl } from './model.ts';
import type { Bookmark, BookmarkDraft } from './model.ts';
import { BookmarkStore } from './storage.ts';
import { DashboardView, OpenMarksHost, SIDEBAR_VIEW, SidebarView, DASHBOARD_VIEW, BookmarkModal, WelcomeModal, FaviconCacheClearModal, FaviconConsentModal } from './ui.ts';
import { faviconCacheName, downloadFavicon, fetchPageMetadata } from './metadata.ts';
import type { FaviconDownload } from './metadata.ts';
import { OpenMarksSettingTab } from './settings.ts';
import { FaviconQueue } from './favicon-queue.ts';
import type { FaviconQueueProgress } from './favicon-queue.ts';
import { faviconRetryAt, shouldFetchFavicon } from './favicon-policy.ts';
import { loadSampleBookmarks } from './sample-data.ts';
import { RefreshScheduler } from './refresh-scheduler.ts';
import { CoalescedAsyncWriter, DeferredFaviconSet, emptyFaviconRecord, faviconOrigin, faviconOriginChanged, migrateLegacyFaviconIndex, normalizeFaviconCacheIndex, persistBeforeLegacyCleanup, isManagedFaviconPath } from './favicon-cache.ts';
import type { FaviconCacheIndex, FaviconCacheRecord } from './favicon-cache.ts';

export default class OpenMarksPlugin extends Plugin implements OpenMarksHost {
  store!: BookmarkStore;
  displayMode: 'compact' | 'comfortable' | 'gallery' | 'list' = 'comfortable';
  defaultCollection = 'Unsorted';
  onboardingCompleted = false;
  automaticFavicons = false;
  faviconPrivacyChoice = false;
  faviconsDuringImport = true;
  faviconRefreshDays = 30;
  faviconProgressText = '';
  private welcomeShown = false;
  private faviconQueue!: FaviconQueue<Bookmark>;
  private faviconQueueGeneration = 0;
  private faviconCacheIndex: FaviconCacheIndex = {};
  private migratingFaviconMetadata = false;
  private lastFaviconCacheWarningAt = 0;
  private faviconCacheWriter?: CoalescedAsyncWriter;
  private preferenceWrite: Promise<void> = Promise.resolve();
  private originFaviconResults = new Map<string, { at: number; result: FaviconDownload; source: string }>();
  private originFaviconRequests = new Map<string, Promise<{ result: FaviconDownload; source: string }>>();
  private deferredFavicons = new DeferredFaviconSet();
  private importInProgress = false;
  private importRefreshPending = false;
  private faviconRetryTimers = new Set<ReturnType<typeof setTimeout>>();
  private refreshScheduler!: RefreshScheduler;
  get isImporting(): boolean { return this.importInProgress; }
  onunload(): void { this.faviconQueue?.cancel(); this.originFaviconRequests.clear(); this.refreshScheduler?.cancel(); for (const timer of this.faviconRetryTimers) clearTimeout(timer); this.faviconRetryTimers.clear(); void this.faviconCacheWriter?.stopAndFlush(); }
  async onload(): Promise<void> {
    const saved = await this.loadData() as { displayMode?: string; defaultCollection?: string; onboardingCompleted?: boolean; automaticFavicons?: boolean; faviconPrivacyChoice?: boolean; faviconsDuringImport?: boolean; faviconRefreshDays?: number; faviconCacheIndex?: unknown } | null;
    if (saved?.displayMode && ['compact', 'comfortable', 'gallery', 'list'].includes(saved.displayMode)) this.displayMode = saved.displayMode as typeof this.displayMode;
    this.defaultCollection = saved?.defaultCollection?.trim() || 'Unsorted';
    this.onboardingCompleted = saved?.onboardingCompleted === true;
    this.automaticFavicons = saved?.faviconPrivacyChoice === true && saved?.automaticFavicons === true;
    this.faviconPrivacyChoice = saved?.faviconPrivacyChoice === true;
    this.faviconCacheIndex = normalizeFaviconCacheIndex(saved?.faviconCacheIndex);
    this.faviconCacheWriter = new CoalescedAsyncWriter(() => this.savePreferences(), (error) => {
      if (Date.now() - this.lastFaviconCacheWarningAt > 60_000) {
        this.lastFaviconCacheWarningAt = Date.now();
        console.error('OpenMarks could not persist favicon cache state. Retrieval will remain eligible for a later retry.', error);
        new Notice('OpenMarks could not save favicon retry state. It will try again later.');
      }
    }, 2000);
    this.faviconsDuringImport = saved?.faviconsDuringImport !== false;
    const days = saved?.faviconRefreshDays;
    this.faviconRefreshDays = [7, 30, 60, 90].includes(days) ? days : 30;
    this.store = new BookmarkStore(this.app, this.defaultCollection);
    this.refreshScheduler = new RefreshScheduler(() => this.renderViews(), 60, 180, (error) => console.error('OpenMarks could not refresh its views.', error));
    this.createFaviconQueue();
    this.addSettingTab(new OpenMarksSettingTab(this.app, this, this));
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this));
    this.registerView(SIDEBAR_VIEW, (leaf) => new SidebarView(leaf, this));
    this.addCommand({ id: 'open-dashboard', name: 'Open bookmark manager', callback: () => void this.openDashboard() });
    this.addCommand({ id: 'add-bookmark', name: 'Add bookmark', callback: () => new BookmarkModal(this.app, this).open() });
    this.addCommand({ id: 'save-clipboard-url', name: 'Save URL from clipboard', callback: () => void this.saveClipboardUrl() });
    this.addCommand({ id: 'open-sidebar', name: 'Open bookmark sidebar', callback: () => void this.openSidebar() });
    this.addCommand({ id: 'refresh-favicons', name: 'Refresh all bookmark favicons', callback: () => void this.refreshAllFavicons() });
    this.addCommand({ id: 'cancel-favicon-refresh', name: 'Cancel automatic favicon retrieval', callback: () => this.cancelFaviconRefresh() });
    this.addRibbonIcon('bookmark', 'Open OpenMarks', () => void this.openDashboard());
    this.app.workspace.onLayoutReady(() => {
      this.watchVaultChanges();
      return this.store.load().then(async () => {
        await this.migrateFaviconCacheIndex();
        await this.restoreCachedFaviconReferences();
        await this.refresh();
        if (this.store.issues.length) new Notice(`OpenMarks found ${this.store.issues.length} bookmark note${this.store.issues.length === 1 ? '' : 's'} that need attention. Open the manager to review them.`, 8000);
        if (this.store.all().length > 0) await this.completeOnboarding();
        else if (!this.onboardingCompleted && !this.welcomeShown) {
          this.welcomeShown = true;
          new WelcomeModal(this.app, this).open();
        }
        if (!this.faviconPrivacyChoice && this.store.all().length > 0) new FaviconConsentModal(this.app, this).open();
        this.enqueueMissingFavicons(0);
      });
    });
  }

  private watchVaultChanges(): void {
    this.registerEvent(this.app.vault.on('create', (file) => {
      if (this.migratingFaviconMetadata) return;
      const deferIcon = this.importInProgress;
      if (file instanceof TFile && file.path.startsWith('_openmarks/bookmarks/')) void this.store.refreshFromFile(file).then((item) => { if (item && !deferIcon) this.enqueueFavicons([item], 5); return this.refresh(); });
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (this.migratingFaviconMetadata) return;
      if (file instanceof TFile && file.path.startsWith('_openmarks/bookmarks/')) {
        const previous = this.store.getByPath(file.path);
        void this.store.refreshFromFile(file).then(async (item) => {
          if (!item) return this.refresh();
          if (previous && item.url !== previous.url && faviconOriginChanged(previous.url, item.url) && item.favicon === previous.favicon && item.favicon) item = await this.store.update(item.id, { favicon: '' });
          if (previous && this.onlyFaviconChanged(previous, item)) { this.updateFaviconUi(item); return; }
          if (!previous || item.url !== previous.url || !item.favicon) this.enqueueFavicons([item], 5);
          return this.refresh();
        });
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && (oldPath.startsWith('_openmarks/bookmarks/') || file.path.startsWith('_openmarks/bookmarks/'))) void this.store.handleRename(file, oldPath).then((item) => { if (item && !item.favicon) this.enqueueFavicons([item], 5); return this.refresh(); });
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (file.path.startsWith('_openmarks/bookmarks/')) void this.store.handleDelete(file.path).then(() => this.refresh());
    }));
  }

  async refresh(): Promise<void> {
    if (this.importInProgress) { this.importRefreshPending = true; return; }
    await this.refreshScheduler.schedule();
  }

  private async renderViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW);
    for (const leaf of leaves) if (leaf.view instanceof DashboardView) await leaf.view.render();
    for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW)) if (leaf.view instanceof SidebarView) leaf.view.render();
  }

  private onlyFaviconChanged(previous: Bookmark, next: Bookmark): boolean {
    const faviconFields = new Set(['favicon', 'favicon_source', 'favicon_checked_at', 'favicon_retry_at', 'favicon_etag', 'favicon_last_modified', 'favicon_failed_attempts']);
    return Object.keys(previous).every((key) => faviconFields.has(key) || JSON.stringify(previous[key as keyof Bookmark]) === JSON.stringify(next[key as keyof Bookmark]));
  }

  private updateFaviconUi(item: Bookmark): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (leaf.view instanceof DashboardView) leaf.view.updateFavicon(item);
  }

  private createFaviconQueue(manual = false): void {
    const generation = ++this.faviconQueueGeneration;
    this.faviconQueue = new FaviconQueue((item) => item.id, (item) => item.url, (item, signal) => this.retrieveFavicon(item, signal, manual), (state) => {
      if (generation === this.faviconQueueGeneration) this.onFaviconQueueProgress(state);
    }, 3, 0);
  }

  private faviconRecord(item: Bookmark): FaviconCacheRecord {
    const origin = faviconOrigin(item.url);
    if (!origin) return emptyFaviconRecord('');
    const record = this.faviconCacheIndex[origin] ?? emptyFaviconRecord(origin, item.favicon);
    if (!record.iconPath && item.favicon) record.iconPath = item.favicon;
    this.faviconCacheIndex[origin] = record;
    return record;
  }

  private async persistFaviconCacheIndex(): Promise<void> {
    this.faviconCacheWriter?.request();
  }

  private async migrateFaviconCacheIndex(): Promise<void> {
    const migration = migrateLegacyFaviconIndex(this.faviconCacheIndex, this.store.all());
    const changed = JSON.stringify(migration.index) !== JSON.stringify(this.faviconCacheIndex);
    this.faviconCacheIndex = migration.index;
    try {
      await persistBeforeLegacyCleanup(
        async () => { if (changed) await this.savePreferences(); },
        async () => {
          if (!migration.pathsToClean.length) return;
          this.migratingFaviconMetadata = true;
          try {
            const failed = await this.store.stripLegacyFaviconMetadata(migration.pathsToClean);
            if (failed.length) new Notice(`Favicon state was saved, but ${failed.length} bookmark note${failed.length === 1 ? '' : 's'} still contain legacy cache properties. OpenMarks will retry cleanup later.`, 8000);
          } finally { this.migratingFaviconMetadata = false; }
        },
      );
      if (migration.pathsToClean.length) await this.store.load();
    } catch (error) {
      if (changed) {
        console.error('OpenMarks could not save the favicon cache migration. Legacy bookmark properties were retained.', error);
        new Notice('OpenMarks could not save its favicon cache migration. Existing bookmark metadata was left intact.');
      }
    }
  }

  private async restoreCachedFaviconReferences(): Promise<void> {
    for (const item of this.store.all()) {
      const record = this.faviconCacheIndex[faviconOrigin(item.url)];
      if (!item.favicon && record?.iconPath && this.app.vault.getAbstractFileByPath(record.iconPath)) {
        try { await this.store.update(item.id, { favicon: record.iconPath }); }
        catch (error) { console.error(`OpenMarks could not restore the cached favicon reference for ${item.path}.`, error); }
      }
    }
  }

  private async updateFaviconRecord(item: Bookmark, update: Partial<FaviconCacheRecord>): Promise<void> {
    const record = this.faviconRecord(item);
    Object.assign(record, update, { origin: record.origin });
    await this.persistFaviconCacheIndex();
  }

  private cancelFaviconRefresh(): void {
    this.faviconQueue.cancel();
    this.originFaviconRequests.clear();
    this.createFaviconQueue();
    this.faviconProgressText = '';
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (leaf.view instanceof DashboardView) leaf.view.updateFaviconProgress('');
    new Notice('Queued favicon retrieval was cancelled. New and manually refreshed bookmarks can still retrieve icons.');
  }

  enqueueFavicons(items: readonly Bookmark[], priority = 5, force = false): void {
    if ((!force && !this.automaticFavicons) || !this.faviconQueue) return;
    const now = Date.now();
    const eligible = items.filter((item) => {
      const current = this.store.get(item.id) ?? item;
      if (force) this.deferredFavicons.release([current.id]);
      if (!force && this.deferredFavicons.shouldSkip(current.id)) return false;
      const cache = this.faviconRecord(current);
      const cachedPath = current.favicon || cache.iconPath;
      const fileExists = cachedPath && this.app.vault.getAbstractFileByPath(cachedPath);
      const policy = { url: current.url, favicon: cachedPath, favicon_source: cache.source, favicon_checked_at: cache.lastSuccessAt, favicon_retry_at: cache.retryAt, favicon_failed_attempts: cache.failures };
      const missingReference = Boolean(cache.iconPath && this.app.vault.getAbstractFileByPath(cache.iconPath) && current.favicon !== cache.iconPath);
      return missingReference || force || shouldFetchFavicon(policy, Boolean(fileExists), now, this.faviconRefreshDays);
    });
    this.faviconQueue.enqueue(eligible, priority);
  }

  private enqueueMissingFavicons(priority: number): void {
    this.enqueueFavicons(this.store.all(), priority);
  }

  deferFavicons(ids: readonly string[]): void { this.deferredFavicons.defer(ids); }
  beginImport(): boolean { if (this.importInProgress) return false; this.importInProgress = true; return true; }
  endImport(): void {
    this.importInProgress = false;
    if (this.importRefreshPending) { this.importRefreshPending = false; void this.refresh(); }
  }

  private onFaviconQueueProgress(state: FaviconQueueProgress): void {
    const total = state.pending + state.running;
    this.faviconProgressText = total ? `Caching favicons: ${total} remaining` : '';
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (leaf.view instanceof DashboardView) leaf.view.updateFaviconProgress(this.faviconProgressText);
  }

  private async retrieveFavicon(item: Bookmark, signal: AbortSignal, manual: boolean): Promise<void> {
    const current = this.store.get(item.id);
    if (!current || signal.aborted || (!manual && !this.automaticFavicons)) return;
    const origin = new URL(current.url).origin;
    const cached = this.faviconRecord(current);
    const cachedFile = cached.iconPath ? this.app.vault.getAbstractFileByPath(cached.iconPath) : null;
    const cachePolicy = { url: current.url, favicon: cached.iconPath, favicon_source: cached.source, favicon_checked_at: cached.lastSuccessAt, favicon_retry_at: cached.retryAt, favicon_failed_attempts: cached.failures };
    if (!manual && cachedFile && current.favicon !== cached.iconPath && !shouldFetchFavicon(cachePolicy, true, Date.now(), this.faviconRefreshDays)) {
      await this.store.update(current.id, { favicon: cached.iconPath });
      this.updateFaviconUi(this.store.get(current.id) ?? current);
      return;
    }
    let request = this.originFaviconRequests.get(origin);
    try {
      const prior = this.originFaviconResults.get(origin);
      if (!request && prior && Date.now() - prior.at < this.faviconRefreshDays * 86_400_000) request = Promise.resolve({ result: prior.result, source: prior.source });
      if (!request) {
        request = (async () => {
          await this.updateFaviconRecord(current, { lastAttemptAt: new Date().toISOString() });
          return this.resolveOriginFavicon(current, signal);
        })();
        this.originFaviconRequests.set(origin, request);
      }
      const { result, source } = await request;
      if (signal.aborted) return;
      this.originFaviconResults.set(origin, { at: Date.now(), result, source });
      if (this.originFaviconRequests.get(origin) === request) this.originFaviconRequests.delete(origin);
      const latest = this.store.get(item.id);
      if (latest && faviconOrigin(latest.url) === origin && !signal.aborted) {
        await this.applyFaviconResult(latest, result);
        await this.updateFaviconRecord(latest, {
          source, iconPath: result.path, lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(),
          etag: result.etag, lastModified: result.lastModified, retryAt: '', failures: 0,
        });
      }
    } catch {
      const latest = this.store.get(item.id);
      if (latest && faviconOrigin(latest.url) === origin && !signal.aborted) {
        try {
          const state = this.faviconRecord(latest);
          const failures = state.failures + 1;
          const retryAt = faviconRetryAt(failures, Date.now());
          await this.updateFaviconRecord(latest, { failures, retryAt, lastAttemptAt: new Date().toISOString() });
          this.scheduleFaviconRetry(latest.id);
        } catch (error) { console.error('OpenMarks could not record a favicon retry. The bookmark remains eligible for a later scan.', error); }
      }
      if (this.originFaviconRequests.get(origin) === request) this.originFaviconRequests.delete(origin);
      throw new Error('Favicon retrieval failed.');
    }
  }

  private scheduleFaviconRetry(id: string): void {
    const item = this.store.get(id); if (!item) return;
    const retryAt = this.faviconRecord(item).retryAt; if (!retryAt) return;
    const remaining = Date.parse(retryAt) - Date.now();
    const timer = setTimeout(() => {
      this.faviconRetryTimers.delete(timer);
      const latest = this.store.get(id);
      if (!latest || !this.automaticFavicons) return;
      if (Date.parse(this.faviconRecord(latest).retryAt) > Date.now()) this.scheduleFaviconRetry(id);
      else this.enqueueFavicons([latest]);
    }, Math.max(0, Math.min(remaining, 2_147_000_000)));
    this.faviconRetryTimers.add(timer);
  }

  private async resolveOriginFavicon(item: Bookmark, signal: AbortSignal): Promise<{ result: FaviconDownload; source: string }> {
    const metadata = await fetchPageMetadata(item.url, signal);
    const cache = this.faviconRecord(item);
    if (signal.aborted) throw new Error('Favicon request cancelled.');
    for (const candidate of metadata.faviconCandidates) {
      if (signal.aborted) throw new Error('Favicon request cancelled.');
      const validators = candidate === cache.source ? {
        etag: cache.etag, lastModified: cache.lastModified,
        cachedPath: cache.iconPath && this.app.vault.getAbstractFileByPath(cache.iconPath) ? cache.iconPath : item.favicon && this.app.vault.getAbstractFileByPath(item.favicon) ? item.favicon : '',
      } : {};
      const result = await downloadFavicon(candidate, item.url, await faviconCacheName(item.url), async (target, data) => {
        if (signal.aborted) throw new Error('Favicon retrieval cancelled.');
        await this.ensureFaviconFolder(); await this.app.vault.adapter.writeBinary(normalizePath(target), data);
      }, validators, signal);
      if (signal.aborted) throw new Error('Favicon retrieval cancelled.');
      if (result.path) return { result, source: candidate };
    }
    throw new Error('No valid same-site favicon was available.');
  }

  private async applyFaviconResult(item: Bookmark, result: FaviconDownload): Promise<void> {
    await this.store.update(item.id, { favicon: result.path });
    this.updateFaviconUi(this.store.get(item.id) ?? item);
  }

  async setDisplayMode(mode: 'compact' | 'comfortable' | 'gallery' | 'list'): Promise<void> {
    this.displayMode = mode;
    await this.savePreferences();
  }

  async completeOnboarding(): Promise<void> {
    this.onboardingCompleted = true;
    await this.savePreferences();
  }

  async installSampleLibrary(): Promise<void> {
    if (this.store.all().length) throw new Error('Sample bookmarks can only be added to an empty OpenMarks library.');
    const samples: BookmarkDraft[] = await loadSampleBookmarks();
    const installed: Bookmark[] = [];
    if (!this.beginImport()) throw new Error('An import is already in progress.');
    try { for (const sample of samples) installed.push(await this.store.create(sample)); }
    finally { this.endImport(); }
    this.enqueueFavicons(installed, 0);
    await this.completeOnboarding();
    await this.refresh();
  }

  async setDefaultCollection(collection: string): Promise<void> {
    this.defaultCollection = collection.trim() || 'Unsorted';
    if (this.store) this.store.defaultCollection = this.defaultCollection;
    await this.savePreferences();
  }

  async setAutomaticFavicons(enabled: boolean): Promise<void> {
    this.automaticFavicons = enabled;
    this.faviconPrivacyChoice = true;
    this.faviconQueue.cancel(); this.originFaviconRequests.clear(); this.createFaviconQueue();
    this.faviconProgressText = '';
    if (enabled) this.enqueueMissingFavicons(0);
    await this.savePreferences(); await this.refresh();
  }

  async setFaviconsDuringImport(enabled: boolean): Promise<void> { this.faviconsDuringImport = enabled; await this.savePreferences(); }
  async setFaviconRefreshDays(days: number): Promise<void> { this.faviconRefreshDays = days; await this.savePreferences(); this.enqueueMissingFavicons(0); }

  async clearFaviconCache(): Promise<void> {
    new FaviconCacheClearModal(this.app, this.automaticFavicons, () => void this.clearFaviconCacheConfirmed()).open();
  }

  private async clearFaviconCacheConfirmed(): Promise<void> {
    this.faviconQueue.cancel(); this.originFaviconRequests.clear(); this.createFaviconQueue();
    const all = this.store.all();
    const ownedPaths = new Set(all.map((item) => item.favicon).filter(Boolean));
    for (const record of Object.values(this.faviconCacheIndex)) if (record.iconPath) ownedPaths.add(record.iconPath);
    for (const item of all) if (item.favicon && ownedPaths.has(item.favicon) && isManagedFaviconPath(item.favicon)) await this.store.update(item.id, { favicon: '' });
    for (const path of ownedPaths) if (isManagedFaviconPath(path) && this.app.vault.adapter.exists && await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
    this.faviconCacheIndex = {};
    this.deferredFavicons.clear();
    this.originFaviconResults.clear(); this.originFaviconRequests.clear();
    await this.savePreferences();
    if (this.automaticFavicons) this.enqueueMissingFavicons(0);
    await this.refresh();
    new Notice(this.automaticFavicons ? 'Cached favicons were cleared. OpenMarks will retrieve them again in the background.' : 'Cached favicons were cleared. Automatic retrieval is off, so icons will use fallbacks until you request them.');
  }

  manualRefreshFavicons(): void { void this.refreshAllFavicons(); }

  private async savePreferences(): Promise<void> {
    const data = {
      displayMode: this.displayMode,
      defaultCollection: this.defaultCollection,
      onboardingCompleted: this.onboardingCompleted,
      automaticFavicons: this.automaticFavicons,
      faviconPrivacyChoice: this.faviconPrivacyChoice,
      faviconCacheIndex: structuredClone(this.faviconCacheIndex),
      faviconsDuringImport: this.faviconsDuringImport,
      faviconRefreshDays: this.faviconRefreshDays,
    };
    const write = this.preferenceWrite.catch(() => {}).then(() => this.saveData(data));
    this.preferenceWrite = write;
    await write;
  }

  async openBookmark(item: Bookmark): Promise<void> {
    let url: string;
    try { url = normalizeUrl(item.url); }
    catch { new Notice('This bookmark does not contain a valid HTTP or HTTPS URL.'); return; }
    try {
      const host = window as Window & { require?: (id: string) => { shell?: { openExternal?: (target: string) => Promise<void> } } };
      const openExternal = Platform.isDesktopApp ? host.require?.('electron').shell?.openExternal : undefined;
      if (openExternal) void openExternal(url).catch(() => new Notice('The system browser could not open this bookmark.'));
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    await this.store.update(item.id, { last_opened: new Date().toISOString() });
    await this.refresh();
  }

  async refreshFavicon(item: Bookmark): Promise<void> {
    this.deferredFavicons.release([item.id]);
    try {
      const meta = await fetchPageMetadata(item.url);
      if (!meta.faviconCandidates.length) { new Notice('This page did not declare a same-site favicon.'); return; }
      let cached = false;
      for (const candidate of meta.faviconCandidates) {
        cached = await this.cacheFavicon(item, candidate);
        if (cached) break;
      }
      new Notice(cached ? 'Favicon refreshed.' : 'The site icon could not be downloaded or validated.');
    } catch (error) { new Notice(error instanceof Error ? error.message : 'Favicon refresh failed.'); }
  }

  async cacheFavicon(item: Bookmark, faviconUrl: string, quiet = false): Promise<boolean> {

    await this.ensureFaviconFolder();
    const result = await downloadFavicon(faviconUrl, item.url, await faviconCacheName(item.url), async (target, data) => {
      await this.app.vault.adapter.writeBinary(normalizePath(target), data);
    });
    if (result.path && faviconOrigin(this.store.get(item.id)?.url ?? '') === faviconOrigin(item.url)) {
      await this.store.update(item.id, { favicon: result.path });
      await this.updateFaviconRecord(item, { source: faviconUrl, iconPath: result.path, lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), etag: result.etag, lastModified: result.lastModified, retryAt: '', failures: 0 });
      if (!quiet) await this.refresh(); return true;
    }
    return false;
  }

  private async refreshAllFavicons(): Promise<void> {
    this.faviconQueue.cancel();
    this.originFaviconResults.clear(); this.originFaviconRequests.clear();
    this.createFaviconQueue(true);
    this.enqueueFavicons(this.store.all(), 30, true);
    if (!this.store.all().length) new Notice('There are no bookmarks to refresh.');
  }

  private async ensureFaviconFolder(): Promise<void> {
    await this.ensureFolder(FAVICON_ROOT);
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = '';
    for (const part of normalizePath(path).split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async openDashboard(): Promise<void> {
    const leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: DASHBOARD_VIEW, active: true }); this.app.workspace.revealLeaf(leaf);
  }

  private async openSidebar(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false); if (!leaf) return;
    await leaf.setViewState({ type: SIDEBAR_VIEW, active: true }); this.app.workspace.revealLeaf(leaf);
  }

  private async saveClipboardUrl(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText(); const url = normalizeUrl(text);
      const item = await this.store.create({ url }); this.enqueueFavicons([item], 10); await this.refresh(); new Notice(`Saved “${item.title}”.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already saved')) new Notice(error.message);
      else { new Notice('Clipboard did not contain a valid HTTP or HTTPS URL.'); new BookmarkModal(this.app, this).open(); }
    }
  }
}
