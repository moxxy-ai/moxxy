import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';

const VERSION = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;

export function parseVersion(text: string): string | null {
  return VERSION.exec(text)?.[0] ?? null;
}

/** Negative when `a` is older than `b`; a pre-release comes before its release. */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = splitPre(a);
  const [coreB = '', preB] = splitPre(b);
  const numsA = coreA.split('.').map(Number);
  const numsB = coreB.split('.').map(Number);
  for (let i = 0; i < Math.max(numsA.length, numsB.length); i += 1) {
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA.localeCompare(preB, 'en', { numeric: true });
}

function splitPre(version: string): [string, string | undefined] {
  const at = version.indexOf('-');
  return at === -1 ? [version, undefined] : [version.slice(0, at), version.slice(at + 1)];
}

/** What the CLI says its version is, or null when it prints none within `timeoutMs`. */
export async function readCliVersion(target: ExecutableTarget, timeoutMs = 10_000): Promise<string | null> {
  return parseVersion(await printedVersion(target, timeoutMs));
}

function printedVersion(target: ExecutableTarget, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawnExecutableTarget(target, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}
