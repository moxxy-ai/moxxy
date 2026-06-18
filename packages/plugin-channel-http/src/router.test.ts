import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { Socket } from 'node:net';
import { Session, silentLogger } from '@moxxy/core';
import { defineTranscriber } from '@moxxy/sdk';
import type { ClientSession } from '@moxxy/sdk';
import {
  routeRequest,
  handleHealth,
  handleTurn,
  handleTurnAudio,
  driveTurn,
  turnRequestSchema,
} from './router.js';
import type { MoxxyEvent } from '@moxxy/sdk';

function makeIncoming(opts: { method: string; url: string; headers?: Record<string, string>; body?: string }): IncomingMessage {
  const readable = Readable.from(opts.body ? [Buffer.from(opts.body)] : []);
  const socket = new Socket();
  const req = readable as unknown as IncomingMessage;
  Object.assign(req, {
    method: opts.method,
    url: opts.url,
    headers: opts.headers ?? {},
    socket,
  });
  return req;
}

function makeResponse(): ServerResponse & {
  _status: number;
  _headers: Record<string, string | number | string[]>;
  _body: string;
  _emit(event: string): void;
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const res = {
    _status: 0,
    _headers: {} as Record<string, string | number | string[]>,
    _body: '',
    headersSent: false,
    writeHead(status: number, headers: Record<string, string | number | string[]>) {
      this._status = status;
      this._headers = headers;
      this.headersSent = true;
      return this;
    },
    end(body?: string) {
      if (body !== undefined) this._body += body;
      return this;
    },
    write(chunk: string) {
      this._body += chunk;
      return true;
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return this;
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return this;
    },
    _emit(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  } as unknown as ServerResponse & {
    _status: number;
    _headers: Record<string, string | number | string[]>;
    _body: string;
    _emit(event: string): void;
  };
  return res;
}

describe('routeRequest', () => {
  it('matches GET /v1/health', () => {
    expect(routeRequest(makeIncoming({ method: 'GET', url: '/v1/health' }))).toBe(handleHealth);
  });

  it('returns null for unknown routes', () => {
    expect(routeRequest(makeIncoming({ method: 'GET', url: '/unknown' }))).toBeNull();
    expect(routeRequest(makeIncoming({ method: 'PUT', url: '/v1/turn' }))).toBeNull();
  });

  it('matches POST /v1/turn', () => {
    expect(routeRequest(makeIncoming({ method: 'POST', url: '/v1/turn' }))).not.toBeNull();
  });

  it('matches POST /v1/turn/stream', () => {
    expect(routeRequest(makeIncoming({ method: 'POST', url: '/v1/turn/stream' }))).not.toBeNull();
  });

  it('matches POST /v1/turn/audio (with or without query string)', () => {
    expect(routeRequest(makeIncoming({ method: 'POST', url: '/v1/turn/audio' }))).toBe(
      handleTurnAudio,
    );
    expect(
      routeRequest(makeIncoming({ method: 'POST', url: '/v1/turn/audio?model=sonnet' })),
    ).toBe(handleTurnAudio);
  });
});

describe('handleTurnAudio', () => {
  const ctx = (session: Session) => ({ session, authToken: 'x', logger: silentLogger });

  it('rejects requests without Bearer auth with 401', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const res = makeResponse();
    await handleTurnAudio(
      makeIncoming({ method: 'POST', url: '/v1/turn/audio', headers: { 'content-type': 'audio/ogg' } }),
      res,
      ctx(session),
    );
    expect(res._status).toBe(401);
  });

  it('returns 503 when no transcriber is active on the session', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const res = makeResponse();
    await handleTurnAudio(
      makeIncoming({
        method: 'POST',
        url: '/v1/turn/audio',
        headers: { 'content-type': 'audio/ogg', authorization: 'Bearer x' },
        body: 'oggbytes',
      }),
      res,
      ctx(session),
    );
    expect(res._status).toBe(503);
    expect(JSON.parse(res._body).error).toBe('no_transcriber');
  });

  it('rejects non-audio Content-Type with 415', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const res = makeResponse();
    await handleTurnAudio(
      makeIncoming({
        method: 'POST',
        url: '/v1/turn/audio',
        headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer x' },
        body: 'bytes',
      }),
      res,
      ctx(session),
    );
    expect(res._status).toBe(415);
  });

  it('returns 400 on empty body', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const res = makeResponse();
    await handleTurnAudio(
      makeIncoming({
        method: 'POST',
        url: '/v1/turn/audio',
        headers: { 'content-type': 'audio/ogg', authorization: 'Bearer x' },
        body: '',
      }),
      res,
      ctx(session),
    );
    expect(res._status).toBe(400);
  });

  it('returns 422 when the transcriber yields an empty transcript', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: '   ' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const res = makeResponse();
    await handleTurnAudio(
      makeIncoming({
        method: 'POST',
        url: '/v1/turn/audio',
        headers: { 'content-type': 'audio/ogg', authorization: 'Bearer x' },
        body: 'oggbytes',
      }),
      res,
      ctx(session),
    );
    expect(res._status).toBe(422);
  });
});

describe('handleTurn — client-disconnect abort (u70-1)', () => {
  it('aborts the turn signal when the client hangs up mid-run', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveClosed!: () => void;
    const sawSignal = new Promise<void>((r) => {
      resolveClosed = r;
    });
    // A session whose runTurn blocks until aborted, recording the signal it
    // received so the test can assert it was wired through.
    const session = {
      runTurn: (_prompt: string, opts?: { signal?: AbortSignal }) => {
        capturedSignal = opts?.signal;
        resolveClosed();
        return (async function* () {
          await new Promise<void>((resolve) => {
            opts?.signal?.addEventListener('abort', () => resolve());
          });
        })();
      },
    } as unknown as ClientSession;

    const res = makeResponse();
    const handlerDone = handleTurn(
      makeIncoming({
        method: 'POST',
        url: '/v1/turn',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: JSON.stringify({ prompt: 'hello' }),
      }),
      res,
      { session, authToken: 'x', logger: silentLogger },
    );

    // Wait until runTurn is in-flight, then simulate the client disconnect.
    await sawSignal;
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
    res._emit('close');
    expect(capturedSignal!.aborted).toBe(true);

    await handlerDone;
    // The close listener is detached after the turn settles (no leak).
    res._emit('close'); // would throw if listener double-fired on a dead res
  });
});

describe('driveTurn', () => {
  const fakeSession = (gen: () => AsyncGenerator<MoxxyEvent>): ClientSession =>
    ({ runTurn: () => gen() }) as unknown as ClientSession;

  const asst = (content: string): MoxxyEvent =>
    ({ type: 'assistant_message', content }) as unknown as MoxxyEvent;

  it('drains all events and extracts the LAST assistant message', async () => {
    const session = fakeSession(async function* () {
      yield asst('first');
      yield { type: 'tool_call_requested' } as unknown as MoxxyEvent;
      yield asst('final');
    });
    const res = makeResponse();
    const { events, assistant } = await driveTurn(session, 'hi', {}, res);
    expect(events).toHaveLength(3);
    expect(assistant).toBe('final');
  });

  it('returns empty assistant when no assistant_message is emitted', async () => {
    const session = fakeSession(async function* () {
      yield { type: 'tool_call_requested' } as unknown as MoxxyEvent;
    });
    const res = makeResponse();
    const { assistant } = await driveTurn(session, 'hi', {}, res);
    expect(assistant).toBe('');
  });

  it('forwards an abort signal and aborts it when the client disconnects', async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const inFlight = new Promise<void>((r) => (started = r));
    const session = {
      runTurn: (_p: string, opts?: { signal?: AbortSignal }) => {
        signal = opts?.signal;
        started();
        return (async function* () {
          await new Promise<void>((resolve) => opts?.signal?.addEventListener('abort', () => resolve()));
        })();
      },
    } as unknown as ClientSession;

    const res = makeResponse();
    const done = driveTurn(session, 'hi', {}, res);
    await inFlight;
    expect(signal!.aborted).toBe(false);
    res._emit('close');
    expect(signal!.aborted).toBe(true);
    await done;
  });

  it('detaches the close listener after the turn settles', async () => {
    const session = fakeSession(async function* () {
      yield asst('ok');
    });
    const res = makeResponse();
    await driveTurn(session, 'hi', {}, res);
    // Listener removed -> a late close does not abort anything / throw.
    expect(() => res._emit('close')).not.toThrow();
  });

  it('re-throws when the turn fails (and still detaches the listener)', async () => {
    const session = fakeSession(async function* () {
      yield asst('partial');
      throw new Error('boom');
    });
    const res = makeResponse();
    await expect(driveTurn(session, 'hi', {}, res)).rejects.toThrow('boom');
    expect(() => res._emit('close')).not.toThrow();
  });
});

describe('handleHealth', () => {
  it('replies 200 ok', async () => {
    const res = makeResponse();
    await handleHealth(makeIncoming({ method: 'GET', url: '/v1/health' }), res);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ status: 'ok' });
  });
});

describe('turnRequestSchema', () => {
  it('accepts minimal {prompt}', () => {
    expect(turnRequestSchema.parse({ prompt: 'hi' })).toEqual({ prompt: 'hi' });
  });

  it('accepts optional model + systemPrompt', () => {
    const out = turnRequestSchema.parse({ prompt: 'hi', model: 'sonnet', systemPrompt: 'be terse' });
    expect(out.model).toBe('sonnet');
    expect(out.systemPrompt).toBe('be terse');
  });

  it('rejects empty prompt', () => {
    expect(() => turnRequestSchema.parse({ prompt: '' })).toThrow();
  });

  it('rejects non-string fields', () => {
    expect(() => turnRequestSchema.parse({ prompt: 123 })).toThrow();
  });
});

// keep `vi` reachable so the import isn't pruned by some bundlers in CI
void vi;
