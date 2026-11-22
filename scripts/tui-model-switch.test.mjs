import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadModelDefaults } from '../packages/config/dist/index.js';
import { Session } from '../packages/core/dist/index.js';
import { applyProviderModelSwitch } from '../packages/plugin-cli/dist/session/picker-handlers.js';
import { codexAgentPlugin } from '../packages/plugin-provider-codex-agent/dist/index.js';
import { openaiPlugin } from '../packages/plugin-provider-openai/dist/index.js';
import { connectRemoteSession, platformSocket, startRunnerServer } from '../packages/runner/dist/index.js';
import { removeWorkDir } from './agent-cli-env.mjs';

test('TUI model selection on a shared session', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-tui-model-'));
  const previousHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  const session = new Session({ cwd: home, silent: true });
  let server;
  let attached;
  try {
    session.pluginHost.registerStatic(codexAgentPlugin);
    session.pluginHost.registerStatic(openaiPlugin);
    session.providers.setActive('codex-agent');
    session.providers.setEnabled('openai', false);
    const socketPath = platformSocket(path.basename(home), path.join(home, 'runner.sock'));
    server = await startRunnerServer(session, { socketPath });
    attached = await connectRemoteSession({ socketPath, role: 'tui' });

    const selections = [];
    let notice;
    const pick = (client, model, provider = 'codex-agent') => applyProviderModelSwitch({
      session: client,
      setActiveModelOverride: (id) => { selections.push(id); },
      setSystemNotice: (message) => { notice = message; },
    }, provider, model);

    for (const [surface, client] of [['standalone', session], ['attached', attached]]) {
      await t.test(surface + ' lowers Ultra on Luna and keeps Max back on Terra without a turn', async () => {
        await attached.setReasoningEffort('ultra');
        for (const model of ['gpt-6-luna', 'gpt-5.6-terra']) {
          await pick(client, model);
          assert.equal(selections.at(-1), model);
          assert.equal(session.getInfo().reasoningEffort, 'max', model);
        }
        assert.equal((await loadModelDefaults()).effort, 'off');
      });
    }
    await t.test('quick successive selections keep their order across a runner request', async () => {
      await attached.setReasoningEffort('ultra');
      await Promise.all([pick(attached, 'gpt-6-luna'), pick(attached, 'gpt-5.6-terra')]);
      assert.deepEqual(selections.slice(-2), ['gpt-6-luna', 'gpt-5.6-terra']);
      assert.equal(attached.getInfo().reasoningEffort, 'max');
    });
    await t.test('a refused provider switch preserves the model and effort', async () => {
      await attached.setReasoningEffort('ultra');
      const before = selections.length;
      await pick(attached, 'gpt-6-luna', 'openai');
      assert.match(notice, /disabled/i);
      assert.equal(selections.length, before);
      assert.equal(session.getInfo().reasoningEffort, 'ultra');
    });
  } finally {
    await attached?.close();
    await server?.close();
    await session.close();
    if (previousHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previousHome;
    assert.equal(await removeWorkDir(home), null);
  }
});
