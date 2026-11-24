globalThis.window ??= globalThis;
import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshScheduler } from '../.test-build/refresh-scheduler.mjs';

test('a burst of 100 vault events produces one scheduled interface refresh', async () => {
  let renders = 0;
  const scheduler = new RefreshScheduler(() => { renders++; }, 10, 40);
  const pending = Array.from({ length: 100 }, () => scheduler.schedule());
  await Promise.all(pending);
  assert.equal(renders, 1);
});

test('continuous event bursts are refreshed by max wait and can be cancelled on unload', async () => {
  let renders = 0;
  const scheduler = new RefreshScheduler(() => { renders++; }, 50, 80);
  const pending = [scheduler.schedule()];
  await new Promise((resolve) => setTimeout(resolve, 30));
  pending.push(scheduler.schedule());
  await Promise.all(pending);
  assert.equal(renders, 1);

  const cancelled = scheduler.schedule();
  scheduler.cancel();
  await cancelled;
  assert.equal(renders, 1);
});

test('scheduled rerenders never overlap while a prior render is still running', async () => {
  let running = 0; let maximum = 0; let renders = 0;
  const scheduler = new RefreshScheduler(async () => {
    running++; maximum = Math.max(maximum, running); renders++;
    await new Promise((resolve) => setTimeout(resolve, 25));
    running--;
  }, 5, 10);
  const first = scheduler.schedule();
  await new Promise((resolve) => setTimeout(resolve, 8));
  const second = scheduler.schedule();
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
  assert.equal(renders, 2);
});
