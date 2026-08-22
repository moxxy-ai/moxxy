import { describe, expect, it } from 'vitest';
import { captureAx, pointForBackendNode } from './perceive.js';
import type { CdpSession } from './types.js';

/**
 * The bridge from CDP to the tree the model reads. Driven against a recorded
 * CDP session rather than a real browser: what matters here is which commands
 * are sent, in what order, and how a malformed or empty reply is handled —
 * none of which needs Chromium to verify.
 */

function fakeCdp(replies: Record<string, unknown>): { cdp: CdpSession; sent: string[] } {
  const sent: string[] = [];
  const cdp: CdpSession = {
    send: async (method) => {
      sent.push(method);
      if (!(method in replies)) return {};
      const reply = replies[method];
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { cdp, sent };
}

describe('captureAx', () => {
  it('enables the accessibility domain before asking for the tree', () => {
    const { cdp, sent } = fakeCdp({
      'Accessibility.getFullAXTree': { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' } }] },
    });

    return captureAx(cdp).then(() => {
      expect(sent).toEqual(['Accessibility.enable', 'Accessibility.getFullAXTree']);
    });
  });

  it('builds a uid-indexed tree from the reply', async () => {
    const { cdp } = fakeCdp({
      'Accessibility.getFullAXTree': {
        nodes: [
          { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
          { nodeId: '2', role: { value: 'button' }, name: { value: 'OK' }, backendDOMNodeId: 9 },
        ],
      },
    });

    const tree = await captureAx(cdp);

    expect(tree?.children[0]?.name).toBe('OK');
    expect(tree?.index.get('2')?.backendNodeId).toBe(9);
  });

  it('returns null when the page exposes no tree', async () => {
    const { cdp } = fakeCdp({ 'Accessibility.getFullAXTree': { nodes: [] } });
    expect(await captureAx(cdp)).toBeNull();
  });

  it('returns null rather than throwing when the reply is malformed', async () => {
    const { cdp } = fakeCdp({ 'Accessibility.getFullAXTree': { unexpected: true } });
    expect(await captureAx(cdp)).toBeNull();
  });

  it('propagates a CDP failure so the caller can report it', async () => {
    const { cdp } = fakeCdp({ 'Accessibility.getFullAXTree': new Error('target closed') });
    await expect(captureAx(cdp)).rejects.toThrow('target closed');
  });
});

describe('pointForBackendNode', () => {
  it('returns the centre of the content box', async () => {
    // A 100x40 box with its top-left at (10, 20): centre is (60, 40).
    const { cdp } = fakeCdp({
      'DOM.getBoxModel': { model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } },
    });

    expect(await pointForBackendNode(cdp, 7)).toEqual({ x: 60, y: 40 });
  });

  it('scrolls the node into view before measuring it', async () => {
    const { cdp, sent } = fakeCdp({
      'DOM.getBoxModel': { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } },
    });

    await pointForBackendNode(cdp, 7);

    expect(sent.indexOf('DOM.scrollIntoViewIfNeeded')).toBeLessThan(sent.indexOf('DOM.getBoxModel'));
  });

  it('returns null for a node with no box — it is not rendered', async () => {
    const { cdp } = fakeCdp({ 'DOM.getBoxModel': {} });
    expect(await pointForBackendNode(cdp, 7)).toBeNull();
  });

  it('returns null when the node is gone', async () => {
    const { cdp } = fakeCdp({ 'DOM.getBoxModel': new Error('Could not find node') });
    expect(await pointForBackendNode(cdp, 7)).toBeNull();
  });

  it('returns null for a zero-area box', async () => {
    // A collapsed element is not clickable; reporting a point would produce a
    // click that lands on whatever is underneath it.
    const { cdp } = fakeCdp({ 'DOM.getBoxModel': { model: { content: [5, 5, 5, 5, 5, 5, 5, 5] } } });
    expect(await pointForBackendNode(cdp, 7)).toBeNull();
  });
});
