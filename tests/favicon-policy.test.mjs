import test from 'node:test';
import assert from 'node:assert/strict';
import { faviconRetryAt, shouldFetchFavicon } from '../.test-build/favicon-policy.mjs';

test('fresh cached favicon is reused and expired or missing icons are fetched', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const base = { url: 'https://example.org/page', favicon: '_openmarks/favicons/site.png', favicon_source: 'https://example.org/favicon.ico', favicon_checked_at: '2026-11-01T12:00:00Z', favicon_retry_at: '', favicon_failed_attempts: 0 };
  assert.equal(shouldFetchFavicon(base, true, now, 30), false);
  assert.equal(shouldFetchFavicon({ ...base, favicon_checked_at: '2026-10-01T12:00:00Z' }, true, now, 30), true);
  assert.equal(shouldFetchFavicon({ ...base, favicon: '' }, false, now, 30), true);
});

test('failed favicon retrieval uses exponential retry delay capped at 30 days', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  assert.equal(Date.parse(faviconRetryAt(1, now)) - now, 60 * 60 * 1000);
  assert.equal(Date.parse(faviconRetryAt(2, now)) - now, 2 * 60 * 60 * 1000);
  assert.equal(Date.parse(faviconRetryAt(30, now)) - now, 30 * 24 * 60 * 60 * 1000);
  const later = faviconRetryAt(2, now);
  const item = { url: 'https://example.org', favicon: '', favicon_source: '', favicon_checked_at: '', favicon_retry_at: later, favicon_failed_attempts: 2 };
  assert.equal(shouldFetchFavicon(item, false, now, 30), false);
  assert.equal(shouldFetchFavicon(item, false, Date.parse(later) + 1, 30), true);
});
