/** The plugin entry: the conversation's Codex ends when the conversation does. */
import { describe, expect, it } from 'vitest';
import { collectTurn } from '@moxxy/core';
import { assertDefined } from '@moxxy/sdk';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { CodexAgentProvider, codexSessions, codexAgentPlugin } from './index.js';
import { FakeCodex } from './fake-codex.testkit.js';

describe('the Codex plugin', () => {
  it('starts a new conversation on GPT-6 Luna while the person chose no default model', async () => {
    const { codexAgentProviderDef } = await import('./index.js');
    const provider = new CodexAgentProvider({ startAppServer: new FakeCodex(async () => undefined).start });
    const session = createFakeSession({ provider, plugins: [defaultModePlugin] });

    expect(session.getInfo().defaultModel).toBe('gpt-6-luna');
    expect(codexAgentProviderDef.starterModel).toBe('gpt-6-luna');
    await session.close();
  });

  it('closes the conversation running Codex when the conversation shuts down', async () => {
    const codex = new FakeCodex(async (turn) => {
      await turn.say('hi');
    });
    const provider = new CodexAgentProvider({ startAppServer: codex.start });
    const session = createFakeSession({ provider, plugins: [defaultModePlugin] });
    await collectTurn(session, 'hello');
    expect(codexSessions().size).toBe(1);

    const onShutdown = codexAgentPlugin.hooks?.onShutdown;
    assertDefined(onShutdown, 'the plugin onShutdown hook');
    await onShutdown(session.appContext());

    expect(codex.last.closed).toBe(true);
    expect(codexSessions().size).toBe(0);
    await session.close();
  });

  it("lists the models the person's Codex offers, and still knows its newest when Codex is not asked", async () => {
    const { codexAgentProviderDef, codexAgentModels } = await import('./index.js');

    expect(typeof codexAgentProviderDef.agentCli?.models).toBe('function');
    expect(codexAgentModels.map((m) => m.id)).toContain('gpt-6.1-sol');
  });
});
