/**
 * GPT-Live host handlers against the real stack: a real runner Session over a
 * real unix socket, a real encrypted vault holding ChatGPT OAuth tokens, and a
 * loopback HTTP server standing in for chatgpt.com (the external API). The
 * only other stand-ins are the Electron IPC bus and the runner process pool,
 * which exist to spawn/route OS processes this test already owns directly.
 */
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined },
  dialog: {},
  BrowserWindow: {},
}));

import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { persistCodexTokens } from '@moxxy/plugin-provider-openai-codex';
import {
  createStaticKeySource,
  deriveKey,
  generateSalt,
  VaultStore,
} from '@moxxy/plugin-vault';
import {
  connectRemoteSession,
  startRunnerServer,
  type RemoteSession,
  type RunnerServer,
  platformSocket,
} from '@moxxy/runner';
import { asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { buildInProcessPlugins } from '../in-process-plugins';
import type { RunnerPool } from '../runner-pool';
import { setActiveBus } from './shared';
import { registerSessionHandlers } from './session';
import { registerVoiceHandlers } from './voice';

type Handler = (...args: unknown[]) => Promise<unknown>;

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=ice-lite\r\n';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeVault(withLogin: boolean): Promise<VaultStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-gpt-live-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const vault = new VaultStore({
    filePath: path.join(dir, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test-passphrase', generateSalt())),
  });
  if (withLogin) {
    await persistCodexTokens(vault, {
      access: 'oauth-access-token',
      refresh: 'oauth-refresh-token',
      expires: Date.now() + 3_600_000,
      accountId: 'acct-live',
    });
  }
  return vault;
}

async function startRunner(): Promise<{ session: Session; remote: RemoteSession }> {
  const session = new Session({
    cwd: process.cwd(),
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });
  const name = `moxxy-live-${Math.random().toString(36).slice(2, 10)}`;
  const socketPath = platformSocket(name, path.join(os.tmpdir(), `${name}.sock`));
  const server: RunnerServer = await startRunnerServer(session, { socketPath });
  const remote = await connectRemoteSession({ socketPath, role: 'desktop-test' });
  cleanups.push(async () => {
    await remote.close();
    await server.close();
  });
  return { session, remote };
}

async function startBackend(): Promise<{
  readonly baseUrl: string;
  readonly requests: Array<{ headers: IncomingHttpHeaders; body: { session: Record<string, unknown> } }>;
}> {
  const requests: Array<{ headers: IncomingHttpHeaders; body: { session: Record<string, unknown> } }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
    requests.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(201, { location: '/v1/realtime/calls/rtc_u32_TestCall123' });
    res.end(ANSWER);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/backend-api`, requests };
}

function registerHandlers(remote: RemoteSession, vault: VaultStore, baseUrl?: string): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus);
  const pool = {
    activeWorkspaceId: () => 'workspace-1',
    get: (id: string) => (id === 'workspace-1' ? { remote: () => remote } : undefined),
    list: () => [],
  } as unknown as RunnerPool;
  const plugins = buildInProcessPlugins({ vault, ...(baseUrl ? { gptLiveBaseUrl: baseUrl } : {}) });
  registerVoiceHandlers(pool, { inProcessPlugins: () => plugins });
  registerSessionHandlers(pool);
  return handlers;
}

async function seedConversation(session: Session): Promise<void> {
  const turnId = asTurnId('seeded-turn');
  await session.log.append({
    type: 'user_prompt',
    sessionId: session.id,
    turnId,
    source: 'user',
    text: 'Sekretne słowo to pomarańcza.',
  });
  await session.log.append({
    type: 'assistant_message',
    sessionId: session.id,
    turnId,
    source: 'model',
    content: 'Zapamiętałem sekretne słowo.',
    stopReason: 'end_turn',
  });
}

describe('GPT-Live voice handlers', () => {
  it('reports whether the existing ChatGPT login can back GPT-Live', async () => {
    const { remote } = await startRunner();

    const signedIn = registerHandlers(remote, await makeVault(true));
    await expect(signedIn.get('voice.live.preflight')?.()).resolves.toEqual({ authenticated: true });

    const signedOut = registerHandlers(remote, await makeVault(false));
    await expect(signedOut.get('voice.live.preflight')?.()).resolves.toEqual({ authenticated: false });
  });

  it('opens a call seeded with the workspace chat and host-pinned instructions', async () => {
    const { session, remote } = await startRunner();
    await seedConversation(session);
    const backend = await startBackend();
    const handlers = registerHandlers(remote, await makeVault(true), backend.baseUrl);

    const answer = await handlers.get('voice.live.start')?.({ workspaceId: 'workspace-1', sdp: OFFER });

    expect(answer).toEqual({ sdp: ANSWER, callId: 'rtc_u32_TestCall123' });
    const [request] = backend.requests;
    expect(request?.headers.authorization).toBe('Bearer oauth-access-token');
    expect(request?.headers['chatgpt-account-id']).toBe('acct-live');
    expect(request?.body.session.initial_items).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Sekretne słowo to pomarańcza.' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Zapamiętałem sekretne słowo.' }] },
    ]);
    const instructions = String(request?.body.session.instructions);
    expect(instructions).toMatch(/delegate only when the user explicitly asks/i);
    expect(instructions).toMatch(/never say or imply the work is done/i);
    expect(instructions).toMatch(/until the delegation result arrives/i);
    expect(instructions).toMatch(/progress.*answer.*yourself.*never delegate/i);
    expect(instructions).toMatch(/one task at a time.*must finish/i);
    expect(instructions).not.toMatch(/queued/i);
  });

  it('records a spoken exchange into the workspace session as one ordinary turn', async () => {
    const { session, remote } = await startRunner();
    const handlers = registerHandlers(remote, await makeVault(true));

    await handlers.get('session.recordVoiceExchange')?.({
      workspaceId: 'workspace-1',
      userText: 'Jaka jest stolica Francji?',
      assistantText: 'Stolicą Francji jest Paryż.',
    });

    const conversation = session.log
      .toJSON()
      .filter((event: MoxxyEvent) => event.type === 'user_prompt' || event.type === 'assistant_message');
    expect(conversation.map((event) => event.type)).toEqual(['user_prompt', 'assistant_message']);
    expect(conversation[0]?.turnId).toBe(conversation[1]?.turnId);
  });
});
