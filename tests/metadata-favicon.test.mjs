import test from 'node:test';
import assert from 'node:assert/strict';
import { setRequestUrlHandler } from './obsidian-mock.mjs';
import { downloadFavicon, fetchPageMetadata, requestAfterPacing } from '../.test-build/metadata.mjs';

globalThis.window ??= globalThis;
const iconBytes = new TextEncoder().encode('12345678icon').buffer;

test('favicon requests send conditional validators and preserve cache on HTTP 304', async () => {
  let received;
  setRequestUrlHandler(async (options) => { received = options; return { status: 304, headers: { etag: '"v2"', 'last-modified': 'Mon, 23 Nov 2026 12:00:00 GMT' }, arrayBuffer: Promise.resolve(new ArrayBuffer(0)) }; });
  const result = await downloadFavicon('https://example.org/favicon.ico', 'https://example.org/page', 'site-1', async () => assert.fail('304 must not write'), { etag: '"v1"', lastModified: 'Sun, 22 Nov 2026 12:00:00 GMT', cachedPath: '_openmarks/favicons/site-1.ico' });
  assert.equal(received.headers['If-None-Match'], '"v1"');
  assert.equal(received.headers['If-Modified-Since'], 'Sun, 22 Nov 2026 12:00:00 GMT');
  assert.equal(result.path, '_openmarks/favicons/site-1.ico');
  assert.equal(result.notModified, true); assert.equal(result.etag, '"v2"');
});

test('unsafe favicon destinations and invalid content are rejected', async () => {
  let requests = 0; setRequestUrlHandler(async () => { requests++; return { status: 200, headers: { 'content-type': 'text/html' }, arrayBuffer: Promise.resolve(iconBytes) }; });
  const crossOrigin = await downloadFavicon('https://cdn.example.net/icon.png', 'https://example.org/page', 'one', async () => {});
  assert.equal(crossOrigin.path, ''); assert.equal(requests, 0);
  const invalid = await downloadFavicon('https://example.org/icon.png', 'https://example.org/page', 'two', async () => {});
  assert.equal(invalid.path, ''); assert.equal(requests, 1);
});

test('favicon requests to one host are paced and cancellation stops a waiting request', async () => {
  const times = [];
  setRequestUrlHandler(async () => { times.push(Date.now()); return { status: 404, headers: {}, arrayBuffer: Promise.resolve(new ArrayBuffer(0)) }; });
  await Promise.all([
    downloadFavicon('https://paced.example/a.ico', 'https://paced.example/one', 'a', async () => {}),
    downloadFavicon('https://paced.example/b.ico', 'https://paced.example/two', 'b', async () => {}),
  ]);
  assert.equal(times.length, 2);
  assert.ok(Math.abs(times[1] - times[0]) >= 250, `requests were only ${Math.abs(times[1] - times[0])}ms apart`);

  const controller = new AbortController();
  const pending = downloadFavicon('https://paced.example/c.ico', 'https://paced.example/three', 'c', async () => {}, {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/i);
});

test('network timeout starts only after the queue and host pacing delay', async () => {
  const started = Date.now();
  const value = await requestAfterPacing(new Promise((resolve) => setTimeout(resolve, 35)), async () => 'completed', 10);
  assert.equal(value, 'completed');
  assert.ok(Date.now() - started >= 30);
});

test('page metadata never exposes preview URLs for network retrieval', async () => {
  let requests = 0;
  const targets = [
    'http://127.0.0.1/admin',
    'https://site.example.evil.invalid/image.png',
    'https://cdn.example-cdn.com/image.png',
    'https://site.example/redirect-to-private',
    'https://rebind.example/image.png',
  ];
  setRequestUrlHandler(async () => {
    requests++;
    return { status: 200, headers: { 'content-type': 'text/html' }, text: Promise.resolve(targets.map((url) => `<meta property="og:image" content="${url}">`).join('')), arrayBuffer: Promise.resolve(new ArrayBuffer(0)) };
  });
  const metadata = await fetchPageMetadata('https://site.example/article');
  assert.equal(requests, 1, 'only the user-selected page is requested');
  assert.equal('previewImage' in metadata, false);
  assert.equal('preview_image' in metadata, false);
});



test('unsafe legacy bookmark IDs cannot allocate favicon files', async () => {
  setRequestUrlHandler(() => assert.fail('invalid cache names must fail before requesting'));
  const result = await downloadFavicon('https://example.org/favicon.ico','https://example.org','site-x/../other',() => assert.fail('no write'));
  assert.equal(result.path,'');
});

test('metadata parses as data without a DOM or subresource requests', async () => {
  const requests = [];
  setRequestUrlHandler(async ({url}) => {
    requests.push(url);
    return { status: 200, headers: {'Content-Type': 'text/html'}, text:
      '<title>A &amp; B</title><template><meta name="description" content="ignored"></template>' +
      '<meta name="Description" content="Publisher&#39;s guide"><link rel="icon" href="/icon.png">' +
      '<img src="https://assets.example/photo.png">' };
  });
  const url = 'https://metadata.example/guide';
  const result = await fetchPageMetadata(url);
  assert.equal(result.title, 'A & B');
  assert.equal(result.description, "Publisher's guide");
  assert.equal(result.favicon, 'https://metadata.example/icon.png');
  assert.deepEqual(requests, [url]);
});
