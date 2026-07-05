import { migrateModeName, type ModeDef } from '@moxxy/sdk';

export class ModeRegistry {
  private readonly modes = new Map<string, ModeDef>();
  private active: string | null = null;
  private previous: string | null = null;
  private readonly changeListeners = new Set<() => void>();

  /** Observe active-mode changes — used by the runner to broadcast
   *  InfoChanged so remote clients track a mode switch (whether it came from
   *  a `setMode` RPC or a mode handing off to another mode mid-session). */
  onActiveChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /**
   * Register a mode. Throws on duplicate — use `replace()` for
   * overwrite. Auto-activates on first registration (modes need a default
   * for any session to work).
   */
  register(mode: ModeDef): void {
    if (this.modes.has(mode.name)) {
      throw new Error(`Mode already registered: ${mode.name}`);
    }
    this.modes.set(mode.name, mode);
    if (!this.active) this.activate(mode);
  }

  replace(mode: ModeDef): void {
    this.modes.set(mode.name, mode);
    if (!this.active) {
      this.activate(mode);
    } else if (this.active === mode.name) {
      // The active mode's def was swapped in place (e.g. a hot-reloaded mode
      // plugin). `getActive()` already returns the new def, but observers of
      // `onActiveChange` (the runner broadcasting InfoChanged) must be told the
      // active behaviour changed under them, or remote clients keep driving the
      // stale def. `activate()` would early-return on the name match, so notify
      // directly.
      this.notifyChange();
    }
  }

  /**
   * Remove a mode. If it was active, the active slot is cleared —
   * callers must `setActive()` explicitly rather than silently picking
   * some arbitrary "next" mode.
   */
  unregister(name: string): void {
    this.modes.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<ModeDef> {
    return [...this.modes.values()];
  }

  has(name: string): boolean {
    return this.modes.has(name) || this.modes.has(migrateModeName(name));
  }

  /** Active mode name, or null when none is active. Mirrors ActiveDefRegistry
   *  so the manifest apply loop + `categories()` surface can treat modes
   *  uniformly. (`mode` has no protected-floor concept here — `mode-default`
   *  is a critical package, so the default is protected at the package level.) */
  getActiveName(): string | null {
    return this.active;
  }

  /**
   * Name of the mode that was active before the current one, or null when
   * there is no history (session boot). Lets a transient mode (goal) revert
   * to whatever the user was in before arming it — carried onto the
   * ModeContext as `previousModeName` by run-turn.
   */
  getPreviousActiveName(): string | null {
    return this.previous;
  }

  setActive(name: string): void {
    // Prefer the literal name; only when it isn't registered fall back to the
    // legacy-name map (e.g. a persisted "tool-use" → "default"). This never
    // overrides a validly-registered name and keeps an old config / preference
    // / setMode RPC value from crashing a session with "Mode not registered".
    const mode = this.modes.get(name) ?? this.modes.get(migrateModeName(name));
    if (!mode) throw new Error(`Mode not registered: ${name}`);
    this.activate(mode);
  }

  getActive(): ModeDef {
    if (!this.active) throw new Error('No active mode registered.');
    const mode = this.modes.get(this.active);
    if (!mode) throw new Error(`Active mode missing: ${this.active}`);
    return mode;
  }

  private activate(mode: ModeDef): void {
    if (this.active === mode.name) return;
    this.previous = this.active;
    this.active = mode.name;
    this.notifyChange();
  }

  /** Fan out to change listeners, isolating each fault so a single throwing
   *  observer (e.g. the runner's InfoChanged broadcast hitting a dead socket)
   *  can't abort the rest or unwind into register()/replace()/setActive(). */
  private notifyChange(): void {
    for (const fn of this.changeListeners) {
      try {
        fn();
      } catch {
        // Swallow: an observer fault must not break mode activation.
      }
    }
  }
}
