import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSampleBookmarks } from '../.test-build/sample-data.mjs';

test('sample library is bundled, lazy-decoded, and contains 100 unique bookmarks', async () => {
  const source = await readFile('src/sample-data-generated.ts', 'utf8');
  const main = await readFile('src/main.ts', 'utf8');
  assert.match(source, /SAMPLE_DATA_GZIP_BASE64/);
  assert.equal(main.includes('sample-data.json'), false);

  const samples = await loadSampleBookmarks();
  assert.equal(samples.length, 100);
  assert.equal(new Set(samples.map((item) => item.id)).size, 100);
  assert.ok(samples.some((item) => item.collection === 'Technology & Development/Development'));
  assert.ok(samples.every((item) => /^https?:\/\//.test(item.url)));
  assert.ok(samples.every((item) => item.tags.every((tag) => !/\s/.test(tag))));
});
