import { PluginSettingTab, Setting } from 'obsidian';
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Bookmarks').setHeading();
    new Setting(containerEl)
      .setName('Bookmark folder')
      .setDesc('Bookmark notes are stored in _openmarks/bookmarks in this vault. Moving the folder requires a verified migration, so its location is fixed for now.');
    new Setting(containerEl)
      .setName('Default collection')
      .setDesc('Collection assigned to new bookmarks when you leave the collection field blank.')
      .addText((text) => text.setValue(this.host.defaultCollection).setPlaceholder('Unsorted').onChange((value) => void this.host.setDefaultCollection(value)));
    new Setting(containerEl)
      .setName('Default display')
      .setDesc('Choose the layout used when the bookmark manager opens.')
      .addDropdown((dropdown) => dropdown
        .addOption('comfortable', 'Comfortable')
        .addOption('compact', 'Compact')
        .addOption('gallery', 'Gallery')
        .addOption('list', 'List')
        .setValue(this.host.displayMode)
        .onChange((value) => {
          if (['compact', 'comfortable', 'gallery', 'list'].includes(value)) void this.host.setDisplayMode(value as OpenMarksSettingsHost['displayMode']);
        }));
    new Setting(containerEl)
      .setName('Gallery previews')
      .setDesc('OpenMarks does not download webpage preview images because Obsidian does not expose controls to restrict redirect destinations. Previews cached in this vault remain available.');
    new Setting(containerEl).setName('Favicons').setHeading();
    new Setting(containerEl)
      .setName('Automatically retrieve favicons')
      .setDesc('When enabled, OpenMarks contacts bookmarked websites to find and cache their icons. This may disclose your IP address and access timing. Disabling automatic retrieval does not remove cached icons.')
      .addToggle((toggle) => toggle.setValue(this.host.automaticFavicons).onChange((value) => void this.host.setAutomaticFavicons(value)));
    new Setting(containerEl)
      .setName('Refresh cached favicons')
      .setDesc('Refresh cached icons after this interval. Fresh local icons remain available offline.')
      .addDropdown((dropdown) => dropdown.addOption('7', '7 days').addOption('30', '30 days').addOption('60', '60 days').addOption('90', '90 days').setValue(String(this.host.faviconRefreshDays)).onChange((value) => void this.host.setFaviconRefreshDays(Number(value))));
    new Setting(containerEl)
      .setName('Download favicons during imports')
      .setDesc('When disabled, imports use fallback icons. Automatic retrieval resumes after OpenMarks restarts, or you can request it with Refresh all favicons.')
      .addToggle((toggle) => toggle.setValue(this.host.faviconsDuringImport).onChange((value) => void this.host.setFaviconsDuringImport(value)));
    const actions = containerEl.createDiv({ cls: 'openmarks-settings-actions' });
    actions.createEl('button', { text: 'Refresh all favicons' }).addEventListener('click', () => this.host.manualRefreshFavicons());
    actions.createEl('button', { text: 'Clear favicon cache' }).addEventListener('click', () => void this.host.clearFaviconCache());
    new Setting(containerEl).setName('Exports').setHeading();
    new Setting(containerEl)
      .setName('Manage saved exports')
      .setDesc('Review the number of OpenMarks exports in this vault and move them to the vault trash after confirmation.')
      .addButton((button) => button.setButtonText('Manage exports').onClick(() => new ExportCleanupModal(this.appInstance).open()));
  }
}
