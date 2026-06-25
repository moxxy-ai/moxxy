/**
 * Tests for the three-stage focus widget. The point of these tests
 * is to lock down:
 *
 *   1. Each stage renders a visible, clickable affordance — no
 *      empty / blank tile regressions.
 *   2. Stage transitions are wired correctly (inactive → active →
 *      mini-text / mini-voice → back).
 *   3. Every transition fires focus.resize so the BrowserWindow
 *      grows / shrinks with the content — and the mini-text stage
 *      enables edge-resize (`resizable: true`).
 *   4. The text composer in mini-text actually invokes
 *      session.runTurn for the active workspace (the bidirectional
 *      sync test — the focus widget must send to the runner just
 *      like the main window does).
 *   5. A runner.event arriving on the runner.event channel updates
 *      the focus widget's latest preview, rendered as Markdown
 *      (the receive side of the bidirectional sync).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { chatStore } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { FocusWidget } from './FocusWidget';

interface IpcSpy {
  invokes: Array<{ channel: string; args: unknown }>;
  emit: (channel: string, payload: unknown) => void;
}

interface FakeApiOptions {
  readonly historyEvents?: ReadonlyArray<MoxxyEvent>;
  readonly hasTranscriber?: boolean;
}

function event(
  seq: number,
  patch: Partial<MoxxyEvent> & { type: MoxxyEvent['type']; turnId?: string },
): MoxxyEvent {
  return {
    id: `e-${seq}`,
    seq,
    ts: seq,
    sessionId: 's-test',
    turnId: patch.turnId ?? `t-${seq}`,
    ...patch,
  } as MoxxyEvent;
}

function installFakeApi(options: FakeApiOptions = {}): IpcSpy {
  const invokes: Array<{ channel: string; args: unknown }> = [];
  const subs = new Map<string, Set<(payload: unknown) => void>>();
  const historyEvents = options.historyEvents ?? [];
  const hasTranscriber = options.hasTranscriber ?? true;

  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      invokes.push({ channel, args });
      // Connection / chat read APIs need sensible defaults so the
      // bridges don't reject on mount.
      if (channel === 'connection.snapshotAll') {
        return Promise.resolve([
          {
            workspaceId: 'ws-test',
            phase: { phase: 'connected' },
            cliPath: null,
            attempts: 0,
            log: [],
          },
        ]);
      }
      if (channel === 'connection.activeWorkspace') {
        return Promise.resolve('ws-test');
      }
      if (channel === 'chat.loadHistory') {
        return Promise.resolve({ events: historyEvents, prevCursor: null });
      }
      if (channel === 'focus.resize') {
        return Promise.resolve({ horizontalAnchor: 'right' });
      }
      if (channel === 'focus.moveBy') {
        return Promise.resolve({ horizontalAnchor: 'right' });
      }
      if (
        channel === 'focus.dragStart' ||
        channel === 'focus.dragMove'
      ) {
        return Promise.resolve({ horizontalAnchor: 'right' });
      }
      if (channel === 'focus.dragEnd') {
        return Promise.resolve(undefined);
      }
      if (channel === 'session.runTurn') {
        return Promise.resolve({ turnId: 't-1' });
      }
      if (channel === 'session.hasTranscriber') {
        return Promise.resolve(hasTranscriber);
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((channel: string, cb: (payload: unknown) => void) => {
      let set = subs.get(channel);
      if (!set) {
        set = new Set();
        subs.set(channel, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    }) as never,
  } as never);

  return {
    invokes,
    emit: (channel, payload) => {
      const set = subs.get(channel);
      if (set) for (const cb of set) cb(payload);
    },
  };
}

beforeEach(() => {
  // Each test gets a fresh workspace chat so latest-line / sending
  // states don't bleed across cases.
  chatStore.drop('ws-test');
});

afterEach(() => {
  __setApiOverride(null);
});

describe('FocusWidget stages', () => {
  it('renders the inactive square with a visible activate button', () => {
    installFakeApi();
    render(<FocusWidget />);
    const button = screen.getByRole('button', { name: /click to expand/i });
    expect(button).toBeTruthy();
  });

  it('inactive → active fires focus.resize and shows the action row', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open main window/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /close focus mode/i })).toBeTruthy();
    await waitFor(() => {
      const resize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number }).width >= 200 &&
          (i.args as { width: number }).width <= 280,
      );
      expect(resize).toBeTruthy();
    });
  });

  it('active → mini-text shows the composer input + send', () => {
    installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    expect(screen.getByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeTruthy();
  });

  it('active → mini-text enables edge-resize via focus.resize', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    await waitFor(() => {
      const resize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { resizable?: boolean }).resizable === true,
      );
      expect(resize).toBeTruthy();
    });
  });

  it('shows the mic button when the runner has a transcriber', async () => {
    installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^record voice$/i })).toBeTruthy();
    });
  });

  it('hides the mic button when the runner has no transcriber', async () => {
    installFakeApi({ hasTranscriber: false });
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    // Text / restore / close stay visible; mic is gone.
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /record voice/i })).toBeNull();
    });
  });

  it('mini-text → back returns to the active stage', () => {
    installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/ask moxxy/i)).toBeNull();
  });

  it('active → close fires focus.close IPC', () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /close focus mode/i }));
    expect(spy.invokes.some((i) => i.channel === 'focus.close')).toBe(true);
  });

  it('mini → restore-main fires focus.restoreMain IPC', () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    fireEvent.click(screen.getByRole('button', { name: /open main window/i }));
    expect(spy.invokes.some((i) => i.channel === 'focus.restoreMain')).toBe(true);
  });

  it('dragging the inactive square tracks screen coordinates and does not expand it', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    const square = screen.getByRole('button', { name: /click to expand/i });
    fireEvent.mouseDown(square, {
      button: 0,
      clientX: 10,
      clientY: 10,
      screenX: 610,
      screenY: 410,
    });
    fireEvent.mouseMove(square, {
      clientX: 14,
      clientY: 13,
      screenX: 690,
      screenY: 470,
    });
    fireEvent.mouseUp(square, {
      clientX: 14,
      clientY: 13,
      screenX: 690,
      screenY: 470,
    });

    await waitFor(() => {
      expect(spy.invokes.some((i) => i.channel === 'focus.dragStart')).toBe(true);
      const move = spy.invokes.find((i) => i.channel === 'focus.dragMove');
      expect(move).toBeTruthy();
      expect(move!.args).toEqual({ screenX: 690, screenY: 470 });
      expect(spy.invokes.some((i) => i.channel === 'focus.dragEnd')).toBe(true);
    });
    expect(spy.invokes.some((i) => i.channel === 'focus.moveBy')).toBe(false);
    expect(screen.queryByRole('button', { name: /^text$/i })).toBeNull();
  });
});

describe('FocusWidget bidirectional sync', () => {
  it('hydrates the active workspace history and shows the latest user/assistant block in mini-text', async () => {
    const spy = installFakeApi({
      historyEvents: [
        event(1, { type: 'user_prompt', turnId: 't-history', source: 'user', text: 'cached user prompt' } as never),
        event(2, {
          type: 'assistant_message',
          turnId: 't-history',
          source: 'model',
          content: 'cached assistant answer',
          stopReason: 'end_turn',
        } as never),
      ],
    });
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    await waitFor(() => {
      const load = spy.invokes.find((i) => i.channel === 'chat.loadHistory');
      expect(load).toBeTruthy();
      expect((load!.args as { workspaceId: string }).workspaceId).toBe('ws-test');
    });
    await waitFor(() => {
      expect(screen.getByText(/cached assistant answer/i)).toBeTruthy();
    });
  });

  it('sending from mini-text invokes session.runTurn for the active workspace', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    // Wait for ConnectionBridge to push the active workspace id
    // through, which un-disables the input.
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/ask moxxy|no active workspace/i) as HTMLInputElement;
      expect(input.disabled).toBe(false);
    });

    const input = screen.getByPlaceholderText(/ask moxxy/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello from focus' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      const turnCall = spy.invokes.find((i) => i.channel === 'session.runTurn');
      expect(turnCall).toBeTruthy();
      expect((turnCall!.args as { prompt: string }).prompt).toBe('hello from focus');
      expect((turnCall!.args as { workspaceId: string }).workspaceId).toBe(
        'ws-test',
      );
    });
  });

  it('a runner.event flowing into chatStore surfaces in mini-text latest line', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    // Simulate the runner streaming an assistant_chunk event — this
    // is what bindWindow's SessionDriver delivers to the focus
    // window when the main window sends a turn.
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-incoming',
        seq: 10,
        ts: 10,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-incoming',
        delta: 'response from the main window',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByText(/response from the main window/i)).toBeTruthy();
    });
  });

  it('renders the latest assistant message as Markdown, not raw text', async () => {
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    chatStore.dispatch('ws-test', {
      type: 'event',
      event: {
        type: 'assistant_chunk',
        turnId: 't-md',
        delta: 'Fetched the **newest** page',
      } as never,
    });

    // The `**newest**` must render as a <strong>, not literal asterisks —
    // this is the fix for the mini-text showing raw markdown on one line.
    await waitFor(() => {
      expect(screen.getByText('newest').tagName).toBe('STRONG');
    });
  });

  it('shows an inactive assistant preview bubble and opens mini-text when the square is clicked', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview',
        seq: 20,
        ts: 20,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview',
        delta: 'live reply while collapsed',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByText(/live reply while collapsed/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    });
    expect(screen.getByText(/live reply while collapsed/i)).toBeTruthy();
  });

  it('opens mini-text when the inactive preview text is clicked', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-click',
        seq: 21,
        ts: 21,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-click',
        delta: 'clickable preview reply',
      } as MoxxyEvent,
    });

    const previewButton = await screen.findByRole('button', {
      name: /open latest reply/i,
    });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    });
    expect(screen.getByText(/clickable preview reply/i)).toBeTruthy();
  });

  it('shows assistant preview beside the active controls', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-active-preview',
        seq: 22,
        ts: 22,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-active-preview',
        delta: 'reply while controls are open',
      } as MoxxyEvent,
    });

    await screen.findByText(/reply while controls are open/i);
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();

    await waitFor(() => {
      const previewResize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).width >= 600,
      );
      expect(previewResize).toBeTruthy();
      expect((previewResize!.args as { height: number }).height).toBeGreaterThanOrEqual(100);
    });
  });

  it('keeps long assistant preview text scrollable instead of truncating it', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-scrollable-preview',
        seq: 23,
        ts: 23,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-scrollable-preview',
        delta:
          'To jest długa odpowiedź do dymku focus mode, która ma wystarczająco dużo tekstu, żeby przekroczyć kilka linii i wymusić przewijanie w obrębie samego dymku zamiast ucinania treści po kilku zdaniach. Finalny fragment do przewijania musi nadal być dostępny w treści.',
      } as MoxxyEvent,
    });

    const previewButton = await screen.findByRole('button', {
      name: /open latest reply/i,
    });
    expect(previewButton.textContent).toContain('Finalny fragment do przewijania');
    expect(previewButton.textContent?.endsWith('...')).toBe(false);
    expect(previewButton.getAttribute('style')).toContain('overflow-y: auto');
  });

  it('reserves enough window height for a three-line inactive preview', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-height',
        seq: 24,
        ts: 24,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-height',
        delta:
          'Tak — jest kilka sensownych sposobów na tworzenie napisów w locie, zależnie od tego, czy chodzi Ci o szybki podgląd czy finalny eksport.',
      } as MoxxyEvent,
    });

    await screen.findByText(/tworzenie napisów/i);

    await waitFor(() => {
      const previewResize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).width >= 400,
      );
      expect(previewResize).toBeTruthy();
      expect((previewResize!.args as { height: number }).height).toBeGreaterThanOrEqual(100);
    });
  });

  it('keeps the inactive preview window size stable while assistant chunks stream', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-1',
        seq: 21,
        ts: 21,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-size',
        delta: 'first live chunk',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByText(/first live chunk/i)).toBeTruthy();
    });

    const resizeCountAfterFirstPreview = spy.invokes.filter(
      (i) => i.channel === 'focus.resize',
    ).length;

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-2',
        seq: 22,
        ts: 22,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-size',
        delta: ' and second live chunk',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByText(/first live chunk and second live chunk/i)).toBeTruthy();
    });

    const resizeCountAfterSecondPreview = spy.invokes.filter(
      (i) => i.channel === 'focus.resize',
    ).length;
    expect(resizeCountAfterSecondPreview).toBe(resizeCountAfterFirstPreview);
  });
});
