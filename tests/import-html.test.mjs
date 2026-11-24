import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBookmarkHtml, parseBookmarkHtml } from '../.test-build/import-export.mjs';

function element(tagName, { textContent = '', attributes = {}, children = [] } = {}) {
  const node = {
    tagName: tagName.toUpperCase(), textContent, children,
    getAttribute(name) { return attributes[name.toLowerCase()] ?? null; },
    hasAttribute(name) { return Object.hasOwn(attributes, name.toLowerCase()); },
    nextElementSibling: null,
  };
  children.forEach((child, index) => { child.nextElementSibling = children[index + 1] ?? null; });
  return node;
}
function setDocument(rootList, title = '') {
  globalThis.DOMParser = class { parseFromString() { return { title, querySelector: () => rootList }; } };
}

test('browser HTML import preserves nested folder paths, tags, and descriptions', () => {
  const first = element('DT', { children: [element('A', { textContent: 'Firewall guide', attributes: { href: 'https://example.org/firewall', tags: 'security,reading', add_date: String(Date.UTC(2024, 0, 2, 12) / 1000) } })] });
  const description = element('DD', { textContent: 'A useful guide.' });
  const childList = element('DL', { children: [first, description] });
  const childFolder = element('DT', { children: [element('H3', { textContent: 'Reference' }), childList] });
  const parentList = element('DL', { children: [childFolder] });
  const parentFolder = element('DT', { children: [element('H3', { textContent: 'Security' }), parentList] });
  const rootList = element('DL', { children: [parentFolder] });
  setDocument(rootList);

  const rows = parseBookmarkHtml('<dl></dl>');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].draft.collection, 'Security/Reference');
  assert.deepEqual(rows[0].draft.tags, ['security', 'reading']);
  assert.equal(rows[0].draft.description, 'A useful guide.');
  assert.equal(rows[0].draft.created, '2024-01-02');
});

test('browser ADD_DATE retains the browser-local calendar day', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const timestamp = Date.UTC(2026, 10, 23, 2, 0, 0) / 1000;
    const anchor = element('A', { textContent: 'Late evening bookmark', attributes: { href: 'https://example.org', add_date: String(timestamp) } });
    setDocument(element('DL', { children: [element('DT', { children: [anchor] })] }));
    assert.equal(parseBookmarkHtml('<DL></DL>')[0].draft.created, '2026-11-22');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('browser HTML export uses folder hierarchy and preserves user tags', () => {
  const html = exportBookmarkHtml([{
    id: 'a', title: 'Firewall guide', url: 'https://example.org/firewall', domain: 'example.org', description: 'A useful guide.',
    collection: 'Security/Reference', tags: ['security', 'reading'], favorite: true, status: 'unread', created: '2026-01-01',
    last_opened: '', favicon: '', favicon_source: '', favicon_checked_at: '', favicon_retry_at: '', favicon_etag: '', favicon_last_modified: '',
    favicon_failed_attempts: 0, preview_image: '', preview_source: '', notes: 'Private notes are not part of browser HTML.', path: '',
  }]);
  assert.match(html, /<H3>Security<\/H3>[\s\S]*<H3>Reference<\/H3>/);
  assert.match(html, /TAGS="security,reading"/);
  const exportedDay = new Date(Number(html.match(/ADD_DATE="(\d+)"/)[1]) * 1000);
  assert.equal(exportedDay.toDateString(), new Date(2026, 0, 1).toDateString());
  assert.match(html, /NAME="generator" CONTENT="OpenMarks"/);
  assert.doesNotMatch(html, /TAGS="Security\/Reference/);
});

test('arbitrary tag values containing slashes stay tags, while legacy OpenMarks exports retain old collections', () => {
  const anchor = element('A', { textContent: 'Entry', attributes: { href: 'https://example.org', tags: 'Work/Research,reference' } });
  const list = element('DL', { children: [element('DT', { children: [anchor] })] });
  setDocument(list);
  const generic = parseBookmarkHtml('<DL></DL>')[0].draft;
  assert.equal(generic.collection, 'Unsorted');
  assert.deepEqual(generic.tags, ['Work/Research', 'reference']);
  setDocument(list, 'OpenMarks bookmarks');
  const legacy = parseBookmarkHtml('<DL></DL>')[0].draft;
  assert.equal(legacy.collection, 'Work/Research');
  assert.deepEqual(legacy.tags, ['reference']);
});
