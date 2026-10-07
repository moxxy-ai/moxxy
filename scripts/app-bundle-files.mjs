import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Walk a dir, returning dist-relative POSIX paths of every file under it. */
function walk(absDir, relPrefix, out) {
  for (const name of readdirSync(absDir)) {
    const abs = path.join(absDir, name);
    const rel = `${relPrefix}/${name}`;
    if (statSync(abs).isDirectory()) walk(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * What a hot-update carries: `dist/**` + `dist-electron/**` of a built
 * `apps/desktop`, minus the floor bootstrap and sourcemaps (the runtime needs
 * neither). Returns dist-relative POSIX path → raw bytes; empty when the
 * desktop has not been built.
 */
export function collectAppBundleFiles(desktopDir) {
  const files = {};
  for (const root of ['dist', 'dist-electron']) {
    const abs = path.join(desktopDir, root);
    if (!existsSync(abs)) continue;
    for (const rel of walk(abs, root, [])) {
      if (rel === 'dist-electron/main/bootstrap.js' || rel.endsWith('.map')) continue;
      files[rel] = readFileSync(path.join(desktopDir, rel));
    }
  }
  return files;
}
