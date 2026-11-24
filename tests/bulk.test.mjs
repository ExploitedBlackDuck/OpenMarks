import test from 'node:test';
import assert from 'node:assert/strict';
import { runBounded, waitForDomainSlot } from '../.test-build/bulk.mjs';

test('bounded worker pool respects concurrency and reports completed progress', async () => {
  const controller = new AbortController(); let active = 0; let maximum = 0; const progress = [];
  const result = await runBounded([1, 2, 3, 4, 5], 2, controller.signal, async () => {
    active++; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--;
  }, (state) => progress.push(state));
  assert.equal(maximum, 2);
  assert.deepEqual(result, { completed: 5, total: 5 });
  assert.deepEqual(progress.at(-1), result);
});

test('cancellation prevents queued work but lets in-flight items settle', async () => {
  const controller = new AbortController(); const started = []; let finished = 0;
  const promise = runBounded([1, 2, 3, 4], 2, controller.signal, async (item) => {
    started.push(item); if (item === 1) setTimeout(() => controller.abort(), 0);
    await new Promise((resolve) => setTimeout(resolve, 2)); finished++;
  }, () => {});
  const result = await promise;
  assert.deepEqual(started, [1, 2]);
  assert.equal(finished, 2);
  assert.equal(result.completed, 2);
});

test('domain pacing allocates separate slots per hostname and observes cancellation', async () => {
  const slots = new Map(); const controller = new AbortController();
  assert.equal(await waitForDomainSlot('https://one.example/path', slots, controller.signal, 0), true);
  assert.equal(await waitForDomainSlot('https://two.example/path', slots, controller.signal, 0), true);
  assert.equal(slots.size, 2);
  controller.abort();
  assert.equal(await waitForDomainSlot('https://three.example/', slots, controller.signal, 0), false);
});
