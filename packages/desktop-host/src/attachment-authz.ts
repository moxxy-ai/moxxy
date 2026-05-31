/**
 * Authorize attachment file paths before the main process reads them.
 *
 * `session.runTurn` accepts a list of `{ path, name }` from the renderer, and
 * {@link buildAttachments} then reads each path and inlines its bytes into the
 * prompt sent to the model. A path is legitimate ONLY when the user actually
 * chose it:
 *
 *   - via the native file picker (`session.pickAttachment`), or
 *   - by selecting a file in the workspace tree (always under the workspace
 *     cwd, which `workspace.listDir` already confines).
 *
 * Shape validation can't distinguish a legit absolute path (`/Users/me/pic.png`
 * picked via the dialog) from an injected one (`/Users/me/.ssh/id_rsa`), so a
 * compromised/XSS'd renderer could otherwise exfiltrate arbitrary files by
 * stuffing them into `attachments`. We gate on PROVENANCE instead: paths the
 * picker handed out are remembered here, and paths under the workspace cwd are
 * allowed — both resolved through `realpath` so a symlink can't smuggle an
 * outside file in under an inside-looking name.
 *
 * Unauthorized paths are dropped (not fatal): the turn proceeds without them.
 */

import { realpath } from 'node:fs/promises';
import path from 'node:path';

export interface AttachmentSpec {
  readonly path: string;
  readonly name: string;
}

/**
 * realpath'd paths the native picker has handed to the renderer this session.
 * Bounded so a user who picks thousands of files over a long session can't
 * grow it without limit; eviction is oldest-first (Set preserves insertion
 * order), which is fine — stale picks just need re-picking.
 */
const pickedRealPaths = new Set<string>();
const MAX_REMEMBERED_PICKS = 1024;

/** Record a path the native file picker returned, so a later runTurn that
 *  references it is authorized. Resolves through realpath; best-effort. */
export async function rememberPickedAttachment(absPath: string): Promise<void> {
  const real = await realpath(absPath).catch(() => null);
  if (!real) return;
  if (pickedRealPaths.size >= MAX_REMEMBERED_PICKS) {
    const oldest = pickedRealPaths.values().next().value;
    if (oldest !== undefined) pickedRealPaths.delete(oldest);
  }
  pickedRealPaths.add(real);
}

function isInside(root: string, abs: string): boolean {
  return abs === root || abs.startsWith(root + path.sep);
}

/**
 * Filter `attachments` down to the ones whose real path is either a remembered
 * pick or lives inside one of `cwds`. Returns the authorized subset plus the
 * names that were dropped (for logging / a future renderer notice).
 */
export async function authorizeAttachments(
  attachments: ReadonlyArray<AttachmentSpec>,
  cwds: ReadonlyArray<string>,
): Promise<{ authorized: AttachmentSpec[]; dropped: string[] }> {
  const roots = (
    await Promise.all(
      cwds.map((c) => realpath(c).catch(() => path.resolve(c))),
    )
  ).filter(Boolean);
  const authorized: AttachmentSpec[] = [];
  const dropped: string[] = [];
  for (const att of attachments) {
    const real = await realpath(att.path).catch(() => null);
    const ok = real !== null && (pickedRealPaths.has(real) || roots.some((r) => isInside(r, real)));
    if (ok) authorized.push(att);
    else dropped.push(att.name);
  }
  return { authorized, dropped };
}

/** Test seam: forget every remembered pick. */
export function __resetPickedAttachments(): void {
  pickedRealPaths.clear();
}
