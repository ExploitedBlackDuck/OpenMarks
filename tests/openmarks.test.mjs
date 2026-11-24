import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBookmark, newBookmarkId, normalizeUrl, safeFilename, searchBookmarks } from '../.test-build/model.mjs';
import { isPublicWebUrl, safeFaviconBytes, sameOrigin } from '../.test-build/security.mjs';
import { exportCsv, exportJson, parseCsv, parseCsvBookmarks, parseBookmarkJson, parseMarkdownBookmarks, parsePlainTextUrls, previewImport, saveExportToVault } from '../.test-build/import-export.mjs';
import { createOpenOnce, favoriteButtonAccessibility, faviconInitials, isCardEnter, navigationCurrentAttribute, visibleTags } from '../.test-build/ui-behavior.mjs';

test('URL normalization and unsafe scheme rejection', () => {
  assert.equal(normalizeUrl('example.org#top'), 'https://example.org/#top');
  assert.equal(normalizeUrl('http://example.org/a#part'), 'http://example.org/a#part');
  assert.throws(() => normalizeUrl('file:///etc/passwd'));
  assert.throws(() => normalizeUrl('https://user:pass@example.org'));
});

test('new IDs are unique, opaque, and independent of URL identity', () => {
  const first = makeBookmark({ url: 'https://example.org/a' });
  const second = makeBookmark({ url: 'https://example.org/a' });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  assert.notEqual(first.id, second.id);
  assert.notEqual(newBookmarkId(), newBookmarkId());
});

test('bookmark defaults, tag normalization, and safe filenames', () => {
  const item = makeBookmark({ url: 'https://example.org', tags: ['x', 'x', ' y '] });
  assert.deepEqual(item.tags, ['x', 'y']); assert.equal(item.status, 'unread'); assert.equal(item.domain, 'example.org'); assert.equal(item.title, 'example.org');
  assert.equal(safeFilename('../a:b?*', '1234'), 'ab 1234.md');
  assert.equal(safeFilename('Same title', '../other/file'), 'Same title otherfile.md');
  assert.ok(safeFilename('x'.repeat(200), 'id').length < 100);
});

test('new UUID filenames use a short suffix while bookmark IDs remain independent', () => {
  const id = 'd2a5f544-2b42-4b50-b53f-9053493abd01';
  assert.equal(safeFilename('Readable title', id), 'Readable title d2a5f544.md');
  assert.equal(makeBookmark({ url: 'https://stable-filename.example', id }).id, id);
});

test('search covers notes, tags, descriptions, and nested collections', () => {
  const a = makeBookmark({ url: 'https://example.org', title: 'Docs', collection: 'Dev/Obsidian', tags: ['API'], description: 'Plugin help', notes: 'official manual' });
  const b = makeBookmark({ url: 'https://other.org', title: 'Other', collection: 'Personal' });
  assert.equal(searchBookmarks([a, b], { query: 'official api' }).length, 1);
  assert.equal(searchBookmarks([a, b], { collection: 'Dev' }).length, 1);
  assert.equal(searchBookmarks([a, b], { tag: 'api' }).length, 1);
});

test('local search finds the right record in a 2,500-bookmark library', () => {
  const library = Array.from({ length: 2499 }, (_, i) => makeBookmark({ url: `https://site-${i}.example`, title: `Entry ${i}` }));
  library.push(makeBookmark({ url: 'https://target.example', title: 'Local security playbook', tags: ['incident response'] }));
  const start = performance.now(); const results = searchBookmarks(library, { query: 'security incident' });
  assert.equal(results.length, 1); assert.equal(results[0].domain, 'target.example');
  assert.ok(performance.now() - start < 1000, 'local search should remain responsive at this size');
});

test('network validation rejects local and private targets', () => {
  for (const url of ['http://127.0.0.1', 'http://127.1', 'http://192.168.1.2', 'http://localhost.', 'http://printer.local', 'http://[::1]', 'http://[ff02::1]', 'http://[ff0e::1]', 'http://[::ffff:127.0.0.1]', 'file:///tmp/a']) assert.equal(isPublicWebUrl(url), false, url);
  assert.equal(isPublicWebUrl('https://example.org'), true);
  assert.equal(sameOrigin('https://example.org/icon.png', 'https://example.org/page'), true);
  assert.equal(sameOrigin('https://cdn.example.org/icon.png', 'https://example.org/page'), false);
});

test('favicon format validation rejects all SVG favicons', () => {
  const unsafe = new TextEncoder().encode('<svg onload="alert(1)"></svg>').buffer;
  const external = new TextEncoder().encode('<svg><style>@import url(https://evil.example/a.css)</style></svg>').buffer;
  const safe = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>').buffer;
  assert.equal(safeFaviconBytes(unsafe, 'image/svg+xml'), null);
  assert.equal(safeFaviconBytes(external, 'image/svg+xml'), null);
  assert.equal(safeFaviconBytes(safe, 'image/svg+xml'), null);
});

test('image validation supports the separate 500 KB preview limit', () => {
  const image = new Uint8Array(220_000);
  image.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(safeFaviconBytes(image.buffer, 'image/png', 500_000)?.extension, 'png');
  const oversized = new Uint8Array(500_001);
  oversized.set(image.slice(0, 8));
  assert.equal(safeFaviconBytes(oversized.buffer, 'image/png', 500_000), null);
});

test('CSV parser supports quoted commas and newlines', () => {
  assert.deepEqual(parseCsv('url,title,description\nhttps://a.test,"A, title","line 1\nline 2"')[1], ['https://a.test', 'A, title', 'line 1\nline 2']);
  const rows = parseCsvBookmarks('title,url,collection,tags\nDocs,https://docs.example,Work/Docs,"a|b"');
  assert.equal(rows[0].draft.collection, 'Work/Docs'); assert.deepEqual(rows[0].draft.tags, ['a', 'b']);
});

test('JSON/Anybox-like import and duplicate preview are non-destructive', () => {
  const rows = parseBookmarkJson(JSON.stringify({ bookmarks: [{ url: 'https://a.test', title: 'A', folder: 'Read later', tags: ['x'] }] }));
  assert.equal(rows[0].draft.collection, 'Read later');
  const existing = makeBookmark({ url: 'https://saved.example' });
  const preview = previewImport([{ draft: { url: 'https://saved.example' }, sourceLine: 1 }, { draft: { url: 'javascript:alert(1)' }, sourceLine: 2 }, { draft: { url: 'https://new.example' }, sourceLine: 3 }], [existing]);
  assert.equal(preview.rows.length, 1); assert.equal(preview.duplicates.length, 1); assert.equal(preview.invalid.length, 1);
});

test('plain URL lists and Markdown bookmark notes import locally', () => {
  assert.equal(parsePlainTextUrls('https://one.example\n- https://two.example').length, 2);
  const row = parseMarkdownBookmarks('---\ntype: bookmark\ntitle: "A title"\nurl: "https://a.example"\ncollection: "Work/Notes"\ntags:\n  - "x"\nfavorite: true\n---\nBody notes')[0];
  assert.equal(row.draft.title, 'A title'); assert.deepEqual(row.draft.tags, ['x']); assert.equal(row.draft.notes, 'Body notes');
});

test('exports round-trip friendly CSV and JSON without local note paths', () => {
  const item = { ...makeBookmark({ url: 'https://a.test', title: 'A,"B', tags: ['one'] }), path: '_openmarks/bookmarks/a.md' };
  const csv = exportCsv([item]); assert.ok(csv.includes('"A,""B"'));
  const csvAgain = parseCsvBookmarks(csv)[0].draft;
  assert.equal(csvAgain.title, item.title); assert.deepEqual(csvAgain.tags, item.tags); assert.equal(csvAgain.url, item.url);
  const jsonAgain = parseBookmarkJson(exportJson([item]))[0].draft;
  assert.equal(jsonAgain.title, item.title); assert.deepEqual(jsonAgain.tags, item.tags); assert.equal(jsonAgain.url, item.url);
  assert.equal(JSON.parse(exportJson([item]))[0].path, undefined);
  assert.equal('preview_image' in JSON.parse(exportJson([item]))[0], false);
  assert.equal('preview_source' in JSON.parse(exportJson([item]))[0], false);
});

test('export files are written into the vault for platform-independent retrieval', async () => {
  const folders = []; const files = [];
  const vault = { async createFolder(path) { folders.push(path); }, adapter: { async exists() { return false; } }, async create(path, text) { files.push({ path, text }); return { path }; } };
  const path = await saveExportToVault(vault, 'json', '[{"url":"https://example.org"}]', 1763850000000);
  assert.match(path, /^_openmarks\/exports\/openmarks-export-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(path.endsWith('.json'));
  assert.deepEqual(folders, ['_openmarks', '_openmarks/exports']);
  assert.equal(files[0].path, path);
  assert.equal(files[0].text, '[{"url":"https://example.org"}]');
});

test('export filenames add a readable collision suffix and preserve prior files', async () => {
  const checked = []; const created = [];
  const vault = {
    async createFolder() {},
    adapter: { async exists(path) { checked.push(path); return path.endsWith('2026-11-23.html'); } },
    async create(path) { created.push(path); return { path }; },
  };
  const path = await saveExportToVault(vault, 'html', '<html></html>', new Date(2026, 10, 23, 12).getTime());
  assert.equal(path, '_openmarks/exports/openmarks-export-2026-11-23-2.html');
  assert.deepEqual(created, [path]);
  assert.equal(checked.length, 2);
});

test('concurrent exports retry when another export wins the filename race', async () => {
  const files = new Set();
  const vault = {
    async createFolder() {},
    adapter: { async exists(path) { return files.has(path); } },
    async create(path) { if (files.has(path)) throw new Error('already exists'); files.add(path); return { path }; },
  };
  const timestamp = new Date(2026, 10, 23, 12).getTime();
  const paths = await Promise.all([
    saveExportToVault(vault, 'csv', 'first', timestamp),
    saveExportToVault(vault, 'csv', 'second', timestamp),
  ]);
  assert.deepEqual(new Set(paths), new Set([
    '_openmarks/exports/openmarks-export-2026-11-23.csv',
    '_openmarks/exports/openmarks-export-2026-11-23-2.csv',
  ]));
});

test('CSV export marks formula-like bookmark text as plain text', () => {
  const item = { ...makeBookmark({ url: 'https://a.test', title: '=HYPERLINK("https://evil.test")' }), path: '' };
  const csv = exportCsv([item]);
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://evil.test\"\")\""));
});

test('favorite controls expose both an action label and pressed state', () => {
  assert.deepEqual(favoriteButtonAccessibility('Research notes', false), { label: 'Add Research notes to favorites', pressed: 'false' });
  assert.deepEqual(favoriteButtonAccessibility('Research notes', true), { label: 'Remove Research notes from favorites', pressed: 'true' });
});

test('navigation state exposes the active item to assistive technology', () => {
  assert.equal(navigationCurrentAttribute(true), 'page');
  assert.equal(navigationCurrentAttribute(false), 'false');
});

test('bookmark click activation opens once and stops event propagation', () => {
  let opened = 0; let release;
  const activate = createOpenOnce(() => { opened++; }, (callback) => { release = callback; });
  const event = () => { let prevented = false; let stopped = false; activate({ preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } }); return { prevented, stopped }; };
  assert.deepEqual(event(), { prevented: true, stopped: true });
  event(); assert.equal(opened, 1);
  release(); event(); assert.equal(opened, 2);
});

test('card Enter activation ignores nested controls', () => {
  const card = {}; const nestedButton = {};
  assert.equal(isCardEnter('Enter', card, card), true);
  assert.equal(isCardEnter('Enter', nestedButton, card), false);
  assert.equal(isCardEnter(' ', card, card), false);
});

test('favicon fallbacks use recognizable title or host identities and tags can be capped', () => {
  assert.equal(faviconInitials('Documentation', 'docs.github.com'), 'GH');
  assert.equal(faviconInitials('Docs', 'doc.rust-lang.org'), 'RU');
  assert.equal(faviconInitials('Example', 'example.co.uk'), 'EX');
  assert.deepEqual(visibleTags(['one', 'two', 'three', 'four']), { visible: ['one', 'two', 'three'], remaining: 1 });
});

test('Recently opened only includes bookmarks with an open timestamp', () => {
  const opened=makeBookmark({url:'https://example.org/a',last_opened:'2026-11-20T00:00:00Z'});
  const unopened=makeBookmark({url:'https://example.org/b'});
  assert.deepEqual(searchBookmarks([unopened,opened],{openedOnly:true}),[opened]);
});

test('fc and fd DNS labels are eligible while IPv6 local addresses are blocked', () => {
  for (const domain of ['fda.gov','fcc.gov','fdic.gov','fdroid.org']) assert.ok(isPublicWebUrl('https://'+domain));
  for (const ip of ['fc00::1','fd12::1','febf::1']) assert.equal(isPublicWebUrl('http://['+ip+']'),false);
});

test('raster responses require matching signatures, including the WebP container type', () => {
  const bytes=new TextEncoder().encode('RIFFxxxxWAVEfmt ').buffer;
  for (const mime of ['image/png','image/jpeg','image/x-icon','image/gif','image/webp']) {
    assert.equal(safeFaviconBytes(bytes,mime),null);
  }
  const png=Uint8Array.from([137,80,78,71,13,10,26,10]).buffer;
  assert.equal(safeFaviconBytes(png,'image/jpeg'),null);
});

test('CSV link headers are accepted and bookmark favicon references are local paths', () => {
  assert.equal(parseCsvBookmarks('LINK,title\nhttps://example.org,Example')[0].draft.url,'https://example.org');
  for (const value of ['https://example.org/icon.png','../x.png','/absolute.png','a/../x.png','data:image/png']) {
    assert.equal(makeBookmark({url:'https://example.org',favicon:value}).favicon,'');
  }
  assert.equal(makeBookmark({url:'https://example.org',favicon:'Attachments/icon.png'}).favicon,'Attachments/icon.png');
});
