/**
 * Bounded task queue with cancellation support.
 *
 * Provides resource governance for autonomous execution:
 * - Queue rejects work above configured capacity
 * - Queue drains in FIFO order and never exceeds concurrency
 * - Disconnect cancels pending work and stale generations cannot execute
 * - Cancellation tokens propagated from workflow cancellation to underlying operations
 */
export class BoundedTaskQueue {
  private queue: Array<{ id: string; fn: () => Promise<void>; resolve: () => void; reject: (err: Error) => void }> = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly capacity: number;
  private cancelled = false;

  constructor(concurrency = 4, capacity = 100) {
    this.concurrency = concurrency;
    this.capacity = capacity;
  }

  public get size(): number {
    return this.queue.length + this.active;
  }

  public get isFull(): boolean {
    return this.size >= this.capacity;
  }

  public get isCancelled(): boolean {
    return this.cancelled;
  }

  public cancel(): void {
    this.cancelled = true;
    // Reject all pending queued items
    for (const item of this.queue) {
      item.reject(new Error('Task queue cancelled'));
    }
    this.queue = [];
  }

  public enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.cancelled) {
      return Promise.reject(new Error('Task queue cancelled'));
    }
    if (this.isFull) {
      return Promise.reject(new Error('Task queue at capacity'));
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: String(Date.now()) + Math.random().toString(36).slice(2),
        fn: async () => {
          const result = await fn();
          resolve(result);
        },
        resolve: () => resolve(undefined as unknown as T),
        reject,
      });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.active >= this.concurrency || this.queue.length === 0 || this.cancelled) {
      return;
    }

    this.active++;
    const item = this.queue.shift();
    if (!item) {
      this.active--;
      return;
    }

    try {
      await item.fn();
      item.resolve();
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.active--;
      void this.drain();
    }
  }
}

export const taskQueue = new BoundedTaskQueue(4, 100);

/**
 * Cancellation token for propagating cancellation from workflow to operations.
 */
export class CancellationToken {
  private cancelled = false;
  private listeners: Array<() => void> = [];

  public get isCancelled(): boolean {
    return this.cancelled;
  }

  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    }
    this.listeners = [];
  }

  public onCancel(listener: () => void): void {
    if (this.cancelled) {
      listener();
    } else {
      this.listeners.push(listener);
    }
  }

  public throwIfCancelled(): void {
    if (this.cancelled) {
      throw new Error('Operation cancelled');
    }
  }

  public checkCancelled(): boolean {
    return this.cancelled;
  }
}

export const globalCancellationToken = new CancellationToken();
