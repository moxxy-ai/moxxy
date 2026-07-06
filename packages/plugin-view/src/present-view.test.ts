import { describe, expect, it } from 'vitest';
import type { ToolContext, ToolDef } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
import { defaultViewRenderer } from '@moxxy/core';
import { buildViewPlugin, type PresentViewResult, type ViewSurface } from './index.js';

const ctx = {} as ToolContext;
function tool(surface?: ViewSurface | null): ToolDef {
  const plugin = buildViewPlugin({
    getRenderer: () => defaultViewRenderer,
    ...(surface !== undefined ? { getSurface: () => surface } : {}),
  });
  const t = plugin.tools?.find((x) => x.name === 'present_view');
  if (!t) throw new Error('present_view missing');
  return t;
}
const run = (t: ToolDef, spec: string) => t.handler({ spec }, ctx) as PresentViewResult;

describe('present_view — input schema', () => {
  const t = tool();
  it('requires a non-empty spec', () => {
    expect(t.inputSchema.safeParse({ spec: '' }).success).toBe(false);
    expect(t.inputSchema.safeParse({ spec: '<view/>' }).success).toBe(true);
  });
  it('caps spec length at 20k', () => {
    expect(t.inputSchema.safeParse({ spec: 'x'.repeat(20_001) }).success).toBe(false);
    expect(t.inputSchema.safeParse({ spec: 'x'.repeat(20_000) }).success).toBe(true);
  });
  it('accepts an optional fallbackText (capped)', () => {
    expect(t.inputSchema.safeParse({ spec: '<view/>', fallbackText: 'summary' }).success).toBe(true);
    expect(t.inputSchema.safeParse({ spec: '<view/>', fallbackText: 'x'.repeat(2_001) }).success).toBe(false);
  });
});

describe('present_view — output', () => {
  it('returns a view-rooted AST and an accurate nodeCount', () => {
    const r = run(tool(), '<view title="t"><stack><text>a</text><text>b</text></stack></view>');
    expect(r.ok).toBe(true);
    expect(r.ast?.root.kind).toBe('element');
    expect(r.ast?.root.kind === 'element' && r.ast.root.tag).toBe('view');
    // view > stack > (text>txt, text>txt) = 1 + 1 + (2 + 2) = 6
    expect(r.nodeCount).toBe(6);
  });

  it('surfaces parse errors with messages', () => {
    const r = run(tool(), '<view><iframe/></view>');
    expect(r.ok).toBe(false);
    expect(r.rendered).toBe(false);
    expect(r.errors?.some((e) => /unknown tag <iframe>/.test(e.message))).toBe(true);
  });

  it('reports no active renderer', () => {
    const plugin = buildViewPlugin({ getRenderer: () => null });
    const tools = plugin.tools;
    assertDefined(tools, 'plugin declares tools');
    const t = tools.find((x) => x.name === 'present_view');
    assertDefined(t, 'plugin registers present_view');
    const r = run(t, '<view/>');
    expect(r.ok).toBe(false);
    const err = r.errors?.[0];
    assertDefined(err, 'a failed parse reports at least one error');
    expect(err.message).toMatch(/no active view renderer/);
  });

  it('without a surface: rendered=false, no url/viewId', () => {
    const r = run(tool(null), '<view/>');
    expect(r.ok).toBe(true);
    expect(r.rendered).toBe(false);
    expect(r.url).toBeUndefined();
    expect(r.viewId).toBeUndefined();
  });

  it('with a surface: returns url and a fresh viewId each call', () => {
    let n = 0;
    const surface: ViewSurface = { url: 'https://x.trycloudflare.com/?t=k', nextViewId: () => `v_${++n}` };
    const t = tool(surface);
    const a = run(t, '<view/>');
    const b = run(t, '<view/>');
    expect(a.rendered).toBe(true);
    expect(a.url).toBe('https://x.trycloudflare.com/?t=k');
    expect(a.viewId).toBe('v_1');
    expect(b.viewId).toBe('v_2');
  });
});

describe('present_view — plugin shape', () => {
  it('contributes exactly the present_view tool', () => {
    const plugin = buildViewPlugin({ getRenderer: () => defaultViewRenderer });
    expect(plugin.tools?.map((t) => t.name)).toEqual(['present_view']);
    expect(plugin.name).toBe('@moxxy/plugin-view');
  });
});
