import { describe, expect, it, vi } from 'vitest';
import type { VoiceLink } from './call.js';
import { Calls, pickCallChannel, type CallPorts, type CallChannel } from './calls.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const channel = (id: string, guildId = 'g1', joinable = true): CallChannel => ({ id, guildId, joinable });

describe('choosing where to call', () => {
  it('joins the voice channel the owner is already in', () => {
    const picked = pickCallChannel([
      { ownerIsMember: true, ownerChannel: null, voiceChannels: [channel('lobby')] },
      { ownerIsMember: true, ownerChannel: channel('gaming', 'g2'), voiceChannels: [channel('gaming', 'g2')] },
    ]);
    expect(picked).toEqual({ channel: channel('gaming', 'g2'), ownerPresent: true });
  });

  it('otherwise rings in the first voice channel of a server the owner is on', () => {
    const picked = pickCallChannel([
      { ownerIsMember: false, ownerChannel: null, voiceChannels: [channel('elsewhere', 'g0')] },
      { ownerIsMember: true, ownerChannel: null, voiceChannels: [channel('locked', 'g1', false), channel('lobby')] },
    ]);
    expect(picked).toEqual({ channel: channel('lobby'), ownerPresent: false });
  });

  it('finds nothing when no shared server has a voice channel the bot may join', () => {
    expect(pickCallChannel([{ ownerIsMember: true, ownerChannel: null, voiceChannels: [channel('locked', 'g1', false)] }])).toBeNull();
  });
});

/** Stand-in for the Discord side: the gateway (where the owner is), the voice
 *  connection and the owner's DMs. */
function discord(opts: { ownerPresent?: boolean; noChannel?: boolean } = {}) {
  const moves = new Set<(channelId: string | null) => void>();
  const played: string[] = [];
  const closed = new Set<() => void>();
  let connected = false;
  const link: VoiceLink = {
    onSpeechStart: () => () => undefined,
    onSpeechEnd: () => () => undefined,
    onClosed: (fn) => {
      closed.add(fn);
      return () => closed.delete(fn);
    },
    captureUtterance: () => new Promise(() => undefined),
    play: async (clip) => {
      played.push(new TextDecoder().decode(clip));
    },
    stop: () => undefined,
    close: () => {
      connected = false;
      for (const fn of closed) fn();
    },
  };
  const dms: string[] = [];
  const ports: CallPorts = {
    findChannel: async () =>
      opts.noChannel ? null : { channel: channel('lobby'), ownerPresent: opts.ownerPresent ?? true },
    connect: async () => {
      connected = true;
      return link;
    },
    notifyOwner: async (text) => {
      dms.push(text);
    },
    onOwnerMoved: (fn) => {
      moves.add(fn);
      return () => moves.delete(fn);
    },
    transcribe: async () => '',
    answer: async () => null,
    speak: async (text) => new TextEncoder().encode(text),
  };
  return {
    ports,
    played,
    dms,
    get connected() {
      return connected;
    },
    /** The voice connection is lost without anyone hanging up. */
    dropConnection: () => {
      connected = false;
      for (const fn of closed) fn();
    },
    ownerMovesTo: (channelId: string | null) => {
      for (const fn of moves) fn(channelId);
    },
  };
}

describe('placing and ending calls', () => {
  it('the owner calls: the bot joins them and is ready to talk', async () => {
    const d = discord({ ownerPresent: true });
    const calls = new Calls(d.ports);

    const reply = await calls.start();

    expect(d.connected).toBe(true);
    expect(reply).toMatch(/lobby|call/i);
    expect(calls.active).toBe(true);
  });

  it('the agent calls: rings with a link in DMs and says why once the owner joins', async () => {
    const d = discord({ ownerPresent: false });
    const calls = new Calls(d.ports);

    await calls.start({ greeting: 'Skończyłem budowanie projektu.' });

    expect(d.dms[0]).toContain('https://discord.com/channels/g1/lobby');
    expect(d.dms[0]).toContain('Skończyłem budowanie projektu.');
    expect(d.played).toEqual([]);
    d.ownerMovesTo('lobby');
    await sleep(5);
    expect(d.played).toEqual(['Skończyłem budowanie projektu.']);
  });

  it('says why straight away when the owner is already there', async () => {
    const d = discord({ ownerPresent: true });
    const calls = new Calls(d.ports);

    await calls.start({ greeting: 'Mam pytanie.' });
    await sleep(5);

    expect(d.played).toEqual(['Mam pytanie.']);
    expect(d.dms).toEqual([]);
  });

  it('says a reply to a message written in the app while the call is on', async () => {
    const d = discord({ ownerPresent: true });
    const calls = new Calls(d.ports);
    await calls.start();

    expect(calls.say('Przed chwilą szukałem konsoli na OLX.')).toBe(true);
    await sleep(5);

    expect(d.played).toEqual(['Przed chwilą szukałem konsoli na OLX.']);
  });

  it('says nothing when there is no call', () => {
    const d = discord();
    expect(new Calls(d.ports).say('Gotowe.')).toBe(false);
    expect(d.played).toEqual([]);
  });

  it('tells the owner when the call dropped, so they can call again', async () => {
    const d = discord({ ownerPresent: true });
    const calls = new Calls(d.ports);
    await calls.start();

    d.dropConnection();
    await sleep(5);

    expect(calls.active).toBe(false);
    expect(d.dms).toEqual([expect.stringMatching(/dropped.*\/call/i)]);
  });

  it('says nothing in DMs when the owner hangs up', async () => {
    const d = discord({ ownerPresent: true });
    const calls = new Calls(d.ports);
    await calls.start();

    calls.hangUp();
    await sleep(5);

    expect(d.dms).toEqual([]);
  });

  it('hangs up when the owner leaves the voice channel', async () => {
    const d = discord({ ownerPresent: true });
    const calls = new Calls(d.ports);
    await calls.start();

    d.ownerMovesTo(null);

    expect(calls.active).toBe(false);
    expect(d.connected).toBe(false);
  });

  it('gives up ringing when the owner does not pick up, and says so in DMs', async () => {
    const d = discord({ ownerPresent: false });
    const calls = new Calls(d.ports, { ringMs: 20 });
    await calls.start({ greeting: 'Halo?' });

    await sleep(60);

    expect(calls.active).toBe(false);
    expect(d.dms.at(-1)).toMatch(/missed|nieodebran/i);
  });

  it('refuses a second call while one is on', async () => {
    const d = discord();
    const calls = new Calls(d.ports);
    await calls.start();

    expect(await calls.start()).toMatch(/already/i);
  });

  it('explains when there is nowhere to call', async () => {
    const calls = new Calls(discord({ noChannel: true }).ports);

    expect(await calls.start()).toMatch(/voice channel/i);
    expect(calls.active).toBe(false);
  });

  it('/hangup ends the call, and says so when there is none', async () => {
    const d = discord();
    const calls = new Calls(d.ports);
    expect(calls.hangUp()).toMatch(/no call/i);

    await calls.start();
    expect(calls.hangUp()).toMatch(/ended/i);
    expect(d.connected).toBe(false);
  });

  it('reports a failed connection instead of throwing', async () => {
    const d = discord();
    const calls = new Calls({ ...d.ports, connect: vi.fn(async () => { throw new Error('missing Connect permission'); }) });

    expect(await calls.start()).toMatch(/missing Connect permission/);
    expect(calls.active).toBe(false);
  });
});
