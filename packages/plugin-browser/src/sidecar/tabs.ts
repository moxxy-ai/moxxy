import { SidecarError } from './types.js';
import type { PageHandle } from './types.js';

/**
 * Named tabs, so the agent's target is always explicit.
 *
 * The old sidecar held exactly one `page` and every command implicitly meant
 * "the current page". That is fine until anything opens a second one — a
 * popup, a `target="_blank"` link, the agent itself — at which point "current"
 * becomes ambiguous and the agent silently acts on the wrong document.
 *
 * Two rules follow from that, and both are enforced here rather than left to
 * callers:
 *
 *   - an id is never reused, so a handle left over from an earlier turn fails
 *     loudly instead of landing on an unrelated tab;
 *   - adding a tab never moves the active one, so a popup appearing mid-task
 *     cannot retarget work already in flight.
 */

export interface TabRecord {
  readonly id: string;
  readonly page: PageHandle;
}

export class TabRegistry {
  private readonly tabs = new Map<string, PageHandle>();
  /**
   * Reverse lookup, so registering the same document twice is a no-op.
   * `context.newPage()` both RETURNS the page and fires `context.on('page')`,
   * so the explicit add and the listener both see it — without this, opening
   * one tab produced two entries pointing at the same document.
   */
  private readonly ids = new WeakMap<PageHandle, string>();
  private active: string | null = null;
  /** Monotonic: ids are never recycled (see the class doc). */
  private counter = 0;

  /** Register a page and return its id. The active tab is unchanged unless
   *  this is the first tab. */
  add(page: PageHandle): string {
    const known = this.ids.get(page);
    if (known !== undefined && this.tabs.has(known)) return known;
    const id = `t${++this.counter}`;
    this.tabs.set(id, page);
    this.ids.set(page, id);
    if (this.active === null) this.active = id;
    return id;
  }

  get activeId(): string | null {
    return this.active;
  }

  list(): ReadonlyArray<TabRecord> {
    return [...this.tabs].map(([id, page]) => ({ id, page }));
  }

  /**
   * Resolve `id`, or the active tab when omitted. Throws rather than falling
   * back to a different tab — a command aimed at a tab that is gone must fail,
   * because quietly running it somewhere else is worse than not running it.
   */
  get(id?: string): TabRecord {
    if (id === undefined) {
      if (this.active === null) throw new SidecarError('no open tab', 'runtime');
      const page = this.tabs.get(this.active);
      if (!page) throw new SidecarError('no open tab', 'runtime');
      return { id: this.active, page };
    }
    const page = this.tabs.get(id);
    if (!page) {
      const open = [...this.tabs.keys()];
      throw new SidecarError(
        `unknown tab_id ${id}${open.length > 0 ? ` — open tabs: ${open.join(', ')}` : ' — no open tabs'}`,
        'runtime',
      );
    }
    return { id, page };
  }

  /** Point the registry's default at `id`. Throws when it is unknown. */
  select(id: string): void {
    this.get(id);
    this.active = id;
  }

  /** Close and forget a tab. The active slot moves to a survivor, or empties. */
  async close(id: string): Promise<void> {
    const page = this.tabs.get(id);
    if (!page) return;
    this.tabs.delete(id);
    this.ids.delete(page);
    if (this.active === id) this.active = this.tabs.keys().next().value ?? null;
    try {
      await page.close();
    } catch {
      // A tab that already went away is closed as far as we are concerned.
    }
  }

  /** Drop every tab (session teardown). Does not close the pages — the caller
   *  owns the browser lifetime. */
  clear(): void {
    for (const page of this.tabs.values()) this.ids.delete(page);
    this.tabs.clear();
    this.active = null;
  }
}
