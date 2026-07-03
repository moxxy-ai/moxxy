import { describe, expect, it } from 'vitest';
import { gateInbound } from './allow-list.js';
import {
  parseAllowedChannels,
  parseAuthorizedUser,
  serializeAllowedChannels,
} from './keys.js';

const PAIRED = '111111111111';
const OTHER = '222222222222';
const GUILD = '333333333333';
const CHAN = '444444444444';

describe('gateInbound (authorization gate on every session-reaching path)', () => {
  it('denies everything when unpaired', () => {
    expect(
      gateInbound({ authorId: PAIRED, guildId: null, channelId: CHAN }, null, new Set()),
    ).toEqual({ ok: false, reason: 'not-paired' });
  });

  it('denies a foreign user even in an allow-listed channel', () => {
    expect(
      gateInbound({ authorId: OTHER, guildId: GUILD, channelId: CHAN }, PAIRED, new Set([CHAN])),
    ).toEqual({ ok: false, reason: 'foreign-user' });
  });

  it('allows the paired user in a DM', () => {
    expect(
      gateInbound({ authorId: PAIRED, guildId: null, channelId: CHAN }, PAIRED, new Set()),
    ).toEqual({ ok: true, context: 'dm' });
  });

  it('denies the paired user in a guild channel that is not allow-listed', () => {
    expect(
      gateInbound({ authorId: PAIRED, guildId: GUILD, channelId: CHAN }, PAIRED, new Set()),
    ).toEqual({ ok: false, reason: 'channel-not-allowed' });
  });

  it('allows the paired user in an allow-listed guild channel', () => {
    expect(
      gateInbound({ authorId: PAIRED, guildId: GUILD, channelId: CHAN }, PAIRED, new Set([CHAN])),
    ).toEqual({ ok: true, context: 'guild' });
  });
});

describe('vault value parsers (corrupt values fail closed)', () => {
  it('parseAuthorizedUser accepts a snowflake, rejects junk', () => {
    expect(parseAuthorizedUser('123456789')).toBe('123456789');
    expect(parseAuthorizedUser(' 123456789 ')).toBe('123456789');
    expect(parseAuthorizedUser('not-a-user')).toBeNull();
    expect(parseAuthorizedUser('')).toBeNull();
    expect(parseAuthorizedUser(null)).toBeNull();
    expect(parseAuthorizedUser('123; DROP TABLE')).toBeNull();
  });

  it('parseAllowedChannels round-trips and rejects corrupt JSON / junk entries', () => {
    const raw = serializeAllowedChannels(['111111', '222222', '111111']);
    expect(parseAllowedChannels(raw)).toEqual(['111111', '222222']);
    expect(parseAllowedChannels('not json')).toEqual([]);
    expect(parseAllowedChannels('{"a":1}')).toEqual([]);
    expect(parseAllowedChannels(JSON.stringify(['111111', 'nope']))).toEqual([]);
    expect(parseAllowedChannels(null)).toEqual([]);
  });
});
