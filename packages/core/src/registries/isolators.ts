import type { Isolator } from '@moxxy/sdk';
import type { Logger } from '../logger.js';

export interface IsolatorRegisterOptions {
  /**
   * True when the isolator comes from a statically-registered (trusted)
   * builtin, false for a discovered (untrusted) plugin. A discovered isolator
   * is never allowed to shadow a name already claimed by a trusted one.
   */
  readonly trusted?: boolean;
  readonly logger?: Logger;
}

/**
 * Collection of capability isolators contributed by plugins via
 * `PluginSpec.isolators`. Unlike the single-active registries, this is just the
 * set of AVAILABLE isolators — selection (and ownership of the security
 * boundary) stays with the active security layer (`@moxxy/plugin-security`),
 * which reads these and picks one by `security.isolator` config.
 *
 * A contributed isolator is therefore NEVER auto-activated: registration only
 * makes it available; the user must opt in by name, so a rogue plugin can't
 * silently weaken isolation just by being installed.
 *
 * This is the one registry where "last wins" crosses a trust boundary: a
 * discovered plugin contributing an isolator whose name matches a trusted
 * builtin would silently swap the implementation the security layer resolves by
 * `security.isolator`. So a discovered registration may NEVER overwrite a name
 * a trusted registration already claimed; it's refused with a warning.
 */
export class IsolatorRegistry {
  private readonly impls = new Map<string, Isolator>();
  /** Names registered by a trusted (static) source — these are never shadowed. */
  private readonly trustedNames = new Set<string>();

  register(iso: Isolator, opts: IsolatorRegisterOptions = {}): void {
    const trusted = opts.trusted ?? true;
    if (!trusted && this.trustedNames.has(iso.name)) {
      // A discovered plugin must not shadow a trusted isolator: that would let
      // it silently weaken an isolation boundary the user already opted into.
      opts.logger?.warn(
        'IsolatorRegistry: refusing to let a discovered plugin shadow a trusted isolator',
        { name: iso.name },
      );
      return;
    }
    if (this.impls.has(iso.name) && !trusted) {
      // Replacing an existing (untrusted) entry from another discovered copy:
      // allowed (same name → same role) but surfaced so it isn't silent.
      opts.logger?.warn('IsolatorRegistry: a discovered isolator overwrote an existing name', {
        name: iso.name,
      });
    }
    // Overwrite by name: an isolator may arrive via more than one path (a
    // bundled built-in AND a discovered copy). Same name → same role; last wins.
    this.impls.set(iso.name, iso);
    if (trusted) this.trustedNames.add(iso.name);
  }

  unregister(name: string): void {
    this.impls.delete(name);
    this.trustedNames.delete(name);
  }

  get(name: string): Isolator | undefined {
    return this.impls.get(name);
  }

  has(name: string): boolean {
    return this.impls.has(name);
  }

  list(): ReadonlyArray<Isolator> {
    return [...this.impls.values()];
  }
}
