/**
 * Turn picked file paths into real {@link UserPromptAttachment}s.
 *
 * The renderer can only hand us a path (no fs access), but the model needs the
 * actual payload. This reads the file in the main process and builds the right
 * attachment so every file type reaches the model for analysis:
 *
 *   - images           → `image` (base64) — the model sees the pixels
 *   - PDFs (≤32 MB)    → `document` (base64) — read natively (text + figures)
 *   - Office / ODF     → `file` (text extracted via officeparser)
 *   - text / code      → `file` (inline UTF-8)
 *   - oversized files  → `file` with a head excerpt + a note pointing the agent
 *                        at a path it can `read_file`/`grep` on demand
 *                        (see {@link largeFileFallback})
 *
 * Anything truly binary/unsupported, or unreadable, is skipped (with a warn)
 * rather than inlined as garbage. Earlier the desktop dropped every binary file
 * silently, so PDFs/Word/Excel never reached the model at all.
 *
 * It also owns {@link persistImageBlob}: pasted/dropped images arrive as raw
 * bytes (no path), so we stash them in a temp file and hand back a path the
 * same {@link buildAttachments} pipeline can read on the next turn.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { parseOfficeAsync } from 'officeparser';

/** Image extensions we forward as inline base64 with a real mediaType. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** Office / OpenDocument formats officeparser can extract text from. */
const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.docx',
  '.xlsx',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
]);

/** Caps so a renderer-chosen file can't OOM the main process / blow the prompt. */
const MAX_TEXT_BYTES = 512 * 1024; // 512 KB inlined directly; larger → agentic fallback
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB image
/** Anthropic's native PDF ceiling. Larger PDFs fall back to text extraction. */
const MAX_PDF_NATIVE_BYTES = 32 * 1024 * 1024; // 32 MB
/** How much of an oversized file we inline before pointing at the full copy. */
const HEAD_EXCERPT_BYTES = 8 * 1024; // 8 KB preview

function isPdf(buf: Buffer, ext: string): boolean {
  return ext === '.pdf' || (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-');
}

/** Extract plain text from an Office/ODF/PDF buffer. Returns null on failure
 *  (corrupt / unsupported / empty) so the caller can skip rather than throw. */
async function extractText(buf: Buffer, name: string): Promise<string | null> {
  try {
    const text = await parseOfficeAsync(buf, { outputErrorToConsole: false });
    return typeof text === 'string' && text.trim().length > 0 ? text : null;
  } catch (e) {
    console.warn(`[attachments] could not extract text from ${name}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Read a file and return its plain text, mirroring {@link buildAttachments}'
 * per-file text logic WITHOUT the attachment/size machinery: PDFs and Office /
 * OpenDocument files go through officeparser; any other file is returned as
 * UTF-8 when it isn't binary (a NUL byte ⇒ binary ⇒ null). Returns null on a
 * read failure, on a binary/unsupported file, or when no text could be
 * extracted.
 *
 * Reused by the offline anonymizer (`anonymizer.parseDocument`): no provider, no
 * runner, no network — just readFile + officeparser.
 */
export async function parseFileToText(absPath: string): Promise<string | null> {
  const ext = path.extname(absPath).toLowerCase();
  const name = path.basename(absPath);
  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch {
    return null;
  }
  // PDF (by extension or magic bytes) or Office/ODF → officeparser.
  if (isPdf(buf, ext) || OFFICE_EXTENSIONS.has(ext)) {
    return extractText(buf, name);
  }
  // Anything else: UTF-8 text, unless it looks binary.
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

export async function buildAttachments(
  files: ReadonlyArray<{ path: string; name: string }>,
): Promise<UserPromptAttachment[]> {
  const out: UserPromptAttachment[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    try {
      const buf = await readFile(f.path);
      const mediaType = IMAGE_MEDIA_TYPES[ext];

      // 1. Image → base64 the model can see.
      if (mediaType) {
        if (buf.byteLength > MAX_IMAGE_BYTES) {
          console.warn(`[attachments] skipping ${f.name}: image exceeds ${MAX_IMAGE_BYTES} bytes`);
          continue;
        }
        out.push({ kind: 'image', content: buf.toString('base64'), mediaType, name: f.name });
        continue;
      }

      // 2. PDF → native document block if within the provider limit, else
      //    extract text and fall back so even a huge PDF stays analyzable.
      if (isPdf(buf, ext)) {
        if (buf.byteLength <= MAX_PDF_NATIVE_BYTES) {
          out.push({
            kind: 'document',
            content: buf.toString('base64'),
            mediaType: 'application/pdf',
            name: f.name,
          });
        } else {
          const text = await extractText(buf, f.name);
          if (text) out.push(await largeFileFallback(text, f.name, null));
          else
            console.warn(
              `[attachments] skipping ${f.name}: PDF >${MAX_PDF_NATIVE_BYTES} bytes and no extractable text`,
            );
        }
        continue;
      }

      // 3. Office / OpenDocument → extract text, inline or fall back by size.
      if (OFFICE_EXTENSIONS.has(ext)) {
        const text = await extractText(buf, f.name);
        if (!text) continue; // already warned
        if (Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES) {
          out.push({ kind: 'file', content: text, name: f.name });
        } else {
          out.push(await largeFileFallback(text, f.name, null));
        }
        continue;
      }

      // 4. Text / code → inline, or fall back to the file itself when large.
      if (buf.includes(0)) {
        console.warn(`[attachments] skipping ${f.name}: looks binary / unsupported`);
        continue;
      }
      if (buf.byteLength <= MAX_TEXT_BYTES) {
        out.push({ kind: 'file', content: buf.toString('utf8'), name: f.name });
      } else {
        // The original file is already readable text — point the agent at it
        // rather than copying it into a temp file.
        out.push(await largeFileFallback(buf.toString('utf8'), f.name, f.path));
      }
    } catch {
      // Unreadable (gone / permission) → drop it rather than fail the turn.
    }
  }
  return out;
}

/**
 * Build a `file` attachment for content too large to inline every turn. The
 * model gets a head excerpt plus a note telling it where the full text lives so
 * it can `read_file`/`grep` the rest on demand (agentic retrieval — no
 * embeddings). `sourcePath` is the original file when it's already readable
 * text; otherwise (PDF/Office text extraction) we persist a temp `.txt` the
 * same TTL sweep prunes.
 */
async function largeFileFallback(
  fullText: string,
  name: string,
  sourcePath: string | null,
): Promise<UserPromptAttachment> {
  let readablePath = sourcePath;
  if (!readablePath) {
    await mkdir(ATTACHMENT_TMP_DIR, { recursive: true });
    void pruneOldAttachments();
    const safe = path.basename(name).replace(/[^\w.-]+/g, '_') || 'attachment';
    readablePath = path.join(ATTACHMENT_TMP_DIR, `${randomUUID()}-${safe}.txt`);
    await writeFile(readablePath, fullText, 'utf8');
  }
  const head = fullText.slice(0, HEAD_EXCERPT_BYTES);
  const kb = Math.max(1, Math.round(fullText.length / 1024));
  const approxTokens = Math.round(fullText.length / 4);
  const note =
    `\n\n[Preview only — "${name}" is large (~${kb} KB, ~${approxTokens} tokens); ` +
    `the text above is just the beginning. The full text is saved at:\n  ${readablePath}\n` +
    `Use your file tools (read_file with an offset, or grep) on that path to read or search the rest.]`;
  return { kind: 'file', content: head + note, name };
}

/** MIME type → file extension for the image blobs we accept on paste. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

/** Where pasted/dropped image blobs land before a turn reads them. */
const ATTACHMENT_TMP_DIR = path.join(os.tmpdir(), 'moxxy-attachments');
/** Sweep temp attachments older than this so pastes don't accumulate. */
const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Persist a base64 image blob the renderer pasted or dropped (it can't touch
 * the filesystem) to a temp file, returning a `{ path, name }` the existing
 * attachment pipeline ships unchanged. Throws if the blob isn't an accepted
 * image type or exceeds {@link MAX_IMAGE_BYTES} — the renderer surfaces the
 * message as a transient notice.
 */
export async function persistImageBlob(
  dataBase64: string,
  mediaType: string,
  name?: string,
): Promise<{ path: string; name: string }> {
  const ext = IMAGE_EXTENSIONS[mediaType.toLowerCase()];
  if (!ext) throw new Error(`Can't attach ${mediaType || 'this'} — only images can be pasted.`);
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.byteLength === 0) throw new Error('Pasted image was empty.');
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large to attach (max ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB).`,
    );
  }
  await mkdir(ATTACHMENT_TMP_DIR, { recursive: true });
  void pruneOldAttachments();
  const filePath = path.join(ATTACHMENT_TMP_DIR, `${randomUUID()}.${ext}`);
  await writeFile(filePath, buf);
  const display = name && name.trim().length > 0 ? name : `pasted-image.${ext}`;
  return { path: filePath, name: display };
}

/** Best-effort sweep of stale temp attachments. Never throws — a failed
 *  prune just means the next save tries again. */
async function pruneOldAttachments(): Promise<void> {
  try {
    const now = Date.now();
    const entries = await readdir(ATTACHMENT_TMP_DIR);
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(ATTACHMENT_TMP_DIR, entry);
        try {
          const info = await stat(full);
          if (now - info.mtimeMs > ATTACHMENT_TTL_MS) await unlink(full);
        } catch {
          /* already gone / racing another sweep */
        }
      }),
    );
  } catch {
    /* dir missing or unreadable — nothing to prune */
  }
}
