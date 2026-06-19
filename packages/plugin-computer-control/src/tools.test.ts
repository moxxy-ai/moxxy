import { MoxxyError } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import {
  applescriptTool,
  clickTool,
  clipboardTool,
  keyTool,
  openTool,
  screenshotTool,
  typeTool,
} from './index.js';

/** Minimal ToolContext stub — only `signal` is read by these handlers. */
const fakeCtx = { signal: new AbortController().signal } as never;

describe('@moxxy/plugin-computer-control schemas', () => {
  it('screenshot accepts an optional region', () => {
    expect(screenshotTool.inputSchema.safeParse({}).success).toBe(true);
    expect(
      screenshotTool.inputSchema.safeParse({ region: { x: 0, y: 0, width: 100, height: 100 } })
        .success,
    ).toBe(true);
  });

  it('click requires x and y, count 1-3 only', () => {
    expect(clickTool.inputSchema.safeParse({ x: 100, y: 200 }).success).toBe(true);
    expect(clickTool.inputSchema.safeParse({ x: 100, y: 200, count: 2 }).success).toBe(true);
    expect(clickTool.inputSchema.safeParse({ x: 100, y: 200, count: 5 }).success).toBe(false);
    expect(clickTool.inputSchema.safeParse({ x: -1, y: 0 }).success).toBe(false);
  });

  it('type rejects oversize payloads', () => {
    expect(typeTool.inputSchema.safeParse({ text: 'hello' }).success).toBe(true);
    expect(typeTool.inputSchema.safeParse({ text: 'a'.repeat(5000) }).success).toBe(false);
  });

  it('key allows known modifier names and rejects unknown ones', () => {
    expect(keyTool.inputSchema.safeParse({ key: 'tab' }).success).toBe(true);
    expect(
      keyTool.inputSchema.safeParse({ key: 'a', modifiers: ['cmd', 'shift'] }).success,
    ).toBe(true);
    expect(
      keyTool.inputSchema.safeParse({ key: 'a', modifiers: ['windows'] }).success,
    ).toBe(false);
  });

  it('open requires target or app at runtime (not enforced by zod)', () => {
    // Both optional at schema level — runtime guard does the validation.
    expect(openTool.inputSchema.safeParse({ app: 'Safari' }).success).toBe(true);
    expect(openTool.inputSchema.safeParse({ target: '/tmp' }).success).toBe(true);
    expect(openTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it('clipboard requires action enum', () => {
    expect(clipboardTool.inputSchema.safeParse({ action: 'read' }).success).toBe(true);
    expect(clipboardTool.inputSchema.safeParse({ action: 'write', text: 'x' }).success).toBe(true);
    expect(clipboardTool.inputSchema.safeParse({ action: 'paste' }).success).toBe(false);
  });

  it('applescript needs a non-empty script', () => {
    expect(applescriptTool.inputSchema.safeParse({ script: 'return 1' }).success).toBe(true);
    expect(applescriptTool.inputSchema.safeParse({ script: '' }).success).toBe(false);
  });

  it('open rejects a target/app beginning with "-" (argument-injection guard, darwin only)', async () => {
    // The guard runs after ensureDarwin, so on non-darwin hosts ensureDarwin
    // throws first — assert that path too so the test is meaningful everywhere.
    if (process.platform === 'darwin') {
      await expect(openTool.handler({ target: '-g' }, fakeCtx)).rejects.toThrow(
        /must not begin with '-'/,
      );
      await expect(openTool.handler({ app: '-n' }, fakeCtx)).rejects.toThrow(
        /must not begin with '-'/,
      );
    } else {
      await expect(openTool.handler({ target: '-g' }, fakeCtx)).rejects.toBeInstanceOf(MoxxyError);
    }
  });

  it('screenshot returns an image-shaped result ({ mediaType, base64 }), never a stringified blob', async () => {
    // The SDK's tool_result projection emits a provider `image` ContentBlock
    // ONLY when the result object carries a string `mediaType` + `base64`; any
    // other shape falls through to JSON.stringify and reaches the model as
    // undecodable base64 TEXT. Assert the handler honors that contract.
    if (process.platform === 'darwin') {
      // On a host without Screen Recording permission (typical CI) the handler
      // throws a MoxxyError instead of capturing — also acceptable; the ONLY
      // forbidden outcome is returning a (stringified) blob the model can't see.
      let result: unknown;
      try {
        // Tiny region keeps the capture cheap and well under the byte cap.
        result = await screenshotTool.handler(
          { region: { x: 0, y: 0, width: 1, height: 1 } },
          fakeCtx,
        );
      } catch (err) {
        expect(err).toBeInstanceOf(MoxxyError);
        return;
      }
      // Must be a structured object, NOT a string (a stringified blob).
      expect(typeof result).toBe('object');
      expect(result).not.toBeNull();
      const r = result as { mediaType?: unknown; base64?: unknown };
      expect(typeof r.mediaType).toBe('string');
      expect(r.mediaType as string).toMatch(/^image\//);
      expect(typeof r.base64).toBe('string');
      expect((r.base64 as string).length).toBeGreaterThan(0);
    } else {
      // Non-darwin: ensureDarwin rejects before any capture — still never a blob.
      await expect(screenshotTool.handler({}, fakeCtx)).rejects.toBeInstanceOf(MoxxyError);
    }
  });

  it('every tool is permission:prompt — never auto-allowed', () => {
    const all = [
      screenshotTool,
      clickTool,
      typeTool,
      keyTool,
      openTool,
      clipboardTool,
      applescriptTool,
    ];
    for (const tool of all) {
      expect(tool.permission?.action).toBe('prompt');
    }
  });
});
