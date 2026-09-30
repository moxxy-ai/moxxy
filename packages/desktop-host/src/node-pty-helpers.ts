import { chmodSync, statSync } from 'node:fs';
import path from 'node:path';

/** Re-add the executable bit to node-pty's prebuilt `spawn-helper` under a
 *  freshly-installed npm prefix: npm can drop it, and the terminal then falls
 *  back to a dead piped shell. Best-effort + silent. */
export function chmodNodePtyHelpers(prefixRoot: string): void {
  const base = path.join(prefixRoot, 'node_modules', 'node-pty');
  const candidates = [
    path.join(base, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    path.join(base, 'build', 'Release', 'spawn-helper'),
  ];
  for (const file of candidates) {
    try {
      const st = statSync(file);
      if (!(st.mode & 0o111)) chmodSync(file, st.mode | 0o111);
    } catch {
      /* not present / not permitted — runtime self-heal covers it */
    }
  }
}
