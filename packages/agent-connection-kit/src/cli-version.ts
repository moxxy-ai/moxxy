import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';

const isDigit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9';
const isLetter = (char: string | undefined): boolean =>
  char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z'));
const isPreRelease = (char: string | undefined): boolean => isDigit(char) || isLetter(char) || char === '.' || char === '-';

/**
 * The first `1.2.3` or `1.2.3-pre.4` in `text`. A walk over the characters,
 * not a regular expression: a search starting at every digit of a long run
 * of digits takes time quadratic in its length.
 */
export function parseVersion(text: string): string | null {
  for (let start = 0; start < text.length; start += 1) {
    if (!isDigit(text[start]) || isDigit(text[start - 1])) continue;
    let end = versionCoreEnd(text, start);
    if (end === null) continue;
    if (text[end] === '-' && isPreRelease(text[end + 1])) {
      end += 1;
      while (isPreRelease(text[end])) end += 1;
    }
    return text.slice(start, end);
  }
  return null;
}

/** Where `major.minor.patch` starting at `start` ends, or null when there is none. */
function versionCoreEnd(text: string, start: number): number | null {
  let at = start;
  for (let part = 0; part < 3; part += 1) {
    if (part > 0) {
      if (text[at] !== '.') return null;
      at += 1;
    }
    const digits = at;
    while (isDigit(text[at])) at += 1;
    if (at === digits) return null;
  }
  return at;
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
