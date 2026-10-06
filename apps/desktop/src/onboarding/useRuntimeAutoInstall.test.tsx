import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UseOnboarding } from '@moxxy/client-core';
import { useRuntimeAutoInstall } from './useRuntimeAutoInstall';

type Runtime = Pick<UseOnboarding, 'node' | 'installNode'>;

function runtime(node: UseOnboarding['node'], overrides: Partial<UseOnboarding['installNode']> = {}) {
  const runs: number[] = [];
  const ob: Runtime = {
    node,
    installNode: {
      running: false,
      progress: [],
      error: null,
      run: async () => {
        runs.push(Date.now());
        return true;
      },
      ...overrides,
    },
  };
  return { ob, runs };
}

const missing = { installed: false, version: null, bin: null };
const present = { installed: true, version: 'v22.12.0', bin: '/usr/local/bin/node' };

describe('useRuntimeAutoInstall', () => {
  it('installs the runtime without being asked when the computer has none', () => {
    const { ob, runs } = runtime(missing);

    renderHook(() => useRuntimeAutoInstall(ob));

    expect(runs).toHaveLength(1);
  });

  it('leaves a computer that already has the runtime alone', () => {
    const { ob, runs } = runtime(present);

    renderHook(() => useRuntimeAutoInstall(ob));

    expect(runs).toHaveLength(0);
  });

  it('waits for the check before deciding', () => {
    const { ob, runs } = runtime(null);

    const view = renderHook(({ current }) => useRuntimeAutoInstall(current), {
      initialProps: { current: ob },
    });
    expect(runs).toHaveLength(0);

    view.rerender({ current: { ...ob, node: missing } });
    expect(runs).toHaveLength(1);
  });

  it('tries once: a failed install waits for the person to retry', () => {
    const { ob, runs } = runtime(missing);

    const view = renderHook(({ current }) => useRuntimeAutoInstall(current), {
      initialProps: { current: ob },
    });
    view.rerender({
      current: { ...ob, installNode: { ...ob.installNode, error: 'no network' } },
    });
    view.rerender({ current: { ...ob, node: { ...missing } } });

    expect(runs).toHaveLength(1);
  });
});
