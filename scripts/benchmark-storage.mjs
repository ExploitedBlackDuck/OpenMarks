import esbuild from '../node_modules/esbuild/lib/main.js';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { searchBookmarks } from '../src/model.ts';
import { previewImport } from '../src/import-export.ts';
import { TFile } from '../tests/obsidian-mock.mjs';

await mkdir('.test-build', { recursive: true });
await esbuild.build({
  entryPoints: ['src/storage.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '.test-build/storage.mjs',
  plugins: [{ name: 'obsidian-test-api', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve('tests/obsidian-mock.mjs'), external: true }));
  } }],
});
const { BookmarkStore } = await import('../.test-build/storage.mjs');

function benchmarkApp() {
  const files = new Map(); const folders = new Set();
  const vault = {
    getMarkdownFiles: () => [...files.values()],
    getAbstractFileByPath: (path) => files.get(path) ?? (folders.has(path) ? { path } : null),
    cachedRead: async (file) => file.content,
    create: async (path, content) => {
      if (files.has(path)) throw new Error('File already exists.');
      const file = new TFile(path, content); files.set(path, file); return file;
    },
    createFolder: async (path) => { folders.add(path); },
    process: async (file, callback) => { file.content = callback(file.content); return file.content; },
  };
  const fileManager = {
    processFrontMatter: async () => {},
    trashFile: async (file) => { files.delete(file.path); },
  };
  return { app: { vault, fileManager } };
}

for (const count of [1_000, 5_000, 10_000]) {
  const { app } = benchmarkApp(); const store = new BookmarkStore(app);
  const drafts = Array.from({ length: count }, (_, index) => ({
    url: `https://site-${index}.example/articles/${index}#section-${index % 4}`,
    title: `Benchmark bookmark ${index}`,
    tags: [`batch-${index % 20}`],
    collection: `Batch/${index % 10}`,
  }));
  const importStart = performance.now();
  for (const draft of drafts) await store.create(draft);
  const importMs = performance.now() - importStart;

  const reloadStore = new BookmarkStore(app);
  const loadStart = performance.now(); await reloadStore.load();
  const loadMs = performance.now() - loadStart;

  const searchStart = performance.now();
  const matches = searchBookmarks(reloadStore.all(), { query: 'benchmark bookmark 999', sort: 'title' });
  const searchMs = performance.now() - searchStart;

  const rows = drafts.map((draft, index) => ({ draft, sourceLine: index + 1 }));
  const duplicateStart = performance.now();
  const preview = previewImport(rows, reloadStore.all());
  const duplicatePreviewMs = performance.now() - duplicateStart;

  console.log(JSON.stringify({ count, importMs: +importMs.toFixed(1), loadMs: +loadMs.toFixed(1), searchMs: +searchMs.toFixed(1), duplicatePreviewMs: +duplicatePreviewMs.toFixed(1), loaded: reloadStore.all().length, searchMatches: matches.length, duplicates: preview.duplicates.length }));
}
