import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REST } from 'discord.js';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import {
  asSessionId,
  asToolCallId,
  asTurnId,
  assertDefined,
  type ToolContext,
  type ToolDef,
} from '@moxxy/sdk';
import { buildDiscordPlugin } from '../index.js';
import { DISCORD_AUTHORIZED_USER_KEY, DISCORD_TOKEN_ENV, DISCORD_TOKEN_KEY } from '../keys.js';
import { DISCORD_MESSAGE_LIMIT } from '../render.js';
import { buildDiscordSendMessageTool } from './send-message.js';

const OWNER_ID = '123456789012345678';
const DM_CHANNEL_ID = '987654321098765432';
const VAULT_TOKEN = 'vault-token-aaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccc';
const ENV_TOKEN = 'env-token-aaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccc';

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

/**
 * Test double for the ONE external boundary here — Discord's HTTP API. The
 * real discord.js `REST` client (routing, auth header, error mapping) runs
 * unchanged; only the wire call (`makeRequest`, the documented fetch seam) is
 * answered locally.
 */
function fakeDiscordApi(
  respond: (req: RecordedRequest) => { status: number; body: unknown } = defaultRespond,
) {
  const requests: RecordedRequest[] = [];
  const makeRequest = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers as HeadersInit);
    const req: RecordedRequest = {
      method: init.method ?? 'GET',
      url,
      authorization: headers.get('authorization'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : multipart(init.body),
    };
    requests.push(req);
    const { status, body } = respond(req);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { requests, makeRequest };
}

/** A multipart upload as the test reads it: the JSON payload + the file names. */
function multipart(body: unknown): unknown {
  if (!(body instanceof FormData)) return null;
  const files: string[] = [];
  body.forEach((value, key) => {
    if (key.startsWith('files[') && value instanceof Blob) files.push((value as File).name);
  });
  return { payload: JSON.parse(String(body.get('payload_json'))), files };
}

function defaultRespond(req: RecordedRequest): { status: number; body: unknown } {
  if (req.url.endsWith('/users/@me/channels')) {
    return { status: 200, body: { id: DM_CHANNEL_ID, type: 1 } };
  }
  return { status: 200, body: { id: String(Date.now()), channel_id: DM_CHANNEL_ID } };
}

const ctx = (): ToolContext => ({
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

let tmp: string;
let vault: VaultStore;
let savedEnvToken: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dc-send-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  savedEnvToken = process.env[DISCORD_TOKEN_ENV];
  delete process.env[DISCORD_TOKEN_ENV];
});

afterEach(async () => {
  if (savedEnvToken === undefined) delete process.env[DISCORD_TOKEN_ENV];
  else process.env[DISCORD_TOKEN_ENV] = savedEnvToken;
  await fs.rm(tmp, { recursive: true, force: true });
});

function toolWith(api: ReturnType<typeof fakeDiscordApi>): ToolDef {
  return buildDiscordSendMessageTool({
    getVault: () => vault,
    createRest: (token) =>
      new REST({ version: '10', makeRequest: api.makeRequest as never }).setToken(token),
  });
}

async function pairOwner(): Promise<void> {
  await vault.set(DISCORD_TOKEN_KEY, VAULT_TOKEN);
  await vault.set(DISCORD_AUTHORIZED_USER_KEY, OWNER_ID);
}

describe('discord_send_message', () => {
  it('opens a DM with the paired owner and posts the text there', async () => {
    await pairOwner();
    const api = fakeDiscordApi();

    const out = await toolWith(api).handler({ text: 'Zadanie gotowe ✅' }, ctx());

    expect(api.requests).toHaveLength(2);
    const [openDm, post] = api.requests;
    assertDefined(openDm, 'DM open request');
    assertDefined(post, 'message post request');
    expect(openDm.method).toBe('POST');
    expect(openDm.url).toMatch(/\/v10\/users\/@me\/channels$/);
    expect(openDm.body).toEqual({ recipient_id: OWNER_ID });
    expect(openDm.authorization).toBe(`Bot ${VAULT_TOKEN}`);
    expect(post.url).toMatch(new RegExp(`/v10/channels/${DM_CHANNEL_ID}/messages$`));
    expect(post.body).toEqual({ content: 'Zadanie gotowe ✅', allowed_mentions: { parse: [] } });
    expect(out).toEqual({ delivered: true, userId: OWNER_ID, parts: 1 });
  });

  it('splits text over the Discord message limit into ordered parts', async () => {
    await pairOwner();
    const api = fakeDiscordApi();
    const line = 'x'.repeat(100);
    const text = Array.from({ length: 40 }, (_, i) => `${i}:${line}`).join('\n');
    expect(text.length).toBeGreaterThan(DISCORD_MESSAGE_LIMIT);

    const out = (await toolWith(api).handler({ text }, ctx())) as { parts: number };

    const posts = api.requests.filter((r) => r.url.endsWith('/messages'));
    expect(out.parts).toBe(posts.length);
    expect(posts.length).toBeGreaterThan(1);
    const contents = posts.map((p) => (p.body as { content: string }).content);
    for (const c of contents) expect(c.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(contents.join('\n')).toBe(text);
  });

  it('prefers the MOXXY_DISCORD_TOKEN env override over the vault token', async () => {
    await pairOwner();
    process.env[DISCORD_TOKEN_ENV] = ENV_TOKEN;
    const api = fakeDiscordApi();

    await toolWith(api).handler({ text: 'hi' }, ctx());

    expect(api.requests.every((r) => r.authorization === `Bot ${ENV_TOKEN}`)).toBe(true);
  });

  it('fails without calling Discord when no bot token is configured', async () => {
    await vault.set(DISCORD_AUTHORIZED_USER_KEY, OWNER_ID);
    const api = fakeDiscordApi();

    await expect(toolWith(api).handler({ text: 'hi' }, ctx())).rejects.toThrow(/bot token/i);
    expect(api.requests).toHaveLength(0);
  });

  it('fails without calling Discord when no owner is paired', async () => {
    await vault.set(DISCORD_TOKEN_KEY, VAULT_TOKEN);
    const api = fakeDiscordApi();

    await expect(toolWith(api).handler({ text: 'hi' }, ctx())).rejects.toThrow(/pair/i);
    expect(api.requests).toHaveLength(0);
  });

  it('surfaces a Discord API rejection instead of reporting delivery', async () => {
    await pairOwner();
    const api = fakeDiscordApi((req) =>
      req.url.endsWith('/messages')
        ? { status: 403, body: { message: 'Cannot send messages to this user', code: 50007 } }
        : defaultRespond(req),
    );

    await expect(toolWith(api).handler({ text: 'hi' }, ctx())).rejects.toThrow(
      /Cannot send messages to this user/,
    );
  });

  it('rejects empty text at the schema boundary', () => {
    const tool = toolWith(fakeDiscordApi());
    expect(tool.inputSchema.safeParse({ text: '' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ text: 'ok' }).success).toBe(true);
  });

  it('is contributed by the plugin, gated by a permission prompt, and only reaches discord.com', () => {
    const plugin = buildDiscordPlugin({ vault });
    const tool = (plugin.tools ?? []).find((t) => t.name === 'discord_send_message');
    assertDefined(tool, 'discord_send_message tool');
    expect(tool.permission).toEqual({ action: 'prompt' });
    expect(tool.isolation?.capabilities.net).toEqual({ mode: 'allowlist', hosts: ['discord.com'] });
  });

  it('attaches local files to the owner DM, after the text', async () => {
    await pairOwner();
    const api = fakeDiscordApi();
    const clip = path.join(tmp, 'clip.mp4');
    await fs.writeFile(clip, Buffer.from('not really a video'));

    const out = await toolWith(api).handler({ text: 'Proszę, oto plik', files: [clip] }, ctx());

    const posts = api.requests.filter((r) => r.url.endsWith('/messages'));
    expect(posts.at(-1)?.body).toEqual({
      payload: { content: 'Proszę, oto plik', allowed_mentions: { parse: [] } },
      files: ['clip.mp4'],
    });
    expect(out).toEqual({ delivered: true, userId: OWNER_ID, parts: 1, files: ['clip.mp4'] });
  });

  it("refuses files over Discord's upload limit before contacting Discord", async () => {
    await pairOwner();
    const api = fakeDiscordApi();
    const big = path.join(tmp, 'trailer.mp4');
    await fs.writeFile(big, '');
    await fs.truncate(big, 11 * 1024 * 1024);

    await expect(toolWith(api).handler({ text: 'film', files: [big] }, ctx())).rejects.toThrow(/10 MB/u);
    expect(api.requests).toHaveLength(0);
  });

  it('refuses a path that is not a file', async () => {
    await pairOwner();
    const api = fakeDiscordApi();

    await expect(toolWith(api).handler({ text: 'folder', files: [tmp] }, ctx())).rejects.toThrow(/not a file/u);
    expect(api.requests).toHaveLength(0);
  });
});
