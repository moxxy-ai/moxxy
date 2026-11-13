import { describe, expect, it } from 'vitest';
import type { AgentCliJob } from '@moxxy/client-core';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import type { AgentCliReport } from '@moxxy/sdk';
import { readyPlan, startOption } from './start-options';

const report = (over: Partial<AgentCliReport> = {}): AgentCliReport => ({
  state: 'current',
  command: 'claude',
  installed: '2.1.9',
  latest: '2.1.9',
  minimum: '2.1.0',
  checkedAt: 1,
  signedIn: true,
  account: 'ana@example.com',
  ...over,
});
const claude: ProviderEntry = {
  name: 'claude-code',
  agentName: 'Claude Code',
  ready: true,
  enabled: true,
  active: false,
  authKind: 'oauth',
  kind: 'builtin',
  keyName: 'CLAUDE_CODE_API_KEY',
  agentCli: report(),
};
const missing = (entry: ProviderEntry): ProviderEntry => ({
  ...entry,
  ready: false,
  agentCli: { state: 'missing', command: 'claude', installed: null, latest: '2.1.9', minimum: '2.1.0', checkedAt: 1 },
});
const signedOut = (entry: ProviderEntry): ProviderEntry => ({
  ...entry,
  ready: false,
  agentCli: report({ signedIn: false, account: null }),
});
const idle = { job: null, checking: false };

describe('startOption', () => {
  it('names the agents the way a person knows them', () => {
    expect(startOption('claude-code', claude, idle).name).toBe('Claude');
    expect(startOption('codex-agent', undefined, idle).name).toBe('ChatGPT');
    expect(startOption('opencode', undefined, idle).name).toBe('Free model');
  });

  it('says who is signed in when the agent is ready', () => {
    const option = startOption('claude-code', claude, idle);
    expect(option.state).toBe('ready');
    expect(option.detail).toBe('Signed in as ana@example.com');
  });

  it('checks before it knows anything', () => {
    expect(startOption('claude-code', undefined, idle).state).toBe('checking');
  });

  it('offers the sign-in for an agent the list does not name once the list is in', () => {
    expect(startOption('claude-code', undefined, { ...idle, listed: true }).state).toBe('sign-in');
    expect(startOption('opencode', undefined, { ...idle, listed: true }).state).toBe('ready');
  });

  it('offers to install an agent that is not on this computer', () => {
    const option = startOption('claude-code', missing(claude), idle);
    expect(option.state).toBe('install');
    expect(option.detail).toMatch(/about a minute/);
  });

  it('shows how far an install got', () => {
    const job: AgentCliJob = { action: 'install', running: true, line: null, fraction: 0.4, error: null, note: null, retry: 'install' };
    const option = startOption('claude-code', missing(claude), { job, checking: false });
    expect(option.state).toBe('installing');
    expect(option.progress).toBe(0.4);
    expect(option.detail).toBe('Installing… 40%');
  });

  it('asks to sign in with the account the person already has', () => {
    const option = startOption('codex-agent', signedOut({ ...claude, name: 'codex-agent', agentName: 'Codex' }), idle);
    expect(option.state).toBe('sign-in');
    expect(option.detail).toBe('Sign in with your ChatGPT account');
  });

  it('says a failed install plainly and offers it again', () => {
    const job: AgentCliJob = { action: 'install', running: false, line: null, fraction: null, error: 'EACCES', note: null, retry: 'install' };
    const option = startOption('claude-code', missing(claude), { job, checking: false });
    expect(option.state).toBe('failed');
    expect(option.detail).toBe('The install did not finish. Try again.');
  });

  it('counts an installed free model as ready before its sign-in is known', () => {
    const unknown = { ...signedOut({ ...claude, name: 'opencode', agentName: 'OpenCode' }), agentCli: report({ signedIn: undefined, account: null }) };
    expect(startOption('opencode', unknown, idle).state).toBe('ready');
  });

  it('keeps the free model free of any account wording', () => {
    const free = startOption('opencode', { ...claude, name: 'opencode', agentName: 'OpenCode' }, idle);
    expect(free.state).toBe('ready');
    expect(free.detail).toBe('No account needed.');
  });
});

describe('readyPlan', () => {
  it('picks the first plan already signed in on this computer', () => {
    const options = [
      startOption('claude-code', signedOut(claude), idle),
      startOption('codex-agent', { ...claude, name: 'codex-agent', agentName: 'Codex' }, idle),
    ];
    expect(readyPlan(options)?.provider).toBe('codex-agent');
  });

  it('is null when no plan is ready', () => {
    expect(readyPlan([startOption('claude-code', missing(claude), idle)])).toBeNull();
  });
});
