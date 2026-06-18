/**
 * Offline document anonymizer — MAIN-process file I/O for the gallery app.
 *
 * The anonymizer redacts PII from a document entirely on-device: the renderer's
 * NER worker runs a locally installed model (downloaded once via `apps.install`,
 * served over `moxxy-app://`). These handlers are the only main-process surface
 * it needs:
 *
 *   - `anonymizer.pickDocument`  — native open dialog (remembers the pick so the
 *     follow-up parse is authorized).
 *   - `anonymizer.parseDocument` — read + extract text from the picked/workspace
 *     file. NO provider, NO runner, NO network — only readFile + officeparser
 *     (see {@link parseFileToText}). Provenance-gated before any byte is read.
 *   - `anonymizer.saveRedacted`  — write the redacted text to a user-chosen path
 *     (save dialog only; never auto-writes anywhere).
 */

import { basename } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { dialog, BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import type { DeskStore } from '../desks';
import { authorizeAttachments, rememberPickedAttachment } from '../attachment-authz';
import { parseFileToText } from '../attachments.js';
import { handle } from './shared';

/** Document extensions the anonymizer can parse. Mirrors the picker filter and
 *  {@link parseFileToText}'s capabilities. */
const DOCUMENT_EXTENSIONS = [
  'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp',
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'rtf', 'html', 'xml',
];

/**
 * Collect every workspace cwd the user could legitimately have selected a file
 * from: each open workspace's runner cwd plus the active desk's cwd. A file
 * under any of these — or one the picker handed out — is authorized to read.
 */
async function authorizedCwds(pool: RunnerPool, desks: DeskStore): Promise<string[]> {
  const cwds = new Set<string>();
  for (const { supervisor } of pool.list()) {
    const cwd = supervisor.getCwd();
    if (cwd) cwds.add(cwd);
  }
  try {
    const active = await desks.getActive();
    if (active?.cwd) cwds.add(active.cwd);
  } catch {
    /* desks unreadable — fall through with whatever the pool gave us */
  }
  return [...cwds];
}

export function registerAnonymizerHandlers(pool: RunnerPool, desks: DeskStore): void {
  handle('anonymizer.pickDocument', async () => {
    const window = BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    const opts: Electron.OpenDialogOptions = {
      title: 'Pick a document to anonymize',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: DOCUMENT_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const result = window
      ? await dialog.showOpenDialog(window, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0]!;
    // Remember the choice so the follow-up parseDocument is authorized even
    // though the file lives outside any workspace cwd.
    await rememberPickedAttachment(picked);
    return picked;
  });

  handle('anonymizer.parseDocument', async ({ path }) => {
    // Provenance gate (same as session.runTurn): only a user-picked path or a
    // path under an open workspace cwd may be read, so a compromised renderer
    // can't read arbitrary files by feeding parseDocument a path.
    const cwds = await authorizedCwds(pool, desks);
    const { authorized } = await authorizeAttachments([{ path, name: basename(path) }], cwds);
    if (authorized.length === 0) {
      return { error: "This file isn't authorized to read. Pick it via the document picker." };
    }
    // No provider, no runner, no network — just readFile + officeparser.
    const text = await parseFileToText(path);
    return text ? { text } : { error: 'Could not extract text from this document.' };
  });

  handle('anonymizer.saveRedacted', async ({ suggestedName, content }) => {
    const window = BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    const opts: Electron.SaveDialogOptions = {
      title: 'Save redacted document',
      defaultPath: suggestedName,
    };
    const result = window
      ? await dialog.showSaveDialog(window, opts)
      : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return null;
    // Write ONLY to the user-chosen path — no auto-write anywhere else.
    await writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });
}
