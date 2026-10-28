export class AutoSave {
  private timer = 0;
  private revision = 0;
  private saved = 0;
  private running: Promise<void> | undefined;
  private pendingError: unknown;
  private disposed = false;
  constructor(private readonly write: () => Promise<void>, private readonly status: (state: 'pending' | 'saving' | 'saved' | 'error', error?: unknown) => void) {}
  changed(): void {
    if (this.disposed) return;
    this.revision++; this.pendingError = undefined; this.status('pending');
    clearTimeout(this.timer); this.timer = window.setTimeout(() => { void this.flush().catch(error => this.status('error', error)); }, 450);
  }
  async flush(): Promise<void> {
    if (this.disposed) return;
    clearTimeout(this.timer);
    if (this.running) { await this.running; if (this.saved !== this.revision) await this.flush(); return; }
    if (this.pendingError) throw this.pendingError;
    if (this.saved === this.revision) return;
    this.running = (async () => {
      while (this.saved !== this.revision) {
        const current = this.revision; this.status('saving');
        try { await this.write(); this.saved = current; this.pendingError = undefined; }
        catch (error) { this.pendingError = error; this.status('error', error); throw error; }
      }
      this.status('saved');
    })();
    try { await this.running; } finally { this.running = undefined; }
  }
  discard(): void { clearTimeout(this.timer); this.disposed = true; }
}
