export class RefreshScheduler {
  private debounceTimer: ReturnType<typeof window.setTimeout> | undefined;
  private maxTimer: ReturnType<typeof window.setTimeout> | undefined;
  private waiters: Array<() => void> = [];
  private running = false;

  constructor(
    private readonly refresh: () => void | Promise<void>,
    private readonly debounceMs = 60,
    private readonly maxWaitMs = 200,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  schedule(): Promise<void> {
    const completion = new Promise<void>((resolve) => this.waiters.push(resolve));
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout((): void => { this.flush(); }, this.debounceMs);
    if (!this.maxTimer) this.maxTimer = window.setTimeout((): void => { this.flush(); }, this.maxWaitMs);
    return completion;
  }

  flush(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.maxTimer) window.clearTimeout(this.maxTimer);
    this.debounceTimer = undefined;
    this.maxTimer = undefined;
    if (!this.waiters.length || this.running) return;
    const waiters = this.waiters.splice(0);
    this.running = true;
    void Promise.resolve().then(this.refresh).catch(this.onError).finally(() => {
      this.running = false;
      waiters.forEach((resolve) => resolve());
      if (this.waiters.length) this.flush();
    });
  }

  cancel(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.maxTimer) window.clearTimeout(this.maxTimer);
    this.debounceTimer = undefined;
    this.maxTimer = undefined;
    this.waiters.splice(0).forEach((resolve) => resolve());
  }
}
