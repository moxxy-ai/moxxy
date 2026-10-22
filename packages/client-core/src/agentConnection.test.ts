import { describe, expect, it } from 'vitest';
import type { AgentCliReport } from '@moxxy/sdk';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import { agentConnectionView, isProviderConnected, type AgentCliJob } from './agentConnection.js';

const report = (over: Partial<AgentCliReport> = {}): AgentCliReport => ({
  state: 'current',
  command: 'codex',
  installed: '0.162.1',
  latest: '0.162.1',
  minimum: '0.155.1',
  checkedAt: 1,
  signedIn: true,
  account: 'ada@example.com',
  ...over,
});

const entry = (agentCli?: AgentCliReport, over: Partial<ProviderEntry> = {}): ProviderEntry => ({
  name: 'codex-agent',
  agentName: 'Codex',
  ready: true,
  enabled: true,
  active: false,
  authKind: 'oauth',
  kind: 'builtin',
  keyName: 'CODEX_AGENT_API_KEY',
  ...(agentCli ? { agentCli } : {}),
  ...over,
});

const view = (e: ProviderEntry, job: AgentCliJob | null = null, checking = false) => agentConnectionView(e, { job, checking });

describe('an agent connection row', () => {
  it('is connected, naming the account, when the CLI is current and signed in', () => {
    expect(view(entry(report()))).toMatchObject({
      state: 'connected',
      detail: 'ada@example.com · Codex 0.162.1',
      action: null,
    });
  });

  it('asks to sign in when the agent is signed out', () => {
    expect(view(entry(report({ signedIn: false, account: null }), { ready: false }))).toMatchObject({
      state: 'not-connected',
      action: 'sign-in',
    });
  });

  it('offers to install a missing CLI', () => {
    expect(view(entry(report({ state: 'missing', installed: null })))).toMatchObject({
      state: 'not-installed',
      detail: 'Codex is not installed on this computer',
      action: 'install',
    });
  });

  it('shows how far an install got, and why it failed', () => {
    const missing = entry(report({ state: 'missing', installed: null }));
    expect(view(missing, { action: 'install', running: true, line: 'Downloading', fraction: 0.4, error: null })).toMatchObject({
      state: 'installing',
      detail: 'Downloading',
      progress: 0.4,
      action: null,
    });
    expect(view(missing, { action: 'install', running: false, line: null, fraction: null, error: 'curl: (6) Could not resolve host' })).toMatchObject({
      state: 'install-failed',
      detail: 'curl: (6) Could not resolve host',
      action: 'install',
    });
  });

  it('says when an update is required, before anything else about it', () => {
    expect(view(entry(report({ state: 'update-required', installed: '0.150.0', signedIn: false })))).toMatchObject({
      state: 'update-required',
      detail: 'Codex 0.150.0 is older than Moxxy works with — update it to 0.155.1 or newer',
      action: 'update',
    });
  });

  it('offers no update of a CLI inside an app, which the app updates', () => {
    const inside = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

    expect(view(entry(report({ state: 'update-required', installed: '0.150.0', path: inside, origin: 'app' })))).toMatchObject({
      state: 'update-required',
      detail: `Codex 0.150.0 at ${inside} is older than Moxxy works with — it is part of ChatGPT.app, which updates it`,
      action: null,
    });
    expect(view(entry(report({ state: 'update-available', installed: '0.155.1', path: inside, origin: 'app' })))).toMatchObject({ state: 'connected', action: null });
  });

  it('offers an update the vendor published', () => {
    expect(view(entry(report({ state: 'update-available', installed: '0.155.1' })))).toMatchObject({
      state: 'update-available',
      detail: 'ada@example.com · Codex 0.162.1 is out — you have 0.155.1',
      action: 'update',
    });
  });

  it('is checking until the first check ends, and while asked to check again', () => {
    expect(view(entry())).toMatchObject({ state: 'checking', action: null });
    expect(view(entry(report()), null, true)).toMatchObject({ state: 'checking' });
  });

  it('is unavailable when the CLI is there but says no version', () => {
    expect(view(entry(report({ state: 'unknown', installed: null })))).toMatchObject({
      state: 'unavailable',
      detail: "Codex is installed, but Moxxy could not read its version",
      action: 'check',
    });
  });

  it('keeps the update after a failed update, saying why it failed', () => {
    const outdated = entry(report({ state: 'update-available', installed: '0.155.1' }));
    expect(view(outdated, { action: 'update', running: false, line: null, fraction: null, error: 'Wait until the running turns end' })).toMatchObject({
      state: 'update-available',
      detail: 'Wait until the running turns end',
      action: 'update',
    });
  });
});

describe('whether a provider can be picked', () => {
  const api = (over: Partial<ProviderEntry> = {}): ProviderEntry => ({
    name: 'openai',
    ready: true,
    enabled: true,
    active: false,
    authKind: 'api-key',
    kind: 'builtin',
    keyName: 'OPENAI_API_KEY',
    ...over,
  });

  it('takes a provider whose credentials resolved', () => {
    expect(isProviderConnected(api())).toBe(true);
  });

  it('leaves out a provider with no key, and one turned off', () => {
    expect(isProviderConnected(api({ ready: false }))).toBe(false);
    expect(isProviderConnected(api({ enabled: false }))).toBe(false);
  });

  it('leaves out a local server that does not answer, though it is configured', () => {
    expect(isProviderConnected(api({ name: 'local', connected: false }))).toBe(false);
    expect(isProviderConnected(api({ name: 'local', connected: true }))).toBe(true);
  });

  it('takes an agent that is installed and signed in, also with an update waiting', () => {
    expect(isProviderConnected(entry(report()))).toBe(true);
    expect(isProviderConnected(entry(report({ state: 'update-available', latest: '0.163.0' })))).toBe(true);
  });

  it('leaves out an agent that is missing, signed out, too old or not checked yet', () => {
    expect(isProviderConnected(entry(report({ state: 'missing', installed: null, signedIn: undefined })))).toBe(false);
    expect(isProviderConnected(entry(report({ signedIn: false })))).toBe(false);
    expect(isProviderConnected(entry(report({ state: 'update-required', installed: '0.150.0' })))).toBe(false);
    expect(isProviderConnected(entry())).toBe(false);
  });
});
