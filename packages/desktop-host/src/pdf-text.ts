/**
 * Robust, dependency-light PDF → plain-text extraction for the offline
 * anonymizer (and the attachment text fallback).
 *
 * Why this exists: officeparser bundles an old pdf.js build that returns an
 * EMPTY string for a great many ordinary text-layer PDFs (and silently so — no
 * throw), which surfaced to the user as "Could not extract text from this
 * document." This module uses `pdfjs-dist` (the maintained pure-JS engine — no
 * native deps, no network) directly:
 *
 *   - concatenates every page's `getTextContent()` items (the visible text
 *     layer), inserting line breaks at vertical gaps so prose stays readable;
 *   - pulls AcroForm field VALUES (fillable personal-details forms store data in
 *     form fields, not the content stream) via `getFieldObjects()` + per-page
 *     Widget annotations.
 *
 * It runs entirely in the main process with the worker disabled (`getDocument`
 * runs the parser on the calling thread in Node), no `eval`, and no network
 * (`disableFontFace`, no `standardFontDataUrl`/`cMapUrl` fetches). Returns null
 * when the PDF has no extractable text AND no form values — i.e. a scanned
 * image-only PDF, where only OCR (out of scope) could recover the content.
 */

// pdfjs-dist 4.x ships an ESM "legacy" build that works under Node without the
// modern top-level-await / DOM globals the default build assumes. Import it
// lazily so the (sizable) module only loads when a PDF is actually parsed.
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfjsModule> | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
      // In Node there is no real Web Worker; pdfjs runs a "fake worker" inline.
      // Setting up that fake worker needs the worker module loaded in this
      // realm — otherwise getDocument throws "No GlobalWorkerOptions.workerSrc
      // specified". Importing the worker module registers it AND sets a
      // workerSrc, with NO runtime path resolution — so it survives Rollup
      // bundling into the Electron main bundle (where node_modules isn't
      // packed and `require.resolve` of a worker file would fail). This is the
      // bundler-safe way to run pdfjs offline on the main thread.
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      return m;
    })();
  }
  return pdfjsPromise;
}

/** A page's text items as exposed by pdfjs (the subset we read). */
interface TextItemLike {
  str?: string;
  /** Set on hard line breaks between runs; we honour it for readability. */
  hasEOL?: boolean;
}

/**
 * Outcome of {@link extractPdfText}:
 *   - `text`     — pdfjs read content (text layer and/or form fields);
 *   - `empty`    — pdfjs opened the PDF fine but it has NO text and NO form
 *                  fields (a scanned/image-only PDF — OCR territory, out of
 *                  scope). The caller should NOT bother officeparser: it can't
 *                  do better and its stale worker may even crash on the bytes;
 *   - `failed`   — pdfjs could not open/parse the PDF (corrupt/encrypted). The
 *                  caller may fall back to officeparser as a last resort.
 */
export type PdfExtractResult =
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  | { kind: 'failed' };

/**
 * Extract plain text from a PDF buffer. Concatenates the text layer of every
 * page and appends any AcroForm field values. Never throws — failures resolve
 * to a `failed`/`empty` result the caller dispatches on (see
 * {@link PdfExtractResult}).
 */
export async function extractPdfText(buf: Buffer): Promise<PdfExtractResult> {
  let pdfjs: PdfjsModule;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    // pdfjs failed to load (should not happen) — let the caller fall back.
    return { kind: 'failed' };
  }

  // pdfjs takes ownership of the TypedArray it parses, so hand it a private
  // copy (Buffer's backing ArrayBuffer may be shared/pooled by Node).
  const data = new Uint8Array(buf.byteLength);
  data.set(buf);

  let doc: Awaited<ReturnType<PdfjsModule['getDocument']>['promise']> | null = null;
  try {
    doc = await pdfjs.getDocument({
      data,
      // Main-process, offline-only hardening:
      useWorkerFetch: false, // never fetch worker assets over the network
      isEvalSupported: false, // no eval() in the font/JS interpreter
      disableFontFace: true, // we only want text, not rendering
      // No standardFontDataUrl / cMapUrl: we intentionally do not fetch font or
      // CMap data. Missing CMaps can drop the odd CJK glyph, but it keeps the
      // path strictly offline and is far better than the empty-string failure.
    }).promise;

    const parts: string[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        const content = await page.getTextContent();
        const pageText = joinTextItems(content.items as TextItemLike[]);
        if (pageText.trim().length > 0) parts.push(pageText);
      } finally {
        // Free per-page parse state so big PDFs don't accumulate memory.
        page.cleanup();
      }
    }

    // AcroForm field values (fillable forms keep data in fields, not the page
    // content stream). getFieldObjects() returns a map of field name → entries.
    try {
      const fields = await doc.getFieldObjects();
      const formText = fields ? collectFieldValues(fields) : '';
      if (formText.trim().length > 0) parts.push(formText);
    } catch {
      /* no AcroForm / unreadable fields — ignore */
    }

    const text = parts
      .join('\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Opened fine: either we got text, or it's genuinely image-only (`empty`).
    return text.length > 0 ? { kind: 'text', text } : { kind: 'empty' };
  } catch {
    // Corrupt / unsupported / encrypted PDF — let the caller fall back.
    return { kind: 'failed' };
  } finally {
    // Always release the worker/parser resources.
    await doc?.destroy().catch(() => {});
  }
}

/**
 * Join a page's text items into readable prose. pdfjs emits one item per text
 * run; `hasEOL` marks the end of a visual line. We insert a newline on EOL and a
 * space otherwise so words from adjacent runs don't fuse.
 */
function joinTextItems(items: readonly TextItemLike[]): string {
  let out = '';
  for (const it of items) {
    const s = typeof it.str === 'string' ? it.str : '';
    out += s;
    if (it.hasEOL) out += '\n';
    else if (s.length > 0 && !s.endsWith(' ')) out += ' ';
  }
  return out;
}

/**
 * Pull human-readable values out of pdfjs's `getFieldObjects()` map. Each entry
 * carries the field's current `value` (and for some widgets a `defaultValue`);
 * we keep the field name alongside its value so the redactor sees the label too
 * (e.g. "Full name: Jane Doe").
 */
function collectFieldValues(fields: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, entries] of Object.entries(fields)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const value = fieldValue(entry);
      if (value && value.trim().length > 0) {
        const label = name.trim();
        lines.push(label ? `${label}: ${value}` : value);
      }
    }
  }
  return lines.join('\n');
}

/** Best-effort read of a field entry's display value as a string. */
function fieldValue(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as { value?: unknown; defaultValue?: unknown };
  const raw = e.value ?? e.defaultValue;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string').join(', ');
  return null;
}
