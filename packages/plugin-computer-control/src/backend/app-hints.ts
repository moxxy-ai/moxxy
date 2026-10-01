import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatterFile } from '@moxxy/sdk';
import { z } from 'zod';

/** What the model should know about one family of apps before it drives them. */
export interface AppHint {
  /** Lower-case bundle identifiers, app ids or names this hint is for; a versioned identifier or name matches its base. */
  readonly apps: readonly string[];
  readonly text: string;
}

/** Each file is also a regular skill; `apps` in its frontmatter says whose hint it is. */
export const appHintsDirectory = fileURLToPath(new URL('../../skills/computer-apps', import.meta.url));

const appsSchema = z.object({ apps: z.array(z.string().min(1)).min(1) });

export function loadAppHints(directory: string = appHintsDirectory): AppHint[] {
  let files: string[];
  try {
    files = readdirSync(directory).filter((file) => file.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    const { frontmatter, body } = parseFrontmatterFile(readFileSync(join(directory, file), 'utf8'));
    const parsed = appsSchema.safeParse(frontmatter);
    const text = body.trim();
    return parsed.success && text ? [{ apps: parsed.data.apps.map((app) => app.toLowerCase()), text }] : [];
  });
}

export function hintFor(hints: ReadonlyArray<AppHint>, app: { id: string; name: string }): string | undefined {
  const keys = [app.id.toLowerCase(), app.name.toLowerCase()];
  // "com.adobe.PremierePro.25" and "Adobe Premiere Pro 2025" are still Premiere Pro.
  const matches = (entry: string) => keys.some((key) => key === entry || key.startsWith(`${entry}.`) || key.startsWith(`${entry} `));
  return hints.find((hint) => hint.apps.some(matches))?.text;
}
