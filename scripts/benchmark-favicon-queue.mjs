import { FaviconQueue } from '../.test-build/favicon-queue.mjs';

for (const count of [1_000, 5_000, 10_000]) {
  let completed = 0;
  const items = Array.from({ length: count }, (_, index) => ({ id: String(index), url: `https://host-${index % 100}.example/icon`, priority: index % 97 === 0 ? 5 : 0 }));
  const queue = new FaviconQueue((item) => item.id, (item) => item.url, async () => { completed++; }, () => {}, 3, 0);
  const start = performance.now();
  queue.enqueue(items);
  while (completed < count) await new Promise((resolve) => setTimeout(resolve, 1));
  console.log(JSON.stringify({ pending: count, elapsedMs: +(performance.now() - start).toFixed(1) }));
}
