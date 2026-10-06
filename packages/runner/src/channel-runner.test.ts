import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channelRunnerSocket, channelSessionId } from './channel-runner.js';

let savedMoxxyHome: string | undefined;

beforeEach(() => {
  savedMoxxyHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = path.join(os.tmpdir(), 'moxxy-home-channel-runner');
});

afterEach(() => {
  if (savedMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = savedMoxxyHome;
});

describe('dedicated channel runner address', () => {
  it('gives each channel bot its own socket under the moxxy home', () => {
    expect(channelRunnerSocket('discord', 'darwin')).toBe(
      path.join(os.tmpdir(), 'moxxy-home-channel-runner', 'channel-discord.sock'),
    );
  });

  it('uses a named pipe on Windows', () => {
    expect(channelRunnerSocket('discord', 'win32')).toBe('\\\\.\\pipe\\moxxy-channel-discord');
  });

  it('gives each channel bot one sticky session', () => {
    expect(channelSessionId('discord')).toBe('moxxy-channel-discord');
  });
});
