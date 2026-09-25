import { randomUUID } from 'node:crypto';
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
      opts?.signal?.throwIfAborted();
      const supportsCancellation = (ctx.serverProtocolVersion() ?? 0) >= 16;
      const requestId = opts?.signal && supportsCancellation ? randomUUID() : undefined;
      if (requestId) ctx.requireServerProtocol(16, 'Cancelling speech synthesis');
      const cancelRemote = (): void => {
        if (!requestId) return;
        void peer.request(RunnerMethod.CancelSynthesize, { requestId }).catch(() => undefined);
      };
      if (requestId) opts?.signal?.addEventListener('abort', cancelRemote, { once: true });
      try {
        const res = await peer.request<SynthesizeResult>(RunnerMethod.Synthesize, {
        ...(requestId ? { requestId } : {}),
        text,
        ...(opts?.voice ? { voice: opts.voice } : {}),
        ...(opts?.language ? { language: opts.language } : {}),
        ...(typeof opts?.rate === 'number' ? { rate: opts.rate } : {}),
        }, opts?.signal ? { signal: opts.signal } : {});
        return {
          audio: new Uint8Array(Buffer.from(res.audio, 'base64')),
          mimeType: res.mimeType,
          ...(res.usage ? { usage: res.usage } : {}),
        };
      } finally {
        if (requestId) opts?.signal?.removeEventListener('abort', cancelRemote);
      }
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
