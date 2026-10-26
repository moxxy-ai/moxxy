/** The plugin entry: the conversation's live Claude ends when the conversation does. */
import { describe, expect, it } from 'vitest';
import { collectTurn } from '@moxxy/core';
import { assertDefined } from '@moxxy/sdk';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { ClaudeAgentProvider, claudeSessions, claudeCodePlugin } from './index.js';
import { FakeClaude, assistantText } from './fake-claude.testkit.js';

describe('the Claude plugin', () => {
  it('closes the conversation running Claude when the conversation shuts down', async () => {
    const claude = new FakeClaude(async function* () {
      yield assistantText('hi');
    });
    const provider = new ClaudeAgentProvider({ executable: '/usr/local/bin/claude', loadSdk: async () => claude });
    const session = createFakeSession({ provider, plugins: [defaultModePlugin] });
    await collectTurn(session, 'hello');
    expect(claudeSessions().size).toBe(1);

    const onShutdown = claudeCodePlugin.hooks?.onShutdown;
    assertDefined(onShutdown, 'the plugin onShutdown hook');
    await onShutdown(session.appContext());

    expect(claude.last.closed).toBe(true);
    expect(claudeSessions().size).toBe(0);
    await session.close();
  });

  it('starts a new conversation on Haiku 5.5 while the person chose no default model', async () => {
    const { claudeCodeProviderDef } = await import('./index.js');
    const provider = new ClaudeAgentProvider({
      executable: '/usr/local/bin/claude',
      loadSdk: async () => new FakeClaude(async function* () {}),
    });
    const session = createFakeSession({ provider, plugins: [defaultModePlugin] });

    expect(session.getInfo().defaultModel).toBe('claude-haiku-5-5');
    expect(claudeCodeProviderDef.starterModel).toBe('claude-haiku-5-5');
    await session.close();
  });

  it("lists the models the person's Claude offers, and still knows Haiku 5.5 when Claude is not asked", async () => {
    const { claudeCodeProviderDef, claudeCodeModels } = await import('./index.js');

    expect(typeof claudeCodeProviderDef.agentCli?.models).toBe('function');
    expect(claudeCodeModels.map((m) => m.id)).toContain('claude-haiku-5-5');
    expect(claudeCodeModels.map((m) => m.id)).not.toContain('claude-haiku-4-5');
  });
});
