import test from 'node:test';
import assert from 'node:assert/strict';
import { FaviconQueue } from '../.test-build/favicon-queue.mjs';

test('favicon queue caps concurrency and deduplicates queued bookmarks', async () => {
  let active = 0; let maximum = 0; const visited = [];
  const queue = new FaviconQueue((item) => item.id, (item) => item.url, async (item) => {
    active++; maximum = Math.max(maximum, active); visited.push(item.title); await new Promise((resolve) => setTimeout(resolve, 3)); active--;
  }, () => {}, 2, 0);
  queue.enqueue([{ id: 'a', title: 'old', url: 'https://a.example' }, { id: 'b', title: 'b', url: 'https://b.example' }]);
  queue.enqueue([{ id: 'a', title: 'updated', url: 'https://a.example' }, { id: 'c', title: 'c', url: 'https://c.example' }], 10);
  const deadline = Date.now() + 1000;
  while ((queue.state.pending || queue.state.running) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(maximum, 2);
  assert.equal(visited.filter((title) => title === 'updated' || title === 'old').length, 1);
  assert.ok(visited.includes('c'));
  assert.equal(queue.state.pending, 0); assert.equal(queue.state.running, 0);
});

test('visible priority moves queued work ahead of background items', async () => {
  const order = []; let release;
  const firstWait = new Promise((resolve) => { release = resolve; });
  const queue = new FaviconQueue((item) => item.id, (item) => item.url, async (item) => {
    order.push(item.id); if (item.id === 'running') await firstWait;
  }, () => {}, 1, 0);
  queue.enqueue([{ id: 'running', url: 'https://a.example' }]);
  queue.enqueue([{ id: 'background', url: 'https://b.example' }, { id: 'visible', url: 'https://c.example' }], 0);
  queue.enqueue([{ id: 'visible', url: 'https://c.example' }], 20);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ['running', 'visible', 'background']);
});

test('cancellation stops queued work and blocks future queue additions', async () => {
  const order = [];
  const queue = new FaviconQueue((item) => item.id, (item) => item.url, async (item) => { order.push(item.id); await new Promise((resolve) => setTimeout(resolve, 3)); }, () => {}, 1, 0);
  queue.enqueue([{ id: 'one', url: 'https://a.example' }, { id: 'two', url: 'https://b.example' }]);
  queue.cancel(); queue.enqueue([{ id: 'three', url: 'https://c.example' }]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ['one']);
  assert.equal(queue.state.pending, 0);
});

test('repeated cancellation is safe and a replacement queue resumes new work', async () => {
  let oldVisits = 0; let newVisits = 0;
  const oldQueue = new FaviconQueue((item) => item.id, (item) => item.url, async () => { oldVisits++; }, () => {}, 1, 0);
  oldQueue.cancel(); oldQueue.cancel(); oldQueue.enqueue([{ id: 'stale', url: 'https://stale.example/' }]);
  const resumedQueue = new FaviconQueue((item) => item.id, (item) => item.url, async () => { newVisits++; }, () => {}, 1, 0);
  resumedQueue.enqueue([{ id: 'new', url: 'https://new.example/' }]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(oldVisits, 0); assert.equal(newVisits, 1);
});
