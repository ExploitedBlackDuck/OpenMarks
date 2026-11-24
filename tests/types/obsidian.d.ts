/* Minimal compile-time surface for the official Obsidian API.
   Runtime imports remain external and are supplied by Obsidian. */
declare module 'obsidian' {
  export class TAbstractFile { path: string; }
  export class TFolder extends TAbstractFile { children: TAbstractFile[]; }
  export class TFile extends TAbstractFile { }
  export interface FrontMatterCache { [key: string]: any; }
  export interface Vault {
    configDir: string;
    getMarkdownFiles(): TFile[];
    getFiles(): TFile[];
    getAbstractFileByPath(path: string): TAbstractFile | null;
    getResourcePath(file: TFile): string;
    cachedRead(file: TFile): Promise<string>;
    process(file: TFile, callback: (data: string) => string): Promise<string>;
    create(path: string, data: string): Promise<TFile>;
    createFolder(path: string): Promise<void>;
    adapter: { read(path: string): Promise<string>; writeBinary(path: string, data: ArrayBuffer): Promise<void>; exists(path: string): Promise<boolean>; remove(path: string): Promise<void> };
    on(name: 'create' | 'modify' | 'delete', callback: (file: TAbstractFile) => void): EventRef;
    on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => void): EventRef;
  }
  export interface FileManager {
    processFrontMatter(file: TFile, callback: (frontmatter: FrontMatterCache) => void): Promise<void>;
    trashFile(file: TFile): Promise<void>;
  }
  export interface MetadataCache { on(name: string, callback: (file: TFile) => void): EventRef; }
  export class WorkspaceLeaf { view: ItemView; setViewState(state: any): Promise<void>; openFile(file: TFile): Promise<void>; }
  export interface Workspace {
    getLeavesOfType(type: string): WorkspaceLeaf[];
    getLeaf(mode?: string): WorkspaceLeaf;
    getRightLeaf( split: boolean): WorkspaceLeaf | null;
    revealLeaf(leaf: WorkspaceLeaf): void;
    onLayoutReady(callback: () => void): void;
  }
  export interface App { vault: Vault; fileManager: FileManager; metadataCache: MetadataCache; workspace: Workspace; }
  export class Plugin {
    app: App;
    manifest: { id: string; dir?: string };
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    registerView(type: string, factory: (leaf: WorkspaceLeaf) => ItemView): void;
    addCommand(command: { id: string; name: string; callback: () => void }): void;
    addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
    addSettingTab(tab: PluginSettingTab): void;
    registerEvent(event: EventRef): void;
    onload(): Promise<void> | void;
  }
  export class ItemView {
    app: App; contentEl: HTMLElement;
    constructor(leaf: WorkspaceLeaf);
    getViewType(): string; getDisplayText(): string; getIcon(): string;
    onOpen(): Promise<void> | void; onClose(): Promise<void> | void;
  }
  export class Modal {
    app: App; modalEl: HTMLElement; contentEl: HTMLElement; titleEl: HTMLElement;
    constructor(app: App); open(): void; close(): void; onOpen(): void; onClose(): void;
  }
  export class Menu {
    addItem(callback: (item: MenuItem) => void): this;
    showAtMouseEvent(event: MouseEvent): void;
    showAtPosition(position: { x: number; y: number }): void;
  }
  export interface MenuItem { setTitle(title: string): this; setIcon(icon: string): this; onClick(callback: () => void): this; }
  export interface TextComponent { inputEl: HTMLInputElement; setPlaceholder(value: string): this; setValue(value: string): this; onChange(callback: (value: string) => void): this; }
  export interface TextAreaComponent { inputEl: HTMLTextAreaElement; setPlaceholder(value: string): this; setValue(value: string): this; onChange(callback: (value: string) => void): this; }
  export interface DropdownComponent { addOption(value: string, display: string): this; setValue(value: string): this; onChange(callback: (value: string) => void): this; }
  export interface ToggleComponent { setValue(value: boolean): this; onChange(callback: (value: boolean) => void): this; }
  export interface ButtonComponent { setButtonText(value: string): this; onClick(callback: () => void): this; }
  export class Setting {
    constructor(container: HTMLElement); setName(name: string): this; setDesc(description: string): this; setHeading(): this;
    addText(callback: (component: TextComponent) => void): this;
    addTextArea(callback: (component: TextAreaComponent) => void): this;
    addDropdown(callback: (component: DropdownComponent) => void): this;
    addToggle(callback: (component: ToggleComponent) => void): this;
    addButton(callback: (component: ButtonComponent) => void): this;
  }
  export class PluginSettingTab { containerEl: HTMLElement; constructor(app: App, plugin: Plugin); display(): void; }
  export class Notice { constructor(message: string, timeout?: number); }
  export interface EventRef { }
  export function setIcon(element: HTMLElement, icon: string): void;
  export const Platform: { isDesktopApp: boolean; isIosApp: boolean; isAndroidApp: boolean };
  export function normalizePath(path: string): string;
  export function parseYaml(text: string): unknown;
  export function stringifyYaml(value: unknown): string;
  export function requestUrl(params: { url: string; method?: string; headers?: Record<string, string>; throw?: boolean; contentType?: string }): Promise<{ status: number; text: Promise<string>; arrayBuffer: Promise<ArrayBuffer>; headers: Record<string, string> }>;
}
interface HTMLElement {
    empty(): void; addClass(...classes: string[]): void; setText(text: string): void; appendText(text: string): void;
    createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;
    createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K];
}
