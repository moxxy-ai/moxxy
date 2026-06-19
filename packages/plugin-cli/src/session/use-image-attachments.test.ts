import { describe, expect, it, vi } from 'vitest';

// Drive the hook without a React renderer by mocking react's useRef with a
// deterministic, persistent implementation (mirrors use-turn-runner.test.ts).
// The hook only uses useRef, so that's all we need.
const refCells: Array<{ current: unknown }> = [];
let refIdx = 0;

vi.mock('react', () => ({
  useRef: (init: unknown) => {
    const i = refIdx++;
    if (!refCells[i]) refCells[i] = { current: init };
    return refCells[i]!;
  },
}));

// Side-load the image bytes synchronously so registerImage's pending promise
// resolves to a known attachment without touching the filesystem.
vi.mock('../image-attachments.js', () => ({
  detectPastedImagePath: (s: string) =>
    s.endsWith('.png') ? { absPath: s, mediaType: 'image/png', name: 'x.png' } : null,
  extractImagePlaceholders: (text: string) => {
    const re = /\[Image #(\d+)\]/g;
    const ids: number[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) ids.push(Number(m[1]));
    return ids;
  },
  loadImageAttachment: async (d: { mediaType: string; name: string }) => ({
    kind: 'image',
    content: 'AAAA',
    mediaType: d.mediaType,
    name: d.name,
  }),
}));

vi.mock('../clipboard-image.js', () => ({ readClipboardImageSync: () => null }));

const { useImageAttachments } = await import('./use-image-attachments.js');

function mountFresh() {
  refCells.length = 0;
  refIdx = 0;
  return useImageAttachments(() => {});
}

describe('useImageAttachments leak guard (u-image-1)', () => {
  it('clears pending attachments and resets ids when a submit references NO placeholders', async () => {
    const handle = mountFresh();
    // Paste an image: registers a pending decode and inserts [Image #1].
    expect(handle.registerImage({ absPath: '/a.png', mediaType: 'image/png', name: 'a.png' })).toBe(
      '[Image #1]',
    );
    // User deletes the placeholder and submits plain text — no [Image #N].
    const out = await handle.resolveAttachments('just text', null, 'openai', 'gpt-test');
    expect(out).toEqual([]);
    // The pending map must have been cleared and numbering reset: a fresh
    // paste starts back at #1 rather than climbing forever.
    expect(handle.registerImage({ absPath: '/b.png', mediaType: 'image/png', name: 'b.png' })).toBe(
      '[Image #1]',
    );
  });

  it('keeps pending attachments when the model rejects images so a /model switch + resubmit works', async () => {
    const handle = mountFresh();
    handle.registerImage({ absPath: '/a.png', mediaType: 'image/png', name: 'a.png' });
    // Non-vision model: error, but the map is intentionally preserved.
    const rejected = await handle.resolveAttachments(
      'describe [Image #1]',
      { supportsImages: false },
      'openai',
      'gpt-test',
    );
    expect(rejected).toHaveProperty('error');
    // Resubmit against a vision-capable model resolves the SAME placeholder.
    const ok = await handle.resolveAttachments(
      'describe [Image #1]',
      { supportsImages: true },
      'openai',
      'gpt-test',
    );
    expect(Array.isArray(ok)).toBe(true);
    expect((ok as unknown[]).length).toBe(1);
  });
});
