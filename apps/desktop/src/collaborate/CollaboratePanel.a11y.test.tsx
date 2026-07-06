/**
 * Accessibility regression tests for the Collaborate panel's TaskModal — the
 * panel's only modal. It must be a REAL dialog: role + aria-modal + a labelled
 * title, focus moved in on open, Escape-to-close, and focus restored to the
 * trigger on close. The pre-fix modal was a click-only div with none of this, so
 * a keyboard/AT user had no way to dismiss it and could Tab out into the
 * obscured page behind the scrim.
 *
 * The panel reads its collaboration from the dedicated coordinator via `useCollab`
 * (not a chat session), so we mock that hook to render a running collaboration
 * with a claimed board item — the task chip whose modal we exercise.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { assertDefined } from '@moxxy/sdk';

// A running collaboration whose board has one claimed item ("api.ts") — folded
// by pairToolEvents into the task chip the TaskModal opens from. Built via
// vi.hoisted so the (hoisted) vi.mock factory below can reference it.
const seeded = vi.hoisted(() => {
  let seq = 0;
  const ce = (subtype: string, payload: unknown): unknown => {
    seq += 1;
    return {
      type: 'plugin_event',
      id: `e${seq}`,
      ts: seq * 1000,
      sessionId: 's',
      turnId: 't',
      source: 'plugin',
      pluginId: '@moxxy/mode-collaborative',
      subtype,
      payload,
    };
  };
  return [
    ce('collab_started', { task: 'build the thing', parallel: true }),
    ce('collab_agent_spawned', { id: 'backend', role: 'implementer' }),
    ce('collab_board_update', {
      kind: 'board',
      action: 'claim',
      item: { id: 't1', title: 'api.ts', status: 'claimed', owner: 'backend', paths: ['src/api.ts'], detail: 'build the api' },
    }),
  ];
});

vi.mock('./useCollab', () => ({
  useCollab: () => ({
    events: seeded,
    running: true,
    task: 'build the thing',
    approval: null,
    start: async () => {},
    end: async () => {},
    command: async () => {},
    respondApproval: () => {},
  }),
}));

import { CollaboratePanel } from './CollaboratePanel';

const WS = 'ws-collab';

beforeEach(() => {
  __setApiOverride({
    invoke: ((channel: string) => {
      if (channel === 'collab.active') return Promise.resolve({ active: false });
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => {}) as never,
  } as never);
});

afterEach(() => {
  __setApiOverride(null);
});

function openTaskModal(): HTMLElement {
  const trigger = screen.getByRole('button', { name: /api\.ts/i });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  return trigger;
}

describe('CollaboratePanel TaskModal accessibility', () => {
  it('opens a labelled dialog (role=dialog, aria-modal, aria-labelledby title)', () => {
    render(<CollaboratePanel onView={() => {}} workspaceId={WS} />);
    openTaskModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    // The label target is the task title.
    assertDefined(labelledBy, 'aria-labelledby target id');
    expect(document.getElementById(labelledBy)?.textContent).toMatch(/api\.ts/i);
  });

  it('moves focus into the dialog on open (not left on the obscured trigger)', () => {
    render(<CollaboratePanel onView={() => {}} workspaceId={WS} />);
    const trigger = openTaskModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<CollaboratePanel onView={() => {}} workspaceId={WS} />);
    const trigger = openTaskModal();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('has an accessible close button', () => {
    render(<CollaboratePanel onView={() => {}} workspaceId={WS} />);
    openTaskModal();
    const close = screen.getByRole('button', { name: /close/i });
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
