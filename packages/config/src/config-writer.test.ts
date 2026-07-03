import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setConfigValue } from './config-writer.js';

let tmp: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-cfgw-'));
  prevHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = path.join(tmp, 'home');
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('setConfigValue', () => {
  it('creates the user config and sets a nested path', async () => {
    const res = await setConfigValue({
      scope: 'user',
      cwd: tmp,
      path: 'context.reasoning',
      value: true,
    });
    expect(res.config.context?.reasoning).toBe(true);
    const text = await fs.readFile(res.path, 'utf8');
    expect(text).toContain('reasoning: true');
  });

  it('preserves comments on existing YAML', async () => {
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    const file = path.join(home, 'config.yaml');
    await fs.writeFile(file, '# keep me\ncontext:\n  caching: true # inline note\n');
    await setConfigValue({ scope: 'user', cwd: tmp, path: 'tui.hints', value: false });
    const text = await fs.readFile(file, 'utf8');
    expect(text).toContain('# keep me');
    expect(text).toContain('# inline note');
    expect(text).toContain('hints: false');
  });

  it('rejects writes that would produce a schema-invalid config', async () => {
    await expect(
      setConfigValue({ scope: 'user', cwd: tmp, path: 'tui.theme', value: 'neon' }),
    ).rejects.toThrow(/invalid config/);
  });
});
