import test from 'node:test';
import assert from 'node:assert/strict';
import { CoalescedAsyncWriter, DeferredFaviconSet, emptyFaviconRecord, faviconOriginChanged, migrateLegacyFaviconIndex, normalizeFaviconCacheIndex, persistCacheState, persistBeforeLegacyCleanup, isManagedFaviconPath } from '../.test-build/favicon-cache.mjs';
import { makeBookmark } from '../.test-build/model.mjs';

test('legacy favicon metadata migrates by origin and repeated migration is stable', () => {
  const first = makeBookmark({ url: 'https://docs.example.com/a', favicon: '_openmarks/favicons/site-one.png', favicon_source: 'https://docs.example.com/icon.png', favicon_checked_at: '2026-11-20T00:00:00Z', favicon_etag: '"one"', path: '_openmarks/bookmarks/one.md' });
  const second = makeBookmark({ url: 'https://docs.example.com/b', favicon: '_openmarks/favicons/site-two.png', favicon_source: 'https://docs.example.com/icon.png', favicon_checked_at: '2026-11-21T00:00:00Z', favicon_retry_at: '2026-11-22T00:00:00Z', favicon_failed_attempts: 2, path: '_openmarks/bookmarks/two.md' });
  const migrated = migrateLegacyFaviconIndex({}, [first, second]);
  const record = migrated.index['https://docs.example.com'];
  assert.equal(record.lastSuccessAt, '2026-11-21T00:00:00Z');
  assert.equal(record.iconPath, second.favicon);
  assert.equal(record.failures, 2);
  const repeated = migrateLegacyFaviconIndex(migrated.index, [first, second]);
  assert.deepEqual(repeated.index, migrated.index);
  assert.deepEqual(migrated.pathsToClean.sort(), [first.path, second.path].sort());
});

test('cache index rejects malformed and non-HTTP origins', () => {
  const index = normalizeFaviconCacheIndex({
    'javascript:alert(1)': emptyFaviconRecord('javascript:alert(1)'),
    'https://example.org': { origin: 'https://example.org', failures: -1, etag: 4 },
    '/local': {},
  });
  assert.deepEqual(Object.keys(index), ['https://example.org']);
  assert.equal(index['https://example.org'].failures, 0);
  assert.equal(index['https://example.org'].etag, '');
});

test('deferred import icons resume on next plugin start, manual request, or cache clear', () => {
  const duringSession = new DeferredFaviconSet();
  duringSession.defer(['bookmark-1']);
  assert.equal(duringSession.shouldSkip('bookmark-1'), true);
  assert.equal(new DeferredFaviconSet().shouldSkip('bookmark-1'), false);
  duringSession.release(['bookmark-1']);
  assert.equal(duringSession.shouldSkip('bookmark-1'), false);
  duringSession.defer(['bookmark-2']); duringSession.clear();
  assert.equal(duringSession.shouldSkip('bookmark-2'), false);
});

test('cache-index migration never removes legacy properties before persistence succeeds', async () => {
  const order = [];
  await assert.rejects(persistBeforeLegacyCleanup(async () => { order.push('persist'); throw new Error('disk full'); }, async () => { order.push('cleanup'); }));
  assert.deepEqual(order, ['persist']);
  await persistBeforeLegacyCleanup(async () => { order.push('persisted'); }, async () => { order.push('cleanup after persist'); });
  assert.deepEqual(order, ['persist', 'persisted', 'cleanup after persist']);
});

test('favicon cache bookkeeping failures are contained and retryable', async () => {
  const errors = [];
  const persisted = await persistCacheState(async () => { throw new Error('simulated save failure'); }, (error) => errors.push(error.message));
  assert.equal(persisted, false);
  assert.deepEqual(errors, ['simulated save failure']);
  let attempts = 0;
  assert.equal(await persistCacheState(async () => { attempts++; }, () => {}), true);
  assert.equal(attempts, 1);
});

test('cache clearing only accepts generated OpenMarks favicon paths', () => {
  assert.equal(isManagedFaviconPath('_openmarks/favicons/site-abcd-123.png'), true);
  assert.equal(isManagedFaviconPath('_openmarks/favicons/user-photo.png'), false);
  assert.equal(isManagedFaviconPath('_openmarks/favicons/site-legacy.svg'), true);
  assert.equal(isManagedFaviconPath('_openmarks/favicons/../bookmarks/site-id.png'), false);
  assert.equal(isManagedFaviconPath('attachments/site-id.png'), false);
});

test('favicon identity follows origins and retains icons when a URL changes within the same origin', () => {
  assert.equal(faviconOriginChanged('https://docs.example.org/start', 'https://docs.example.org/config'), false);
  assert.equal(faviconOriginChanged('https://docs.example.org/start', 'https://www.example.org/start'), true);
});

test('favicon cache persistence coalesces result bursts and flushes changes made during a save', async () => {
  let saves = 0;
  let finishFirst;
  const writer = new CoalescedAsyncWriter(async () => {
    saves++;
    if (saves === 1) await new Promise((resolve) => { finishFirst = resolve; });
  }, () => {}, 5);
  for (let index = 0; index < 20; index++) writer.request();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(saves, 1);
  writer.request(); writer.request();
  finishFirst();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writer.flush();
  assert.equal(saves, 2);
});

test('cache writer retries transient failures with bounded exponential backoff', async () => {
  let attempts = 0;
  const errors = [];
  const writer = new CoalescedAsyncWriter(async () => {
    attempts++;
    if (attempts < 3) throw new Error(`failure ${attempts}`);
  }, (error) => errors.push(error.message), 1, 2, 8, 3);
  writer.request();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await writer.flush();
  assert.equal(attempts, 3);
  assert.deepEqual(errors, ['failure 1', 'failure 2']);
});

test('cache writer stops automatic retries after the configured limit and keeps data dirty', async () => {
  let attempts = 0;
  const writer = new CoalescedAsyncWriter(async () => { attempts++; throw new Error('disk unavailable'); }, () => {}, 1, 2, 4, 2);
  writer.request();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(attempts, 3);
  await writer.flush();
  assert.equal(attempts, 4, 'explicit flush can retry data after the automatic retry budget is exhausted');
});

test('shutdown makes a best-effort flush without leaving retry timers behind', async () => {
  let attempts = 0;
  const writer = new CoalescedAsyncWriter(async () => { attempts++; throw new Error('disk unavailable'); }, () => {}, 1, 2, 4, 2);
  writer.request();
  await writer.stopAndFlush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(attempts, 1);
  writer.request();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(attempts, 1, 'writes are not rescheduled after unload');
});
