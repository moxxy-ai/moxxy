import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readInstalledClaudeCreds, writeInstalledClaudeCreds } from './cli-creds.js';

let tmp: string;
let credsFile: string;
const priorOverride = process.env.MOXXY_CLAUDE_CREDENTIALS_FILE;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-cli-'));
  credsFile = path.join(tmp, '.credentials.json');
  // The override makes the reader/writer use this file and skip the Keychain,
  // so the test is deterministic and never touches the real `claude` creds.
  process.env.MOXXY_CLAUDE_CREDENTIALS_FILE = credsFile;
});

afterEach(async () => {
  if (priorOverride === undefined) delete process.env.MOXXY_CLAUDE_CREDENTIALS_FILE;
  else process.env.MOXXY_CLAUDE_CREDENTIALS_FILE = priorOverride;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('readInstalledClaudeCreds', () => {
  it('returns null when the file is missing', async () => {
    expect(await readInstalledClaudeCreds()).toBeNull();
  });

  it('returns null when there is no usable access token', async () => {
    await fs.writeFile(credsFile, JSON.stringify({ claudeAiOauth: {} }), 'utf8');
    expect(await readInstalledClaudeCreds()).toBeNull();
  });

  it('parses the nested claudeAiOauth bundle the CLI writes', async () => {
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'AT',
          refreshToken: 'RT',
          expiresAt: 1782407688118,
          subscriptionType: 'max',
        },
      }),
      'utf8',
    );
    expect(await readInstalledClaudeCreds()).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 1782407688118,
      subscriptionType: 'max',
    });
  });

  it('also accepts a flat (un-nested) bundle', async () => {
    await fs.writeFile(credsFile, JSON.stringify({ accessToken: 'flat' }), 'utf8');
    expect(await readInstalledClaudeCreds()).toEqual({ accessToken: 'flat' });
  });
});

describe('writeInstalledClaudeCreds', () => {
  it('round-trips through the override file', async () => {
    await writeInstalledClaudeCreds({
      accessToken: 'NEW',
      refreshToken: 'NEWR',
      expiresAt: 123,
      subscriptionType: 'pro',
    });
    const reread = await readInstalledClaudeCreds();
    expect(reread).toEqual({
      accessToken: 'NEW',
      refreshToken: 'NEWR',
      expiresAt: 123,
      subscriptionType: 'pro',
    });
    // Persisted under the nested key the CLI expects to read back.
    const raw = JSON.parse(await fs.readFile(credsFile, 'utf8'));
    expect(raw.claudeAiOauth.accessToken).toBe('NEW');
  });
});
