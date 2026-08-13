import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';

/**
 * Hermetic cover for the screenshot handler.
 *
 * The previous test shelled out to the real `screencapture`, which made it
 * depend on the host being macOS, having a display, and having been granted
 * Screen Recording. Worse, it accepted a thrown MoxxyError as a pass, so on any
 * machine without that permission (every CI runner) it verified nothing while
 * still reporting green. Faking the process layer means the contract below is
 * actually asserted, on every platform.
 */
const runProcess = vi.fn();
const ensureDarwin = vi.fn();

vi.mock('../shell.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shell.js')>();
  return {
    ...actual,
    ensureDarwin: (...args: unknown[]) => ensureDarwin(...args),
    runProcess: (...args: unknown[]) => runProcess(...args),
  };
});

const { screenshotTool } = await import('./screenshot.js');

const ctx = { signal: new AbortController().signal } as never;

/** Smallest thing that is unmistakably PNG bytes; content is never decoded. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const ok = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

/** Track every temp path either command was pointed at, to assert cleanup. */
let touched: string[] = [];

const workingTools = (outBytes: Buffer = PNG): void => {
  runProcess.mockImplementation(async (cmd: string, args: string[]) => {
    if (cmd === 'screencapture') {
      const target = args[args.length - 1]!;
      touched.push(target);
      await fs.writeFile(target, PNG);
      return ok;
    }
    if (cmd === 'sips') {
      const out = args[args.indexOf('--out') + 1]!;
      touched.push(out);
      await fs.writeFile(out, outBytes);
      return ok;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
};

beforeEach(() => {
  touched = [];
  ensureDarwin.mockReset();
  runProcess.mockReset();
});
afterEach(async () => {
  for (const f of touched) await fs.rm(f, { force: true });
});

describe('computer_screenshot', () => {
  it('returns { mediaType, base64 }, the shape the model can actually see', async () => {
    // Load-bearing: the SDK emits a provider `image` block only for exactly
    // this shape. Anything else is JSON.stringify'd and reaches the model as
    // base64 TEXT it cannot decode.
    workingTools();

    const result = (await screenshotTool.handler({}, ctx)) as Record<string, unknown>;

    expect(typeof result).toBe('object');
    // jpeg is the default: much smaller, and the model reads pixels not bytes.
    expect(result.mediaType).toBe('image/jpeg');
    expect(typeof result.base64).toBe('string');
    expect(result.base64).toBe(PNG.toString('base64'));
  });

  it('reports image/png when png was asked for', async () => {
    workingTools();

    const result = (await screenshotTool.handler({ format: 'png' }, ctx)) as Record<
      string,
      unknown
    >;

    expect(result.mediaType).toBe('image/png');
  });

  it('passes a region through to screencapture as -R', async () => {
    workingTools();

    await screenshotTool.handler({ region: { x: 1, y: 2, width: 3, height: 4 } }, ctx);

    const args = runProcess.mock.calls.find((c) => c[0] === 'screencapture')![1] as string[];
    expect(args[args.indexOf('-R') + 1]).toBe('1,2,3,4');
  });

  it('refuses on a non-darwin host rather than shelling out anyway', async () => {
    ensureDarwin.mockImplementation(() => {
      throw new MoxxyError({ code: 'TOOL_ERROR', message: 'darwin only' });
    });

    await expect(screenshotTool.handler({}, ctx)).rejects.toBeInstanceOf(MoxxyError);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('surfaces a capture failure as a MoxxyError, naming the likely cause', async () => {
    runProcess.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', timedOut: false });

    await expect(screenshotTool.handler({}, ctx)).rejects.toThrow(/screencapture failed/);
  });

  it('refuses an image that is still over the cap after compression', async () => {
    // Rather than hand the model megabytes it cannot use, say what to lower.
    workingTools(Buffer.alloc(6 * 1024 * 1024, 1));

    await expect(screenshotTool.handler({}, ctx)).rejects.toThrow(/exceeded/);
  });

  it('leaves no temp file behind, on success or on failure', async () => {
    workingTools();
    await screenshotTool.handler({}, ctx);

    runProcess.mockReset();
    workingTools(Buffer.alloc(6 * 1024 * 1024, 1));
    await screenshotTool.handler({}, ctx).catch(() => undefined);

    expect(touched.length).toBeGreaterThan(0);
    for (const f of touched) {
      await expect(fs.access(f)).rejects.toThrow();
    }
  });
});
