import type { Synthesizer, SynthesizerDef } from '@moxxy/sdk';

/**
 * Registry of text-to-speech backends. Mirrors {@link TranscriberRegistry}:
 *   - plugins call `register(def)` at load time
 *   - the host / the agent calls `setActive(name, config)` once a backend is chosen
 *   - read-aloud surfaces read `getActive()` to turn text into audio
 *
 * Like transcribers, at most one synthesizer is *active* at a time.
 * `getActive()` throws when none is active so callers degrade gracefully (the
 * desktop falls back to the OS `speechSynthesis`).
 *
 * `secretResolver` is the vault-backed `getSecret` (same one wired into tool
 * contexts). It's handed to each synthesizer's `create(ctx)` so a TTS plugin
 * can read its API key without touching `process.env`.
 */
export class SynthesizerRegistry {
  private readonly defs = new Map<string, SynthesizerDef>();
  private readonly instances = new Map<string, Synthesizer>();
  private active: string | null = null;
  private readonly secretResolver?: (name: string) => Promise<string | null>;

  constructor(opts: { secretResolver?: (name: string) => Promise<string | null> } = {}) {
    this.secretResolver = opts.secretResolver;
  }

  register(def: SynthesizerDef, instance?: Synthesizer): void {
    if (this.defs.has(def.name)) {
      throw new Error(`Synthesizer already registered: ${def.name}`);
    }
    this.defs.set(def.name, def);
    if (instance) this.instances.set(def.name, instance);
    // Unlike transcribers (where the host picks an STT backend explicitly), TTS
    // has a sensible default: if nothing is active yet, adopt the first
    // synthesizer registered. So a user who asks the agent to author an
    // ElevenLabs plugin gets read-aloud through it immediately — no extra
    // activate step. Switch/deactivate later via the `set_voice` tool.
    if (this.active === null) this.active = def.name;
  }

  replace(def: SynthesizerDef, instance?: Synthesizer): void {
    this.defs.set(def.name, def);
    this.instances.delete(def.name);
    if (instance) this.instances.set(def.name, instance);
  }

  unregister(name: string): void {
    this.defs.delete(name);
    this.instances.delete(name);
    if (this.active === name) this.active = null;
  }

  list(): ReadonlyArray<SynthesizerDef> {
    return [...this.defs.values()];
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  setActive(name: string, config?: Record<string, unknown>): Synthesizer {
    if (!this.defs.has(name)) throw new Error(`Synthesizer not registered: ${name}`);
    // If a config is supplied, (re)build the instance with it; otherwise reuse
    // or lazily build the default instance.
    if (config) {
      this.instances.set(name, this.build(name, config));
    }
    const instance = this.instantiate(name);
    this.active = name;
    return instance;
  }

  /** Deactivate the current synthesizer (read-aloud falls back to the OS voice). */
  clearActive(): void {
    this.active = null;
  }

  getActive(): Synthesizer {
    if (!this.active) throw new Error('No active synthesizer. Call setActive(name) first.');
    return this.instantiate(this.active);
  }

  /** Active synthesizer, or null when none is configured. Lazily instantiates
   *  the active def (so an auto-activated synthesizer works without setActive). */
  tryGetActive(): Synthesizer | null {
    if (!this.active) return null;
    try {
      return this.instantiate(this.active);
    } catch {
      return null;
    }
  }

  /** Reuse the cached instance for `name`, building it from its def on first use. */
  private instantiate(name: string): Synthesizer {
    let inst = this.instances.get(name);
    if (!inst) {
      inst = this.build(name);
      this.instances.set(name, inst);
    }
    return inst;
  }

  private build(name: string, config?: Record<string, unknown>): Synthesizer {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Synthesizer not registered: ${name}`);
    return def.create({
      config: config ?? {},
      ...(this.secretResolver ? { getSecret: this.secretResolver } : {}),
    });
  }

  getActiveName(): string | null {
    return this.active;
  }
}
