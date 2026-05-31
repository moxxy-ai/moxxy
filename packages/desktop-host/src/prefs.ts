/**
 * Desktop-app preferences (separate from the runner's own
 * ~/.moxxy/preferences.json). Stores anything that's purely about the
 * desktop's local UI state: whether the user has finished onboarding,
 * which Clerk user they were last signed in as, ui prefs, etc.
 *
 * Crash-atomic write via the framework's writeFileAtomic (unique temp +
 * rename) so a crashed save can't corrupt the file. Lives under
 * ~/.moxxy/desktop/prefs.json next to desks.json.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createMutex, writeFileAtomic } from '@moxxy/sdk';
import type { DesktopPrefs } from '@moxxy/desktop-ipc-contract';

const DEFAULTS: DesktopPrefs = {
  onboardingComplete: false,
  clerkUserId: null,
  clerkDisplayName: null,
  signedInAt: null,
  version: 1,
};

function prefsPath(): string {
  return path.join(homedir(), '.moxxy', 'desktop', 'prefs.json');
}

/** Serializes update read-merge-write cycles. The read+write are split by an
 *  await (writeFileAtomic), so two concurrent prefs.update calls could
 *  otherwise both read the same snapshot and the second would clobber the
 *  first; the lock makes the second see the first's merged result. */
const writeMutex = createMutex();

export function readPrefs(): DesktopPrefs {
  try {
    const body = readFileSync(prefsPath(), 'utf8');
    const parsed = JSON.parse(body) as Partial<DesktopPrefs>;
    if (parsed && typeof parsed === 'object') {
      return { ...DEFAULTS, ...parsed, version: 1 };
    }
  } catch {
    /* missing or malformed → defaults */
  }
  return { ...DEFAULTS };
}

export async function writePrefs(next: DesktopPrefs): Promise<void> {
  await writeFileAtomic(prefsPath(), JSON.stringify(next, null, 2));
}

export function updatePrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs> {
  return writeMutex.run(async () => {
    const current = readPrefs();
    const next = { ...current, ...patch, version: 1 as const };
    await writePrefs(next);
    return next;
  });
}
