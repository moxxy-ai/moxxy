import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readRequestBody, bearerTokenMatches } from '@moxxy/sdk/server';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { MoxxyEvent } from '@moxxy/sdk';

export const turnRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export type TurnRequest = z.infer<typeof turnRequestSchema>;

/**
 * Counting semaphore gating how many turns run concurrently on the single
 * shared session. The HTTP server otherwise accepts unlimited parallel
 * requests, each calling `session.runTurn` on the SAME session — N concurrent
 * clients would spawn N provider streams (cost/memory/connection blowup) and
 * interleave one shared conversation history. `tryAcquire` is non-blocking so
 * excess requests get a fast 429 instead of queueing unbounded.
 */
export class TurnLimiter {
  private inUse = 0;
  constructor(private readonly max: number) {}
  tryAcquire(): boolean {
    if (this.inUse >= this.max) return false;
    this.inUse += 1;
    return true;
  }
  release(): void {
    if (this.inUse > 0) this.inUse -= 1;
  }
  get active(): number {
    return this.inUse;
  }
}

export interface RouterContext {
  readonly session: Session;
  readonly authToken: string | null;
  readonly logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
  /** Bounds concurrent in-flight turns on the shared session. Optional so
   *  existing embedders/tests keep working unbounded; the channel always
   *  supplies one. */
  readonly turnLimiter?: TurnLimiter;
}

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, ctx: RouterContext) => Promise<void>;

/** Shape an internal/server-side error for the wire: log the full detail
 *  server-side and return a stable, generic message so filesystem paths,
 *  provider internals, or system-prompt fragments embedded in `err` never leak
 *  to a (possibly remote) caller. Client-input validation errors (400) are NOT
 *  routed through this — echoing the caller's own malformed input is safe. */
function publicError(
  ctx: RouterContext,
  logMsg: string,
  err: unknown,
): string {
  ctx.logger?.warn(logMsg, { err: err instanceof Error ? err.message : String(err) });
  return 'internal error';
}

/** Match HTTP request to a handler. Returns null if no route matches. */
export function routeRequest(req: IncomingMessage): RouteHandler | null {
  const rawUrl = req.url ?? '/';
  // Strip the query string before matching — `/v1/turn/audio?model=...`
  // is the same route as `/v1/turn/audio`. The handler reads query
  // params off req.url itself.
  const pathname = rawUrl.split('?')[0] ?? rawUrl;
  if (req.method === 'GET' && pathname === '/v1/health') return handleHealth;
  if (req.method === 'POST' && pathname === '/v1/turn') return handleTurn;
  if (req.method === 'POST' && pathname === '/v1/turn/stream') return handleTurnStream;
  if (req.method === 'POST' && pathname === '/v1/turn/audio') return handleTurnAudio;
  return null;
}

export async function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

function checkAuth(req: IncomingMessage, expected: string | null): boolean {
  if (!expected) return true;
  // Constant-time compare of the full `Bearer <token>` header so the token
  // isn't recoverable byte-by-byte via response timing.
  return bearerTokenMatches(req.headers.authorization, `Bearer ${expected}`);
}

async function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  return (await readRequestBody(req, max)).toString('utf8');
}

/** Audio uploads need a much larger cap than JSON; 10 MB covers a few
 *  minutes of Opus voice (Telegram caps voice notes at 50 MB, but
 *  realistic notes are well under that). */
const DEFAULT_AUDIO_MAX = 10 * 1024 * 1024;

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Run options forwarded to `session.runTurn`, minus the abort `signal`
 *  (which `driveTurn` owns). */
export type TurnRunOptions = Omit<Parameters<Session['runTurn']>[1] & object, 'signal'>;

/** Hard cap on events buffered for a single non-streaming turn. The buffered
 *  path holds every event in memory and returns them in one JSON blob; a
 *  runaway/tool-looping turn could otherwise grow this without bound. Once
 *  exceeded we abort the turn rather than keep allocating. Generous enough that
 *  no normal turn hits it. */
export const MAX_BUFFERED_EVENTS = 50_000;

/**
 * Drive a single buffered (non-streaming) turn to completion: drain every
 * event, abort the turn if the client hangs up (so the model stops billing
 * with nobody listening), and pull out the final assistant message. Shared by
 * `handleTurn` and `handleTurnAudio` so the abort wiring and event/assistant
 * extraction live in exactly one place. Re-throws on turn failure so each
 * caller can shape its own error reply.
 */
export async function driveTurn(
  session: Session,
  prompt: string,
  runOptions: TurnRunOptions,
  res: ServerResponse,
): Promise<{ events: MoxxyEvent[]; assistant: string }> {
  const controller = new AbortController();
  const onClose = (): void => controller.abort();
  res.on('close', onClose);

  const events: MoxxyEvent[] = [];
  try {
    for await (const event of session.runTurn(prompt, { ...runOptions, signal: controller.signal })) {
      events.push(event);
      if (events.length >= MAX_BUFFERED_EVENTS) {
        controller.abort();
        break;
      }
    }
  } finally {
    res.off('close', onClose);
  }

  const finalAssistant = events.findLast((e) => e.type === 'assistant_message');
  const assistant =
    finalAssistant && finalAssistant.type === 'assistant_message' ? finalAssistant.content : '';
  return { events, assistant };
}

export async function handleTurn(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  if (!checkAuth(req, ctx.authToken)) {
    reply(res, 401, { error: 'unauthorized' });
    return;
  }

  let body: TurnRequest;
  try {
    const raw = await readBody(req);
    body = turnRequestSchema.parse(JSON.parse(raw));
  } catch (err) {
    reply(res, 400, { error: 'bad_request', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (ctx.turnLimiter && !ctx.turnLimiter.tryAcquire()) {
    reply(res, 429, { error: 'too_many_turns', message: 'concurrent turn limit reached; retry shortly' });
    return;
  }

  let result: { events: MoxxyEvent[]; assistant: string };
  try {
    result = await driveTurn(
      ctx.session,
      body.prompt,
      {
        ...(body.model ? { model: body.model } : {}),
        ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
      },
      res,
    );
  } catch (err) {
    reply(res, 500, { error: 'turn_failed', message: publicError(ctx, 'http turn failed', err) });
    return;
  } finally {
    ctx.turnLimiter?.release();
  }

  reply(res, 200, { events: result.events, assistant: result.assistant });
}

/**
 * Audio-in turn. Designed for iOS Shortcuts and curl: the client POSTs
 * raw audio bytes with `Content-Type: audio/<format>`. Optional query
 * params (`model`, `language`, `systemPrompt`) tune the run.
 *
 * The session must have an active Transcriber registered (e.g. via
 * `@moxxy/plugin-stt-whisper`); without one the endpoint returns 503
 * rather than transparently dropping the audio.
 */
export async function handleTurnAudio(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  if (!checkAuth(req, ctx.authToken)) {
    reply(res, 401, { error: 'unauthorized' });
    return;
  }

  const transcriber = ctx.session.transcribers.tryGetActive();
  if (!transcriber) {
    reply(res, 503, {
      error: 'no_transcriber',
      message:
        'No active Transcriber on this session. Install @moxxy/plugin-stt-whisper (or another transcriber plugin) and activate it before POSTing audio.',
    });
    return;
  }

  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('audio/')) {
    reply(res, 415, {
      error: 'unsupported_media_type',
      message: "Expected Content-Type: audio/* (e.g. audio/ogg, audio/m4a, audio/mpeg).",
    });
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await readRequestBody(req, DEFAULT_AUDIO_MAX);
  } catch (err) {
    reply(res, 413, { error: 'payload_too_large', message: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (bytes.length === 0) {
    reply(res, 400, { error: 'empty_body', message: 'audio body is empty' });
    return;
  }

  // Pull tuning params off the query string — keeping them out of the
  // body lets the payload remain raw audio (cleanest curl / Shortcut flow).
  const url = new URL(req.url ?? '/', 'http://localhost');
  const model = url.searchParams.get('model') ?? undefined;
  const language = url.searchParams.get('language') ?? undefined;
  const promptHint = url.searchParams.get('prompt') ?? undefined;
  const systemPrompt = url.searchParams.get('systemPrompt') ?? undefined;

  let transcript: string;
  try {
    const result = await transcriber.transcribe(new Uint8Array(bytes), {
      mimeType: contentType,
      ...(language ? { language } : {}),
      ...(promptHint ? { prompt: promptHint } : {}),
    });
    transcript = result.text.trim();
  } catch (err) {
    reply(res, 502, { error: 'transcription_failed', message: publicError(ctx, 'http audio transcription failed', err) });
    return;
  }
  if (!transcript) {
    reply(res, 422, { error: 'empty_transcript', message: 'transcriber returned empty text' });
    return;
  }

  if (ctx.turnLimiter && !ctx.turnLimiter.tryAcquire()) {
    reply(res, 429, { error: 'too_many_turns', message: 'concurrent turn limit reached; retry shortly' });
    return;
  }

  let result: { events: MoxxyEvent[]; assistant: string };
  try {
    result = await driveTurn(
      ctx.session,
      transcript,
      {
        ...(model ? { model } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
      },
      res,
    );
  } catch (err) {
    reply(res, 500, { error: 'turn_failed', message: publicError(ctx, 'http audio turn failed', err) });
    return;
  } finally {
    ctx.turnLimiter?.release();
  }

  reply(res, 200, { transcript, events: result.events, assistant: result.assistant });
}

export async function handleTurnStream(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouterContext,
): Promise<void> {
  if (!checkAuth(req, ctx.authToken)) {
    reply(res, 401, { error: 'unauthorized' });
    return;
  }

  let body: TurnRequest;
  try {
    const raw = await readBody(req);
    body = turnRequestSchema.parse(JSON.parse(raw));
  } catch (err) {
    reply(res, 400, { error: 'bad_request', message: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (ctx.turnLimiter && !ctx.turnLimiter.tryAcquire()) {
    reply(res, 429, { error: 'too_many_turns', message: 'concurrent turn limit reached; retry shortly' });
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  // Abort the turn when the client hangs up — without this the model keeps
  // generating (and billing) with nothing consuming the SSE stream.
  const controller = new AbortController();
  const onClose = (): void => controller.abort();
  res.on('close', onClose);

  // Respect TCP backpressure: a slow/stalled-but-open consumer would otherwise
  // let Node's internal write queue grow unbounded (a tool-heavy turn emits
  // thousands of large events) until OOM. When `write` returns false we pause
  // until 'drain', escaping early if the turn is aborted (client gone).
  const safeWrite = async (chunk: string): Promise<void> => {
    if (res.writableEnded || res.destroyed) return;
    if (res.write(chunk)) return;
    if (controller.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        res.off('drain', done);
        controller.signal.removeEventListener('abort', done);
        resolve();
      };
      res.once('drain', done);
      controller.signal.addEventListener('abort', done, { once: true });
    });
  };

  try {
    for await (const event of ctx.session.runTurn(body.prompt, {
      ...(body.model ? { model: body.model } : {}),
      ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
      signal: controller.signal,
    })) {
      await safeWrite(`data: ${JSON.stringify(event)}\n\n`);
    }
    await safeWrite('data: [DONE]\n\n');
  } catch (err) {
    await safeWrite(
      `event: error\ndata: ${JSON.stringify({ message: publicError(ctx, 'http stream turn failed', err) })}\n\n`,
    );
  } finally {
    res.off('close', onClose);
    ctx.turnLimiter?.release();
    // The client may have hung up mid-stream; end() on an already-ended/
    // destroyed response throws ERR_STREAM_WRITE_AFTER_END.
    if (!res.writableEnded && !res.destroyed) {
      try { res.end(); } catch { /* socket already gone */ }
    }
  }
}
