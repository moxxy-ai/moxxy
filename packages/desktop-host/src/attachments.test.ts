import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAttachments, parseFileToText, persistImageBlob } from './attachments';

/** Temp files persistImageBlob writes; cleaned up after each test. */
const written: string[] = [];
/** Temp dirs buildAttachments tests write inputs into. */
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(written.map((p) => unlink(p).catch(() => {})));
  written.length = 0;
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
  tmpDirs.length = 0;
});

const b64 = (bytes: Buffer): string => bytes.toString('base64');

/**
 * Build a minimal, valid single-page text-layer PDF (no deps) whose visible
 * text is `text`. Just enough structure for pdfjs to read a `Tj` showing op.
 */
function makeTextPdf(text: string): Buffer {
  const esc = (s: string): string => s.replace(/([\\()])/g, '\\$1');
  const content = `BT /F1 24 Tf 72 700 Td (${esc(text)}) Tj ET`;
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  return assemblePdf(objs);
}

/**
 * Build a minimal fillable AcroForm PDF (no deps) with one text field named
 * `name` holding `value` — the shape a personal-details form uses (data lives
 * in the field, not the content stream).
 */
function makeFormPdf(name: string, value: string): Buffer {
  const objs: string[] = [];
  objs[1] =
    '<< /Type /Catalog /Pages 2 0 R ' +
    '/AcroForm << /Fields [5 0 R] /NeedAppearances true >> >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [5 0 R] ' +
    '/Resources << /Font << /Helv 6 0 R >> >> /Contents 4 0 R >>';
  objs[4] = '<< /Length 5 >>\nstream\nBT ET\nendstream';
  objs[5] =
    '<< /Type /Annot /Subtype /Widget /FT /Tx ' +
    `/T (${name}) /V (${value}) /Rect [72 700 300 720] /P 3 0 R ` +
    '/DA (/Helv 12 Tf 0 g) >>';
  objs[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  return assemblePdf(objs);
}

/** Assemble PDF objects (1-indexed) into a valid file with an xref table. */
function assemblePdf(objs: string[]): Buffer {
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Build a single-page PDF that is a pure raster image (no text layer, no form
 * fields) — the "scanned document" shape pdfjs cannot extract any text from.
 * Uses a 1×1 DeviceGray image so the structure is valid and image-only.
 */
function makeImageOnlyPdf(): Buffer {
  // A 1-byte raw DeviceGray image (one black pixel).
  const imgData = Buffer.from([0x00]);
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>';
  const content = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objs[5] =
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 ' +
    `/ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${imgData.length} >>\n` +
    `stream\n${imgData.toString('latin1')}\nendstream`;
  return assemblePdf(objs);
}

/** Write `bytes` to a fresh temp file named `name`, returning {path, name}. */
async function tmpFile(name: string, bytes: Buffer | string): Promise<{ path: string; name: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-attach-test-'));
  tmpDirs.push(dir);
  const p = path.join(dir, name);
  await writeFile(p, bytes);
  return { path: p, name };
}

describe('persistImageBlob', () => {
  it('writes the bytes to a temp file and returns a path + name', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
    const att = await persistImageBlob(b64(bytes), 'image/png');
    written.push(att.path);

    expect(path.extname(att.path)).toBe('.png');
    expect(att.name).toBe('pasted-image.png');
    const onDisk = await readFile(att.path);
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it('keeps the source filename when one is given', async () => {
    const att = await persistImageBlob(b64(Buffer.from([1, 2, 3])), 'image/jpeg', 'shot.jpg');
    written.push(att.path);
    expect(att.name).toBe('shot.jpg');
    // Extension on disk follows the media type, not the display name.
    expect(path.extname(att.path)).toBe('.jpg');
  });

  it('gives each blob a unique path so repeated pastes never collide', async () => {
    const a = await persistImageBlob(b64(Buffer.from([1])), 'image/png');
    const b = await persistImageBlob(b64(Buffer.from([1])), 'image/png');
    written.push(a.path, b.path);
    expect(a.path).not.toBe(b.path);
  });

  it('rejects non-image media types', async () => {
    await expect(
      persistImageBlob(b64(Buffer.from('hello')), 'text/plain'),
    ).rejects.toThrow(/only images/i);
  });

  it('rejects an empty blob', async () => {
    await expect(persistImageBlob('', 'image/png')).rejects.toThrow(/empty/i);
  });

  it('rejects blobs over the size cap', async () => {
    const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1);
    await expect(persistImageBlob(b64(tooBig), 'image/png')).rejects.toThrow(/too large/i);
  });
});

describe('buildAttachments', () => {
  it('reads an image as a base64 image attachment', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = await buildAttachments([await tmpFile('pic.png', bytes)]);
    expect(out).toEqual([
      { kind: 'image', content: bytes.toString('base64'), mediaType: 'image/png', name: 'pic.png' },
    ]);
  });

  it('reads a PDF within the native limit as a base64 document', async () => {
    const bytes = Buffer.from('%PDF-1.4\n…tiny pdf bytes…');
    const out = await buildAttachments([await tmpFile('report.pdf', bytes)]);
    expect(out).toEqual([
      {
        kind: 'document',
        content: bytes.toString('base64'),
        mediaType: 'application/pdf',
        name: 'report.pdf',
      },
    ]);
  });

  it('detects a PDF by magic bytes even with a misleading extension', async () => {
    const bytes = Buffer.from('%PDF-1.7\nstuff');
    const out = await buildAttachments([await tmpFile('notes.dat', bytes)]);
    expect(out[0]).toMatchObject({ kind: 'document', mediaType: 'application/pdf' });
  });

  it('inlines a small text/code file as a file attachment', async () => {
    const out = await buildAttachments([await tmpFile('main.ts', 'export const x = 1;\n')]);
    expect(out).toEqual([{ kind: 'file', content: 'export const x = 1;\n', name: 'main.ts' }]);
  });

  it('skips an unknown binary file (NUL bytes) rather than inlining garbage', async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]);
    const out = await buildAttachments([await tmpFile('blob.bin', bytes)]);
    expect(out).toEqual([]);
  });

  it('skips a corrupt Office file instead of failing the turn', async () => {
    // Not a real OOXML zip — officeparser fails, so it is dropped.
    const out = await buildAttachments([await tmpFile('broken.docx', 'not a real docx')]);
    expect(out).toEqual([]);
  });

  it('falls back to a head excerpt + read-on-demand note for an oversized text file', async () => {
    const big = 'A'.repeat(600 * 1024); // > 512 KB inline cap
    const input = await tmpFile('huge.log', big);
    const out = await buildAttachments([input]);
    expect(out).toHaveLength(1);
    const att = out[0]!;
    expect(att.kind).toBe('file');
    expect(att.name).toBe('huge.log');
    // Only a preview is inlined, plus a note pointing at the original path.
    expect(att.content.length).toBeLessThan(big.length);
    expect(att.content).toContain(input.path);
    expect(att.content).toMatch(/read_file|grep/i);
  });

  it('drops an unreadable path without throwing', async () => {
    const out = await buildAttachments([{ path: '/no/such/file.txt', name: 'file.txt' }]);
    expect(out).toEqual([]);
  });

  it('does NOT read a huge text file whole — head-excerpt fallback, accurate size note', async () => {
    // 70 MB > MAX_READ_WHOLE_BYTES (64 MB). A whole-file read + base64 here
    // would balloon the main process; instead we must peek only the head.
    const size = 70 * 1024 * 1024;
    const input = await tmpFile('massive.log', Buffer.alloc(size, 0x41 /* 'A' */));
    const out = await buildAttachments([input]);
    expect(out).toHaveLength(1);
    const att = out[0]!;
    expect(att.kind).toBe('file');
    // Only a small preview is inlined (8 KB head + note), never the whole file.
    expect(att.content.length).toBeLessThan(64 * 1024);
    expect(att.content).toContain(input.path);
    // The size note reflects the TRUE size, not the 8 KB head.
    expect(att.content).toMatch(/~7\d{4} KB/);
  });

  it('skips a huge binary file instead of slurping it into memory', async () => {
    // A 70 MB file whose head contains a NUL → binary → skipped from the head
    // peek, never fully read.
    const buf = Buffer.alloc(70 * 1024 * 1024, 0x41);
    buf[10] = 0x00;
    const out = await buildAttachments([await tmpFile('massive.bin', buf)]);
    expect(out).toEqual([]);
  });
});

describe('parseFileToText', () => {
  it('returns UTF-8 text for a plain text file', async () => {
    const { path: p } = await tmpFile('notes.txt', 'Alice met Bob in Berlin.');
    expect(await parseFileToText(p)).toBe('Alice met Bob in Berlin.');
  });

  it('returns null for a binary (NUL-containing) file', async () => {
    const { path: p } = await tmpFile('blob.bin', Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(await parseFileToText(p)).toBeNull();
  });

  it('returns null for a corrupt Office file rather than throwing', async () => {
    const { path: p } = await tmpFile('broken.docx', Buffer.from('not really a docx'));
    expect(await parseFileToText(p)).toBeNull();
  });

  it('returns null for an unreadable path', async () => {
    expect(await parseFileToText('/no/such/file.txt')).toBeNull();
  });

  it('strips RTF control words to plain text (by extension)', async () => {
    const rtf =
      '{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24 ' +
      'Hello \\b John Smith\\b0 from \\i Berlin\\i0 .\\par Email john@acme.com}';
    const { path: p } = await tmpFile('memo.rtf', rtf);
    const text = await parseFileToText(p);
    expect(text).not.toBeNull();
    expect(text).toContain('Hello John Smith from Berlin');
    expect(text).toContain('john@acme.com');
    // No RTF control words survive.
    expect(text).not.toMatch(/\\rtf1|\\fonttbl|\\par|\\b0/);
  });

  it('detects RTF by its magic signature even without a .rtf extension', async () => {
    const rtf = '{\\rtf1\\ansi Plain content here.\\par}';
    const { path: p } = await tmpFile('mystery.dat', rtf);
    expect(await parseFileToText(p)).toContain('Plain content here.');
  });

  it("decodes RTF \\'xx hex escapes", async () => {
    // \'e9 is é in the default code page.
    const rtf = "{\\rtf1\\ansi caf\\'e9 owner Ren\\'e9}";
    const { path: p } = await tmpFile('accents.rtf', rtf);
    const text = await parseFileToText(p);
    expect(text).toContain('café');
    expect(text).toContain('René');
  });

  it('parses a large control-word-dense RTF in linear time (no O(n^2) slice)', async () => {
    // ~50k control words. The old `rtf.slice(i)` tail-copy per control word made
    // this quadratic and could pin a core for seconds; the sticky-regex parse is
    // linear. The marker prose at the end must still be recovered.
    const body = '\\b0\\par '.repeat(50_000);
    const rtf = `{\\rtf1\\ansi\\deff0 ${body} The end name is Zoe Adler.}`;
    const { path: p } = await tmpFile('huge.rtf', Buffer.from(rtf, 'latin1'));
    const started = Date.now();
    const text = await parseFileToText(p);
    const elapsed = Date.now() - started;
    expect(text).not.toBeNull();
    expect(text).toContain('The end name is Zoe Adler.');
    expect(text).not.toMatch(/\\par|\\b0/);
    // Generous ceiling — a quadratic parse blows well past this on this input.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('recovers readable prose from a legacy binary .doc (OLE)', async () => {
    // A synthetic OLE doc: the compound-doc magic header, then a WordDocument
    // stream of readable prose interleaved with NUL/control noise (the shape
    // legacyDocToText recovers).
    const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const noise = Buffer.from([0, 1, 0, 2, 0, 0, 3]);
    const prose = Buffer.from('Dear Jane Doe, your account 12345 is ready.', 'latin1');
    const more = Buffer.from('Contact: jane@example.com', 'latin1');
    const buf = Buffer.concat([OLE_MAGIC, Buffer.alloc(20), noise, prose, noise, more, noise]);
    const { path: p } = await tmpFile('letter.doc', buf);
    const text = await parseFileToText(p);
    expect(text).not.toBeNull();
    expect(text).toContain('Dear Jane Doe, your account 12345 is ready.');
    expect(text).toContain('jane@example.com');
  });

  it('returns null for a .doc with no recoverable text', async () => {
    const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const buf = Buffer.concat([OLE_MAGIC, Buffer.alloc(64, 0)]);
    const { path: p } = await tmpFile('empty.doc', buf);
    expect(await parseFileToText(p)).toBeNull();
  });

  it('extracts the text layer from a real PDF via pdfjs', async () => {
    // officeparser's bundled pdf.js returns "" for many such PDFs (the bug);
    // pdfjs reads the content-stream text reliably.
    const { path: p } = await tmpFile('details.pdf', makeTextPdf('Hello John Doe 555-1234'));
    const text = await parseFileToText(p);
    expect(text).not.toBeNull();
    expect(text).toContain('Hello John Doe 555-1234');
  });

  it('detects a PDF by magic bytes even with a non-.pdf extension', async () => {
    const { path: p } = await tmpFile('scan.dat', makeTextPdf('Contact: jane@acme.com'));
    expect(await parseFileToText(p)).toContain('jane@acme.com');
  });

  it('pulls AcroForm field values out of a fillable PDF form', async () => {
    // Personal-details forms store data in form fields, not the page content.
    const { path: p } = await tmpFile('form.pdf', makeFormPdf('FullName', 'Jane Q. Doe'));
    const text = await parseFileToText(p);
    expect(text).not.toBeNull();
    expect(text).toContain('Jane Q. Doe');
    // The field name is kept as a label so the redactor sees the context.
    expect(text).toContain('FullName');
  });

  it('returns null for an image-only PDF (no text layer, no form fields)', async () => {
    // A scanned document — only OCR (out of scope) could recover its content.
    const { path: p } = await tmpFile('scanned.pdf', makeImageOnlyPdf());
    expect(await parseFileToText(p)).toBeNull();
  });
});
