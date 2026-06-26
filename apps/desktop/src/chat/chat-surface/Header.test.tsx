import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { Header } from './Header';

const connectedPhase = {
  phase: 'connected',
  socket: '/tmp/moxxy.sock',
  sessionId: 'ws-test',
  activeProvider: 'openai-codex',
  activeMode: 'default',
} as const;

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

describe('chat Header focus mode action', () => {
  it('toggles focus mode through the desktop IPC when clicked', async () => {
    const invoke = vi.fn(async () => undefined);
    __setApiOverride({
      invoke,
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);

    render(
      <Header
        phase={connectedPhase}
        workspaceId="ws-test"
        railPane={null}
        onPickPane={vi.fn()}
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={vi.fn()}
        onView={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^toggle focus mode$/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('focus.toggle');
    });
  });

  it('labels the header icon buttons with hover tooltips', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);

    render(
      <Header
        phase={connectedPhase}
        workspaceId="ws-test"
        railPane={null}
        onPickPane={vi.fn()}
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={vi.fn()}
        onView={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^search transcript$/i })).toHaveAttribute(
      'title',
      'Search transcript',
    );
    expect(screen.getByRole('button', { name: /^toggle focus mode$/i })).toHaveAttribute(
      'title',
      'Toggle focus mode',
    );
    expect(screen.getByRole('button', { name: /^rename workspace$/i })).toHaveAttribute(
      'title',
      'Rename workspace',
    );
    expect(screen.getByRole('button', { name: /^open context menu$/i })).toHaveAttribute(
      'title',
      'Open context menu',
    );
  });

  it('uses an eye-in-focus-frame glyph for the focus mode button', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);

    render(
      <Header
        phase={connectedPhase}
        workspaceId="ws-test"
        railPane={null}
        onPickPane={vi.fn()}
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={vi.fn()}
        onView={vi.fn()}
      />,
    );

    const focusIcon = screen
      .getByRole('button', { name: /^toggle focus mode$/i })
      .querySelector('svg');
    const pathData = Array.from(focusIcon?.querySelectorAll('path') ?? []).map((path) =>
      path.getAttribute('d'),
    );
    expect(pathData).toContain(
      'M5.2 12s2.7-4.1 6.8-4.1 6.8 4.1 6.8 4.1-2.7 4.1-6.8 4.1-6.8-4.1-6.8-4.1Z',
    );
    expect(focusIcon?.querySelector('circle[cx="12"][cy="12"][r="2.15"]')).toBeTruthy();
  });
});
