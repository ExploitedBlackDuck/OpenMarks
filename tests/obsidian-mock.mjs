export class TFolder { constructor(path, children = []) { this.path = path; this.children = children; } }
export class TFile { constructor(path, content = '') { this.path = path; this.content = content; } }
export class ItemView { constructor(leaf) { this.leaf = leaf; this.contentEl = {}; } }
export class Modal { constructor(app) { this.app = app; } }
export class Menu { }
export class Notice { constructor(message) { this.message = message; } }
export class Setting { }
export function setIcon() { }
export function normalizePath(path) { return path.replace(/\\/g, '/').replace(/\/+/g, '/'); }
export function parseYaml(text) { return JSON.parse(text.trim()); }
export function stringifyYaml(value) { return JSON.stringify(value, null, 2); }
let requestHandler = async () => { throw new Error('No requestUrl mock was configured.'); };
export function setRequestUrlHandler(handler) { requestHandler = handler; }
export async function requestUrl(options) { return requestHandler(options); }
export class Plugin {}
export class PluginSettingTab {}
export const Platform={isDesktopApp:false};
