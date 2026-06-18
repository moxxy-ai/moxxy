import type { Transcriber, TranscribersClientView, TranscriptionResult } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export function makeTranscribersView(ctx: ViewContext): TranscribersClientView {
  const { peer, info } = ctx;
  // Transcription is a server-side capability; a thin client routes audio
  // through runTurn attachments instead.
  // When the runner has an active transcriber, expose a proxy whose
  // transcribe() ships the audio to the runner over the `transcribe` RPC.
  // Channel code (`tryGetActive()?.transcribe(bytes)`) is unchanged - audio
  // input "just works" while attached, transcribed server-side.
  const proxy = (): Transcriber => ({
    name: info()?.activeTranscriber ?? 'runner',
    transcribe: (audio, opts) => {
      const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio;
      return peer.request<TranscriptionResult>(RunnerMethod.Transcribe, {
        audio: Buffer.from(bytes).toString('base64'),
        ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
        ...(opts?.language ? { language: opts.language } : {}),
        ...(opts?.prompt ? { prompt: opts.prompt } : {}),
      });
    },
  });
  return {
    getActiveName: () => info()?.activeTranscriber ?? null,
    has: (name) => name === info()?.activeTranscriber,
    getActive: () => {
      if (!info()?.activeTranscriber) {
        throw new Error('no active transcriber on the runner');
      }
      return proxy();
    },
    tryGetActive: () => (info()?.activeTranscriber ? proxy() : null),
    setActive: () => {
      throw new Error('switch the active transcriber on the runner, not the attached client');
    },
  };
}
