/**
 * The provider-login relay: spawn `moxxy login --stdin-prompts`, turn its
 * stdout into output/prompt events, feed answers to its stdin, and finish on
 * exit. The CLI + stream format are exercised for real elsewhere (the SDK
 * scanner test + a live `--stdin-prompts` run); here we mock the subprocess to
 * pin the glue: arg shape, event fan-out, stdin writes, and cancel semantics.
 */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDefined, encodeLoginAuthUrl, encodeLoginPrompt } from '@moxxy/sdk';

const h = vi.hoisted(() => ({
  spawn: undefined as undefined | ((...args: unknown[]) => unknown),
  sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
}));

// `electron` is a type-only import in provider-login.ts, but the CI test
// environment may not have electron's native binary installed (esp. Node 24),
// so stub it — matching the sibling desktop-host tests — to keep collection
// from touching the real package.
vi.mock('electron', () => ({}));
vi.mock('./cli-resolver', () => ({
  augmentedPaths: () => [],
  resolveMoxxyCli: () => ({ kind: 'direct', bin: '/fake/moxxy' }),
  spawnCli: (...args: unknown[]) => {
    assertDefined(h.spawn, 'spawn stub');
    return h.spawn(...args);
  },
}));
vi.mock('./send-event', () => ({
  sendEvent: (_w: unknown, channel: string, payload: Record<string, unknown>) =>
    h.sent.push({ channel, payload }),
}));
import {
  answerProviderLogin,
  cancelProviderLogin,
  startProviderLogin,
} from './provider-login';

function makeChild(): {
  child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { write: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> };
} {
  const child = new EventEmitter() as never as ReturnType<typeof makeChild>['child'];
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return { child };
}

const fakeWindow = { once: vi.fn() } as never;
let spawnArgs: unknown[] = [];
let current: ReturnType<typeof makeChild>['child'];

beforeEach(() => {
  h.sent.length = 0;
  spawnArgs = [];
  const { child } = makeChild();
  current = child;
  h.spawn = (...args: unknown[]) => {
    spawnArgs = args;
    return child;
  };
});

const events = (channel: string): Array<Record<string, unknown>> =>
  h.sent.filter((s) => s.channel === channel).map((s) => s.payload);

describe('provider-login relay', () => {
  it('spawns `moxxy login <provider> --stdin-prompts` with piped stdio', () => {
    startProviderLogin('id1', 'claude-code', fakeWindow);
    expect(spawnArgs[1]).toEqual(['login', 'claude-code', '--stdin-prompts']);
    expect((spawnArgs[2] as { stdio: unknown }).stdio).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('relays plain stdout as output and markers as masked prompts without credential echo', () => {
    startProviderLogin('idR', 'claude-code', fakeWindow);
    current.stdout.emit(
      'data',
      Buffer.from('opening…\n' + encodeLoginPrompt({ question: 'Paste:', mask: true })),
    );
    expect(events('provider.login.output').map((p) => p.text)).toContain('opening…\n');
    expect(events('provider.login.prompt')[0]).toEqual({
      loginId: 'idR',
      question: 'Paste:',
      mask: true,
    });
    answerProviderLogin('idR', 'subscription-secret');
    expect(events('provider.login.output').flatMap((event) => Object.values(event))).not.toContain('subscription-secret');
  });

  it('opens a validated auth URL through the injected Electron callback and emits a renderer fallback event', async () => {
    const openExternal = vi.fn(async () => undefined);
    const url = 'https://auth.example.test/authorize?state=opaque';
    startProviderLogin('id-auth', 'openai-codex', fakeWindow, { openExternal });

    current.stdout.emit('data', Buffer.from(encodeLoginAuthUrl(url)));

    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledWith(url));
    expect(events('provider.login.authUrl')[0]).toEqual({ loginId: 'id-auth', url });
  });

  it('keeps the renderer fallback available when the native browser opener throws synchronously', () => {
    const openExternal = vi.fn((_url: string): Promise<void> => {
      throw new Error('native opener unavailable');
    });
    const url = 'https://auth.example.test/authorize?state=opaque';
    startProviderLogin('id-auth-fallback', 'openai-codex', fakeWindow, { openExternal });

    expect(() => current.stdout.emit('data', Buffer.from(encodeLoginAuthUrl(url)))).not.toThrow();
    expect(events('provider.login.authUrl')[0]).toEqual({ loginId: 'id-auth-fallback', url });
    expect(events('provider.login.output').map((event) => event.text)).toContainEqual(
      expect.stringContaining('Could not open the sign-in page automatically'),
    );
  });

  it.each([
    ['unsafe-file', 'file:///etc/passwd'],
    ['unsafe-js', 'javascript:alert(1)'],
    ['unsafe-creds', 'https://alice:secret@auth.example.test/authorize'],
  ])('does not open or emit a forged unsafe auth URL marker: %s', (loginId, url) => {
    const openExternal = vi.fn(async () => undefined);
    startProviderLogin(loginId, 'openai-codex', fakeWindow, {
      openExternal,
    });
    const forged = `\u0000${JSON.stringify({ tag: 'moxxy.login.auth_url', url })}\u0000`;

    current.stdout.emit('data', Buffer.from(forged));

    expect(openExternal).not.toHaveBeenCalled();
    expect(events('provider.login.authUrl')).toHaveLength(0);
  });

  it('writes one stdin line per answer (stripping embedded newlines)', () => {
    startProviderLogin('id2', 'claude-code', fakeWindow);
    answerProviderLogin('id2', 'tok\nen');
    expect(current.stdin.write).toHaveBeenCalledWith('token\n');
  });

  it.each([
    ['successful', 0],
    ['failed', 7],
  ])('emits done + onExit for a %s Claude CLI outcome', (_label, code) => {
    const onExit = vi.fn();
    startProviderLogin('id3', 'claude-code', fakeWindow, { onExit });
    current.emit('exit', code);
    expect(events('provider.login.done')[0]).toEqual({ loginId: 'id3', code });
    expect(onExit).toHaveBeenCalledWith(code);
  });

  it('relays missing-binary errors as diagnostics and a failed outcome', () => {
    startProviderLogin('missing', 'claude-code', fakeWindow);
    current.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    expect(events('provider.login.output')[0]?.text).toMatch(/ENOENT/);
    expect(events('provider.login.done')[0]).toEqual({ loginId: 'missing', code: -1 });
  });

  it('cancel kills the child and suppresses the done event', () => {
    const onExit = vi.fn();
    startProviderLogin('id4', 'claude-code', fakeWindow, { onExit });
    cancelProviderLogin('id4');
    expect(current.kill).toHaveBeenCalled();
    current.emit('exit', 0); // late exit after cancel
    expect(events('provider.login.done')).toHaveLength(0);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('rejects a second login reusing a live id', () => {
    startProviderLogin('dup', 'claude-code', fakeWindow);
    expect(() => startProviderLogin('dup', 'claude-code', fakeWindow)).toThrow(/already running/);
  });
});
