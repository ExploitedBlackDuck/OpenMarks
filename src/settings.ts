import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { ExportCleanupModal } from './ui.ts';

export interface OpenMarksSettingsHost {
  defaultCollection: string;
  displayMode: 'compact' | 'comfortable' | 'gallery' | 'list';
  automaticFavicons: boolean;
  faviconsDuringImport: boolean;
  faviconRefreshDays: number;
  setDefaultCollection(value: string): Promise<void>;
  setDisplayMode(value: 'compact' | 'comfortable' | 'gallery' | 'list'): Promise<void>;
  setAutomaticFavicons(value: boolean): Promise<void>;
  setFaviconsDuringImport(value: boolean): Promise<void>;
  setFaviconRefreshDays(value: number): Promise<void>;
  clearFaviconCache(): Promise<void>;
  manualRefreshFavicons(): void;
}

export class OpenMarksSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private host: OpenMarksSettingsHost) { super(app, plugin); this.appInstance = app; }
  private appInstance: App;

  getSettingDefinitions() {
    return [
      { type: 'group' as const, heading: 'Bookmarks', items: [
        { name: 'Bookmark folder', desc: 'Bookmark notes are stored in _openmarks/bookmarks in this vault. Moving the folder requires a verified migration, so its location is fixed for now.',
          render: () => { } },
        { name: 'Default collection', desc: 'Collection assigned to new bookmarks when you leave the collection field blank.',
          render: (setting: Setting) => { setting.addText((text) => text.setValue(this.host.defaultCollection).setPlaceholder('Unsorted').onChange((value) => void this.host.setDefaultCollection(value).catch(showSettingsError))); } },
        { name: 'Default display', desc: 'Choose the layout used when the bookmark manager opens.',
          render: (setting: Setting) => { setting.addDropdown((dropdown) => dropdown
        .addOption('comfortable', 'Comfortable')
        .addOption('compact', 'Compact')
        .addOption('gallery', 'Gallery')
        .addOption('list', 'List')
        .setValue(this.host.displayMode)
        .onChange((value) => {
          if (['compact', 'comfortable', 'gallery', 'list'].includes(value)) void this.host.setDisplayMode(value as OpenMarksSettingsHost['displayMode']).catch(showSettingsError);
        })); } },
        { name: 'Gallery previews', desc: 'OpenMarks does not download webpage preview images because Obsidian does not expose controls to restrict redirect destinations. Previews cached in this vault remain available.',
          render: () => { } },
      ] },
      { type: 'group' as const, heading: 'Favicons', items: [
        { name: 'Automatically retrieve favicons', desc: 'When enabled, OpenMarks contacts bookmarked websites to find and cache their icons. This may disclose your IP address and access timing. Disabling automatic retrieval does not remove cached icons.',
          render: (setting: Setting) => { setting.addToggle((toggle) => toggle.setValue(this.host.automaticFavicons).onChange((value) => void this.host.setAutomaticFavicons(value).catch(showSettingsError))); } },
        { name: 'Refresh cached favicons', desc: 'Refresh cached icons after this interval. Fresh local icons remain available offline.',
          render: (setting: Setting) => { setting.addDropdown((dropdown) => dropdown.addOption('7', '7 days').addOption('30', '30 days').addOption('60', '60 days').addOption('90', '90 days').setValue(String(this.host.faviconRefreshDays)).onChange((value) => void this.host.setFaviconRefreshDays(Number(value)).catch(showSettingsError))); } },
        { name: 'Download favicons during imports', desc: 'When disabled, imports use fallback icons. Automatic retrieval resumes after OpenMarks restarts, or you can request it with Refresh all favicons.',
          render: (setting: Setting) => { setting.addToggle((toggle) => toggle.setValue(this.host.faviconsDuringImport).onChange((value) => void this.host.setFaviconsDuringImport(value).catch(showSettingsError))); } },
        { name: 'Refresh all favicons', desc: '',
          render: (setting: Setting) => { setting.addButton(button => button.setButtonText('Refresh all favicons').onClick(() => this.host.manualRefreshFavicons())); } },
        { name: 'Clear favicon cache', desc: '',
          render: (setting: Setting) => { setting.addButton(button => button.setButtonText('Clear favicon cache').onClick(() => void this.host.clearFaviconCache().catch(showSettingsError))); } },
      ] },
      { type: 'group' as const, heading: 'Exports', items: [
        { name: 'Manage saved exports', desc: 'Review the number of OpenMarks exports in this vault and move them to the vault trash after confirmation.',
          render: (setting: Setting) => { setting.addButton((button) => button.setButtonText('Manage exports').onClick(() => new ExportCleanupModal(this.appInstance).open())); } },
      ] },
    ];
  }

  display(): void {
    this.containerEl.empty();
    for (const group of this.getSettingDefinitions()) {
      new Setting(this.containerEl).setName(group.heading).setHeading();
      for (const row of group.items) {
        row.render(new Setting(this.containerEl).setName(row.name).setDesc(row.desc));
      }
    }
  }
}

function showSettingsError(error: unknown): void {
  new Notice(`OpenMarks could not complete the settings change: ${String(error)}`);
}
