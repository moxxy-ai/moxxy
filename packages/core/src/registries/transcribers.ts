import type { Transcriber, TranscriberDef } from '@moxxy/sdk';
import { ActiveBackendRegistry } from './active-backend-registry.js';

/**
 * Registry of speech-to-text backends:
 *   - plugins call `register(def)` at load time
 *   - the host/CLI calls `setActive(name, config)` once a backend is chosen
 *   - channels with audio input read `getActive()` to transcribe bytes
 *
 * At most one transcriber is *active* at a time, selected explicitly (no
 * auto-adopt). `getActive()` throws when none is active, so call sites can
 * degrade gracefully (e.g. Telegram falls back to "you sent a voice note but no
 * transcriber is configured").
 */
export class TranscriberRegistry extends ActiveBackendRegistry<TranscriberDef, Transcriber> {
  constructor() {
    super({ noun: 'Transcriber', build: (def, config) => def.createClient(config) });
  }
}
