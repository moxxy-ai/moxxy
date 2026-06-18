import {
  transcribeParamsSchema,
  synthesizeParamsSchema,
  type SynthesizeResult,
  type TranscribeResult,
} from '../protocol.js';
import type { HandlerContext } from './context.js';

export async function handleTranscribe(
  ctx: HandlerContext,
  raw: unknown,
): Promise<TranscribeResult> {
  const { session, broadcastInfo } = ctx;
  const params = transcribeParamsSchema.parse(raw);
  const audio = new Uint8Array(Buffer.from(params.audio, 'base64'));
  const opts = {
    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    ...(params.language ? { language: params.language } : {}),
    ...(params.prompt ? { prompt: params.prompt } : {}),
  };
  // Build an ordered list of candidates: the active transcriber
  // first (if any), then every other registered one — that way an
  // "active but uncredentialled" transcriber (e.g. plain Whisper
  // without OPENAI_API_KEY) doesn't shadow an OAuth-backed one
  // that would actually succeed. Identical to what the TUI does
  // by hardcoding to Codex, but agnostic to transcriber name.
  const candidates = transcribeCandidates(ctx);
  if (candidates.length === 0) throw new Error('no active transcriber on the runner');
  let lastErr: unknown = new Error('no active transcriber on the runner');
  for (const name of candidates) {
    try {
      const transcriber = session.transcribers.setActive(name);
      const result = await transcriber.transcribe(audio, opts);
      // Surface the change so remote clients observe activeTranscriber
      // tracking the one that actually worked.
      broadcastInfo();
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function handleSynthesize(
  ctx: HandlerContext,
  raw: unknown,
): Promise<SynthesizeResult> {
  const { session } = ctx;
  const params = synthesizeParamsSchema.parse(raw);
  const synth = session.synthesizers.tryGetActive();
  if (!synth) throw new Error('no active synthesizer on the runner');
  const opts = {
    ...(params.voice ? { voice: params.voice } : {}),
    ...(params.language ? { language: params.language } : {}),
    ...(typeof params.rate === 'number' ? { rate: params.rate } : {}),
  };
  const result = await synth.synthesize(params.text, opts);
  return {
    audio: Buffer.from(result.audio).toString('base64'),
    mimeType: result.mimeType,
  };
}

/** Ordered candidate list for a transcribe call.
 *  - First the active one (if any) — respects an explicit host /
 *    user choice.
 *  - Then every other registered transcriber. */
function transcribeCandidates(ctx: HandlerContext): ReadonlyArray<string> {
  const { session } = ctx;
  const activeName = session.transcribers.getActiveName();
  const names = session.transcribers.list().map((d) => d.name);
  if (!activeName || !names.includes(activeName)) return names;
  return [activeName, ...names.filter((n) => n !== activeName)];
}
