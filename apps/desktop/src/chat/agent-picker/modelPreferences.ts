import { z } from 'zod';

const STORAGE_KEY = 'moxxy.model-preferences.v1';

const preferenceSchema = z.object({
  version: z.literal(1),
  selections: z.array(z.object({
    workspaceId: z.string().min(1).max(512),
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
  }).strict()).max(10_000),
}).strict();

type ModelPreferences = z.infer<typeof preferenceSchema>;

function readPreferences(): ModelPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, selections: [] };
    const parsed = preferenceSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : { version: 1, selections: [] };
  } catch {
    return { version: 1, selections: [] };
  }
}

export function getModelPreference(workspaceId: string, provider: string): string | null {
  const matches = readPreferences().selections.filter(
    (entry) => entry.workspaceId === workspaceId && entry.provider === provider,
  );
  return matches.at(-1)?.model ?? null;
}

export function setModelPreference(
  workspaceId: string,
  provider: string,
  model: string | null,
): void {
  try {
    const current = readPreferences();
    const selections = current.selections.filter(
      (entry) => entry.workspaceId !== workspaceId || entry.provider !== provider,
    );
    if (model) selections.push({ workspaceId, provider, model });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, selections }));
  } catch {
    // Best effort: the active in-memory selection still works when storage is
    // unavailable (private mode, full quota, or a locked-down web surface).
  }
}
