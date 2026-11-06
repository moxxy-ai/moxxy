/**
 * The versions of the agent CLIs Moxxy knows break with it. The list is read
 * from a real HTTP server on this computer, standing in for GitHub; the cache
 * is a real file in a temporary folder.
 */
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import bundledFile from './agent-versions-blocked.json' with { type: 'json' };
import {
  BLOCKED_AGENT_VERSIONS_URL,
  BUNDLED_BLOCKED_AGENT_VERSIONS,
  blockedAgentVersion,
  blockedAgentVersions,
  cachedBlockedAgentVersions,
  parseBlockedAgentVersions,
} from './agent-versions-blocked.js';

let dir: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (dir) removeDirSync(dir);
  dir = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

function cacheFile(): string {
  dir = mkdtempSync(path.join(tmpdir(), 'moxxy-blocked-'));
  return path.join(dir, 'cache', 'agent-cli-blocked.json');
}

/** A server that answers every request with `status` and `body`, counting the requests. */
async function serve(status: number, body: string): Promise<{ url: string; asked: () => number }> {
  let asked = 0;
  server = createServer((_req, res) => {
    asked += 1;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/agent-versions-blocked.json`, asked: () => asked };
}

const LIST = JSON.stringify({ claude: [{ version: '2.2.0', reason: 'Does not answer in Moxxy' }] });

describe('reading the list', () => {
  it('keeps well-formed entries by the agent command', () => {
    expect(
      parseBlockedAgentVersions({
        $comment: 'notes are ignored',
        claude: [{ version: '2.2.0', reason: ' Does not answer in Moxxy ' }],
        codex: [],
      }),
    ).toEqual({ claude: [{ version: '2.2.0', reason: 'Does not answer in Moxxy' }], codex: [] });
  });

  it('drops entries without a plain version or a reason', () => {
    expect(
      parseBlockedAgentVersions({
        claude: [
          { version: '2.2', reason: 'kept' },
          { version: 'latest', reason: 'not a version' },
          { version: '2.2.1', reason: '' },
          { version: '2.2.2' },
          'junk',
          { version: '2.2.3', reason: 'x'.repeat(301) },
        ],
      }),
    ).toEqual({ claude: [{ version: '2.2', reason: 'kept' }] });
  });

  it('refuses what is not a list at all', () => {
    expect(parseBlockedAgentVersions(null)).toBeNull();
    expect(parseBlockedAgentVersions([])).toBeNull();
    expect(parseBlockedAgentVersions('claude 2.2.0')).toBeNull();
  });

  it('finds a version by the agent and the version, written either way', () => {
    const list = { claude: [{ version: '2.2.0', reason: 'Broken' }] };
    expect(blockedAgentVersion(list, 'claude', '2.2.0')).toEqual({ version: '2.2.0', reason: 'Broken' });
    expect(blockedAgentVersion(list, 'claude', 'v2.2.0')).toEqual({ version: '2.2.0', reason: 'Broken' });
    expect(blockedAgentVersion(list, 'claude', '2.2.1')).toBeUndefined();
    expect(blockedAgentVersion(list, 'codex', '2.2.0')).toBeUndefined();
  });

  it('ships a copy of the file in the repository, which the app falls back on', () => {
    expect(parseBlockedAgentVersions(bundledFile)).toEqual(BUNDLED_BLOCKED_AGENT_VERSIONS);
    expect(BLOCKED_AGENT_VERSIONS_URL).toBe(
      'https://raw.githubusercontent.com/moxxy-ai/moxxy/development/packages/agent-connection-kit/src/agent-versions-blocked.json',
    );
  });
});

describe('getting the list', () => {
  it('reads it from the server and keeps it for an hour, unless asked to look again', async () => {
    const file = cacheFile();
    const { url, asked } = await serve(200, LIST);
    let now = 1_000;
    const opts = (refresh = false) => ({ url, cacheFile: file, refresh, now: () => now });

    expect(await blockedAgentVersions(opts())).toEqual({ claude: [{ version: '2.2.0', reason: 'Does not answer in Moxxy' }] });
    now += 59 * 60_000;
    await blockedAgentVersions(opts());
    expect(asked()).toBe(1);
    now += 2 * 60_000;
    await blockedAgentVersions(opts());
    await blockedAgentVersions(opts(true));
    expect(asked()).toBe(3);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ list: { claude: [{ version: '2.2.0' }] } });
  });

  it('keeps the last list when the server cannot be reached or sends something else', async () => {
    const file = cacheFile();
    const good = await serve(200, LIST);
    await blockedAgentVersions({ url: good.url, cacheFile: file, now: () => 0 });

    expect(await blockedAgentVersions({ url: 'http://127.0.0.1:9/none.json', cacheFile: file, refresh: true, now: () => 0 })).toEqual(
      JSON.parse(LIST),
    );
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const broken = await serve(200, '<html>rate limited</html>');
    expect(await blockedAgentVersions({ url: broken.url, cacheFile: file, refresh: true, now: () => 0 })).toEqual(JSON.parse(LIST));
  });

  it('falls back on the copy shipped with the app when it never got one', async () => {
    const file = cacheFile();
    const { url } = await serve(404, 'Not Found');

    expect(await blockedAgentVersions({ url, cacheFile: file, now: () => 0 })).toEqual(BUNDLED_BLOCKED_AGENT_VERSIONS);
    expect(await cachedBlockedAgentVersions(file)).toEqual(BUNDLED_BLOCKED_AGENT_VERSIONS);
  });

  it('gives the last list without asking the server, for an update about to run', async () => {
    const file = cacheFile();
    const { url, asked } = await serve(200, LIST);
    await blockedAgentVersions({ url, cacheFile: file, now: () => 0 });

    expect(await cachedBlockedAgentVersions(file)).toEqual(JSON.parse(LIST));
    expect(asked()).toBe(1);
  });

  it('ignores a damaged cache', async () => {
    const file = cacheFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{"at": "soon", "list": 7}');

    expect(await cachedBlockedAgentVersions(file)).toEqual(BUNDLED_BLOCKED_AGENT_VERSIONS);
  });
});
