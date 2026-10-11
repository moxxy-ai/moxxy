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
