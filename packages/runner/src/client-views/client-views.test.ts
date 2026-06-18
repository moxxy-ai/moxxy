/**
 * Focused unit tests for the per-surface client-view factories (extracted from
 * RemoteSession). Each factory is pure: hand it a {@link ViewContext} (a stub
 * JSON-RPC peer + an info snapshot + the protocol gate) and assert it (a) reads
 * the snapshot for display-only fields and (b) forwards mutations/actions to the
 * runner over the expected RPC method + params. A recording transport captures
 * every outbound frame and lets us answer requests by hand.
 */
import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@moxxy/sdk';
import { JsonRpcPeer } from '../jsonrpc.js';
import type { Transport } from '../transport.js';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';
import { makeProvidersView } from './providers.js';
import { makeModesView } from './modes.js';
import { makeToolsView } from './tools.js';
import { makeCommandsView } from './commands.js';
import { makeSkillsView } from './skills.js';
import { makePermissionsView } from './permissions.js';
import { makeMcpAdminView } from './mcp-admin.js';
import { makeProviderAdminView } from './provider-admin.js';
import { makeWorkflowsView } from './workflows.js';
import { fakeProvider, fakeProviderDef, fakeMode, fakeTool, fakeSkill } from './fakes.js';

interface SentRequest {
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

/** A transport that records outbound request frames and lets the test reply. */
function recordingPeer(): {
  peer: JsonRpcPeer;
  sent: SentRequest[];
  reply: (id: number, result: unknown) => void;
} {
  const sent: SentRequest[] = [];
  let onFrame: ((f: unknown) => void) | undefined;
  const transport: Transport = {
    send: (f) => {
      const frame = f as SentRequest;
      // Only requests carry a numeric id + method; ignore notifications.
      if (typeof frame.id === 'number' && typeof frame.method === 'string') sent.push(frame);
    },
    onFrame: (h) => {
      onFrame = h;
    },
    onClose: () => undefined,
    close: () => undefined,
  };
  const peer = new JsonRpcPeer(transport);
  return {
    peer,
    sent,
    reply: (id, result) => onFrame?.({ id, result }),
  };
}

const baseInfo: SessionInfo = {
  sessionId: 'sess',
  cwd: '/tmp',
  providers: [
    {
      name: 'openai',
      models: [{ id: 'gpt', contextWindow: 1 }],
      authKind: 'api-key',
      supportsLiveModelDiscovery: false,
    },
    {
      name: 'anthropic',
      models: [{ id: 'opus', contextWindow: 2 }],
      authKind: 'api-key',
      supportsLiveModelDiscovery: false,
    },
  ],
  tools: [{ name: 'read', description: 'read a file' }],
  modes: ['default', 'goal'],
  skills: [{ id: 'sk1', name: 'Skill One' }],
  commands: [
    { name: 'info', description: 'show info' },
    { name: 'compact', description: 'compact', aliases: ['c'], channels: ['tui'] },
  ],
  readyProviders: ['openai'],
  activeProvider: 'openai',
  activeMode: 'default',
  activeModeBadge: null,
  hasTranscriber: false,
  activeTranscriber: null,
  hasSynthesizer: false,
  activeSynthesizer: null,
};

function ctxFor(
  peer: JsonRpcPeer,
  info: SessionInfo | null = baseInfo,
  serverVersion = 8,
): ViewContext {
  return {
    peer,
    info: () => info,
    requireInfo: () => {
      if (!info) throw new Error('not attached');
      return info;
    },
    requireServerProtocol: (minVersion, feature) => {
      if (serverVersion < minVersion) {
        throw new Error(`${feature} is not supported by this runner`);
      }
    },
  };
}

describe('client-views: snapshot-backed reads', () => {
  it('providers view reads active/list from the info snapshot', () => {
    const { peer } = recordingPeer();
    const view = makeProvidersView(ctxFor(peer));
    expect(view.getActiveName()).toBe('openai');
    expect(view.getActive().name).toBe('openai');
    expect(view.list().map((p) => p.name)).toEqual(['openai', 'anthropic']);
  });

  it('modes/tools/skills views map the snapshot through the fakes', () => {
    const { peer } = recordingPeer();
    const ctx = ctxFor(peer);
    expect(makeModesView(ctx).getActive().name).toBe('default');
    expect(makeModesView(ctx).list().map((m) => m.name)).toEqual(['default', 'goal']);
    expect(makeToolsView(ctx).get('read')?.name).toBe('read');
    expect(makeToolsView(ctx).get('missing')).toBeUndefined();
    expect(makeSkillsView(ctx).list().map((s) => s.id)).toEqual(['sk1']);
  });

  it('commands view resolves by name OR alias and filters by channel', () => {
    const { peer } = recordingPeer();
    const view = makeCommandsView(ctxFor(peer));
    expect(view.get('compact')?.name).toBe('compact');
    expect(view.get('c')?.name).toBe('compact'); // alias
    // `info` has no channels restriction → visible everywhere; `compact` only on tui.
    expect(view.listForChannel('telegram').map((c) => c.name)).toEqual(['info']);
    expect(view.listForChannel('tui').map((c) => c.name)).toEqual(['info', 'compact']);
  });
});

describe('client-views: RPC-backed actions forward the right method + params', () => {
  it('providers.setActive forwards provider.setActive', () => {
    const { peer, sent } = recordingPeer();
    const view = makeProvidersView(ctxFor(peer));
    view.setActive('anthropic', { key: 'v' });
    expect(sent[0]?.method).toBe(RunnerMethod.ProviderSetActive);
    expect(sent[0]?.params).toEqual({ name: 'anthropic', config: { key: 'v' } });
  });

  it('modes.setActive forwards mode.setActive', () => {
    const { peer, sent } = recordingPeer();
    makeModesView(ctxFor(peer)).setActive('goal');
    expect(sent[0]?.method).toBe(RunnerMethod.ModeSetActive);
    expect(sent[0]?.params).toEqual({ name: 'goal' });
  });

  it('permissions.addAllow forwards permission.addAllow', async () => {
    const { peer, sent, reply } = recordingPeer();
    const p = makePermissionsView(ctxFor(peer)).addAllow({ name: 'read', reason: 'safe' });
    reply(sent[0]!.id, {});
    await p;
    expect(sent[0]?.method).toBe(RunnerMethod.PermissionAddAllow);
    expect(sent[0]?.params).toEqual({ name: 'read', reason: 'safe' });
  });

  it('mcpAdmin.detach forwards mcp.detach and resolves the reply', async () => {
    const { peer, sent, reply } = recordingPeer();
    const promise = makeMcpAdminView(ctxFor(peer)).detach('serverX');
    expect(sent[0]?.method).toBe(RunnerMethod.McpDetach);
    expect(sent[0]?.params).toEqual({ name: 'serverX' });
    reply(sent[0]!.id, true);
    expect(await promise).toBe(true);
  });
});

describe('client-views: protocol gating', () => {
  it('providerAdmin.setEnabled throws against a too-old runner (v6 < v7)', async () => {
    const { peer } = recordingPeer();
    const view = makeProviderAdminView(ctxFor(peer, baseInfo, 6));
    await expect(view.setEnabled('openai', false)).rejects.toThrow(/not supported by this runner/);
  });

  it('workflows.resume throws against a too-old runner (v4 < v5)', async () => {
    const { peer } = recordingPeer();
    const view = makeWorkflowsView(ctxFor(peer, baseInfo, 4));
    await expect(view.resume('run1', 'go')).rejects.toThrow(/not supported by this runner/);
  });

  it('workflows.run is ungated and forwards workflow.run', async () => {
    const { peer, sent, reply } = recordingPeer();
    const view = makeWorkflowsView(ctxFor(peer, baseInfo, 4));
    const promise = view.run('wf');
    expect(sent[0]?.method).toBe(RunnerMethod.WorkflowRun);
    reply(sent[0]!.id, { ok: true, output: 'done', steps: [] });
    expect((await promise).ok).toBe(true);
  });
});

describe('client-views: fakes stub behavioral fields', () => {
  it('fakeProvider streaming/token-counting throw (work runs on the runner)', async () => {
    const p = fakeProvider('x', []);
    expect(() => p.stream({} as never)).toThrow(/runs on the runner/);
    await expect(p.countTokens({} as never)).rejects.toThrow(/runs on the runner/);
  });

  it('fakeProviderDef.createClient yields a fakeProvider', () => {
    const def = fakeProviderDef({ name: 'y', models: [] });
    expect(def.createClient({} as never).name).toBe('y');
  });

  it('fakeMode/fakeTool throw on execution; fakeSkill carries display fields', () => {
    expect(() => fakeMode('m').run({} as never)).toThrow(/modes run on the runner/);
    expect(() => fakeTool({ name: 't', description: 'd' }).handler({} as never, {} as never)).toThrow(
      /tools execute on the runner/,
    );
    const skill = fakeSkill({ id: 'sk', name: 'S' });
    expect(skill.frontmatter.name).toBe('S');
    expect(skill.scope).toBe('plugin');
  });
});
