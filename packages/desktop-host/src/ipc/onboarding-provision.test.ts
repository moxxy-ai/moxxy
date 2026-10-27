import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { RunnerPool } from '../runner-pool';
import { registerOnboardingHandlers } from './onboarding';
import { setActiveBus } from './shared';

type Handler = (...args: unknown[]) => Promise<unknown>;

function provisionHandler(pool: RunnerPool): Handler {
  const handlers = new Map<string, Handler>();
  setActiveBus({ handle: (channel: string, fn: Handler) => handlers.set(channel, fn) } as never);
  registerOnboardingHandlers(pool);
  const handler = handlers.get('onboarding.provisionProvider');
  assertDefined(handler, 'onboarding.provisionProvider handler');
  return handler;
}

describe('onboarding provisioning and the first plugin install', () => {
  let dir: string;
  let previousEntry: string | undefined;
  let prepared: string;
  let received: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'onboarding-provision-'));
    prepared = path.join(dir, 'prepared');
    received = path.join(dir, 'received.json');
    const entry = path.join(dir, 'cli.mjs');
    // Only the subprocess boundary is substituted. It fails if launched before
    // the real pool's filesystem preparation and records the actual argv.
    await writeFile(entry, `import { existsSync, writeFileSync } from 'node:fs';
if (!existsSync(${JSON.stringify(prepared)})) { console.error('plugin preparation is unfinished'); process.exit(1); }
writeFileSync(${JSON.stringify(received)}, JSON.stringify(process.argv.slice(2)));
`);
    previousEntry = process.env.MOXXY_CLI_ENTRY;
    process.env.MOXXY_CLI_ENTRY = entry;
  });

  afterEach(async () => {
    if (previousEntry === undefined) delete process.env.MOXXY_CLI_ENTRY;
    else process.env.MOXXY_CLI_ENTRY = previousEntry;
    await removeDir(dir);
  });

  it('finishes plugin preparation before launching provision for OpenAI', async () => {
    const pool = new RunnerPool({ beforeStart: () => writeFile(prepared, 'ready') });
    await provisionHandler(pool)({ provider: 'openai', model: 'gpt-6-luna' });
    expect(JSON.parse(await readFile(received, 'utf8'))).toEqual([
      'provision', '--provider', 'openai', '--model', 'gpt-6-luna',
    ]);
  });

  it('propagates a preparation failure without launching provision', async () => {
    const pool = new RunnerPool({ beforeStart: async () => { throw new Error('seed failed'); } });
    await expect(provisionHandler(pool)({ provider: 'openai' })).rejects.toThrow('seed failed');
    await expect(readFile(received)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
