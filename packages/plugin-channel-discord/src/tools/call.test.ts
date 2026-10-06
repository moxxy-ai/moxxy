import { describe, expect, it, vi } from 'vitest';
import { asSessionId, asToolCallId, asTurnId, type ToolContext } from '@moxxy/sdk';
import { buildDiscordCallTool } from './call.js';

const ctx = (): ToolContext => ({
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

describe('discord_call', () => {
  it('has the running bot call the owner and say why first', async () => {
    const placeCall = vi.fn(async () => '📞 Calling — join https://discord.com/channels/g/c');
    const tool = buildDiscordCallTool({ placeCall });

    const out = await tool.handler({ reason: 'Build skończony — chcesz posłuchać wyników?' }, ctx());

    expect(placeCall).toHaveBeenCalledWith('Build skończony — chcesz posłuchać wyników?');
    expect(out).toMatch(/Calling/);
  });

  it('explains where calls come from when the bot is not running in this session', async () => {
    const tool = buildDiscordCallTool({ placeCall: () => null });

    await expect(tool.handler({ reason: 'hej' }, ctx())).rejects.toThrow(/Discord bot/);
  });
});
