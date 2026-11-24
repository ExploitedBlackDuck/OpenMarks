import { ItemView, Menu, Modal, Notice, Setting, TFile, setIcon } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { searchBookmarks } from './model.ts';
import type { Bookmark, BookmarkDraft, SearchFilters } from './model.ts';
import { BookmarkStore } from './storage.ts';
import { enrichDraft, fetchPageMetadata } from './metadata.ts';
import { exportBookmarkHtml, exportCsv, exportJson, parseBookmarkHtml, parseBookmarkJson, parseCsvBookmarks, parseMarkdownBookmarks, parsePlainTextUrls, previewImport, saveExportToVault } from './import-export.ts';
import { createOpenOnce, favoriteButtonAccessibility, faviconInitials, isCardEnter, navigationCurrentAttribute, visibleTags } from './ui-behavior.ts';

export const DASHBOARD_VIEW = 'openmarks-dashboard';
export const SIDEBAR_VIEW = 'openmarks-sidebar';

function recentBookmarksCutoff(days = 30): string { return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); }

export interface OpenMarksHost {
  app: App; store: BookmarkStore; refresh(): Promise<void>;
  displayMode: 'compact' | 'comfortable' | 'gallery' | 'list';
  defaultCollection: string;
  automaticFavicons: boolean; faviconsDuringImport: boolean; faviconProgressText: string;
  isImporting: boolean;
  setDisplayMode(mode: 'compact' | 'comfortable' | 'gallery' | 'list'): Promise<void>;
  setAutomaticFavicons(enabled: boolean): Promise<void>;
  setDefaultCollection(collection: string): Promise<void>;
  openBookmark(item: Bookmark): Promise<void>;
  refreshFavicon(item: Bookmark): Promise<void>;
  cacheFavicon(item: Bookmark, faviconUrl: string): Promise<boolean>;
  enqueueFavicons(items: readonly Bookmark[], priority?: number, force?: boolean): void;
  deferFavicons(ids: readonly string[]): void;
  beginImport(): boolean; endImport(): void;
  completeOnboarding(): Promise<void>;
  installSampleLibrary(): Promise<void>;
}

export class WelcomeModal extends Modal {
  constructor(app: App, private host: OpenMarksHost) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Welcome to OpenMarks');
    this.modalEl.addClass('openmarks-modal', 'openmarks-welcome-modal');
    this.contentEl.createEl('p', { text: 'Choose how you’d like to start your bookmark library.' });
    const privacy = this.contentEl.createEl('label', { cls: 'openmarks-privacy-choice' });
    const automatic = privacy.createEl('input', { attr: { type: 'checkbox' } });
    automatic.checked = this.host.automaticFavicons;
    privacy.createSpan({ text: ' Automatically retrieve favicons. This contacts bookmarked websites and may reveal your IP address and access timing.' });
    const choices = this.contentEl.createDiv({ cls: 'openmarks-welcome-choices' });
    const choose = (title: string, detail: string, action: () => Promise<void>) => {
      const card = choices.createEl('button', { cls: 'openmarks-welcome-choice' });
      card.createEl('strong', { text: title });
      card.createEl('span', { text: detail });
      card.addEventListener('click', () => { card.disabled = true; void this.host.setAutomaticFavicons(automatic.checked).then(action).catch((error) => { card.disabled = false; new Notice(error instanceof Error ? error.message : 'OpenMarks could not complete this choice.'); }); });
    };
    choose('Start with an empty library', 'Create your own bookmark collection from scratch.', async () => { await this.host.completeOnboarding(); this.close(); });
    choose('Explore 100 sample bookmarks', 'Browse an example library with collections, tags, and favorites.', async () => { await this.host.installSampleLibrary(); this.close(); new Notice('Added 100 sample bookmarks.'); });
    choose('Import existing bookmarks', 'Bring in a browser export or another bookmark file.', async () => { this.close(); new ImportModal(this.app, this.host, () => void this.host.completeOnboarding()).open(); });
  }
}

export class FaviconConsentModal extends Modal {
  private decided = false;
  constructor(app: App, private host: OpenMarksHost) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Automatic favicon retrieval'); this.modalEl.addClass('openmarks-modal');
    this.contentEl.createEl('p', { text: 'OpenMarks can retrieve icons from your bookmarked websites. These requests contact those sites and may disclose your IP address and the timing of your access. Cached icons remain available offline.' });
    const actions = this.contentEl.createDiv({ cls: 'openmarks-modal-actions' });
    const disabled = actions.createEl('button', { text: 'Keep disabled' });
    disabled.addEventListener('click', () => { void this.choose(false); });
    const enabled = actions.createEl('button', { cls: 'mod-cta', text: 'Enable retrieval' });
    enabled.addEventListener('click', () => { void this.choose(true); });
  }

  onClose(): void {
    if (this.decided) return;
    this.decided = true;
    void this.host.setAutomaticFavicons(false).catch((error) => new Notice(`OpenMarks could not save the privacy choice: ${error instanceof Error ? error.message : 'unknown error'}`));
  }

  private async choose(enabled: boolean): Promise<void> {
    if (this.decided) return;
    this.decided = true;
    try { await this.host.setAutomaticFavicons(enabled); this.close(); }
    catch (error) {
      this.decided = false;
      new Notice(`OpenMarks could not save the privacy choice: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}

export class ExportCleanupModal extends Modal {
  constructor(app: App) { super(app); }
  onOpen(): void {
    const exports = this.app.vault.getFiles().filter((file) => file.path.startsWith('_openmarks/exports/'));
    this.titleEl.setText('Manage OpenMarks exports'); this.modalEl.addClass('openmarks-modal');
    if (!exports.length) {
      this.contentEl.createEl('p', { text: 'There are no OpenMarks exports in this vault.' });
      this.contentEl.createEl('button', { text: 'Close' }).addEventListener('click', () => this.close());
      return;
    }
    this.contentEl.createEl('p', { text: `${exports.length} export file${exports.length === 1 ? '' : 's'} are stored in _openmarks/exports. OpenMarks will only move these files to the vault trash after you confirm.` });
    const actions = this.contentEl.createDiv({ cls: 'openmarks-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const remove = actions.createEl('button', { cls: 'mod-warning', text: `Move ${exports.length} export${exports.length === 1 ? '' : 's'} to vault trash` });
    remove.addEventListener('click', () => {
      remove.disabled = true;
      void (async () => {
        for (const file of exports) await this.app.fileManager.trashFile(file);
        this.close(); new Notice(`Moved ${exports.length} OpenMarks export${exports.length === 1 ? '' : 's'} to the vault trash.`);
      })().catch((error: unknown) => { remove.disabled = false; new Notice(`OpenMarks could not finish export cleanup: ${error instanceof Error ? error.message : 'unknown error'}`); });
    });
  }
}

export class FaviconCacheClearModal extends Modal {
  constructor(app: App, private automatic: boolean, private onConfirm: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Clear cached favicons?'); this.modalEl.addClass('openmarks-modal');
    this.contentEl.createEl('p', { text: this.automatic ? 'OpenMarks will remove only its generated favicon cache files and clear their bookmark references. It will retrieve eligible icons again in the background.' : 'OpenMarks will remove only its generated favicon cache files and clear their bookmark references. With automatic retrieval off, bookmarks will show fallback icons until you request downloads.' });
    const actions = this.contentEl.createDiv({ cls: 'openmarks-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    actions.createEl('button', { cls: 'mod-warning', text: 'Clear cache' }).addEventListener('click', () => { this.onConfirm(); this.close(); });
  }
}

function button(parent: HTMLElement, label: string, icon: string, action: () => void): HTMLButtonElement {
  const el = parent.createEl('button', { cls: 'openmarks-icon-button', attr: { 'aria-label': label, title: label } });
  setIcon(el, icon); el.addEventListener('click', action); return el;
}

function showFaviconFallback(container: HTMLElement, item: Bookmark): void {
  const { domain } = item;
  let hash = 0; for (const char of domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const initial = faviconInitials(item.title, domain);
  const mark = container.createSpan({ cls: 'openmarks-favicon-fallback', text: initial, attr: { 'aria-hidden': 'true' } });
  mark.style.setProperty('--om-favicon-hue', String(hash % 360));
}

function renderFaviconIcon(container: HTMLButtonElement, item: Bookmark, app: App): void {
  container.replaceChildren();
  container.setAttribute('aria-label', `Open ${item.title}`);
  container.title = `Open ${item.domain}`;
  const faviconFile = item.favicon ? app.vault.getAbstractFileByPath(item.favicon) : null;
  if (faviconFile instanceof TFile) {
    const img = container.createEl('img', { attr: { src: app.vault.getResourcePath(faviconFile), alt: '', loading: 'lazy' } });
    img.addEventListener('error', () => { img.remove(); showFaviconFallback(container, item); });
  } else showFaviconFallback(container, item);
}

export class DashboardView extends ItemView {
  private selecting = false;
  private selected = new Set<string>();
  private sidebarCollapsed = false;
  private filters: SearchFilters = { sort: 'created', descending: true };
  private searchQuery = '';
  private activeFilterLabel = 'All bookmarks';
  private expandedCollections = new Set<string>();
  private density: 'compact' | 'comfortable' | 'gallery' | 'list';
  constructor(leaf: WorkspaceLeaf, private host: OpenMarksHost) { super(leaf); this.density = host.displayMode; }
  getViewType(): string { return DASHBOARD_VIEW; }
  getDisplayText(): string { return 'OpenMarks'; }
  getIcon(): string { return 'bookmark'; }
  async onOpen(): Promise<void> { await this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  updateFavicon(item: Bookmark): void {
    const icon = [...this.contentEl.querySelectorAll<HTMLButtonElement>('.openmarks-favicon[data-bookmark-id]')]
      .find((element) => element.dataset.bookmarkId === item.id);
    if (icon) renderFaviconIcon(icon, item, this.app);
  }

  updateFaviconProgress(text: string): void {
    const progress = this.contentEl.querySelector<HTMLElement>('.openmarks-favicon-progress');
    if (progress) progress.textContent = text;
  }

  async render(): Promise<void> {
    const root = this.contentEl;
    root.querySelectorAll<HTMLDetailsElement>('.openmarks-tree-group[open]').forEach((details) => {
      const path = details.dataset.collectionPath;
      if (path) this.expandedCollections.add(path);
    });
    const previousScroll = root.scrollTop;
    const focused = root.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey : undefined;
    root.empty(); root.addClass('openmarks');
    const bar = root.createDiv({ cls: 'openmarks-topbar' });
    const heading = bar.createDiv({ cls: 'openmarks-heading' });
    const brand = heading.createDiv({ cls: 'openmarks-brand' }); setIcon(brand, 'bookmark'); brand.createEl('h2', { text: 'OpenMarks' });
    heading.createEl('span', { cls: 'openmarks-count', text: `${this.host.store.all().length} saved` });
    const faviconProgress = heading.createEl('span', { cls: 'openmarks-favicon-progress', text: this.host.faviconProgressText, attr: { 'aria-live': 'polite' } });
    const actions = bar.createDiv({ cls: 'openmarks-actions' });
    const collapse = button(actions, this.sidebarCollapsed ? 'Show navigation' : 'Hide navigation', 'panel-left', () => {
      this.sidebarCollapsed = !this.sidebarCollapsed; void this.render();
    }); collapse.setAttribute('aria-expanded', String(!this.sidebarCollapsed));
    const add = actions.createEl('button', { cls: 'openmarks-add-button' }); setIcon(add, 'plus'); add.createSpan({ text: 'Add bookmark' }); add.addEventListener('click', () => new BookmarkModal(this.app, this.host).open());
    const importButton = actions.createEl('button', { cls: 'openmarks-labeled-button', attr: { title: 'Import bookmarks' } }); setIcon(importButton, 'download'); importButton.createSpan({ text: 'Import' }); importButton.disabled = this.host.isImporting; importButton.addEventListener('click', () => { if (!this.host.isImporting) new ImportModal(this.app, this.host).open(); });
    const exportButton = actions.createEl('button', { cls: 'openmarks-labeled-button', attr: { title: 'Export bookmarks' } }); setIcon(exportButton, 'upload'); exportButton.createSpan({ text: 'Export' }); exportButton.addEventListener('click', () => new ExportModal(this.app, this.host.store).open());
    const selectButton = actions.createEl('button', { cls: 'openmarks-select-button', text: this.selecting ? 'Done' : 'Select' });
    selectButton.addEventListener('click', () => { this.selecting = !this.selecting; this.selected.clear(); void this.render(); });
    if (this.selecting) {
      actions.createEl('span', { cls: 'openmarks-count', text: `${this.selected.size} selected` });
      const markRead = actions.createEl('button', { text: 'Mark read' });
      markRead.addEventListener('click', async () => { for (const id of this.selected) await this.host.store.update(id, { status: 'read' }); this.selected.clear(); await this.host.refresh(); });
      const archive = actions.createEl('button', { text: 'Archive' });
      archive.addEventListener('click', async () => { for (const id of this.selected) await this.host.store.update(id, { status: 'archived' }); this.selected.clear(); await this.host.refresh(); });
      const remove = actions.createEl('button', { cls: 'mod-warning', text: 'Delete' });
      remove.addEventListener('click', () => { if (this.selected.size) new ConfirmBulkDeleteModal(this.app, this.host, [...this.selected], () => this.selected.clear()).open(); });
    }
    if (this.host.store.issues.length) {
      const issuePanel = root.createDiv({ cls: 'openmarks-data-issues', attr: { role: 'alert' } });
      issuePanel.createEl('strong', { text: `${this.host.store.issues.length} bookmark notes need attention` });
      issuePanel.createEl('p', { text: 'OpenMarks left these files unchanged. Review the note or its properties, then edit and save it in Obsidian.' });
      const issueList = issuePanel.createEl('ul');
      for (const issue of this.host.store.issues) {
        const row = issueList.createEl('li');
        row.createEl('code', { text: issue.path });
        row.createEl('span', { text: ` ${issue.reason}` });
        const open = row.createEl('button', { text: 'Open note', attr: { type: 'button' } });
        open.addEventListener('click', () => {
          const file = this.app.vault.getAbstractFileByPath(issue.path);
          if (file instanceof TFile) void this.app.workspace.getLeaf('tab').openFile(file);
          else new Notice('This note has been moved or deleted. Reload the OpenMarks library.');
        });
      }
    }
    const layout = root.createDiv({ cls: `openmarks-layout${this.sidebarCollapsed ? ' is-collapsed' : ''}` });
    const navigation = layout.createEl('aside', { cls: 'openmarks-navigation', attr: { 'aria-label': 'Bookmark navigation' } });
    const main = layout.createDiv({ cls: 'openmarks-main' });
    const controls = main.createDiv({ cls: 'openmarks-search-panel' });
    const searchLine = controls.createDiv({ cls: 'openmarks-search-line' }); setIcon(searchLine.createSpan({ cls: 'openmarks-search-icon' }), 'search');
    const search = searchLine.createEl('input', { cls: 'openmarks-search', attr: { type: 'search', placeholder: 'Search bookmarks, collections, or tags…', 'aria-label': 'Search bookmarks' } });
    const quickFilters = controls.createDiv({ cls: 'openmarks-quick-filters', attr: { role: 'group', 'aria-label': 'Quick filters' } });
    const active = this.filters;
    const filterName = this.activeFilterLabel;
    const quickButtons = new Map<string, HTMLButtonElement>();
    for (const name of ['All bookmarks', 'Favorites', 'Unread', 'Recently added']) {
      const chip = quickFilters.createEl('button', { cls: 'openmarks-filter-chip', text: name });
      chip.setAttribute('aria-pressed', String(name === filterName)); quickButtons.set(name, chip);
      if (name === filterName) chip.addClass('is-active');
    }
    const filters = main.createDiv({ cls: 'openmarks-controls' });
    const select = filters.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Sort bookmarks' } });
    [['created','Recently added'],['title','Title'],['domain','Domain'],['opened','Recently opened']].forEach(([value, label]) => select.createEl('option', { value, text: label }));
    select.value = active.sort ?? 'created';
    const viewToggle = filters.createEl('select', { cls: 'dropdown openmarks-density', attr: { 'aria-label': 'Display density' } });
    [['comfortable','Comfortable'],['compact','Compact'],['gallery','Gallery'],['list','List']].forEach(([value,label]) => viewToggle.createEl('option', { value, text: label }));
    viewToggle.value = this.density;
    const grid = main.createDiv({ cls: 'openmarks-grid' });
    const collectionPaths = [...new Set(this.host.store.all().map((item) => item.collection))].filter(Boolean).sort((a,b) => a.localeCompare(b));
    const activate = (label: string, next: SearchFilters): void => {
      this.activeFilterLabel = label;
      Object.assign(active, { openedOnly: undefined, favorite: undefined, status: undefined, collection: undefined, createdAfter: undefined, sort: 'created', descending: true, query: this.searchQuery }, next, { query: this.searchQuery });
      select.value = active.sort ?? 'created';
      quickButtons.forEach((el, key) => { const isActive = key === label; el.classList.toggle('is-active', isActive); el.setAttribute('aria-pressed', String(isActive)); });
      navigation.querySelectorAll<HTMLElement>('[data-filter]').forEach((el) => {
        const isActive = el.getAttribute('data-filter') === label;
        el.classList.toggle('is-active', isActive);
        el.setAttribute('aria-current', navigationCurrentAttribute(isActive));
      });
      draw();
    };
    quickButtons.forEach((el, label) => el.addEventListener('click', () => activate(label, label === 'Favorites' ? { favorite: true } : label === 'Unread' ? { status: 'unread' } : label === 'Recently added' ? { sort: 'created', descending: true, createdAfter: recentBookmarksCutoff() } : { sort: 'created', descending: true })));
    navigation.createEl('div', { cls: 'openmarks-nav-title', text: 'Library' });
    const allItems = this.host.store.all();
    const addNav = (label: string, icon: string, next: SearchFilters, count?: number): void => {
      const el = navigation.createEl('button', { cls: 'openmarks-nav-item', attr: { type: 'button', 'data-filter': label, 'aria-label': label, 'aria-current': navigationCurrentAttribute(label === filterName) } }); setIcon(el, icon); el.createSpan({ text: label });
      if (count !== undefined) el.createSpan({ cls: 'openmarks-nav-count', text: String(count), attr: { 'aria-label': `${count} bookmarks` } });
      if (label === filterName) el.addClass('is-active');
      el.addEventListener('click', () => activate(label, next));
    };
    addNav('All bookmarks', 'library', { sort: 'created', descending: true }, allItems.length);
    navigation.createEl('div', { cls: 'openmarks-nav-title openmarks-nav-section', text: 'Smart collections' });
    addNav('Favorites', 'star', { favorite: true }, allItems.filter((item) => item.favorite).length);
    addNav('Unread', 'circle', { status: 'unread' }, allItems.filter((item) => item.status === 'unread').length);
    addNav('Recently added', 'clock-3', { sort: 'created', descending: true, createdAfter: recentBookmarksCutoff() }, allItems.filter((item) => item.created >= recentBookmarksCutoff()).length);
    addNav('Recently opened', 'history', { openedOnly: true, sort: 'opened', descending: true }, allItems.filter((item) => Boolean(item.last_opened)).length);
    navigation.createEl('div', { cls: 'openmarks-nav-title openmarks-nav-section', text: 'Collections' });
    const tree = new Map<string, { path: string; children: Map<string, unknown> }>();
    for (const path of collectionPaths) {
      let cursor = tree; let cumulative = '';
      for (const segment of path.split('/').filter(Boolean)) {
        cumulative = cumulative ? `${cumulative}/${segment}` : segment;
        if (!cursor.has(segment)) cursor.set(segment, { path: cumulative, children: new Map() });
        cursor = cursor.get(segment)!.children as Map<string, { path: string; children: Map<string, unknown> }>;
      }
    }
    const renderTree = (parent: HTMLElement, nodes: Map<string, { path: string; children: Map<string, unknown> }>): void => {
      for (const [label, node] of nodes) {
        const hasChildren = node.children.size > 0;
        if (hasChildren) {
          const details = parent.createEl('details', { cls: 'openmarks-tree-group' });
          details.dataset.collectionPath = node.path; details.open = this.expandedCollections.has(node.path);
          details.addEventListener('toggle', () => { if (details.open) this.expandedCollections.add(node.path); else this.expandedCollections.delete(node.path); });
          const summary = details.createEl('summary', { cls: 'openmarks-tree-summary', attr: { 'data-filter': node.path, 'aria-current': navigationCurrentAttribute(node.path === filterName) } }); setIcon(summary, 'chevron-right'); summary.createSpan({ text: label });
          summary.createSpan({ cls: 'openmarks-nav-count', text: String(allItems.filter((item) => item.collection === node.path || item.collection.startsWith(`${node.path}/`)).length) });
          summary.addEventListener('click', () => activate(node.path, { collection: node.path }));
          const child = details.createDiv({ cls: 'openmarks-tree-children' });
          const choose = child.createEl('button', { cls: 'openmarks-tree-select', attr: { type: 'button', 'aria-label': `Filter collection ${node.path}`, 'data-filter': node.path, 'aria-current': navigationCurrentAttribute(node.path === filterName) } }); choose.createSpan({ text: `All ${label}` }); choose.createSpan({ cls: 'openmarks-nav-count', text: String(allItems.filter((item) => item.collection === node.path || item.collection.startsWith(`${node.path}/`)).length) }); choose.addEventListener('click', () => activate(node.path, { collection: node.path }));
          renderTree(child, node.children as Map<string, { path: string; children: Map<string, unknown> }>);
        } else {
          const leaf = parent.createEl('button', { cls: 'openmarks-tree-leaf', attr: { type: 'button', title: node.path, 'aria-label': `Filter collection ${node.path}`, 'data-filter': node.path, 'aria-current': navigationCurrentAttribute(node.path === filterName) } }); leaf.createSpan({ text: label }); leaf.createSpan({ cls: 'openmarks-nav-count', text: String(allItems.filter((item) => item.collection === node.path).length) });
          leaf.addEventListener('click', () => activate(node.path, { collection: node.path }));
        }
      }
    };
    renderTree(navigation, tree);
    navigation.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('is-active', el.getAttribute('data-filter') === filterName));
    if (!collectionPaths.length) navigation.createEl('div', { cls: 'openmarks-nav-empty', text: 'Your collections will appear here.' });
    const draw = (): void => {
      grid.empty(); const found = searchBookmarks(this.host.store.all(), active);
      if (this.host.automaticFavicons) this.host.enqueueFavicons(found, 20);
      faviconProgress.setText(this.host.faviconProgressText);
      if (!found.length) { grid.createDiv({ cls: 'openmarks-empty', text: active.query ? 'No bookmarks match this search.' : 'Your bookmark library is empty. Add a bookmark to get started.' }); return; }
      root.dataset.density = this.density;
      for (const item of found) this.renderCard(grid, item, this.density !== 'list');
    };
    search.value = this.searchQuery;
    search.dataset.focusKey = 'search';
    search.addEventListener('input', () => { this.searchQuery = search.value; active.query = this.searchQuery; draw(); });
    select.addEventListener('change', () => { active.sort = select.value as SearchFilters['sort']; draw(); });
    viewToggle.addEventListener('change', () => { this.density = viewToggle.value as typeof this.density; void this.host.setDisplayMode(this.density); draw(); });
    draw();
    root.scrollTop = previousScroll;
    if (focused) [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find((element) => element.dataset.focusKey === focused)?.focus();
  }

  private renderCard(parent: HTMLElement, item: Bookmark, cards: boolean): void {
    const hasGalleryPreview = this.density === 'gallery' && Boolean(item.preview_image && !item.preview_image.startsWith('http'));
    const card = parent.createDiv({ cls: `${cards ? 'openmarks-card' : 'openmarks-row'}${this.density === 'gallery' && !hasGalleryPreview ? ' openmarks-card-no-preview' : ''}` });
    card.dataset.bookmarkId = item.id;
    card.tabIndex = 0; card.setAttribute('role', 'article');
    const openOnce = createOpenOnce(() => { void this.host.openBookmark(item); });
    if (this.selecting) {
      const checkLabel = card.createEl('label', { cls: 'openmarks-selection' });
      const check = checkLabel.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Select ${item.title}` } });
      check.dataset.focusKey = `bookmark:${item.id}:select`;
      check.checked = this.selected.has(item.id);
      check.addEventListener('change', () => { if (check.checked) this.selected.add(item.id); else this.selected.delete(item.id); void this.render(); });
    }
    const icon = card.createEl('button', { cls: 'openmarks-favicon', attr: { type: 'button', 'aria-label': `Open ${item.title}`, title: `Open ${item.domain}`, 'data-bookmark-id': item.id, 'data-focus-key': `bookmark:${item.id}:icon` } });
    icon.addEventListener('click', openOnce);
    renderFaviconIcon(icon, item, this.app);
    if (this.density === 'gallery' && hasGalleryPreview) {
      const preview = card.createEl('a', { cls: 'openmarks-preview', attr: { href: item.url, 'aria-label': `Open ${item.title}`, title: `Open ${item.domain}` } });
      preview.addEventListener('click', openOnce);
      const previewFile = item.preview_image ? this.app.vault.getAbstractFileByPath(item.preview_image) : null;
      if (previewFile instanceof TFile) {
        const img = preview.createEl('img', { attr: { src: this.app.vault.getResourcePath(previewFile), alt: '', loading: 'lazy', title: item.title } });
        img.addEventListener('error', () => { img.remove(); this.renderPreviewFallback(preview, item, 'Preview unavailable offline'); });
      } else this.renderPreviewFallback(preview, item, 'Cached preview unavailable');
    }
    const main = card.createDiv({ cls: 'openmarks-card-main' });
    const titleLine = main.createDiv({ cls: 'openmarks-title-line' });
    titleLine.createEl('a', { cls: 'openmarks-title', text: item.title, attr: { href: item.url, title: item.title, 'aria-label': `Open ${item.title}` } }).addEventListener('click', openOnce);
    titleLine.createEl('span', { cls: `openmarks-status openmarks-status-${item.status}`, text: item.status === 'unread' ? 'Unread' : item.status === 'archived' ? 'Archived' : '' });
    const meta = main.createDiv({ cls: 'openmarks-meta' }); meta.createEl('span', { cls: 'openmarks-domain', text: item.domain });
    if (!this.filters.collection || this.filters.collection !== item.collection) {
      const collectionLabel = item.collection.split('/').filter(Boolean).at(-1) ?? item.collection;
      meta.createEl('span', { cls: 'openmarks-collection', text: collectionLabel, attr: { title: item.collection } });
    }
    if (item.description) main.createDiv({ cls: 'openmarks-description', text: item.description });
    if (item.tags.length) {
      const tags = main.createDiv({ cls: 'openmarks-tags' });
      const visible = visibleTags(item.tags);
      visible.visible.forEach((tag) => tags.createSpan({ cls: 'openmarks-tag', text: tag }));
      if (visible.remaining) tags.createSpan({ cls: 'openmarks-tag-more', text: `+${visible.remaining}`, attr: { title: item.tags.slice(visible.visible.length).join(', ') } });
    }
    const tools = card.createDiv({ cls: 'openmarks-card-tools' });
    const favoriteA11y = favoriteButtonAccessibility(item.title, item.favorite);
    const favorite = button(tools, favoriteA11y.label, 'star', () => { void this.host.store.update(item.id, { favorite: !item.favorite }).then(() => this.host.refresh()); });
    favorite.setAttribute('aria-pressed', favoriteA11y.pressed);
    favorite.dataset.focusKey = `bookmark:${item.id}:favorite`;
    if (item.favorite) favorite.addClass('is-favorite');
    button(tools, 'Bookmark actions', 'more-horizontal', () => this.contextMenu(item, tools));
    card.addEventListener('contextmenu', (event) => { event.preventDefault(); this.contextMenu(item, card, event); });
    card.addEventListener('keydown', (event) => { if (isCardEnter(event.key, event.target, card)) openOnce(event); });
  }

  private renderPreviewFallback(container: HTMLElement, item: Bookmark, message: string): void {
    const fallback = container.createDiv({ cls: 'openmarks-preview-fallback' });
    fallback.createDiv({ cls: 'openmarks-preview-monogram', text: item.domain.replace(/^www\./i, '').slice(0, 1).toUpperCase() || '↗', attr: { 'aria-hidden': 'true' } });
    fallback.createDiv({ cls: 'openmarks-preview-hint', text: message });
  }

  private contextMenu(item: Bookmark, target: HTMLElement, event?: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((entry) => { entry.setTitle('Open bookmark').setIcon('external-link').onClick(() => void this.host.openBookmark(item)); });
    menu.addItem((entry) => { entry.setTitle('Copy URL').setIcon('copy').onClick(() => void navigator.clipboard.writeText(item.url).then(() => new Notice('URL copied.'))); });
    menu.addItem((entry) => { entry.setTitle('Edit bookmark').setIcon('pencil').onClick(() => new BookmarkModal(this.app, this.host, item).open()); });
    menu.addItem((entry) => { entry.setTitle('Move to collection…').setIcon('folder-input').onClick(() => new MoveBookmarkModal(this.app, this.host, item).open()); });
    menu.addItem((entry) => { entry.setTitle(item.status === 'read' ? 'Mark unread' : 'Mark read').setIcon(item.status === 'read' ? 'circle' : 'check').onClick(() => void this.host.store.update(item.id, { status: item.status === 'read' ? 'unread' : 'read' }).then(() => this.host.refresh())); });
    menu.addItem((entry) => { entry.setTitle('Refresh favicon').setIcon('image').onClick(() => void this.host.refreshFavicon(item)); });
    menu.addItem((entry) => { entry.setTitle('Delete bookmark…').setIcon('trash').onClick(() => new ConfirmDeleteModal(this.app, this.host, item).open()); });
    if (event) menu.showAtMouseEvent(event); else menu.showAtPosition({ x: target.getBoundingClientRect().right, y: target.getBoundingClientRect().top });
  }
}

export class SidebarView extends ItemView {
  private filter: SearchFilters = { sort: 'created', descending: true };
  private searchQuery = '';
  constructor(leaf: WorkspaceLeaf, private host: OpenMarksHost) { super(leaf); }
  getViewType(): string { return SIDEBAR_VIEW; }
  getDisplayText(): string { return 'OpenMarks'; }
  getIcon(): string { return 'bookmark'; }
  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }
  render(): void {
    const root = this.contentEl; root.empty(); root.addClass('openmarks', 'openmarks-sidebar');
    const heading = root.createDiv({ cls: 'openmarks-sidebar-heading' }); heading.createEl('h3', { text: 'OpenMarks' });
    button(heading, 'Add bookmark', 'plus', () => new BookmarkModal(this.app, this.host).open());
    const search = root.createEl('input', { cls: 'openmarks-search', attr: { type: 'search', placeholder: 'Search', 'aria-label': 'Search bookmarks' } });
    const nav = root.createDiv({ cls: 'openmarks-sidebar-nav' });
    const content = root.createDiv({ cls: 'openmarks-sidebar-results' });
    const all = this.host.store.all();
    const collections = [...new Set(all.map((b) => b.collection))].sort();
    const renderRows = (): void => {
      content.empty(); const matches = searchBookmarks(this.host.store.all(), this.filter); const bookmarks = matches.slice(0, 50);
      if (!bookmarks.length) content.createDiv({ cls: 'openmarks-empty', text: 'No matches.' });
      bookmarks.forEach((item) => {
        const row = content.createEl('button', { cls: 'openmarks-sidebar-item', attr: { type: 'button', 'aria-label': `Open ${item.title}` } });
        row.createEl('span', { text: item.favorite ? '★' : '•', cls: 'openmarks-sidebar-dot' });
        row.createEl('span', { text: item.title, cls: 'openmarks-sidebar-title' });
        row.addEventListener('click', () => void this.host.openBookmark(item));
      });
      if (matches.length > 50) content.createEl('p', { cls: 'openmarks-sidebar-limit', text: `Showing 50 of ${matches.length}. Refine your search to find other bookmarks.` });
    };
    const navItem = (label: string, icon: string, next: SearchFilters, count?: number): void => {
      const el = nav.createEl('button', { cls: 'openmarks-nav-item', attr: { type: 'button' } }); setIcon(el, icon); el.createSpan({ text: label });
      if (count !== undefined) el.createSpan({ cls: 'openmarks-nav-count', text: String(count), attr: { 'aria-label': `${count} bookmarks` } });
      el.addEventListener('click', () => { this.filter = { ...next, query: this.searchQuery }; renderRows(); });
    };
    navItem('All bookmarks', 'library', { sort: 'created', descending: true }, all.length);
    navItem('Favorites', 'star', { favorite: true, sort: 'created', descending: true }, all.filter((b) => b.favorite).length);
    navItem('Recently added', 'clock-3', { sort: 'created', descending: true, createdAfter: recentBookmarksCutoff() }, all.filter((b) => b.created >= recentBookmarksCutoff()).length);
    navItem('Recently opened', 'history', { openedOnly: true, sort: 'opened', descending: true }, all.filter((b) => Boolean(b.last_opened)).length);
    navItem('Unread', 'circle', { status: 'unread', sort: 'created', descending: true }, all.filter((b) => b.status === 'unread').length);
    nav.createEl('div', { cls: 'openmarks-section-label', text: 'Collections' });
    collections.forEach((collection) => navItem(collection.split('/').at(-1) || collection, 'folder', { collection, sort: 'created', descending: true }, all.filter((b) => b.collection === collection).length));
    search.value = this.searchQuery;
    search.addEventListener('input', () => { this.searchQuery = search.value; this.filter = { ...this.filter, query: this.searchQuery }; renderRows(); }); renderRows();
  }
}

export class BookmarkModal extends Modal {
  private values: BookmarkDraft;
  constructor(app: App, private host: OpenMarksHost, private item?: Bookmark) { super(app); this.values = item ? { ...item } : { url: '', collection: host.defaultCollection }; }
  onOpen(): void {
    this.modalEl.addClass('openmarks-modal'); this.titleEl.setText(this.item ? 'Edit bookmark' : 'Add bookmark');
    const { contentEl } = this; contentEl.empty();
    const fields: [string, keyof BookmarkDraft, string][] = [
      ['URL', 'url', 'https://example.com'], ['Title', 'title', 'Bookmark title'], ['Description', 'description', 'A short summary'], ['Collection', 'collection', 'Work/Research'], ['Tags', 'tags', 'security, reading'], ['Notes', 'notes', 'Your notes'],
    ];
    const inputs = new Map<keyof BookmarkDraft, HTMLInputElement | HTMLTextAreaElement>();
    for (const [label, key, placeholder] of fields) {
      const setting = new Setting(contentEl).setName(label);
      if (key === 'notes') setting.addTextArea((control) => { control.setPlaceholder(placeholder).setValue(String(this.values[key] ?? '')).onChange((value) => { this.values.notes = value; }); control.inputEl.rows = 3; inputs.set(key, control.inputEl); });
      else setting.addText((control) => { control.setPlaceholder(placeholder).setValue(key === 'tags' ? (this.values.tags ?? []).join(', ') : String(this.values[key] ?? '')).onChange((value) => { if (key === 'tags') this.values.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean); else Object.assign(this.values, { [key]: value }); }); if (key === 'url') control.inputEl.type = 'url'; inputs.set(key, control.inputEl); });
    }
    const options = contentEl.createDiv({ cls: 'openmarks-modal-options' });
    const favoriteLabel = options.createEl('label'); const favorite = favoriteLabel.createEl('input', { attr: { type: 'checkbox' } }); favorite.checked = this.values.favorite ?? false; favoriteLabel.appendText(' Favorite'); favorite.addEventListener('change', () => { this.values.favorite = favorite.checked; });
    const status = options.createEl('select', { cls: 'dropdown' }); ['unread','read','archived'].forEach((v) => status.createEl('option', { value: v, text: v[0].toUpperCase() + v.slice(1) })); status.value = this.values.status ?? 'unread'; status.addEventListener('change', () => { this.values.status = status.value as Bookmark['status']; });
    const actions = contentEl.createDiv({ cls: 'openmarks-modal-actions' });
    const metadata = actions.createEl('button', { text: 'Fetch page details' }); metadata.addEventListener('click', async () => {
      this.readInputs(inputs); try { const found = await fetchPageMetadata(this.values.url); this.values.title ||= found.title; this.values.description ||= found.description; for (const [key, input] of inputs) if (key in found && !input.value) input.value = String(found[key as 'title' | 'description'] ?? ''); new Notice(found.title ? 'Page details loaded.' : 'Page details unavailable.'); } catch (error) { new Notice(error instanceof Error ? error.message : 'Could not fetch details.'); }
    });
    const save = actions.createEl('button', { cls: 'mod-cta', text: this.item ? 'Save changes' : 'Save bookmark' }); save.addEventListener('click', async () => {
      this.readInputs(inputs); try {
        const urlChanged = Boolean(this.item && this.values.url !== this.item.url);
        if (!this.item || urlChanged) {
          const wantsMetadata = !this.values.title?.trim() || !this.values.description?.trim() || !this.values.favicon;
          if (wantsMetadata && this.host.automaticFavicons) {
            try {
              const found = await enrichDraft(this.values);
              this.values = { ...found, ...this.values, title: this.values.title?.trim() || found.title, description: this.values.description?.trim() || found.description };
            } catch { /* Metadata is optional so offline saves still work. */ }
          }
        }
        const editableFields: (keyof BookmarkDraft)[] = ['url', 'title', 'description', 'collection', 'tags', 'favorite', 'status', 'notes', 'favicon'];
        const changed: Partial<BookmarkDraft> = {};
        if (this.item) {
          for (const key of editableFields) {
            const before = this.item[key]; const after = this.values[key];
            if (JSON.stringify(before) !== JSON.stringify(after)) Object.assign(changed, { [key]: after });
          }
        }
        const saved = this.item ? await this.host.store.update(this.item.id, changed, this.item.notes, this.item) : await this.host.store.create(this.values);
        if (!saved.favicon || !this.item || this.item.url !== saved.url) this.host.enqueueFavicons([saved], 10);
        await this.host.refresh(); this.close(); new Notice(this.item ? 'Bookmark updated.' : 'Bookmark saved.');
      } catch (error) { new Notice(error instanceof Error ? error.message : 'Could not save bookmark.'); }
    });
    inputs.get('url')?.focus();
  }
  private readInputs(inputs: Map<keyof BookmarkDraft, HTMLInputElement | HTMLTextAreaElement>): void {
    for (const [key, input] of inputs) {
      if (key === 'tags') this.values.tags = input.value.split(',').map((tag) => tag.trim()).filter(Boolean);
      else Object.assign(this.values, { [key]: input.value });
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

function guardDelete(button: HTMLButtonElement, action: () => Promise<void>): void {
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); }
    catch (error) { button.disabled = false; new Notice(error instanceof Error ? error.message : 'Could not finish moving bookmarks to trash.'); }
  });
}

class ConfirmDeleteModal extends Modal {
  constructor(app: App, private host: OpenMarksHost, private item: Bookmark) { super(app); }
  onOpen(): void { this.titleEl.setText('Delete bookmark?'); this.contentEl.createEl('p', { text: `Move “${this.item.title}” to the vault trash?` }); const btn = this.contentEl.createEl('button', { cls: 'mod-warning', text: 'Delete bookmark' }); guardDelete(btn, async () => { await this.host.store.delete(this.item.id); await this.host.refresh(); this.close(); new Notice('Bookmark moved to trash.'); }); }
}

class MoveBookmarkModal extends Modal {
  constructor(app: App, private host: OpenMarksHost, private item: Bookmark) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('openmarks-modal'); this.titleEl.setText('Move bookmark');
    this.contentEl.createEl('p', { text: 'Enter a collection path. Use / for nested collections, such as Work/Research.' });
    const listId = `openmarks-collections-${this.item.id}`;
    const suggestions = this.contentEl.createEl('datalist', { attr: { id: listId } });
    [...new Set(this.host.store.all().map((bookmark) => bookmark.collection).filter(Boolean))].sort().forEach((collection) => suggestions.createEl('option', { value: collection }));
    const input = this.contentEl.createEl('input', { attr: { type: 'text', list: listId, 'aria-label': 'Collection path', placeholder: 'Work/Research' } });
    input.value = this.item.collection;
    const save = this.contentEl.createEl('button', { cls: 'mod-cta', text: 'Move bookmark' });
    save.addEventListener('click', async () => {
      const collection = input.value.trim() || 'Unsorted';
      await this.host.store.update(this.item.id, { collection });
      await this.host.refresh(); this.close(); new Notice(`Moved to ${collection}.`);
    });
    input.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}

class ConfirmBulkDeleteModal extends Modal {
  constructor(app: App, private host: OpenMarksHost, private ids: string[], private onDone: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Delete selected bookmarks?');
    this.contentEl.createEl('p', { text: `Move ${this.ids.length} bookmark notes to the vault trash?` });
    const btn = this.contentEl.createEl('button', { cls: 'mod-warning', text: `Delete ${this.ids.length} bookmarks` });
    guardDelete(btn, async () => { for (const id of this.ids) await this.host.store.delete(id); this.onDone(); await this.host.refresh(); this.close(); new Notice(`Moved ${this.ids.length} bookmarks to trash.`); });
  }
}

export class ImportModal extends Modal {
  private locked = false;
  private loading = false;
  private processing = false;
  private cancelRequested = false;
  constructor(app: App, private host: OpenMarksHost, private onImported?: () => void) { super(app); }
  onOpen(): void {
    this.locked = this.host.beginImport();
    if (!this.locked) { new Notice('An import is already in progress.'); this.close(); return; }
    this.titleEl.setText('Import bookmarks'); this.modalEl.addClass('openmarks-modal');
    this.contentEl.createEl('p', { text: 'Choose a browser HTML, CSV, or JSON export. OpenMarks previews new items and duplicates before saving.' });
    const input = this.contentEl.createEl('input', { attr: { type: 'file', multiple: 'true', accept: '.html,.htm,.csv,.json,.md,.txt,text/html,text/csv,application/json,text/markdown,text/plain' } });
    const preview = this.contentEl.createDiv({ cls: 'openmarks-import-preview' });
    const progress = this.contentEl.createDiv({ cls: 'openmarks-import-progress', attr: { 'aria-live': 'polite' } });
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])]; if (!files.length) return;
      if (files.reduce((sum, file) => sum + file.size, 0) > 10_000_000) { preview.setText('Selected files exceed the 10 MB import limit.'); return; }
      this.loading = true;
      try {
        progress.setText('Reading and validating files…');
        const parsed = await Promise.all(files.map(async (file) => {
          const content = await file.text(); const ext = file.name.split('.').pop()?.toLowerCase();
          return ext === 'csv' ? parseCsvBookmarks(content) : ext === 'json' ? parseBookmarkJson(content) : ['md','markdown'].includes(ext ?? '') ? parseMarkdownBookmarks(content) : ext === 'txt' ? parsePlainTextUrls(content) : parseBookmarkHtml(content);
        }));
        if (this.cancelRequested) return;
        const rows = parsed.flat();
        const result = previewImport(rows, this.host.store.all());
        progress.setText('');
        preview.empty(); preview.createEl('p', { text: `${result.rows.length} new · ${result.duplicates.length} duplicates · ${result.invalid.length} invalid` });
        result.invalid.slice(0, 8).forEach((bad) => preview.createEl('div', { text: `Line ${bad.sourceLine}: ${bad.reason}`, cls: 'openmarks-import-error' }));
        result.duplicates.slice(0, 8).forEach((dup) => preview.createEl('div', { text: `Duplicate: ${dup.url}`, cls: 'openmarks-import-duplicate' }));
        const commit = preview.createEl('button', { cls: 'mod-cta', text: `Import ${result.rows.length} bookmarks` }); commit.disabled = !result.rows.length;
        commit.addEventListener('click', async () => {
          if (this.processing || this.cancelRequested) return;
          this.processing = true; input.disabled = true; commit.disabled = true;
          const cancel = preview.createEl('button', { text: 'Cancel import' }); cancel.addEventListener('click', () => { this.cancelRequested = true; cancel.disabled = true; progress.setText('Cancelling after the current bookmark…'); });
          let imported = 0; const failures: string[] = []; const importedItems: Bookmark[] = [];
          try {
            for (const [index, row] of result.rows.entries()) {
              if (this.cancelRequested) break;
              progress.setText(`Importing bookmark ${index + 1} of ${result.rows.length}…`);
              try { importedItems.push(await this.host.store.create(row.draft)); imported++; }
              catch (error) { failures.push(error instanceof Error ? error.message : 'A bookmark could not be saved.'); }
            }
          } finally {
            this.processing = false;
            if (this.locked) { this.host.endImport(); this.locked = false; }
          }
          if (this.host.faviconsDuringImport) this.host.enqueueFavicons(importedItems, 10);
          else this.host.deferFavicons(importedItems.map((item) => item.id));
          await this.host.refresh(); if (imported) this.onImported?.();
          const skipped = result.duplicates.length + result.invalid.length + failures.length;
          new Notice(`${this.cancelRequested ? 'Import cancelled' : 'Imported'} ${imported} bookmarks. Skipped ${skipped}.${failures.length ? ` First error: ${failures[0]}` : ''}`, 8000);
          if (this.modalEl.isConnected) this.close();
        });
      } catch (error) { progress.setText(''); preview.setText(error instanceof Error ? error.message : 'Could not read this file.'); }
      finally {
        this.loading = false;
        if (this.cancelRequested && !this.processing && this.locked) { this.host.endImport(); this.locked = false; }
      }
    });
  }

  onClose(): void {
    this.cancelRequested = true;
    if (this.processing || this.loading) return;
    if (this.locked) { this.host.endImport(); this.locked = false; }
    void this.host.refresh();
  }
}

class ExportModal extends Modal {
  constructor(app: App, private store: BookmarkStore) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Export bookmarks'); this.contentEl.createEl('p', { text: 'Save the current bookmark library as an export file in this vault.' });
    const select = this.contentEl.createEl('select', { cls: 'dropdown' }); [['html','Browser bookmark HTML'],['json','JSON'],['csv','CSV']].forEach(([value,label]) => select.createEl('option', { value, text: label }));
    const save = this.contentEl.createEl('button', { cls: 'mod-cta', text: 'Save export to vault' }); save.addEventListener('click', () => {
      const data = this.store.all(); const type = select.value; const text = type === 'html' ? exportBookmarkHtml(data) : type === 'csv' ? exportCsv(data) : exportJson(data);
      void (async () => {
        const file = await saveExportToVault(this.app.vault, type as 'html' | 'json' | 'csv', text);
        new Notice(`Export saved to ${file}.`);
        this.close();
      })().catch((error: unknown) => new Notice(`OpenMarks could not save the export: ${error instanceof Error ? error.message : 'unknown error'}`));
    });
  }
}
