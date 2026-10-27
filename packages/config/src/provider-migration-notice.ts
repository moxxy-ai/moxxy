import { promises as fs } from 'node:fs';
import { z } from 'zod/v3';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';

/**
 * A provider the config was moved off at startup (e.g. the retired ChatGPT
 * sign-in → the Codex agent). The CLI records it when it rewrites the config;
 * a surface (the desktop) says so once and clears it. A file rather than a
 * runner message, so the notice survives whichever of the two starts first.
 */
export interface ProviderMigrationNotice {
  readonly from: string;
  readonly to: string;
}

const noticeSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

function noticePath(): string {
  return moxxyPath('notices', 'provider-migration.json');
}

export async function recordProviderMigrationNotice(notice: ProviderMigrationNotice): Promise<void> {
  await writeFileAtomic(noticePath(), JSON.stringify(noticeSchema.parse(notice)));
}

/** The pending notice, or null when there is none (or it cannot be read). */
export async function readProviderMigrationNotice(): Promise<ProviderMigrationNotice | null> {
  try {
    const parsed = noticeSchema.safeParse(JSON.parse(await fs.readFile(noticePath(), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearProviderMigrationNotice(): Promise<void> {
  await fs.rm(noticePath(), { force: true });
}
