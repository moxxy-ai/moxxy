import type { Synthesizer, SynthesizersClientView } from '@moxxy/sdk';
import { RunnerMethod, type SynthesizeResult } from '../protocol.js';
import type { ViewContext } from './context.js';

export function makeSynthesizersView(ctx: ViewContext): SynthesizersClientView {
  const { peer, info } = ctx;
  // TTS is a server-side capability. When the runner has an active
  // synthesizer, expose a proxy whose synthesize() ships the text to the
  // runner over the `synthesize` RPC and decodes the base64 audio it returns.
  // Read-aloud surfaces (`tryGetActive()?.synthesize(text)`) "just work"
  // while attached; absent → the caller falls back to the OS voice.
  const proxy = (): Synthesizer => ({
    name: info()?.activeSynthesizer ?? 'runner',
    synthesize: async (text, opts) => {
      const res = await peer.request<SynthesizeResult>(RunnerMethod.Synthesize, {
        text,
        ...(opts?.voice ? { voice: opts.voice } : {}),
        ...(opts?.language ? { language: opts.language } : {}),
        ...(typeof opts?.rate === 'number' ? { rate: opts.rate } : {}),
      });
      return {
        audio: new Uint8Array(Buffer.from(res.audio, 'base64')),
        mimeType: res.mimeType,
      };
    },
  });
  return {
    getActiveName: () => info()?.activeSynthesizer ?? null,
    has: (name) => name === info()?.activeSynthesizer,
    getActive: () => {
      if (!info()?.activeSynthesizer) {
        throw new Error('no active synthesizer on the runner');
      }
      return proxy();
    },
    tryGetActive: () => (info()?.activeSynthesizer ? proxy() : null),
    setActive: () => {
      throw new Error('switch the active synthesizer on the runner, not the attached client');
    },
  };
}
