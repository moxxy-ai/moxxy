import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { moxxyPackageSchema, type MoxxyRequirement } from '@moxxy/sdk';

/**
 * Read `moxxy.requirements` from a package's `package.json`, resolved by
 * name from the given working directory. Returns an empty array when:
 *   - the package can't be resolved (not installed in the cwd's resolution path)
 *   - the package has no `moxxy` block
 *   - the `moxxy` block exists but declares no requirements
 *   - the `moxxy` block fails schema validation
 *
 * Errors are deliberately swallowed because this is used during boot
 * for every static builtin: a missing or malformed package.json on one
 * builtin shouldn't crash the CLI. The plugin host's registration gate
 * still rejects plugins whose declared requirements aren't satisfied.
 */
export async function readPackageMoxxyRequirements(
  packageName: string,
  fromDir: string,
): Promise<ReadonlyArray<MoxxyRequirement>> {
  const pkgJsonPath = resolvePackageJson(packageName, fromDir);
  if (!pkgJsonPath) return [];
  let raw: string;
  try {
    raw = await fs.readFile(pkgJsonPath, 'utf8');
  } catch {
    return [];
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return [];
  }
  const moxxyBlock = (parsedJson as { moxxy?: unknown }).moxxy;
  if (!moxxyBlock) return [];
  const parsed = moxxyPackageSchema.safeParse(moxxyBlock);
  if (!parsed.success) return [];
  return parsed.data.requirements ?? [];
}

function resolvePackageJson(packageName: string, fromDir: string): string | null {
  const require_ = createRequire(`${fromDir.replace(/\/+$/, '')}/`);
  try {
    return require_.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
}
