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
});
