import { describe, expect, it } from 'vitest';
import { buildAxTree } from './tree.js';
import { workInProgress } from './progress.js';

/**
 * The page's own word that something it started has not finished — declared
 * the standard way (aria-busy, a progress bar with no amount), not guessed from
 * any one site's wording.
 */
const page = (...children: Array<{ nodeId: string; role: string; name: string; busy?: boolean }>) =>
  buildAxTree([
    { nodeId: 'r', role: { value: 'RootWebArea' }, childIds: children.map((c) => c.nodeId) },
    ...children.map((c) => ({
      nodeId: c.nodeId,
      role: { value: c.role },
      name: { value: c.name },
      ...(c.busy ? { properties: [{ name: 'busy', value: { value: true } }] } : {}),
    })),
  ]);

describe('workInProgress', () => {
  it('lists each element still working, as its row', () => {
    const tree = page(
      { nodeId: 'a', role: 'button', name: 'Deploy' },
      { nodeId: 'b', role: 'progressbar', name: 'Deploying' },
      { nodeId: 'c', role: 'region', name: 'Logs', busy: true },
    );

    expect(workInProgress(tree)).toEqual([
      expect.stringMatching(/progressbar: "Deploying"/),
      expect.stringMatching(/region: "Logs"/),
    ]);
  });

  it('is empty on a page at rest', () => {
    expect(workInProgress(page({ nodeId: 'a', role: 'button', name: 'Deploy' }))).toEqual([]);
    expect(workInProgress(null)).toEqual([]);
  });
});
