import { describe, expect, it } from 'vitest';
import type { ToolContext, ToolDef } from '@moxxy/sdk';
import { defaultViewRenderer } from '@moxxy/core';
import { buildViewPlugin, type PresentViewResult } from './index.js';

function toolOf(plugin: ReturnType<typeof buildViewPlugin>): ToolDef {
  const tool = plugin.tools?.find((t) => t.name === 'present_view');
  if (!tool) throw new Error('present_view tool not found');
  return tool;
}

const ctx = {} as ToolContext;

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
});
