import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';
import { Session, silentLogger } from '@moxxy/core';
import { defineMode, definePlugin, defineProvider, defineTranscriber, type ModeContext } from '@moxxy/sdk';
import {
  routeRequest,
  handleHealth,
  handleAgentRun,
  handleInputCapabilities,
  handleMediaPreview,
  handleRunCommand,
  handleTranscription,
  handleTurnAudio,
  turnRequestSchema,
} from './router.js';
import { OfficeAgentRuntime } from './office-agent-runtime.js';

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
  _rawBody: Buffer;
} {
  const res = {
    _status: 0,
    _headers: {} as Record<string, string | number | string[]>,
    _body: '',
    _rawBody: Buffer.alloc(0),
    headersSent: false,
    writeHead(status: number, headers: Record<string, string | number | string[]>) {
      this._status = status;
      this._headers = headers;
      this.headersSent = true;
      return this;
    },
    end(body?: string | Buffer | Uint8Array) {
      if (body !== undefined) {
        const chunk = Buffer.isBuffer(body) ? body : Buffer.from(body);
        this._rawBody = Buffer.concat([this._rawBody, chunk]);
        this._body += chunk.toString('utf8');
      }
      return this;
    },
    write(chunk: string | Buffer | Uint8Array) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this._rawBody = Buffer.concat([this._rawBody, buffer]);
      this._body += buffer.toString('utf8');
      return true;
    },
  } as unknown as ServerResponse & {
    _status: number;
    _headers: Record<string, string | number | string[]>;
    _body: string;
    _rawBody: Buffer;
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

  it('matches Virtual Office input capability and transcription endpoints', () => {
    expect(routeRequest(makeIncoming({ method: 'GET', url: '/v1/input-capabilities' }))).toBe(
      handleInputCapabilities,
    );
    expect(routeRequest(makeIncoming({ method: 'POST', url: '/v1/transcriptions' }))).toBe(
      handleTranscription,
    );
  });

  it('matches Virtual Office media preview endpoint', () => {
    expect(routeRequest(makeIncoming({ method: 'GET', url: '/v1/media/preview' }))).toBe(
      handleMediaPreview,
    );
  });
});

describe('Virtual Office input endpoints', () => {
  const ctx = (session: Session) => ({ session, authToken: 'x', logger: silentLogger });

  function makeCodexSession(opts: { oauthReady?: boolean; supportsImages?: boolean; transcript?: string } = {}): Session {
    const session = new Session({ cwd: '/tmp', silent: true });
    const models = [
      {
        id: 'gpt-5.5',
        contextWindow: 300_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsImages: opts.supportsImages ?? true,
      },
    ];
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'router-codex-input-test',
        providers: [
          defineProvider({
            name: 'openai-codex',
            models,
            createClient: () => ({
              name: 'openai-codex',
              models,
              stream: async function* () {},
              countTokens: async () => 0,
            }),
          }),
        ],
        transcribers: [
          defineTranscriber({
            name: 'openai-codex-transcribe',
            createClient: () => ({
              name: 'openai-codex-transcribe',
              transcribe: async () => ({ text: opts.transcript ?? 'transcribed text' }),
            }),
          }),
        ],
      }),
    );
    session.providers.setActive('openai-codex');
    if (opts.oauthReady ?? true) session.requirements.setRuntime('auth:provider:openai-codex', 'ready');
    return session;
  }

  function captureMode(session: Session): { getSystemPrompt: () => string | undefined } {
    let systemPrompt: string | undefined;
    session.pluginHost.registerStatic(
      definePlugin({
        name: `router-capture-mode-${Math.random().toString(16).slice(2)}`,
        modes: [
          defineMode({
            name: 'capture-office-run',
            run: async function* (ctx: ModeContext) {
              systemPrompt = ctx.systemPrompt;
            },
          }),
        ],
      }),
    );
    session.modes.setActive('capture-office-run');
    return { getSystemPrompt: () => systemPrompt };
  }

  function materializedPathFromPrompt(prompt: string | undefined): string {
    expect(prompt).toContain('Virtual Office uploaded image attachments');
    const match = prompt?.match(/\/[^\n]+?\.png/);
    expect(match?.[0]).toBeTruthy();
    return match![0];
  }

  it('reports voice and image readiness without leaking auth data', async () => {
    const session = makeCodexSession({ supportsImages: true });
    const res = makeResponse();

    await handleInputCapabilities(
      makeIncoming({
        method: 'GET',
        url: '/v1/input-capabilities',
        headers: { authorization: 'Bearer x' },
      }),
      res,
      ctx(session),
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({
      voice: {
        ready: true,
        reason: null,
        transcriber: 'openai-codex-transcribe',
      },
      active_model: {
        provider_id: 'openai-codex',
        model_id: 'gpt-5.5',
        supports_images: true,
        supports_audio: false,
      },
    });
    expect(res._body).not.toContain('Bearer');
    expect(res._body).not.toContain('token');
  });

  it('returns voice unavailable when Codex OAuth is not ready', async () => {
    const session = makeCodexSession({ oauthReady: false });
    const res = makeResponse();

    await handleInputCapabilities(
      makeIncoming({
        method: 'GET',
        url: '/v1/input-capabilities',
        headers: { authorization: 'Bearer x' },
      }),
      res,
      ctx(session),
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toMatchObject({
      voice: {
        ready: false,
        transcriber: 'openai-codex-transcribe',
      },
    });
    expect(JSON.parse(res._body).voice.reason).toContain('openai-codex');
  });

  it('transcribes raw browser audio without starting a run', async () => {
    const session = makeCodexSession({ transcript: 'voice prompt' });
    const res = makeResponse();

    await handleTranscription(
      makeIncoming({
        method: 'POST',
        url: '/v1/transcriptions',
        headers: { 'content-type': 'audio/webm', authorization: 'Bearer x' },
        body: 'webmbytes',
      }),
      res,
      ctx(session),
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ transcript: 'voice prompt' });
    expect(session.log.ofType('user_prompt')).toHaveLength(0);
  });

  it('rejects non-audio transcription uploads', async () => {
    const session = makeCodexSession();
    const res = makeResponse();

    await handleTranscription(
      makeIncoming({
        method: 'POST',
        url: '/v1/transcriptions',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: '{}',
      }),
      res,
      ctx(session),
    );

    expect(res._status).toBe(415);
  });

  it('accepts image attachment payloads larger than the default JSON body limit', async () => {
    const session = makeCodexSession({ supportsImages: true });
    const res = makeResponse();
    const imageContent = Buffer.alloc(70 * 1024, 1).toString('base64');

    await handleAgentRun(
      makeIncoming({
        method: 'POST',
        url: '/v1/agents/session/runs',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: JSON.stringify({
          task: 'Describe this image',
          attachments: [
            {
              kind: 'image',
              content: imageContent,
              mediaType: 'image/png',
              name: 'large-enough.png',
            },
          ],
        }),
      }),
      res,
      ctx(session),
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toMatchObject({
      agent_id: 'session',
      status: 'running',
      attachments: [
        {
          kind: 'image',
          mediaType: 'image/png',
          name: 'large-enough.png',
        },
      ],
    });
  });

  it('materializes session image attachments as local tool paths without polluting the user prompt', async () => {
    const home = await mkdtemp(join(tmpdir(), 'moxxy-office-media-'));
    vi.stubEnv('MOXXY_HOME', home);
    try {
      const session = makeCodexSession({ supportsImages: true });
      const capture = captureMode(session);
      const res = makeResponse();
      const imageBytes = Buffer.from('office image bytes');

      await handleAgentRun(
        makeIncoming({
          method: 'POST',
          url: '/v1/agents/session/runs',
          headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
          body: JSON.stringify({
            task: 'Use this image in a local tool',
            attachments: [
              {
                kind: 'image',
                content: imageBytes.toString('base64'),
                mediaType: 'image/png',
                name: '../my photo.png',
              },
            ],
          }),
        }),
        res,
        ctx(session),
      );

      expect(res._status).toBe(200);
      await vi.waitFor(() => expect(capture.getSystemPrompt() ?? '').toContain('Virtual Office uploaded image attachments'));
      const materializedPath = materializedPathFromPrompt(capture.getSystemPrompt());

      expect(materializedPath.startsWith(join(home, 'media', String(session.id)))).toBe(true);
      expect(materializedPath).toContain('my-photo.png');
      expect(await readFile(materializedPath)).toEqual(imageBytes);
      expect(session.log.ofType('user_prompt')[0]?.text).toBe('Use this image in a local tool');
    } finally {
      vi.unstubAllEnvs();
      await rm(home, { recursive: true, force: true });
    }
  });

  it('materializes office agent image attachments as local tool paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'moxxy-office-agent-media-'));
    vi.stubEnv('MOXXY_HOME', home);
    try {
      const session = makeCodexSession({ supportsImages: true });
      const capture = captureMode(session);
      const runtime = new OfficeAgentRuntime(session, silentLogger);
      const agent = await runtime.create({ name: 'designer' });
      const res = makeResponse();
      const imageBytes = Buffer.from('office agent image bytes');

      await handleAgentRun(
        makeIncoming({
          method: 'POST',
          url: `/v1/agents/${agent.id}/runs`,
          headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
          body: JSON.stringify({
            task: 'Edit this reference image',
            attachments: [
              {
                kind: 'image',
                content: imageBytes.toString('base64'),
                mediaType: 'image/png',
                name: 'reference.png',
              },
            ],
          }),
        }),
        res,
        { ...ctx(session), officeAgents: runtime },
      );

      expect(res._status).toBe(200);
      await vi.waitFor(() => expect(capture.getSystemPrompt() ?? '').toContain('Virtual Office uploaded image attachments'));
      const materializedPath = materializedPathFromPrompt(capture.getSystemPrompt());

      expect(materializedPath.startsWith(join(home, 'media', String(session.id)))).toBe(true);
      expect(materializedPath).toContain('reference.png');
      expect(await readFile(materializedPath)).toEqual(imageBytes);
    } finally {
      vi.unstubAllEnvs();
      await rm(home, { recursive: true, force: true });
    }
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

describe('handleHealth', () => {
  it('replies 200 ok', async () => {
    const res = makeResponse();
    await handleHealth(makeIncoming({ method: 'GET', url: '/v1/health' }), res);
    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ status: 'ok' });
  });
});

describe('handleMediaPreview', () => {
  const ctx = (session: Session) => ({ session, authToken: 'x', logger: silentLogger });

  async function tempFile(name: string, bytes: Buffer | string): Promise<{ dir: string; path: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'moxxy-media-preview-'));
    const path = join(dir, name);
    await writeFile(path, bytes);
    return { dir, path };
  }

  async function referenceImage(session: Session, source: string): Promise<void> {
    await session.log.append({
      type: 'assistant_message',
      sessionId: session.id,
      turnId: session.startTurn().turnId,
      source: 'assistant',
      content: `Generated image: ![preview](${source})`,
    });
  }

  it('requires auth when the bridge is token protected', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const res = makeResponse();

    await handleMediaPreview(
      makeIncoming({ method: 'GET', url: '/v1/media/preview?source=/tmp/missing.png' }),
      res,
      ctx(session),
    );

    expect(res._status).toBe(401);
  });

  it('serves a referenced local image as bytes', async () => {
    const { dir, path } = await tempFile('render.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      const session = new Session({ cwd: dir, silent: true });
      await referenceImage(session, pathToFileURL(path).href);
      const res = makeResponse();

      await handleMediaPreview(
        makeIncoming({
          method: 'GET',
          url: `/v1/media/preview?source=${encodeURIComponent(pathToFileURL(path).href)}`,
          headers: { authorization: 'Bearer x' },
        }),
        res,
        ctx(session),
      );

      expect(res._status).toBe(200);
      expect(res._headers['content-type']).toBe('image/png');
      expect(res._rawBody).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects local images that were not referenced by the current session log', async () => {
    const { dir, path } = await tempFile('private.png', 'png');
    try {
      const session = new Session({ cwd: dir, silent: true });
      const res = makeResponse();

      await handleMediaPreview(
        makeIncoming({
          method: 'GET',
          url: `/v1/media/preview?source=${encodeURIComponent(path)}`,
          headers: { authorization: 'Bearer x' },
        }),
        res,
        ctx(session),
      );

      expect(res._status).toBe(403);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns 404 for a referenced image path that no longer exists', async () => {
    const { dir, path } = await tempFile('gone.png', 'png');
    await rm(path, { force: true });
    try {
      const session = new Session({ cwd: dir, silent: true });
      await referenceImage(session, path);
      const res = makeResponse();

      await handleMediaPreview(
        makeIncoming({
          method: 'GET',
          url: `/v1/media/preview?source=${encodeURIComponent(path)}`,
          headers: { authorization: 'Bearer x' },
        }),
        res,
        ctx(session),
      );

      expect(res._status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects non-image local files even if they were referenced', async () => {
    const { dir, path } = await tempFile('notes.txt', 'hello');
    try {
      const session = new Session({ cwd: dir, silent: true });
      await referenceImage(session, path);
      const res = makeResponse();

      await handleMediaPreview(
        makeIncoming({
          method: 'GET',
          url: `/v1/media/preview?source=${encodeURIComponent(path)}`,
          headers: { authorization: 'Bearer x' },
        }),
        res,
        ctx(session),
      );

      expect(res._status).toBe(415);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects referenced image files above the preview size limit', async () => {
    const bytes = Buffer.alloc((10 * 1024 * 1024) + 1, 1);
    const { dir, path } = await tempFile('huge.jpg', bytes);
    try {
      expect((await stat(path)).size).toBeGreaterThan(10 * 1024 * 1024);
      const session = new Session({ cwd: dir, silent: true });
      await referenceImage(session, path);
      const res = makeResponse();

      await handleMediaPreview(
        makeIncoming({
          method: 'GET',
          url: `/v1/media/preview?source=${encodeURIComponent(path)}`,
          headers: { authorization: 'Bearer x' },
        }),
        res,
        ctx(session),
      );

      expect(res._status).toBe(413);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('handleRunCommand', () => {
  it('emits a global command session_action event for /new on the main session', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    await session.log.append({
      type: 'user_prompt',
      sessionId: session.id,
      turnId: session.startTurn().turnId,
      source: 'user',
      text: 'old conversation',
    });

    const res = makeResponse();
    await handleRunCommand(
      makeIncoming({
        method: 'POST',
        url: '/v1/commands',
        headers: { authorization: 'Bearer x' },
        body: JSON.stringify({
          agent_id: 'session',
          command: '/new',
          origin_id: 'office-client-1',
        }),
      }),
      res,
      { session, authToken: 'x', logger: silentLogger },
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toMatchObject({
      kind: 'client_action',
      action: 'reset_session',
      agent_id: 'session',
    });
    expect(session.log.toJSON()).toHaveLength(1);
    expect(session.log.ofType('plugin_event')[0]).toMatchObject({
      subtype: 'command.session_action',
      payload: {
        command: '/new',
        action: 'new',
        target: 'session',
        origin_channel: 'office',
        origin_id: 'office-client-1',
      },
    });
  });

  it('does not treat /new as an Office Agent local reset', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const res = makeResponse();
    await handleRunCommand(
      makeIncoming({
        method: 'POST',
        url: '/v1/commands',
        headers: { authorization: 'Bearer x' },
        body: JSON.stringify({
          agent_id: 'office-agent-0001',
          command: '/new',
          origin_id: 'office-client-1',
        }),
      }),
      res,
      { session, authToken: 'x', logger: silentLogger },
    );

    expect(res._status).toBe(409);
    expect(JSON.parse(res._body)).toMatchObject({
      error: 'unsupported',
    });
    expect(session.log.ofType('plugin_event')).toHaveLength(0);
  });

  it('keeps /clear local without emitting a command sync event', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const res = makeResponse();
    await handleRunCommand(
      makeIncoming({
        method: 'POST',
        url: '/v1/commands',
        headers: { authorization: 'Bearer x' },
        body: JSON.stringify({
          agent_id: 'session',
          command: '/clear',
          origin_id: 'office-client-1',
        }),
      }),
      res,
      { session, authToken: 'x', logger: silentLogger },
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toMatchObject({
      kind: 'client_action',
      action: 'clear_agent_timeline',
      agent_id: 'session',
    });
    expect(session.log.ofType('plugin_event')).toHaveLength(0);
  });

  it('emits command state_changed when Office switches the model', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'router-test-provider',
        providers: [
          defineProvider({
            name: 'fake',
            models: [{ id: 'fake-model' }],
            createClient: () => ({}) as never,
          }),
        ],
      }),
    );
    session.providers.setActive('fake');

    const res = makeResponse();
    await handleRunCommand(
      makeIncoming({
        method: 'POST',
        url: '/v1/commands',
        headers: { authorization: 'Bearer x' },
        body: JSON.stringify({
          agent_id: 'session',
          command: '/model fake-model',
          origin_id: 'office-client-1',
        }),
      }),
      res,
      { session, authToken: 'x', logger: silentLogger },
    );

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({
      kind: 'notice',
      message: 'switched to fake::fake-model',
    });
    expect(session.log.ofType('plugin_event')[0]).toMatchObject({
      subtype: 'command.state_changed',
      payload: {
        command: '/model fake::fake-model',
        action: 'model_changed',
        target: 'session',
        origin_channel: 'office',
        origin_id: 'office-client-1',
        provider: 'fake',
        model: 'fake-model',
      },
    });
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
