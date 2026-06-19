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
import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UserPromptAttachment } from '@moxxy/sdk';
import { parseOfficeAsync } from 'officeparser';
import { extractPdfText } from './pdf-text.js';

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

/** RTF by extension or its `{\rtf` magic signature. */
function isRtf(buf: Buffer, ext: string): boolean {
  return ext === '.rtf' || buf.toString('latin1', 0, 5) === '{\\rtf';
}

/** Legacy binary Word (`.doc`) / OLE compound document magic
 *  (`D0 CF 11 E0 A1 B1 1A E1`). officeparser only handles the OOXML `.docx`. */
function isLegacyDoc(buf: Buffer, ext: string): boolean {
  const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return ext === '.doc' || (buf.length >= 8 && buf.subarray(0, 8).equals(OLE_MAGIC));
}

/** RTF control groups whose CONTENTS are metadata, not document prose — their
 *  whole `{...}` group is skipped so font/colour/style names don't leak in. */
const RTF_SKIP_GROUPS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pntext',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
]);

/**
 * Strip RTF control words / groups to plain text — dependency-free (RTF is
 * 7-bit ASCII: `\controlword`, `{`/`}` groups, and `\'xx` hex escapes). Skips
 * metadata groups (font/colour/style tables) and any `{\*\...}` destination
 * group, and treats a control word as a word boundary so adjacent runs don't
 * fuse. Good enough to recover the document's prose for redaction without
 * pulling in a heavyweight RTF parser. Returns null if nothing readable remains.
 */
function rtfToText(buf: Buffer): string | null {
  const rtf = buf.toString('latin1');
  let out = '';
  // Group-depth stack: each entry says whether that group's text is suppressed
  // (a metadata/destination group nests inside an already-suppressed one too).
  const skipStack: boolean[] = [];
  const suppressed = (): boolean => skipStack.some(Boolean);
  // Sticky regexes anchored at `lastIndex` against the FULL string — no
  // `rtf.slice(i)` tail-copy per control word (that made this O(n^2) on a
  // control-word-dense RTF). `/y` matches only at the set position, so it's
  // the equivalent of the original `^…` against a fresh tail slice.
  const groupDest = /\\\*?\\([a-z]+)/iy;
  const starDest = /\\\*/y;
  const controlWord = /\\([a-z]+)(-?\d+)? ?/iy;

  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i]!;
    if (ch === '{') {
      // Open a group. Decide if it's a skip group by peeking the destination
      // control word that (optionally after `\*`) starts it.
      groupDest.lastIndex = i + 1;
      const dest = groupDest.exec(rtf);
      starDest.lastIndex = i + 1;
      const isStar = starDest.test(rtf);
      const skip = (dest !== null && RTF_SKIP_GROUPS.has(dest[1]!.toLowerCase())) || isStar;
      skipStack.push(Boolean(skip));
      continue;
    }
    if (ch === '}') {
      skipStack.pop();
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1];
      // `\'xx` → a single byte; decode the hex pair.
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        const code = Number.parseInt(hex, 16);
        if (!suppressed() && Number.isFinite(code)) out += String.fromCharCode(code);
        i += 3;
        continue;
      }
      // A control word: `\word` optionally followed by a numeric arg, then a
      // single optional space delimiter. `\par`/`\line`/`\tab` → whitespace;
      // any other control word is a word boundary (emit a space so e.g.
      // `Smith\b0 from` doesn't become `Smithfrom`).
      controlWord.lastIndex = i;
      const m = controlWord.exec(rtf); // /y → matches only when anchored at `i`
      if (m) {
        const word = m[1]!.toLowerCase();
        if (!suppressed()) {
          if (word === 'par' || word === 'line' || word === 'sect') out += '\n';
          else if (word === 'tab') out += '\t';
          else out += ' ';
        }
        i += m[0].length - 1;
        continue;
      }
      // An escaped literal (`\{`, `\}`, `\\`).
      if (next === '{' || next === '}' || next === '\\') {
        if (!suppressed()) out += next;
        i += 1;
        continue;
      }
      continue;
    }
    if (ch === '\r' || ch === '\n') continue; // raw line breaks are formatting
    if (!suppressed()) out += ch;
  }
  const text = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * Best-effort plain-text recovery from a legacy binary `.doc` (OLE compound
 * document). There is no dependency-free full parser, but the WordDocument
 * stream stores the body as readable text interleaved with control/formatting
 * bytes; pulling out the runs of printable characters recovers the prose well
 * enough for PII redaction. We scan for runs of printable ASCII / Latin-1 (and
 * common whitespace), drop short noise runs, and join them. Returns null when
 * too little readable text is found (e.g. a corrupt or non-text doc).
 */
function legacyDocToText(buf: Buffer): string | null {
  const runs: string[] = [];
  let cur = '';
  const flush = (): void => {
    // Keep runs of ≥4 printable chars; shorter ones are almost always
    // stray bytes from the binary structures, not prose.
    if (cur.trim().length >= 4) runs.push(cur);
    cur = '';
  };
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    // Treat tab/newline/CR and printable ASCII (0x20–0x7e) + Latin-1 high range
    // (0xa0–0xfe) as text. The C1 control range (0x80–0x9f) is excluded so
    // stray control bytes don't get mapped into the recovered prose.
    const printable =
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      (b >= 0x20 && b < 0x7f) ||
      (b >= 0xa0 && b <= 0xfe);
    if (printable) {
      cur += String.fromCharCode(b);
    } else {
      flush();
    }
  }
  flush();
  const text = runs
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Require a minimum signal so we don't hand back a pile of binary noise.
  return text.length >= 16 ? text : null;
}

/** Extract plain text from an Office/ODF buffer via officeparser. Returns null
 *  on failure (corrupt / unsupported / empty) so the caller can skip rather than
 *  throw. NOT for PDFs — those go through {@link extractPdf}. */
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
 * Extract plain text from a PDF buffer. Tries pdfjs-dist first — it reads the
 * text layer AND AcroForm field values, and handles far more PDFs than
 * officeparser's stale bundled pdf.js (which silently returns "" for many
 * ordinary text PDFs — the bug this fixes).
 *
 *   - pdfjs got text/fields → use it.
 *   - pdfjs opened the PDF but found no text and no fields → it's image-only
 *     (a scan); return null. We do NOT fall back to officeparser here: it can't
 *     do better on an image-only PDF, and its stale bundled worker can emit an
 *     unhandled rejection on some byte layouts.
 *   - pdfjs could not open the PDF (corrupt/encrypted) → last-resort
 *     officeparser, then null.
 */
async function extractPdf(buf: Buffer, name: string): Promise<string | null> {
  const result = await extractPdfText(buf);
  if (result.kind === 'text') return result.text;
  if (result.kind === 'empty') {
    console.warn(
      `[attachments] no extractable text in ${name} (likely a scanned / image-only PDF)`,
    );
    return null;
  }
  // pdfjs could not parse the file — give officeparser a shot before giving up.
  const viaOffice = await extractText(buf, name);
  if (viaOffice && viaOffice.trim().length > 0) return viaOffice;
  console.warn(`[attachments] could not extract text from PDF ${name}`);
  return null;
}

/**
 * Extract plain text from an already-read document BUFFER, dispatching by magic
 * bytes + the supplied `name`'s extension. The format-handling core shared by
 * {@link parseFileToText} (path-based — the picker flow) and the anonymizer's
 * drag-and-drop path (which sends the bytes the renderer already holds). Handles:
 *   - PDF (`.pdf`)           → pdfjs-dist (text layer + AcroForm fields), with an
 *                              officeparser fallback (see {@link extractPdf})
 *   - Office/ODF (`.docx`/`.xlsx`/`.pptx`/`.odt`/`.ods`/`.odp`) → officeparser
 *   - RTF (`.rtf`)            → a dependency-free control-word stripper
 *   - legacy Word (`.doc`)   → best-effort printable-run recovery from the OLE doc
 *   - text / code            → UTF-8 (a NUL byte ⇒ binary ⇒ null)
 * Returns null for a binary/unsupported buffer or when no text could be
 * extracted. No provider, no runner, no network — just local parsing.
 */
export async function parseBufferToText(buf: Buffer, name: string): Promise<string | null> {
  const ext = path.extname(name).toLowerCase();
  // PDF (by extension or magic bytes) → pdfjs (text layer + AcroForm fields),
  // falling back to officeparser. Office/ODF → officeparser.
  if (isPdf(buf, ext)) {
    return extractPdf(buf, name);
  }
  if (OFFICE_EXTENSIONS.has(ext)) {
    return extractText(buf, name);
  }
  // RTF → strip control words locally (officeparser doesn't handle RTF, and the
  // raw bytes are readable-but-noisy markup, so don't fall through to UTF-8).
  if (isRtf(buf, ext)) {
    return rtfToText(buf);
  }
  // Legacy binary `.doc` (OLE) → best-effort printable-run recovery (must come
  // BEFORE the binary/NUL check below, since OLE docs are full of NUL bytes).
  if (isLegacyDoc(buf, ext)) {
    return legacyDocToText(buf);
  }
  // Anything else: UTF-8 text, unless it looks binary.
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

/**
 * Read a file and return its plain text via {@link parseBufferToText}. Returns
 * null on a read failure (in addition to the buffer parser's null cases).
 *
 * Reused by the offline anonymizer's picker flow (`anonymizer.parseDocument`),
 * which provenance-gates the path BEFORE calling this — no provider, no runner,
 * no network.
 */
export async function parseFileToText(absPath: string): Promise<string | null> {
  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch {
    return null;
  }
  return parseBufferToText(buf, path.basename(absPath));
}

/** Hard ceiling on reading a picked file fully into memory. A renderer-chosen
 *  multi-GB log/video must NOT be slurped whole (then base64'd at ~1.33x) into
 *  the main process before any per-type cap applies. Sits comfortably above the
 *  32 MB native-PDF cap so a moderately-oversized PDF still text-extracts as
 *  before; only pathologically large files take the bounded head-read path. */
const MAX_READ_WHOLE_BYTES = 64 * 1024 * 1024; // 64 MB

/** Read at most `max` bytes from the head of a file via a bounded handle, so an
 *  oversized file never fully loads into memory. Mirrors workspace-fs's readHead. */
async function readHead(absPath: string, max: number): Promise<Buffer> {
  const handle = await open(absPath, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await handle.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function buildAttachments(
  files: ReadonlyArray<{ path: string; name: string }>,
): Promise<UserPromptAttachment[]> {
  const out: UserPromptAttachment[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    try {
      // Size-gate BEFORE reading the whole file: a huge picked file (a
      // multi-GB log/video) must not be fully loaded — then base64'd at ~1.33x
      // — into the main process before any per-type cap can apply. Stat first
      // and route oversized text/code to the bounded head-excerpt fallback.
      const size = (await stat(f.path)).size;
      const mediaType = IMAGE_MEDIA_TYPES[ext];

      if (size > MAX_READ_WHOLE_BYTES) {
        if (mediaType) {
          console.warn(`[attachments] skipping ${f.name}: image exceeds ${MAX_IMAGE_BYTES} bytes`);
          continue;
        }
        // Peek the head only. If it's binary (PDF/Office/legacy doc) we can't
        // extract from a partial buffer without loading the whole thing, so
        // skip with a warning; readable text gets a head excerpt + read-on-demand.
        const head = await readHead(f.path, HEAD_EXCERPT_BYTES);
        if (isPdf(head, ext) || OFFICE_EXTENSIONS.has(ext) || isLegacyDoc(head, ext) || head.includes(0)) {
          console.warn(
            `[attachments] skipping ${f.name}: ${size} bytes exceeds the ${MAX_READ_WHOLE_BYTES}-byte read cap`,
          );
          continue;
        }
        out.push(await largeFileFallback(head.toString('utf8'), f.name, f.path, size));
        continue;
      }

      const buf = await readFile(f.path);

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
          const text = await extractPdf(buf, f.name);
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
  /** True total size in bytes when `fullText` is only a head excerpt (the file
   *  was too large to read whole); defaults to fullText's own length. */
  totalBytes: number = fullText.length,
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
  const kb = Math.max(1, Math.round(totalBytes / 1024));
  const approxTokens = Math.round(totalBytes / 4);
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
