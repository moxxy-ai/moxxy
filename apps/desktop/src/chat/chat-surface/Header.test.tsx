import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { Header } from './Header';
import type { AgentSession } from '../agent-picker/useAgentSession';

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

/** A connected session with no info yet: the bar renders without telemetry,
 *  which is the state every existing case here was written against. */
const AGENT_FIXTURE = {
  info: null,
  selectedModel: null,
  modes: [],
  onMode: () => undefined,
  onPickProviderModel: () => undefined,
  refresh: () => undefined,
} as unknown as AgentSession;

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
        deskName="blocky"
        sessionName="retry untyped gateway fault"
        runState="running"
        agent={AGENT_FIXTURE}
        agentDisabled={false}
        workspaceId="ws-test"
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }), { detail: 1 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^focus mode$/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('focus.toggle');
    });
  });

  it('keeps the bar quiet: search, focus mode and rename sit behind one control', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);
    const onRename = vi.fn();

    render(
      <Header
        phase={connectedPhase}
        deskName="blocky"
        sessionName="retry untyped gateway fault"
        runState="running"
        agent={AGENT_FIXTURE}
        agentDisabled={false}
        workspaceId="ws-test"
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={onRename}
      />,
    );

    // Not on the bar…
    expect(screen.queryByRole('button', { name: /search transcript/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /focus mode/i })).toBeNull();
    // …one control away.
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }), { detail: 1 });
    expect(screen.getByRole('menuitem', { name: /^search this run/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^focus mode$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /^rename workspace$/i }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the search field from the menu and from the shortcut', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);
    const props = {
      phase: connectedPhase,
      deskName: 'blocky',
      sessionName: 'a run',
      runState: 'idle' as const,
      agent: AGENT_FIXTURE,
      agentDisabled: false,
      workspaceId: 'ws-test',
      onSearchChange: vi.fn(),
      canRename: true,
      onRename: vi.fn(),
    };
    const { rerender } = render(<Header {...props} searchQuery={null} />);
    expect(screen.queryByPlaceholderText('Search this run…')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }), { detail: 1 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^search this run/i }));
    expect(screen.getByPlaceholderText('Search this run…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByPlaceholderText('Search this run…')).toBeNull();

    // ⌘F sets the query from outside; a live query opens the field.
    rerender(<Header {...props} searchQuery="" />);
    expect(screen.getByPlaceholderText('Search this run…')).toBeTruthy();
  });

  it('says nothing about a run that needs nothing: idle and done have no badge', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);
    const props = {
      phase: connectedPhase,
      deskName: 'blocky',
      sessionName: 'a run',
      agent: AGENT_FIXTURE,
      agentDisabled: false,
      workspaceId: 'ws-test',
      searchQuery: null,
      onSearchChange: vi.fn(),
      canRename: true,
      onRename: vi.fn(),
    };
    const { rerender } = render(<Header {...props} runState="idle" />);
    expect(screen.queryByRole('img', { name: /^Run / })).toBeNull();
    rerender(<Header {...props} runState="done" />);
    expect(screen.queryByRole('img', { name: /^Run / })).toBeNull();
    rerender(<Header {...props} runState="failed" />);
    expect(screen.getByRole('img', { name: 'Run failed' })).toBeTruthy();
  });

  it('identifies the run in the bar: workspace, session, and its state', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);

    render(
      <Header
        phase={connectedPhase}
        deskName="blocky"
        sessionName="retry untyped gateway fault"
        runState="awaiting"
        agent={AGENT_FIXTURE}
        agentDisabled={false}
        workspaceId="ws-test"
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={vi.fn()}
      />,
    );

    // The old header led with an anonymous Chat/Collaborate/Apps pill and said
    // nothing about the subject; these three facts are the reason it changed.
    expect(screen.getByText('blocky')).toBeInTheDocument();
    expect(screen.getByText('retry untyped gateway fault')).toBeInTheDocument();
    expect(screen.getByText('awaiting you')).toBeInTheDocument();
  });

  it('uses an eye-in-focus-frame glyph for focus mode', () => {
    __setApiOverride({
      invoke: vi.fn(async () => undefined),
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);

    render(
      <Header
        phase={connectedPhase}
        deskName="blocky"
        sessionName="retry untyped gateway fault"
        runState="running"
        agent={AGENT_FIXTURE}
        agentDisabled={false}
        workspaceId="ws-test"
        searchQuery={null}
        onSearchChange={vi.fn()}
        canRename
        onRename={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }), { detail: 1 });
    const focusIcon = screen.getByRole('menuitem', { name: /^focus mode$/i }).querySelector('svg');
    const pathData = Array.from(focusIcon?.querySelectorAll('path') ?? []).map((path) =>
      path.getAttribute('d'),
    );
    expect(pathData).toContain(
      'M5.2 12s2.7-4.1 6.8-4.1 6.8 4.1 6.8 4.1-2.7 4.1-6.8 4.1-6.8-4.1-6.8-4.1Z',
    );
    expect(focusIcon?.querySelector('circle[cx="12"][cy="12"][r="2.15"]')).toBeTruthy();
  });
});
