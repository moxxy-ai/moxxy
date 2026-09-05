import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execExecutableTargetSync, resolveExecutableTarget } from '../../../packages/sdk/dist/server.js';

// PR builds precede npm publication. Only the disposable smoke home points at
// these real workspace tarballs; installed users and release smoke keep npm.
export async function prepareLocalSmokePackages({ repoRoot, pluginsDir, packageNames }) {
  const pnpm = resolveExecutableTarget('pnpm', { nodeEntryHint: process.env.npm_execpath });
  if (!pnpm) throw new Error('pnpm is required to prepare local smoke packages');
  const manifestPath = path.join(pluginsDir, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dependencies = { ...manifest.dependencies };
  const pending = [...Object.keys(dependencies), ...packageNames].filter(name => name.startsWith('@moxxy/'));
  const sources = {};
  const archives = path.join(pluginsDir, 'smoke-archives');
  await mkdir(archives, { recursive: true });
  for (const name of pending) {
    if (sources[name]) continue;
    if (!/^@moxxy\/[a-z0-9-]+$/.test(name)) throw new Error(`Invalid smoke package name: ${name}`);
    const packageDir = path.join(repoRoot, 'packages', name.slice('@moxxy/'.length));
    const source = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
    if (source.name !== name) throw new Error(`Smoke package name mismatch: ${name}`);
    const archive = path.join(archives, `${name.slice('@moxxy/'.length)}.tgz`);
    execExecutableTargetSync(pnpm, ['pack', '--out', archive], {
      cwd: packageDir, timeout: 60_000, stdio: 'pipe',
    });
    sources[name] = archive;
    dependencies[name] = `file:./smoke-archives/${path.basename(archive)}`;
    pending.push(...Object.keys({ ...source.dependencies, ...source.optionalDependencies, ...source.peerDependencies })
      .filter(dependency => dependency.startsWith('@moxxy/')));
  }
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, dependencies }, null, 2)}\n`);
  return sources;
}
