import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { persistCodexTokens } from '@moxxy/plugin-provider-openai-codex';
import {
  createStaticKeySource,
  deriveKey,
  generateSalt,
  VaultStore,
} from '@moxxy/plugin-vault';
import {
  buildCodexTranscribeUrl,
  buildWhisperCodexPlugin,
  CodexOAuthTranscriber,
  MOXXY_PCM16_24KHZ_MIME,
  pcm16MonoToWav,
} from './index.js';

interface CapturedRequest {
  readonly req: IncomingMessage;
  readonly body: Buffer;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeVault(): Promise<VaultStore> {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-codex-stt-'));
  tempDirs.push(dir);
  return new VaultStore({
    filePath: path.join(dir, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test-passphrase', generateSalt())),
  });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

async function startServer(
  handler: (captured: CapturedRequest, res: ServerResponse) => void | Promise<void>,
): Promise<{ readonly baseUrl: string; readonly close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    await handler({ req, body: await readBody(req) }, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('CodexOAuthTranscriber', () => {
  it('posts wav multipart audio to the Codex transcribe endpoint with OAuth headers', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
      accountId: 'acct_123',
    });

    let captured: CapturedRequest | null = null;
    const server = await startServer((request, res) => {
      captured = request;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'hello from codex' }));
    });

    try {
      const plugin = buildWhisperCodexPlugin({
        vault,
        baseUrl: server.baseUrl,
        sessionIdProvider: () => 'stt-session-id',
      });
      const def = plugin.transcribers?.[0];
      expect(def?.name).toBe('openai-codex-transcribe');

      const transcriber = def!.createClient({});
      const result = await transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), {
        mimeType: 'audio/wav',
      });

      expect(result.text).toBe('hello from codex');
      expect(captured?.req.method).toBe('POST');
      expect(captured?.req.url).toBe('/transcribe');
      expect(captured?.req.headers.authorization).toBe('Bearer access-token');
      expect(captured?.req.headers['chatgpt-account-id']).toBe('acct_123');
      expect(captured?.req.headers.session_id).toBe('stt-session-id');
      expect(captured?.req.headers.originator).toBe('Codex Desktop');
      expect(captured?.req.headers['user-agent']).toMatch(/^Mozilla\/5\.0/);
      expect(captured?.req.headers['content-type']).toContain('multipart/form-data; boundary=');
      expect(captured?.body.toString('latin1')).toContain('filename="moxxy.wav"');
      expect(captured?.body.toString('latin1')).toContain('Content-Type: audio/wav');
    } finally {
      await server.close();
    }
  });

  it('converts local pcm16/24k microphone bytes to wav before upload', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    let body = Buffer.alloc(0);
    const server = await startServer((request, res) => {
      body = request.body;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'pcm converted' }));
    });

    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: server.baseUrl });
      await transcriber.transcribe(new Uint8Array([1, 0, 2, 0]), {
        mimeType: MOXXY_PCM16_24KHZ_MIME,
      });

      expect(body.includes(Buffer.from('RIFF', 'ascii'))).toBe(true);
      expect(body.includes(Buffer.from('WAVE', 'ascii'))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('fails with the login hint when OAuth credentials are missing', async () => {
    const vault = await makeVault();
    const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: 'http://127.0.0.1:9' });

    await expect(transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' }))
      .rejects
      .toThrow(/moxxy login openai-codex/);
  });

  it('classifies 403 transcription responses as authorization denials', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const server = await startServer((_request, res) => {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html><head><style>body{display:flex}</style></head></html>');
    });

    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: server.baseUrl });
      await expect(transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' }))
        .rejects
        .toMatchObject({
          code: 'AUTH_DENIED',
          message: expect.not.stringContaining('<html>'),
        });
    } finally {
      await server.close();
    }
  });

  it('rejects non-2xx and malformed responses, and treats an empty transcript as a valid empty result', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const badServer = await startServer((_request, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'nope' }));
    });
    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: badServer.baseUrl });
      await expect(transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' }))
        .rejects
        .toThrow(/500/);
    } finally {
      await badServer.close();
    }

    // A well-formed 200 with an all-whitespace transcript means "no intelligible
    // speech" — a valid empty RESULT, not an error. Callers (TUI/desktop/Telegram/
    // HTTP) all have their own empty-text path; the transcriber must not throw past
    // them.
    const emptyServer = await startServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: '   ' }));
    });
    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: emptyServer.baseUrl });
      const result = await transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' });
      expect(result.text).toBe('');
    } finally {
      await emptyServer.close();
    }

    // A 200 that's missing the `text` field IS a contract violation → throw.
    const malformedServer = await startServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ notText: 1 }));
    });
    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: malformedServer.baseUrl });
      await expect(transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' }))
        .rejects
        .toThrow(/missing a text field/);
    } finally {
      await malformedServer.close();
    }
  });
});

describe('CodexOAuthTranscriber rich response fields', () => {
  it('surfaces language/duration/segments when the backend reports them', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const server = await startServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          text: '  hi there  ',
          language: 'en',
          duration: 2.5,
          segments: [
            { start: 0, end: 1.2, text: 'hi' },
            { start: 1.2, end: 2.5, text: 'there' },
            { start: 'bad', end: 3, text: 'dropped' },
          ],
        }),
      );
    });

    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: server.baseUrl });
      const result = await transcriber.transcribe(new Uint8Array([1, 2, 3]), {
        mimeType: 'audio/wav',
      });

      expect(result.text).toBe('hi there');
      expect(result.language).toBe('en');
      expect(result.durationSec).toBe(2.5);
      // Malformed segment (non-numeric start) is filtered out.
      expect(result.segments).toEqual([
        { start: 0, end: 1.2, text: 'hi' },
        { start: 1.2, end: 2.5, text: 'there' },
      ]);
    } finally {
      await server.close();
    }
  });

  it('returns only text when the backend omits the rich fields', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const server = await startServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'plain' }));
    });

    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: server.baseUrl });
      const result = await transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' });
      expect(result).toEqual({ text: 'plain' });
    } finally {
      await server.close();
    }
  });
});

describe('buildWhisperCodexPlugin createClient config merge', () => {
  it('keeps the host-wired vault/fetch authoritative when config tries to override them', async () => {
    const hostVault = await makeVault();
    await persistCodexTokens(hostVault, {
      access: 'host-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
      accountId: 'host-acct',
    });

    let captured: CapturedRequest | null = null;
    const server = await startServer((request, res) => {
      captured = request;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'host wins' }));
    });

    // A vault that, if used, would yield different (attacker) credentials.
    const evilVault = await makeVault();
    await persistCodexTokens(evilVault, {
      access: 'evil-token',
      refresh: 'evil-refresh',
      expires: Date.now() + 3_600_000,
      accountId: 'evil-acct',
    });
    const evilFetch = (() => {
      throw new Error('config-supplied fetch must not be used');
    }) as unknown as typeof fetch;

    try {
      const plugin = buildWhisperCodexPlugin({
        vault: hostVault,
        baseUrl: server.baseUrl,
        sessionIdProvider: () => 'host-session',
      });
      const def = plugin.transcribers?.[0];

      // Untrusted registry config attempts to shadow host-wired dependencies.
      const transcriber = def!.createClient({
        vault: evilVault,
        fetch: evilFetch,
      });
      const result = await transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), {
        mimeType: 'audio/wav',
      });

      expect(result.text).toBe('host wins');
      // Host vault credentials were used, not the config-supplied ones.
      expect(captured?.req.headers.authorization).toBe('Bearer host-token');
      expect(captured?.req.headers['chatgpt-account-id']).toBe('host-acct');
    } finally {
      await server.close();
    }
  });

  it('still honours the caller-overridable baseUrl/sessionIdProvider from config', async () => {
    const hostVault = await makeVault();
    await persistCodexTokens(hostVault, {
      access: 'host-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    let captured: CapturedRequest | null = null;
    const configServer = await startServer((request, res) => {
      captured = request;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: 'from config server' }));
    });

    try {
      // Host baseUrl points elsewhere; config must win for these whitelisted keys.
      const plugin = buildWhisperCodexPlugin({
        vault: hostVault,
        baseUrl: 'http://127.0.0.1:9',
        sessionIdProvider: () => 'host-session',
      });
      const def = plugin.transcribers?.[0];
      const transcriber = def!.createClient({
        baseUrl: configServer.baseUrl,
        sessionIdProvider: () => 'config-session',
      });

      const result = await transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), {
        mimeType: 'audio/wav',
      });

      expect(result.text).toBe('from config server');
      expect(captured?.req.headers.session_id).toBe('config-session');
    } finally {
      await configServer.close();
    }
  });
});

describe('CodexOAuthTranscriber hardening', () => {
  it('fast-fails on empty audio without loading tokens or hitting the network', async () => {
    // Empty vault would normally throw the login hint; an empty buffer must
    // short-circuit before that and never touch a (refused) endpoint.
    const vault = await makeVault();
    const fetchSpy = (() => {
      throw new Error('network must not be touched for empty audio');
    }) as unknown as typeof fetch;
    const transcriber = new CodexOAuthTranscriber({
      vault,
      baseUrl: 'http://127.0.0.1:9',
      fetch: fetchSpy,
    });
    const result = await transcriber.transcribe(new Uint8Array(0), { mimeType: 'audio/wav' });
    expect(result).toEqual({ text: '' });
  });

  it('rejects with NETWORK_TIMEOUT when the upstream accepts the connection but never responds', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const liveResponses: ServerResponse[] = [];
    const server = await startServer((_request, res) => {
      // Hold the request open forever — exercises the slow-loris / half-open path.
      liveResponses.push(res);
    });
    try {
      const transcriber = new CodexOAuthTranscriber({
        vault,
        baseUrl: server.baseUrl,
        requestTimeoutMs: 50,
      });
      await expect(
        transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), { mimeType: 'audio/wav' }),
      )
        .rejects
        .toMatchObject({ code: 'NETWORK_TIMEOUT' });
    } finally {
      for (const res of liveResponses) res.destroy();
      await server.close();
    }
  });

  it('rejects with NETWORK_TIMEOUT when headers arrive but the body never finishes (slow-loris body)', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    // Send a 200 + headers + one byte of body, then hold the body open forever.
    // The fetch promise resolves (headers are in), so a size-only cap wouldn't
    // help — the deadline must also span the body read.
    const liveResponses: ServerResponse[] = [];
    const server = await startServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      liveResponses.push(res);
      // Never call res.end(): the body stream dribbles and stalls.
    });
    try {
      const transcriber = new CodexOAuthTranscriber({
        vault,
        baseUrl: server.baseUrl,
        requestTimeoutMs: 80,
      });
      await expect(
        transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), { mimeType: 'audio/wav' }),
      )
        .rejects
        .toMatchObject({ code: 'NETWORK_TIMEOUT' });
    } finally {
      for (const res of liveResponses) res.destroy();
      await server.close();
    }
  });

  it('caps an oversized body read instead of buffering the whole thing', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    // A 200 whose body is megabytes of junk before any closing brace: the read
    // must stop at the cap (yielding unparseable truncated JSON) rather than
    // buffering it all. We assert it surfaces a structured PROVIDER error and
    // returns promptly, not that it OOMs.
    const server = await startServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(`{"text":"${'A'.repeat(8 * 1024 * 1024)}`); // 8MB, no closing quote/brace
    });
    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: server.baseUrl });
      await expect(
        transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), { mimeType: 'audio/wav' }),
      )
        .rejects
        .toMatchObject({ code: 'PROVIDER_UNKNOWN_RESPONSE' });
    } finally {
      await server.close();
    }
  });

  it('honours a caller AbortSignal mid-flight without hanging', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const liveResponses: ServerResponse[] = [];
    const server = await startServer((_request, res) => {
      // Hold open so the caller's own abort is what settles the promise.
      liveResponses.push(res);
    });
    try {
      const controller = new AbortController();
      const transcriber = new CodexOAuthTranscriber({
        vault,
        baseUrl: server.baseUrl,
        // Disable the internal deadline so only the caller signal can settle it.
        requestTimeoutMs: 0,
      });
      const pending = transcriber.transcribe(new Uint8Array([1, 2, 3, 4]), {
        mimeType: 'audio/wav',
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 30);
      await expect(pending).rejects.toMatchObject({ code: 'NETWORK_ABORTED' });
    } finally {
      for (const res of liveResponses) res.destroy();
      await server.close();
    }
  });

  it('truncates and sanitizes the body of an unmapped non-2xx status in the error cause', async () => {
    const vault = await makeVault();
    await persistCodexTokens(vault, {
      access: 'access-token',
      refresh: 'refresh-token',
      expires: Date.now() + 3_600_000,
    });

    const secret = 'X'.repeat(50_000);
    // 402 is not mapped by classifyHttpStatus → falls through to the raw path.
    const server = await startServer((_request, res) => {
      res.writeHead(402, { 'content-type': 'text/plain' });
      res.end(`set-cookie-leak ${secret}`);
    });
    try {
      const transcriber = new CodexOAuthTranscriber({ vault, baseUrl: server.baseUrl });
      let thrown: unknown;
      try {
        await transcriber.transcribe(new Uint8Array([1]), { mimeType: 'audio/wav' });
      } catch (err) {
        thrown = err;
      }
      expect((thrown as { code?: string }).code).toBe('PROVIDER_BAD_REQUEST');
      const cause = (thrown as { cause?: { message?: string } }).cause;
      // The full 50KB body must NOT be embedded verbatim in the cause.
      expect(cause?.message?.length ?? 0).toBeLessThanOrEqual(500);
      expect(cause?.message ?? '').not.toContain(secret);
    } finally {
      await server.close();
    }
  });
});

describe('Codex transcribe helpers', () => {
  it('builds the ChatGPT and local transcribe URLs', () => {
    expect(buildCodexTranscribeUrl()).toBe('https://chatgpt.com/backend-api/transcribe');
    expect(buildCodexTranscribeUrl('https://chatgpt.com')).toBe('https://chatgpt.com/backend-api/transcribe');
    expect(buildCodexTranscribeUrl('http://127.0.0.1:4567')).toBe('http://127.0.0.1:4567/transcribe');
    expect(buildCodexTranscribeUrl('http://127.0.0.1:4567/backend-api')).toBe(
      'http://127.0.0.1:4567/backend-api/transcribe',
    );
  });

  it('rejects a malformed base URL with CONFIG_INVALID instead of a raw TypeError', () => {
    expect(() => buildCodexTranscribeUrl('not a url')).toThrow(/Invalid Codex transcribe base URL/);
    expect(codeOf(() => buildCodexTranscribeUrl('not a url'))).toBe('CONFIG_INVALID');
  });

  it('refuses to target a non-chatgpt, non-loopback origin (bearer-token exfil guard)', () => {
    // A config-controlled host must not receive the live OAuth bearer token.
    expect(codeOf(() => buildCodexTranscribeUrl('https://evil.example.com'))).toBe('CONFIG_INVALID');
    // Plain-http chatgpt.com is also refused (must be https).
    expect(codeOf(() => buildCodexTranscribeUrl('http://chatgpt.com'))).toBe('CONFIG_INVALID');
    // Loopback over https/http stays allowed for the local/test seam.
    expect(() => buildCodexTranscribeUrl('http://127.0.0.1:4567')).not.toThrow();
  });

  it('wraps pcm16 mono 24khz bytes in a valid wav header', () => {
    const wav = pcm16MonoToWav(new Uint8Array([1, 0, 2, 0]), 24_000);
    const buf = Buffer.from(wav);

    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.readUInt32LE(24)).toBe(24_000);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.readUInt32LE(40)).toBe(4);
    expect(buf.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]));
  });
});
