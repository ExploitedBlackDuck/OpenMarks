export interface FaviconQueueProgress { pending: number; running: number; completed: number; failed: number; }
interface QueueEntry<T> { key: string; item: T; priority: number; order: number; }

export class FaviconQueue<T> {
  private pending = new Map<string, QueueEntry<T>>();
  private heap: QueueEntry<T>[] = [];
  private active = new Set<string>();
  private controller = new AbortController();
  private sequence = 0;
  private completed = 0;
  private failed = 0;
  private domainSlots = new Map<string, number>();
  constructor(
    private keyOf: (item: T) => string,
    private urlOf: (item: T) => string,
    private process: (item: T, signal: AbortSignal) => Promise<void>,
    private onProgress: (progress: FaviconQueueProgress) => void = () => {},
    private concurrency = 3,
    private domainIntervalMs = 300,
  ) {}

  get state(): FaviconQueueProgress { return { pending: this.pending.size, running: this.active.size, completed: this.completed, failed: this.failed }; }
  get cancelled(): boolean { return this.controller.signal.aborted; }
  enqueue(items: readonly T[], priority = 0): void {
    if (this.controller.signal.aborted) return;
    for (const item of items) {
      const key = this.keyOf(item);
      if (!key || this.active.has(key)) continue;
      const existing = this.pending.get(key);
      if (existing) {
        if (priority > existing.priority) {
          const updated = { ...existing, priority, item };
          this.pending.set(key, updated); this.pushHeap(updated);
        }
      } else {
        const entry = { key, item, priority, order: this.sequence++ };
        this.pending.set(key, entry); this.pushHeap(entry);
      }
    }
    this.notify(); this.start();
  }

  cancel(): void { this.controller.abort(); this.pending.clear(); this.heap = []; this.notify(); }

  private start(): void {
    while (!this.controller.signal.aborted && this.active.size < Math.max(1, this.concurrency) && this.pending.size) {
      const entry = this.popHeap();
      if (!entry) break;
      this.pending.delete(entry.key); this.active.add(entry.key);
      void this.processOne(entry).catch(() => { this.failed++; }).finally(() => { this.active.delete(entry.key); this.notify(); this.start(); });
    }
  }

  private higher(a: QueueEntry<T>, b: QueueEntry<T>): boolean { return a.priority > b.priority || (a.priority === b.priority && a.order < b.order); }

  private pushHeap(entry: QueueEntry<T>): void {
    let index = this.heap.push(entry) - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.higher(this.heap[index], this.heap[parent])) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]]; index = parent;
    }
  }

  private popHeap(): QueueEntry<T> | undefined {
    while (this.heap.length) {
      const top = this.heap[0]; const last = this.heap.pop()!;
      if (this.heap.length) {
        this.heap[0] = last; let index = 0;
        while (true) {
          const left = index * 2 + 1; const right = left + 1; let best = index;
          if (left < this.heap.length && this.higher(this.heap[left], this.heap[best])) best = left;
          if (right < this.heap.length && this.higher(this.heap[right], this.heap[best])) best = right;
          if (best === index) break;
          [this.heap[index], this.heap[best]] = [this.heap[best], this.heap[index]]; index = best;
        }
      }
      if (this.pending.get(top.key) === top) return top;
    }
    return undefined;
  }

  private async processOne(entry: QueueEntry<T>): Promise<void> {
    try {
      if (!await this.waitForDomain(this.urlOf(entry.item))) return;
      await this.process(entry.item, this.controller.signal); this.completed++;
    } catch { this.failed++; }
  }

  private async waitForDomain(rawUrl: string): Promise<boolean> {
    let host: string;
    try { host = new URL(rawUrl).hostname.toLowerCase(); } catch { return false; }
    const now = Date.now(); const slot = Math.max(now, this.domainSlots.get(host) ?? now);
    this.domainSlots.set(host, slot + this.domainIntervalMs);
    while (!this.controller.signal.aborted && Date.now() < slot) await new Promise((resolve) => setTimeout(resolve, Math.min(100, slot - Date.now())));
    return !this.controller.signal.aborted;
  }

  private notify(): void { this.onProgress(this.state); }
}
