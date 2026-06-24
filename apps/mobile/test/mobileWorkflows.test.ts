/**
 * @vitest-environment jsdom
 */

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { UseWorkflows } from '@moxxy/client-core';
import { useMobileWorkflows } from '../src/hooks/useMobileWorkflows';

type WorkflowSummary = UseWorkflows['list'][number];
type MobileWorkflowStore = ReturnType<typeof useMobileWorkflows>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sample: WorkflowSummary = {
  name: 'daily-summary',
  description: 'Rolls up the inbox',
  enabled: true,
  scope: 'project',
  steps: 3,
  triggers: 'cron(0 8 * * *)',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

const stableRefresh = async () => undefined;
const stableSetEnabled = async () => undefined;
const stableSetTargetSession = async () => undefined;
const stableRun = async () => undefined;

function coreWorkflows(overrides: Partial<UseWorkflows> = {}): UseWorkflows {
  return {
    list: [sample],
    loading: false,
    error: null,
    lastRun: null,
    refresh: stableRefresh,
    setEnabled: stableSetEnabled,
    setTargetSession: stableSetTargetSession,
    run: stableRun,
    ...overrides,
  };
}

function render(node: ReactNode) {
  container ??= document.createElement('div');
  document.body.append(container);
  root ??= createRoot(container);
  act(() => root?.render(node));
}

describe('useMobileWorkflows', () => {
  it('keeps action identities stable across list-only rerenders', () => {
    let observed: MobileWorkflowStore | null = null;

    function Harness({ core }: { readonly core: UseWorkflows }) {
      observed = useMobileWorkflows(core);
      return null;
    }

    const firstCore = coreWorkflows();
    render(createElement(Harness, { core: firstCore }));
    const first = requireObserved(observed);
    const firstRefresh = first.refresh;
    const firstRun = first.run;

    render(createElement(Harness, { core: coreWorkflows({ list: [{ ...sample, enabled: false }] }) }));
    const second = requireObserved(observed);

    expect(second.refresh).toBe(firstRefresh);
    expect(second.run).toBe(firstRun);
    expect(second.workflows).toEqual([{ ...sample, enabled: false }]);
  });
});

function requireObserved(value: MobileWorkflowStore | null): MobileWorkflowStore {
  if (!value) throw new Error('hook did not render');
  return value;
}
