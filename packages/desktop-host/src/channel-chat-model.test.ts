import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { channelOfChat, syncChannelChatModel, watchChannelModels } from './channel-chat-model';
import { getSessionModel, setSessionModel } from './session-models';
import { removeDir } from '@moxxy/vitest-preset/fs';

let tmp: string;
let vault: VaultStore;
const key = deriveKey('test', generateSalt());
const openVault = () =>
  new VaultStore({ filePath: path.join(tmp, 'vault.json'), keySource: createStaticKeySource(key) });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dh-chan-model-'));
  vault = openVault();
  setSessionModel('moxxy-channel-telegram', null, { force: true });
});
afterEach(async () => {
  await removeDir(tmp);
});

function deps() {
  const activated: Array<[string, string]> = [];
  return {
    activated,
    deps: {
      vault: () => vault,
      activateProvider: async (workspaceId: string, provider: string) => void activated.push([workspaceId, provider]),
    },
  };
}

describe("the desktop's chat with a bot runs the bot's model", () => {
  it("takes the bot's saved model and makes its provider active", async () => {
    await vault.set('telegram_model', 'openai-codex::gpt-5.6-luna');
    const { deps: d, activated } = deps();

    await syncChannelChatModel('telegram', d);

    expect(getSessionModel('moxxy-channel-telegram')).toBe('gpt-5.6-luna');
    expect(activated).toEqual([['moxxy-channel-telegram', 'openai-codex']]);
  });

  it('runs the default model when the bot has none of its own', async () => {
    setSessionModel('moxxy-channel-telegram', 'something-stale', { force: true });
    const { deps: d, activated } = deps();

    await syncChannelChatModel('telegram', d);

    expect(getSessionModel('moxxy-channel-telegram')).toBeNull();
    expect(activated).toEqual([]);
  });

  it('leaves channels without a model of their own alone', async () => {
    const { deps: d, activated } = deps();
    await syncChannelChatModel('slack', d);
    expect(activated).toEqual([]);
  });
});

describe('channelOfChat', () => {
  it("names the channel whose bot a chat belongs to, and nothing for a workspace's chat", () => {
    expect(channelOfChat('moxxy-channel-telegram')).toBe('telegram');
    expect(channelOfChat('moxxy-channel-discord')).toBe('discord');
    expect(channelOfChat('ws-1')).toBeNull();
  });
});

describe('watchChannelModels', () => {
  it('fires when another process (the bot) writes the vault', async () => {
    await vault.set('telegram_model', 'openai-codex::gpt-5.5');
    const onChange = vi.fn();
    const stop = watchChannelModels(path.join(tmp, 'vault.json'), onChange);
    try {
      await openVault().set('telegram_model', 'openai-codex::gpt-5.6-luna');
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    } finally {
      stop();
    }
  });
});
