import type { Synthesizer, SynthesizerDef } from '@moxxy/sdk';
import { ActiveBackendRegistry } from './active-backend-registry.js';

/**
 * Registry of text-to-speech backends:
 *   - plugins call `register(def)` at load time
 *   - read-aloud surfaces read `tryGetActive()` to turn text into audio
 *   - the agent switches/deactivates via the `set_voice` tool
 *
 * Unlike transcribers/embedders (where the host picks a backend explicitly),
 * TTS has a sensible default: the first synthesizer registered auto-becomes
 * active (`autoAdoptFirst`), so a user who asks the agent to author an
 * ElevenLabs plugin gets read-aloud through it immediately — no extra activate
 * step. Because `active` can thus be set without a built instance, the active
 * synthesizer is (re)built lazily on read (`buildOnRead`). `getActive()` throws
 * when none is active so the desktop falls back to the OS `speechSynthesis`.
 *
 * `secretResolver` is the vault-backed `getSecret` (the same one wired into
 * tool contexts), handed to each synthesizer's `create(ctx)` so a TTS plugin
 * can read its API key without touching `process.env`.
 */
export class SynthesizerRegistry extends ActiveBackendRegistry<SynthesizerDef, Synthesizer> {
  constructor(opts: { secretResolver?: (name: string) => Promise<string | null> } = {}) {
    const { secretResolver } = opts;
    super({
      noun: 'Synthesizer',
      autoAdoptFirst: true,
      buildOnRead: true,
      build: (def, config) =>
        def.create({
          config,
          ...(secretResolver ? { getSecret: secretResolver } : {}),
        }),
    });
  }
}
