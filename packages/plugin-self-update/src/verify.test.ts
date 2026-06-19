import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPluginBuild, verifySkillFile } from './verify.js';
import { resolveTarget } from './transaction.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function tempPluginDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-verify-'));
  tempDirs.push(dir);
  return dir;
}

describe('verifyPluginBuild', () => {
  it('is a no-op for a bare plugin with no package.json', async () => {
    const dir = await tempPluginDir();
    await fs.writeFile(path.join(dir, 'index.mjs'), 'export default {};\n', 'utf8');
    const target = { kind: 'plugin' as const, name: 'bare', path: dir };
    expect(await verifyPluginBuild(target)).toEqual([]);
  });

  it('reports a failing build script', async () => {
    const dir = await tempPluginDir();
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'p', scripts: { build: 'exit 1' } }),
      'utf8',
    );
    const stages = await verifyPluginBuild({ kind: 'plugin', name: 'p', path: dir });
    expect(stages.at(-1)?.stage).toBe('build');
    expect(stages.at(-1)?.ok).toBe(false);
  }, 30_000);
});

describe('verifySkillFile', () => {
  it('accepts a well-formed skill', async () => {
    const dir = await tempPluginDir();
    const moxxy = dir;
    await fs.mkdir(path.join(moxxy, 'skills'), { recursive: true });
    const target = resolveTarget(moxxy, 'skill', 'good');
    await fs.writeFile(target.path, '---\nname: good\ndescription: does a thing\n---\n\nbody\n', 'utf8');
    expect((await verifySkillFile(target)).ok).toBe(true);
  });

  it('rejects missing frontmatter', async () => {
    const dir = await tempPluginDir();
    await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
    const target = resolveTarget(dir, 'skill', 'bad');
    await fs.writeFile(target.path, 'no frontmatter here\n', 'utf8');
    const r = await verifySkillFile(target);
    expect(r.ok).toBe(false);
  });

  it('rejects frontmatter missing name/description', async () => {
    const dir = await tempPluginDir();
    await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
    const target = resolveTarget(dir, 'skill', 'partial');
    await fs.writeFile(target.path, '---\nname: x\n---\nbody\n', 'utf8');
    expect((await verifySkillFile(target)).ok).toBe(false);
  });

  it('accepts a CRLF (Windows-authored) skill', async () => {
    const dir = await tempPluginDir();
    await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
    const target = resolveTarget(dir, 'skill', 'crlf');
    await fs.writeFile(target.path, '---\r\nname: good\r\ndescription: does a thing\r\n---\r\n\r\nbody\r\n', 'utf8');
    expect((await verifySkillFile(target)).ok).toBe(true);
  });

  it('rejects an empty quoted value that the old \\S+ check accepted', async () => {
    const dir = await tempPluginDir();
    await fs.mkdir(path.join(dir, 'skills'), { recursive: true });
    const target = resolveTarget(dir, 'skill', 'emptyname');
    await fs.writeFile(target.path, '---\nname: ""\ndescription: ok\n---\nbody\n', 'utf8');
    expect((await verifySkillFile(target)).ok).toBe(false);
  });
});
