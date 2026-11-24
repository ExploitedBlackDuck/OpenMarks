import test from 'node:test';
import assert from 'node:assert/strict';
import { BookmarkStore } from '../.test-build/storage.mjs';
import { TFile, TFolder } from './obsidian-mock.mjs';

function fakeApp() {
  const files = new Map(); const trash = new Set(); const folders = new Set();
  let beforeProcessFrontMatter = null;
  let readFailures = 0;
  const vault = {
    getAbstractFileByPath: (path) => files.get(path) ?? (folders.has(path) || path === '_openmarks/bookmarks' ? new TFolder(path, [...files.values()].filter(file => file.path.startsWith(path + '/'))) : null),
    cachedRead: async (file) => { if (readFailures > 0) { readFailures--; throw new Error('simulated read-back failure'); } return file.content; },
    create: async (path, content) => { if (files.has(path)) throw new Error('File already exists.'); const file = new TFile(path, content); files.set(path, file); return file; },
    createFolder: async (path) => { folders.add(path); },
    process: async (file, callback) => { file.content = callback(file.content); return file.content; },
  };
  const fileManager = {
    processFrontMatter: async (file, callback) => {
      await beforeProcessFrontMatter?.(file);
      const match = file.content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      const frontmatter = match ? JSON.parse(match[1]) : {};
      const body = match?.[2] ?? file.content;
      callback(frontmatter);
      file.content = `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${body}`;
    },
    trashFile: async (file) => { files.delete(file.path); trash.add(file.path); },
  };
  return { app: { vault, fileManager }, files, trash, setBeforeProcessFrontMatter(callback) { beforeProcessFrontMatter = callback; }, setReadFailures(count) { readFailures = count; } };
}

test('bookmark store creates, updates, reloads, and trashes Markdown notes', async () => {
  const { app, files, trash } = fakeApp(); const store = new BookmarkStore(app);
  const first = await store.create({ url: 'https://example.org', title: 'Example', collection: 'Work/Reading', tags: ['one'], notes: 'First note body' });
  assert.equal(files.size, 1); assert.ok(first.path.startsWith('_openmarks/bookmarks/'));
  const file = files.get(first.path);
  assert.match(file.content, /First note body/);
  file.content = file.content.replace('First note body', 'External edit').replace('"title": "Example"', '"title": "Edited in Obsidian"').replace('"tags": [\n    "one"\n  ]', '"tags": [\n    "one"\n  ],\n  "custom": "preserve me"');
  const afterExternalEdit = await store.refreshFromFile(file);
  assert.equal(afterExternalEdit.title, 'Edited in Obsidian');
  await store.update(first.id, { description: 'Updated description', notes: 'New notes' });
  assert.match(file.content, /"custom": "preserve me"/);
  assert.match(file.content, /New notes/);
  assert.doesNotMatch(file.content, /External edit/);
  const restarted = new BookmarkStore(app); await restarted.load();
  assert.equal(restarted.all().length, 1);
  assert.equal(restarted.all()[0].description, 'Updated description');
  await restarted.delete(first.id);
  assert.equal(restarted.all().length, 0); assert.equal(trash.size, 1);
});

test('duplicate URLs are rejected and never overwrite existing notes', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  await store.create({ url: 'https://example.org/#one', title: 'Existing' });
  await assert.rejects(store.create({ url: 'https://example.org/#one', title: 'Replacement' }), /already saved/);
  assert.equal(files.size, 1);
  assert.match([...files.values()][0].content, /Existing/);
});

test('different URL fragments remain distinct and the URL index follows updates and deletes', async () => {
  const { app } = fakeApp(); const store = new BookmarkStore(app);
  const first = await store.create({ url: 'https://example.org/guide#install' });
  const second = await store.create({ url: 'https://example.org/guide#configure' });
  assert.equal(store.findAllByUrl('https://example.org/guide#install').length, 1);
  assert.equal(store.findAllByUrl('https://example.org/guide#configure').length, 1);
  await store.update(first.id, { url: 'https://new.example/guide#install' });
  assert.equal(store.findByUrl(first.url), undefined);
  assert.equal(store.findByUrl('https://new.example/guide#install')?.id, first.id);
  await store.delete(second.id);
  assert.equal(store.findByUrl(second.url), undefined);
});

test('safe filename allocation does not overwrite an existing note', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  const original = new TFile('_openmarks/bookmarks/Same title fixed.md', 'unrelated note'); files.set(original.path, original);
  const saved = await store.create({ id: 'fixed', url: 'https://new.example', title: 'Same title' });
  assert.equal(saved.path, '_openmarks/bookmarks/Same title fixed (2).md');
  assert.equal(original.content, 'unrelated note');
  assert.equal(files.size, 2);
});

test('malformed bookmark frontmatter remains on disk and appears in recoverable issues', async () => {
  const { app, files } = fakeApp();
  const malformed = new TFile('_openmarks/bookmarks/Broken.md', '---\ntype: bookmark\nurl: [broken\n---\nKeep this note');
  files.set(malformed.path, malformed);
  const goodStore = new BookmarkStore(app);
  await goodStore.create({ url: 'https://valid.example' });
  const store = new BookmarkStore(app); await store.load();
  assert.equal(store.all().length, 1);
  assert.equal(store.issues.length, 1);
  assert.equal(store.issues[0].path, malformed.path);
  assert.match(store.issues[0].reason, /Invalid YAML/);
  assert.match(malformed.content, /Keep this note/);
});

test('external frontmatter changes survive an unrelated OpenMarks update', async () => {
  const { app, files, setBeforeProcessFrontMatter } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://example.org', title: 'Original' });
  const file = files.get(item.path);
  setBeforeProcessFrontMatter(async (target) => {
    const match = target.content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const metadata = JSON.parse(match[1]); metadata.title = 'Edited directly in Obsidian';
    target.content = `---\n${JSON.stringify(metadata, null, 2)}\n---\n${match[2]}`;
  });
  const updated = await store.update(item.id, { description: 'Changed in OpenMarks' });
  assert.equal(updated.title, 'Edited directly in Obsidian');
  assert.equal(updated.description, 'Changed in OpenMarks');
  assert.equal(file.content.includes('Edited directly in Obsidian'), true);
});

test('a concurrent edit to the same property aborts instead of overwriting the external change', async () => {
  const { app, files, setBeforeProcessFrontMatter } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://same-field.example', title: 'Before' });
  const file = files.get(item.path);
  setBeforeProcessFrontMatter(async (target) => {
    const match = target.content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const metadata = JSON.parse(match[1]); metadata.title = 'External title';
    target.content = `---\n${JSON.stringify(metadata, null, 2)}\n---\n${match[2]}`;
  });
  await assert.rejects(store.update(item.id, { title: 'OpenMarks title' }), /changed outside OpenMarks/);
  assert.equal(store.get(item.id).title, 'External title');
  assert.match(file.content, /External title/);
  assert.doesNotMatch(file.content, /OpenMarks title/);
});

test('editing a bookmark preserves a note-body change made while the editor was open', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://notes-conflict.example', notes: 'Original research notes' });
  const file = files.get(item.path);
  file.content = file.content.replace('Original research notes', 'Notes edited directly in Obsidian');

  await assert.rejects(
    store.update(item.id, { notes: 'Stale dialog text' }, item.notes),
    /note body changed outside OpenMarks/,
  );
  assert.match(file.content, /Notes edited directly in Obsidian/);
  assert.doesNotMatch(file.content, /Stale dialog text/);
});

test('a note-body edit between the metadata write and body write is preserved', async () => {
  const { app, files, setBeforeProcessFrontMatter } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://notes-race.example', notes: 'Original body' });
  const file = files.get(item.path);
  setBeforeProcessFrontMatter(async (target) => {
    target.content = target.content.replace('Original body', 'Concurrent external body');
  });

  await assert.rejects(store.update(item.id, { title: 'New title', notes: 'OpenMarks body' }), /note body changed while OpenMarks was saving/);
  assert.match(file.content, /Concurrent external body/);
  assert.doesNotMatch(file.content, /OpenMarks body/);
  assert.equal(store.get(item.id).notes.trimEnd(), 'Concurrent external body');
});

test('manual duplicate URLs are retained and reported instead of overwriting either note', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  const first = await store.create({ id: 'first-id', url: 'https://duplicate.example', title: 'First' });
  const second = await store.create({ id: 'second-id', url: 'https://other.example', title: 'Second' });
  const secondFile = files.get(second.path);
  secondFile.content = secondFile.content.replace('https://other.example/', 'https://duplicate.example/');
  await store.refreshFromFile(secondFile);
  assert.equal(store.all().length, 2);
  assert.equal(store.findAllByUrl('https://duplicate.example').length, 2);
  assert.equal(store.issues.filter((issue) => issue.kind === 'duplicate-url').length, 1);
  assert.equal(first.title, 'First');
});

test('duplicate URL owner is deterministic regardless of note load order', async () => {
  const { app, files } = fakeApp();
  const later = { type: 'bookmark', id: 'z-later', title: 'Later', url: 'https://ordered-duplicate.example', created: '2026-01-02' };
  const earlier = { type: 'bookmark', id: 'a-earlier', title: 'Earlier', url: 'https://ordered-duplicate.example', created: '2025-12-30' };
  files.set('_openmarks/bookmarks/later.md', new TFile('_openmarks/bookmarks/later.md', `---\n${JSON.stringify(later)}\n---\n`));
  files.set('_openmarks/bookmarks/earlier.md', new TFile('_openmarks/bookmarks/earlier.md', `---\n${JSON.stringify(earlier)}\n---\n`));
  const store = new BookmarkStore(app); await store.load();
  assert.equal(store.findByUrl(earlier.url)?.id, 'a-earlier');
  assert.equal(store.issues.find((issue) => issue.kind === 'duplicate-url')?.path, '_openmarks/bookmarks/later.md');
  assert.match(store.issues.find((issue) => issue.kind === 'duplicate-url')?.reason ?? '', /Earlier/);
});

test('external rename updates the indexed path, and move outside OpenMarks removes the record', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://move.example' });
  const file = files.get(item.path); const oldPath = file.path; const movedPath = '_openmarks/bookmarks/Renamed.md';
  files.delete(oldPath); file.path = movedPath; files.set(movedPath, file);
  await store.handleRename(file, oldPath);
  assert.equal(store.get(item.id)?.path, movedPath);
  files.delete(movedPath); const outside = '_notes/Renamed.md'; file.path = outside; files.set(outside, file);
  await store.handleRename(file, movedPath);
  assert.equal(store.get(item.id), undefined);
});

test('simultaneous updates serialize and keep both patches', async () => {
  const { app } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://concurrent.example' });
  await Promise.all([store.update(item.id, { title: 'Concurrent title' }), store.update(item.id, { favorite: true })]);
  const saved = store.get(item.id);
  assert.equal(saved.title, 'Concurrent title');
  assert.equal(saved.favorite, true);
});

test('legacy IDs and filenames survive load and update', async () => {
  const { app, files } = fakeApp();
  const path = '_openmarks/bookmarks/Hand named bookmark.md';
  const metadata = { type: 'bookmark', id: 'existing-id-42', title: 'Old title', url: 'https://legacy.example', tags: [], favorite: false, status: 'read' };
  const file = new TFile(path, `---\n${JSON.stringify(metadata, null, 2)}\n---\nExisting body\n`); files.set(path, file);
  const store = new BookmarkStore(app); await store.load();
  const item = store.get('existing-id-42');
  assert.equal(item.path, path);
  const updated = await store.update(item.id, { description: 'Updated safely' });
  assert.equal(updated.id, 'existing-id-42');
  assert.equal(updated.path, path);
  assert.match(file.content, /Existing body/);
});

test('configured default collection is used when a new bookmark omits its collection', async () => {
  const { app } = fakeApp(); const store = new BookmarkStore(app, 'Reading/Queue');
  const saved = await store.create({ url: 'https://default-collection.example' });
  assert.equal(saved.collection, 'Reading/Queue');
});

test('new bookmark notes omit operational favicon validators while keeping portable icon paths', async () => {
  const { app } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://old.example/page', favicon: '_openmarks/favicons/site.ico', favicon_source: 'https://old.example/favicon.ico', favicon_checked_at: '2026-11-23T12:00:00.000Z', favicon_retry_at: '', favicon_etag: '"abc"', favicon_last_modified: 'Sun, 22 Nov 2026 12:00:00 GMT', favicon_failed_attempts: 0 });
  assert.equal(item.favicon, '_openmarks/favicons/site.ico');
  const restarted = new BookmarkStore(app); await restarted.load();
  assert.equal(restarted.get(item.id).favicon_etag, '');
  assert.equal(restarted.get(item.id).favicon_checked_at, '');
  const moved = await restarted.update(item.id, { url: 'https://new.example/page' });
  assert.equal(moved.favicon, ''); assert.equal(moved.favicon_source, '');
  assert.equal(moved.favicon_checked_at, ''); assert.equal(moved.favicon_etag, '');
  assert.equal(moved.favicon_failed_attempts, 0);
});

test('legacy favicon cache migration strips only operational properties and preserves notes and custom metadata', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://legacy-cache.example', notes: 'User-authored notes' });
  const file = files.get(item.path);
  const note = file.content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const fm = JSON.parse(note[1]);
  Object.assign(fm, { favicon: '_openmarks/favicons/site-legacy.png', favicon_source: 'https://legacy-cache.example/favicon.ico', favicon_checked_at: '2026-11-20T00:00:00.000Z', favicon_etag: 'tag-1', custom_property: 'keep this' });
  file.content = `---\n${JSON.stringify(fm, null, 2)}\n---\n${note[2]}`;
  await store.refreshFromFile(file);
  const failed = await store.stripLegacyFaviconMetadata([item.path]);
  assert.deepEqual(failed, []);
  assert.doesNotMatch(file.content, /favicon_source|favicon_checked_at|favicon_etag/);
  assert.match(file.content, /"custom_property": "keep this"/);
  assert.match(file.content, /_openmarks\/favicons\/site-legacy\.png/);
  assert.match(file.content, /User-authored notes/);
  const once = file.content;
  assert.deepEqual(await store.stripLegacyFaviconMetadata([item.path]), []);
  assert.equal(file.content, once);
});

test('a manually edited duplicate warning clears when the note is corrected', async () => {
  const { app, files } = fakeApp(); const store = new BookmarkStore(app);
  await store.create({ id: 'one', url: 'https://same.example', title: 'One' });
  const two = await store.create({ id: 'two', url: 'https://other.example', title: 'Two' });
  const file = files.get(two.path);
  file.content = file.content.replace('https://other.example/', 'https://same.example/');
  await store.refreshFromFile(file);
  assert.equal(store.issues.some((issue) => issue.kind === 'duplicate-url'), true);
  file.content = file.content.replace('https://same.example/', 'https://corrected.example/');
  await store.refreshFromFile(file);
  assert.equal(store.issues.some((issue) => issue.kind === 'duplicate-url'), false);
  assert.equal(store.findByUrl('https://corrected.example')?.id, 'two');
});

test('failed metadata writes leave the in-memory record and note unchanged', async () => {
  const { app, files, setBeforeProcessFrontMatter } = fakeApp(); const store = new BookmarkStore(app);
  const item = await store.create({ url: 'https://write-failure.example', title: 'Before' });
  const file = files.get(item.path); const previousContent = file.content;
  setBeforeProcessFrontMatter(async () => { throw new Error('simulated write failure'); });
  await assert.rejects(store.update(item.id, { title: 'After' }), /simulated write failure/);
  assert.equal(store.get(item.id).title, 'Before');
  assert.equal(file.content, previousContent);
});

test('a bookmark created during a failed read-back stays recoverable and indexed on retry', async () => {
  const { app, files, setReadFailures } = fakeApp(); const store = new BookmarkStore(app);
  setReadFailures(1);
  const item = await store.create({ url: 'https://read-back-retry.example' });
  assert.equal(store.get(item.id)?.path, item.path);
  assert.equal(store.findByUrl(item.url)?.id, item.id);
  assert.equal(store.issues.length, 0);

  setReadFailures(2);
  await assert.rejects(store.create({ url: 'https://read-back-recovery.example' }), /preserved and added to the recovery list/);
  assert.equal(files.size, 2);
  assert.equal(store.issues.length, 1);
  assert.match(store.issues[0].path, /read-back-recovery/);
});

test('URL index loads and finds records in a 10,000-note library', async () => {
  const { app, files } = fakeApp();
  for (let index = 0; index < 10_000; index++) {
    const path = `_openmarks/bookmarks/item-${index}.md`;
    const metadata = { type: 'bookmark', id: `id-${index}`, title: `Item ${index}`, url: `https://site-${index}.example/path` };
    files.set(path, new TFile(path, `---\n${JSON.stringify(metadata)}\n---\n`));
  }
  const store = new BookmarkStore(app);
  const start = performance.now(); await store.load();
  for (let index = 0; index < 10_000; index++) assert.equal(store.findByUrl(`https://site-${index}.example/path`)?.id, `id-${index}`);
  const elapsed = performance.now() - start;
  assert.equal(store.all().length, 10_000);
  assert.ok(elapsed < 10_000, `10,000 note load and indexed lookup pass took ${elapsed.toFixed(0)} ms`);
});

test('cleared optional properties load and a remote icon is never written on creation',async()=>{
  const {app,files}=fakeApp();
  const store=new BookmarkStore(app);
  const mark=await store.create({url:'https://example.org',favicon:'https://remote.example/icon.png'});
  const file=files.get(mark.path);
  assert.ok(!file.content.includes('remote.example'));
  await app.fileManager.processFrontMatter(file,fm=>Object.assign(fm,{tags:null,status:null,favorite:null,favicon_failed_attempts:null}));
  await store.load();
  assert.equal(store.issues.length,0);
  assert.deepEqual(store.get(mark.id).tags,[]);
  assert.equal(store.get(mark.id).status,'unread');
});

test('folder discovery visits nested bookmark folders and leaves sibling folders alone', async () => {
  const { filesInFolder } = await import('../.test-build/storage.mjs');
  const root = '_openmarks/bookmarks';
  const direct = new TFile(root + '/One.md');
  const nested = new TFile(root + '/Reading/Two.md');
  const folder = new TFolder(root, [direct, new TFolder(root + '/Reading', [nested])]);
  const requested = [];
  const app = { vault: { getAbstractFileByPath(path) { requested.push(path); return path === root ? folder : null; } } };
  assert.deepEqual([...filesInFolder(app, root)], [direct, nested]);
  assert.deepEqual([...filesInFolder(app, '_openmarks/exports')], []);
  assert.deepEqual(requested, [root, '_openmarks/exports']);
});
