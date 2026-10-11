/** The plugin entry: OpenCode is ready once installed, offers its own models, and ends with the conversation. */
import { describe, expect, it } from 'vitest';
import { collectTurn } from '@moxxy/core';
import { assertDefined } from '@moxxy/sdk';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { AcpAgentProvider, acpSessions, acpAgentPlugin, opencodeProviderDef, __setOpenCodeCommandRunner } from './index.js';
import { FakeOpenCode } from './fake-opencode.testkit.js';

const resolveHost = { cwd: '/work/app' } as never;

describe('the OpenCode plugin', () => {
  it('offers the models the person OpenCode can run once it is switched on', async () => {
    __setOpenCodeCommandRunner(async (_executable, args) =>
      args[0] === 'models'
        ? { code: 0, stdout: 'opencode/big-pickle\nopenai/gpt-6-luna\n', stderr: '' }
        : { code: 0, stdout: '●  OpenAI oauth\n└  1 credentials\n', stderr: '' },
    );
    const resolve = opencodeProviderDef.resolveCredentials;
    assertDefined(resolve, 'resolveCredentials');

    const config = await resolve({ providerConfig: { model: 'openai/gpt-6-luna' }, host: resolveHost } as never);
    const client = opencodeProviderDef.createClient(config);

    expect(config).toMatchObject({ cwd: '/work/app', executable: 'opencode', models: ['opencode/big-pickle', 'openai/gpt-6-luna'] });
    expect(client.models.map((model) => model.id)).toEqual(['openai/gpt-6-luna', 'opencode/big-pickle']);
  });

  it('will not switch on when OpenCode is not installed', async () => {
    __setOpenCodeCommandRunner(async () => ({ code: 1, stdout: '', stderr: '', error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) }));
    const resolve = opencodeProviderDef.resolveCredentials;
    assertDefined(resolve, 'resolveCredentials');

    await expect(resolve({ providerConfig: {}, host: resolveHost } as never)).rejects.toThrow(/Install OpenCode/);
  });

  it('closes the conversation OpenCode when the conversation shuts down', async () => {
    const opencode = new FakeOpenCode(async (turn) => turn.say('hi'));
    const provider = new AcpAgentProvider({ startAgent: opencode.start });
    const session = createFakeSession({ provider, plugins: [defaultModePlugin] });
    await collectTurn(session, 'hello');
    expect(acpSessions().size).toBe(1);

    const onShutdown = acpAgentPlugin.hooks?.onShutdown;
    assertDefined(onShutdown, 'the plugin onShutdown hook');
    await onShutdown(session.appContext());

    expect(opencode.last.closed).toBe(true);
    expect(acpSessions().size).toBe(0);
    await session.close();
  });
});
