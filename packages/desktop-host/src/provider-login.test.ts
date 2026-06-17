/**
 * The provider-login relay: spawn `moxxy login --stdin-prompts`, turn its
 * stdout into output/prompt events, feed answers to its stdin, and finish on
 * exit. The CLI + stream format are exercised for real elsewhere (the SDK
 * scanner test + a live `--stdin-prompts` run); here we mock the subprocess to
 * pin the glue: arg shape, event fan-out, stdin writes, and cancel semantics.
 */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeLoginPrompt } from '@moxxy/sdk';

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
  spawnCli: (...args: unknown[]) => h.spawn!(...args),
}));
vi.mock('./send-event', () => ({
  sendEvent: (_w: unknown, channel: string, payload: Record<string, unknown>) =>
    h.sent.push({ channel, payload }),
}));
vi.mock('./security', () => ({ assertSafeProviderName: () => undefined }));

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

  it('relays plain stdout as output and markers as prompts', () => {
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
  });

  it('writes one stdin line per answer (stripping embedded newlines)', () => {
    startProviderLogin('id2', 'claude-code', fakeWindow);
    answerProviderLogin('id2', 'tok\nen');
    expect(current.stdin.write).toHaveBeenCalledWith('token\n');
  });

  it('emits done + onExit on a normal exit', () => {
    const onExit = vi.fn();
    startProviderLogin('id3', 'claude-code', fakeWindow, { onExit });
    current.emit('exit', 0);
    expect(events('provider.login.done')[0]).toEqual({ loginId: 'id3', code: 0 });
    expect(onExit).toHaveBeenCalledWith(0);
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
