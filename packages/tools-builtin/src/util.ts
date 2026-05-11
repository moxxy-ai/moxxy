import * as path from 'node:path';

export function resolveSafe(cwd: string, target: string): string {
  if (path.isAbsolute(target)) return path.normalize(target);
  return path.resolve(cwd, target);
}

export function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated ${s.length - max} chars]`;
}
