/** A queue with one reader that waits for the next item, woken by `push`, never by a timer. */
export class Inbox<T> {
  private readonly items: T[] = [];
  private wake: (() => void) | undefined;

  push(item: T): void {
    this.items.push(item);
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async next(): Promise<T> {
    for (;;) {
      const item = this.items.shift();
      if (item !== undefined) return item;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  /** Everything queued now, emptying the queue. */
  drain(): T[] {
    return this.items.splice(0);
  }
}

/** Resolve with `fallback` once the turn is stopped, whatever `work` does. */
export function untilStopped<T>(work: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(fallback);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}
