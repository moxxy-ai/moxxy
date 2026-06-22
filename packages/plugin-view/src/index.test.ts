import { describe, expect, it } from 'vitest';
import type { ToolContext, ToolDef, ViewNode, ViewParseResult, ViewRendererDef } from '@moxxy/sdk';
import { defaultViewRenderer } from '@moxxy/core';
import { buildViewPlugin, type PresentViewResult } from './index.js';

function toolOf(plugin: ReturnType<typeof buildViewPlugin>): ToolDef {
  const tool = plugin.tools?.find((t) => t.name === 'present_view');
  if (!tool) throw new Error('present_view tool not found');
  return tool;
}

const ctx = {} as ToolContext;

/** A renderer whose parse returns the supplied doc unconditionally — lets us
 * feed the handler ASTs that core's depth/node caps would normally reject. */
function fixedRenderer(root: ViewNode): ViewRendererDef {
  return {
    name: 'fixed',
    allowList: [],
    parse: (): ViewParseResult => ({ ok: true, doc: { root } }),
    validate: () => [],
  };
}

/** A linearly-nested `stack` chain `depth` levels deep. */
function deepChain(depth: number): ViewNode {
  let node: ViewNode = { kind: 'text', value: 'leaf' };
  for (let i = 0; i < depth; i++) {
    node = { kind: 'element', tag: 'stack', props: {}, children: [node] };
  }
  return node;
}

/** A wide `stack` with `n` direct text children. */
function wideStack(n: number): ViewNode {
  const children: ViewNode[] = [];
  for (let i = 0; i < n; i++) children.push({ kind: 'text', value: 'x' });
  return { kind: 'element', tag: 'stack', props: {}, children };
}

describe('present_view tool', () => {
  const tool = toolOf(buildViewPlugin({ getRenderer: () => defaultViewRenderer }));
  const call = (spec: string) => tool.handler({ spec }, ctx) as PresentViewResult;

  it('returns the validated AST for a good spec', () => {
    const r = call(`<view title="x"><text>hi</text></view>`);
    expect(r.ok).toBe(true);
    expect(r.ast?.title).toBe('x');
    expect(r.nodeCount).toBeGreaterThan(0);
    // No surface attached → parsed only.
    expect(r.rendered).toBe(false);
  });

  it('returns errors for a bad spec without throwing', () => {
    const r = call(`<view><script>x</script></view>`);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]?.message).toMatch(/unknown tag/);
  });

  it('surfaces the url + viewId when a surface is attached', () => {
    const t = toolOf(
      buildViewPlugin({
        getRenderer: () => defaultViewRenderer,
        getSurface: () => ({ url: 'https://x.trycloudflare.com/?t=abc', nextViewId: () => 'v_1' }),
      }),
    );
    const r = t.handler({ spec: `<view><text>hi</text></view>` }, ctx) as PresentViewResult;
    expect(r.ok).toBe(true);
    expect(r.url).toContain('trycloudflare');
    expect(r.viewId).toBe('v_1');
    expect(r.rendered).toBe(true);
  });

  it('reports no active renderer gracefully', () => {
    const t = toolOf(buildViewPlugin({ getRenderer: () => null }));
    const r = t.handler({ spec: `<view><text>hi</text></view>` }, ctx) as PresentViewResult;
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]?.message).toMatch(/no active view renderer/);
  });

  it('rejects an over-large AST (node-count ceiling) without serializing it', () => {
    // A custom renderer can emit an AST far past what the 20k-char source cap
    // implies; the handler must reject on node count, not return the AST.
    const t = toolOf(buildViewPlugin({ getRenderer: () => fixedRenderer(wideStack(5_000)) }));
    const r = t.handler({ spec: '<view/>' }, ctx) as PresentViewResult;
    expect(r.ok).toBe(false);
    expect(r.rendered).toBe(false);
    expect(r.ast).toBeUndefined();
    expect(r.errors?.[0]?.message).toMatch(/view too large/);
  });

  it('does not throw (no stack overflow) on a pathologically deep AST', () => {
    // Deeper than any recursion limit; iterative counting + node cap must turn
    // this into a structured error, never a RangeError out of the handler.
    const t = toolOf(buildViewPlugin({ getRenderer: () => fixedRenderer(deepChain(200_000)) }));
    let r: PresentViewResult;
    expect(() => {
      r = t.handler({ spec: '<view/>' }, ctx) as PresentViewResult;
    }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.ast).toBeUndefined();
  });

  it('accepts an AST exactly at the ceiling', () => {
    // 1 (stack) + 1999 text children = 2000 nodes — must pass.
    const t = toolOf(buildViewPlugin({ getRenderer: () => fixedRenderer(wideStack(1_999)) }));
    const r = t.handler({ spec: '<view/>' }, ctx) as PresentViewResult;
    expect(r.ok).toBe(true);
    expect(r.nodeCount).toBe(2_000);
  });

  it('degrades to rendered:false when getSurface throws', () => {
    const t = toolOf(
      buildViewPlugin({
        getRenderer: () => defaultViewRenderer,
        getSurface: () => {
          throw new Error('surface mid-teardown');
        },
      }),
    );
    const r = t.handler({ spec: '<view><text>hi</text></view>' }, ctx) as PresentViewResult;
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(false);
    expect(r.viewId).toBeUndefined();
    expect(r.url).toBeUndefined();
  });

  it('degrades to rendered:false when nextViewId throws', () => {
    const t = toolOf(
      buildViewPlugin({
        getRenderer: () => defaultViewRenderer,
        getSurface: () => ({
          url: 'https://x.trycloudflare.com/?t=k',
          nextViewId: () => {
            throw new Error('minter corrupted');
          },
        }),
      }),
    );
    const r = t.handler({ spec: '<view><text>hi</text></view>' }, ctx) as PresentViewResult;
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(false);
    expect(r.viewId).toBeUndefined();
  });

  it('treats an empty-string viewId as a surface fault (rendered:false, no id)', () => {
    const t = toolOf(
      buildViewPlugin({
        getRenderer: () => defaultViewRenderer,
        getSurface: () => ({ url: 'https://x.trycloudflare.com/?t=k', nextViewId: () => '' }),
      }),
    );
    const r = t.handler({ spec: '<view><text>hi</text></view>' }, ctx) as PresentViewResult;
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(false);
    expect(r.viewId).toBeUndefined();
    expect(r.url).toBeUndefined();
  });

  it('degrades to a structured error when a custom renderer.parse throws', () => {
    // The default renderer never throws, but a swapped-in custom renderer is
    // not bound by that guarantee — a throw must become a tool error, not a
    // turn-level exception out of the handler.
    const throwing: ViewRendererDef = {
      name: 'throwing',
      allowList: [],
      parse: () => {
        throw new Error('renderer exploded');
      },
      validate: () => [],
    };
    const t = toolOf(buildViewPlugin({ getRenderer: () => throwing }));
    let r: PresentViewResult;
    expect(() => {
      r = t.handler({ spec: '<view/>' }, ctx) as PresentViewResult;
    }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.rendered).toBe(false);
    expect(r!.errors?.[0]?.message).toMatch(/renderer exploded/);
  });

  it('rejects a malformed AST (missing root) with an honest message', () => {
    // A custom renderer claims ok:true but returns no usable root; the handler
    // must reject cleanly (and NOT mislabel it "too deeply nested").
    const malformed: ViewRendererDef = {
      name: 'malformed',
      allowList: [],
      parse: () => ({ ok: true, doc: { root: undefined } as unknown as ViewParseResult['doc'] }) as ViewParseResult,
      validate: () => [],
    };
    const t = toolOf(buildViewPlugin({ getRenderer: () => malformed }));
    let r: PresentViewResult;
    expect(() => {
      r = t.handler({ spec: '<view/>' }, ctx) as PresentViewResult;
    }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.ast).toBeUndefined();
    expect(r!.errors?.[0]?.message).toMatch(/malformed AST/);
  });

  it('degrades when a custom renderer reports a failure with non-iterable errors', () => {
    // ok:false but `errors` is not an array — the handler must not throw on
    // `.map` and must surface a generic failure instead.
    const bad: ViewRendererDef = {
      name: 'bad-errors',
      allowList: [],
      parse: () => ({ ok: false, errors: null as unknown as [] }) as ViewParseResult,
      validate: () => [],
    };
    const t = toolOf(buildViewPlugin({ getRenderer: () => bad }));
    let r: PresentViewResult;
    expect(() => {
      r = t.handler({ spec: '<view/>' }, ctx) as PresentViewResult;
    }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.errors?.[0]?.message).toMatch(/parse failure/);
  });

  it('short-circuits when the turn is already aborted', () => {
    const t = toolOf(buildViewPlugin({ getRenderer: () => defaultViewRenderer }));
    const ac = new AbortController();
    ac.abort();
    const abortedCtx = { signal: ac.signal } as unknown as ToolContext;
    const r = t.handler({ spec: '<view><text>hi</text></view>' }, abortedCtx) as PresentViewResult;
    expect(r.ok).toBe(false);
    expect(r.rendered).toBe(false);
    expect(r.errors?.[0]?.message).toMatch(/aborted/);
  });
});
