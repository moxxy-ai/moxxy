import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineTool, MoxxyError, z } from '@moxxy/sdk';
import { ensureDarwin, procFailureCause, runProcess } from '../shell.js';

const regionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Defaults aggressive on size — a Retina full-screen PNG can pass
 * 5 MB base64-encoded and instantly blow the model's context window.
 * 1280px JPEG @ q72 is ~150 KB for a typical desktop and still
 * legible enough for the model to identify UI elements.
 */
const DEFAULT_MAX_DIM = 1280;
const DEFAULT_FORMAT = 'jpeg' as const;
const DEFAULT_JPEG_QUALITY = 72;
/** Soft cap on the encoded image size in bytes. We refuse to return
 *  anything bigger than this even after the model asks for high-res —
 *  better to fail loudly than silently nuke the context. */
const MAX_BYTES = 1_500_000;

export const screenshotTool = defineTool({
  name: 'computer_screenshot',
  description:
    'Take a screenshot of the macOS desktop. Returns base64-encoded image bytes ' +
    'the model can see directly. By default the image is downscaled to 1280px ' +
    'and JPEG-compressed so a single screenshot stays well under context — ' +
    'override `maxDim` / `format` / `quality` only when you genuinely need full ' +
    'resolution. macOS will prompt for Screen Recording permission on first use.',
  inputSchema: z.object({
    region: regionSchema
      .optional()
      .describe(
        'Crop to a rectangle in screen-pixel coordinates (top-left origin). Omit for full screen.',
      ),
    maxDim: z
      .number()
      .int()
      .min(256)
      .max(3840)
      .optional()
      .describe(
        `Resize so the longest edge is <= this many pixels. Default ${DEFAULT_MAX_DIM}. ` +
          'Lower = smaller payload + less context cost; raise only when you need pixel detail.',
      ),
    format: z
      .enum(['jpeg', 'png'])
      .optional()
      .describe(
        `Output format. Default "${DEFAULT_FORMAT}" (much smaller). Pick "png" only when ` +
          'you need lossless (rare — JPEG is fine for UI screenshots).',
      ),
    quality: z
      .number()
      .int()
      .min(40)
      .max(100)
      .optional()
      .describe(
        `JPEG quality (1-100). Default ${DEFAULT_JPEG_QUALITY}. Ignored for PNG output.`,
      ),
  }),
  permission: { action: 'prompt' },
  // Capture + resize round-trips through temp files under os.tmpdir()
  // (which is /var/folders/... on macOS, not /tmp). Budget covers the two
  // 15s child stages plus encode/cleanup.
  isolation: {
    capabilities: {
      subprocess: true,
      commands: ['screencapture', 'sips'],
      fs: { read: [`${os.tmpdir()}/**`], write: [`${os.tmpdir()}/**`] },
      net: { mode: 'none' },
      timeMs: 45_000,
    },
  },
  async handler({ region, maxDim, format, quality }, ctx) {
    ensureDarwin('computer_screenshot');
    const fmt = format ?? DEFAULT_FORMAT;
    const dim = maxDim ?? DEFAULT_MAX_DIM;
    const q = quality ?? DEFAULT_JPEG_QUALITY;

    // Always capture as PNG first (preserves color depth + no double
    // compression), then let `sips` resize and convert in one pass.
    // `-x` silences the camera-shutter sound.
    // A random suffix guarantees uniqueness even for two captures in the
    // same process within the same millisecond (pid+Date.now() alone can
    // collide and cross-corrupt the temp files).
    const uniq = randomUUID();
    const captureTmp = path.join(
      os.tmpdir(),
      `moxxy-screencap-${process.pid}-${Date.now()}-${uniq}.png`,
    );
    const captureArgs = ['-x', '-t', 'png'];
    if (region) {
      captureArgs.push('-R', `${region.x},${region.y},${region.width},${region.height}`);
    }
    captureArgs.push(captureTmp);
    // Guarantee the original PNG (potentially several MB for a Retina full
    // screen) is removed on EVERY exit path — success, throw, or a spawn
    // reject (e.g. `sips` not on PATH) / mid-capture timeout that may have
    // left a partial file. Without this, those failure paths leak the temp
    // file in os.tmpdir() permanently and accumulate over repeated failures.
    try {
      const cap = await runProcess('screencapture', captureArgs, {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: 15_000,
      });
      if (cap.exitCode !== 0) {
        const cause = procFailureCause(cap, 15_000);
        throw new MoxxyError({
          code: 'TOOL_ERROR',
          message: cause
            ? `screencapture ${cause}`
            : `screencapture failed (exit ${cap.exitCode}): ${cap.stderr.trim() || '(no stderr — likely Screen Recording permission missing — grant in System Settings → Privacy & Security)'}`,
          context: { tool: 'computer_screenshot', exitCode: cap.exitCode, timedOut: cap.timedOut ? 1 : 0 },
        });
      }

      // Resize + format-convert in one sips call. `-Z N` fits within N
      // on the longest edge while preserving aspect ratio. Output ext
      // picks the format; format options apply when JPEG.
      const outExt = fmt === 'jpeg' ? 'jpg' : 'png';
      const outTmp = path.join(
        os.tmpdir(),
        `moxxy-screencap-${process.pid}-${Date.now()}-${uniq}-out.${outExt}`,
      );
      const sipsArgs = [
        '-Z',
        String(dim),
        '--setProperty',
        'format',
        fmt,
      ];
      if (fmt === 'jpeg') {
        sipsArgs.push('--setProperty', 'formatOptions', String(q));
      }
      sipsArgs.push(captureTmp, '--out', outTmp);
      const sip = await runProcess('sips', sipsArgs, {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        timeoutMs: 15_000,
      });
      if (sip.exitCode !== 0) {
        await fs.rm(outTmp, { force: true });
        const cause = procFailureCause(sip, 15_000);
        throw new MoxxyError({
          code: 'TOOL_ERROR',
          message: cause
            ? `sips resize/convert ${cause}`
            : `sips resize/convert failed (exit ${sip.exitCode}): ${sip.stderr.trim() || '(no error message)'}`,
          context: { tool: 'computer_screenshot', exitCode: sip.exitCode, timedOut: sip.timedOut ? 1 : 0 },
        });
      }

      try {
        const bytes = await fs.readFile(outTmp);
        if (bytes.length > MAX_BYTES) {
          throw new MoxxyError({
            code: 'TOOL_ERROR',
            message:
              `screenshot exceeded ${MAX_BYTES} bytes after compression (got ${bytes.length}). ` +
              `Lower maxDim (currently ${dim}) or quality (currently ${q}), or pass a smaller region.`,
            context: { tool: 'computer_screenshot', byteLength: bytes.length },
          });
        }
        // The `{ mediaType, base64 }` pair is load-bearing, not decorative: the
        // SDK's tool_result projection keys off exactly this shape to emit a
        // provider `image` ContentBlock so the model SEES the pixels. Returning
        // the bytes inside a stringified blob (the JSON.stringify fallback path)
        // would reach the model as base64 TEXT it cannot decode. Extra fields
        // are diagnostic only and ignored by the image projection.
        return {
          mediaType: fmt === 'jpeg' ? ('image/jpeg' as const) : ('image/png' as const),
          base64: bytes.toString('base64'),
          byteLength: bytes.length,
          maxDim: dim,
          format: fmt,
          ...(fmt === 'jpeg' ? { quality: q } : {}),
        };
      } finally {
        await fs.rm(outTmp, { force: true });
      }
    } finally {
      await fs.rm(captureTmp, { force: true });
    }
  },
});
