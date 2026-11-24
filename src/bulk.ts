export interface BulkProgress { completed: number; total: number; }

export async function runBounded<T>(items: readonly T[], concurrency: number, signal: AbortSignal, worker: (item: T) => Promise<void>, progress: (value: BulkProgress) => void): Promise<BulkProgress> {
  let next = 0;
  let completed = 0;
  const total = items.length;
  const run = async () => {
    while (!signal.aborted) {
      const index = next++;
      if (index >= total) return;
      try { await worker(items[index]); }
      catch { /* One failed item must not stop the rest of the batch. */ }
      completed++;
      progress({ completed, total });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total || 1)) }, run));
  return { completed, total };
}

export async function waitForDomainSlot(url: string, nextAllowed: Map<string, number>, signal: AbortSignal, intervalMs = 300): Promise<boolean> {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  const now = Date.now();
  const slot = Math.max(now, nextAllowed.get(host) ?? now);
  nextAllowed.set(host, slot + intervalMs);
  while (!signal.aborted && Date.now() < slot) {
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(100, slot - Date.now())));
  }
  return !signal.aborted;
}
