import type { ViewRendererDef } from '@moxxy/sdk';

/**
 * One active view-spec renderer per session. Mirrors
 * {@link CacheStrategyRegistry}: register throws on duplicate, auto-activates
 * the first, and `unregister` clears the active slot rather than picking an
 * arbitrary successor. Core seeds a default renderer so `getActive()` is
 * non-null even with no plugins.
 */
export class ViewRendererRegistry {
  private readonly renderers = new Map<string, ViewRendererDef>();
  private active: string | null = null;

  register(r: ViewRendererDef): void {
    if (this.renderers.has(r.name)) {
      throw new Error(`View renderer already registered: ${r.name}`);
    }
    this.renderers.set(r.name, r);
    if (!this.active) this.active = r.name;
  }

  replace(r: ViewRendererDef): void {
    this.renderers.set(r.name, r);
    if (!this.active) this.active = r.name;
  }

  unregister(name: string): void {
    this.renderers.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<ViewRendererDef> {
    return [...this.renderers.values()];
  }

  setActive(name: string): void {
    const renderer = this.renderers.get(name);
    if (!renderer) throw new Error(`View renderer not registered: ${name}`);
    this.active = renderer.name;
  }

  getActive(): ViewRendererDef | null {
    if (!this.active) return null;
    return this.renderers.get(this.active) ?? null;
  }
}
