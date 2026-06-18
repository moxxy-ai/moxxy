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
 *     file. NO provider, NO runner, NO network — only readFile + local parsers
 *     (pdfjs for PDFs, officeparser for Office/ODF — see {@link parseFileToText}).
 *     Provenance-gated before any byte is read.
 *   - `anonymizer.saveRedacted`  — write the redacted text to a user-chosen path
 *     (save dialog only; never auto-writes anywhere).
 */

import { basename, extname } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { dialog, BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import type { DeskStore } from '../desks';
import { authorizeAttachments, rememberPickedAttachment } from '../attachment-authz';
import { parseFileToText, parseBufferToText } from '../attachments.js';
import { handle } from './shared';

/** True when these bytes are a PDF (by `%PDF-` magic). */
function looksLikePdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-';
}

/** The error to show when extraction yields nothing — a PDF with no text layer
 *  is almost always a scan, which only OCR (out of scope) could read. */
function noTextError(isPdf: boolean): string {
  return isPdf
    ? 'No text found in this PDF — it looks like a scanned image (no selectable text). ' +
        'Scanned documents need OCR, which the offline anonymizer does not do.'
    : 'Could not extract text from this document.';
}

/** Document extensions the anonymizer can parse. Mirrors the picker filter and
 *  {@link parseFileToText}'s capabilities (PDF via pdfjs — text layer + AcroForm
 *  fields, Office/ODF via officeparser, legacy `.doc` + `.rtf` via the local
 *  recovery helpers, everything else as UTF-8 text). */
const DOCUMENT_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'html', 'xml',
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
      return { error: "This file isn't authorized to read. Open it via the picker or drop it here." };
    }
    // No provider, no runner, no network — just local extraction.
    const text = await parseFileToText(path);
    if (text) return { text };
    // Distinguish a scanned PDF (image, no text layer) from a truly unsupported
    // file so the user knows it isn't a bug.
    const isPdf =
      extname(path).toLowerCase() === '.pdf' ||
      (await readFile(path).then(looksLikePdf).catch(() => false));
    return { error: noTextError(isPdf) };
  });

  handle('anonymizer.parseDocumentBytes', async ({ name, dataBase64 }) => {
    // A drag-and-drop sends the BYTES the renderer already legitimately holds
    // (the dropped File's contents), NOT a path — so there is no provenance gate
    // to run and no arbitrary-file-read to worry about: main never opens a
    // renderer-named path, it only extracts text from the supplied buffer. (A
    // path-based drop would let a compromised renderer forge a path and
    // exfiltrate any file, defeating parseDocument's gate above.) Size is capped
    // by the input schema. No provider, no runner, no network.
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.byteLength === 0) return { error: 'The dropped file was empty.' };
    const text = await parseBufferToText(buf, name);
    if (text) return { text };
    const isPdf = extname(name).toLowerCase() === '.pdf' || looksLikePdf(buf);
    return { error: noTextError(isPdf) };
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
