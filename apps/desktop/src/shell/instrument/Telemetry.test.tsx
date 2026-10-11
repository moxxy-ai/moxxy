import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { ContextMeter, contextLevel } from './ContextMeter';
import { compact, Telemetry } from './Telemetry';

/**
 * The context gauge is the readout a supervisor actually watches during a long
 * run, and it deliberately shows no number at rest. That makes two things
 * load-bearing: the ticks must be truthful at the edges, and the meaning must
 * still reach a screen reader without them.
 */

describe('contextLevel', () => {
  it('changes at the two thresholds that mean something', () => {
    expect(contextLevel(0)).toBe('nominal');
    expect(contextLevel(0.69)).toBe('nominal');
    expect(contextLevel(0.7)).toBe('caution');
    expect(contextLevel(0.89)).toBe('caution');
    expect(contextLevel(0.9)).toBe('critical');
    expect(contextLevel(1)).toBe('critical');
  });
});

describe('ContextMeter', () => {
  it('lights no segment at zero, and every segment when full', () => {
    const { container, unmount } = render(<ContextMeter fraction={0} />);
    expect(container.querySelectorAll('i[data-on]')).toHaveLength(0);
    unmount();

    const full = render(<ContextMeter fraction={1} />);
    expect(full.container.querySelectorAll('i[data-on]')).toHaveLength(12);
  });

  it('lights at least one segment for any non-zero usage', () => {
    // A gauge that reads empty while the window is filling is worse than no
    // gauge: 1% of a 200k window is 2000 tokens, which is not nothing.
    const { container } = render(<ContextMeter fraction={0.01} />);
    expect(container.querySelectorAll('i[data-on]').length).toBeGreaterThanOrEqual(1);
  });

  it('clamps out-of-range fractions instead of overflowing the gauge', () => {
    const under = render(<ContextMeter fraction={-1} />);
    expect(under.container.querySelectorAll('i[data-on]')).toHaveLength(0);
    under.unmount();
    const over = render(<ContextMeter fraction={4} />);
    expect(over.container.querySelectorAll('i[data-on]')).toHaveLength(12);
  });

  it('states its reading for assistive tech, since nothing is painted at rest', () => {
    render(<ContextMeter fraction={0.42} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '42');
    expect(meter).toHaveAttribute('aria-label', 'Context window 42% used');
  });
});

describe('compact', () => {
  it('keeps small counts exact and abbreviates the ones that would smear', () => {
    expect(compact(0)).toBe('0');
    expect(compact(999)).toBe('999');
    expect(compact(1_000)).toBe('1.0k');
    expect(compact(12_400)).toBe('12.4k');
    // Past 100k the decimal is noise in a 12px cell.
    expect(compact(128_412)).toBe('128k');
    expect(compact(1_234_567)).toBe('1.2M');
  });
});

describe('Telemetry model panel', () => {
  it('sets the effort and fast mode next to the model and marks a fast conversation', async () => {
    const invoke = vi.fn(async () => {});
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    const info = {
      sessionId: 's1',
      providers: [{ name: 'openai-codex', models: [{ id: 'gpt-6-luna', supportsReasoning: true, supportsFast: true }] }],
      modes: [], activeProvider: 'openai-codex', activeMode: null, activeModeBadge: null,
      reasoningEffort: 'high' as const, fast: true,
    };
    render(<Telemetry workspaceId="ws" info={info} selectedModel="gpt-6-luna" disabled={false} onPick={() => {}} />);
    expect(screen.getByTestId('instrument-telemetry')).toHaveTextContent('gpt-6-luna · fast');

    fireEvent.click(screen.getByTestId('instrument-telemetry'));
    expect(screen.getByLabelText('Reasoning effort')).toHaveValue('high');
    fireEvent.click(screen.getByRole('switch', { name: 'Fast mode' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.setFast', { workspaceId: 'ws', enabled: false }));
    __setApiOverride(null);
  });
});

describe('Telemetry model name', () => {
  const info = {
    sessionId: 's1',
    providers: [
      {
        name: 'openai-codex',
        models: [{ id: 'gpt-plain' }, { id: 'gpt-6-luna', supportsReasoning: true, supportsFast: true }],
      },
    ],
    modes: [], activeProvider: 'openai-codex', activeMode: null, activeModeBadge: null,
  };

  it('names the model a turn will run on when none was picked here, and offers what that model has', () => {
    __setApiOverride({ invoke: vi.fn(async () => {}), subscribe: () => () => {} } as unknown as MoxxyApi);
    render(
      <Telemetry workspaceId="ws-default" info={{ ...info, defaultModel: 'gpt-6-luna' }} selectedModel={null} disabled={false} onPick={() => {}} />,
    );
    expect(screen.getByTestId('instrument-telemetry')).toHaveTextContent('gpt-6-luna');

    fireEvent.click(screen.getByTestId('instrument-telemetry'));
    expect(screen.getByRole('switch', { name: 'Fast mode' })).toBeInTheDocument();
    __setApiOverride(null);
  });

  it('names the provider when the runner is too old to say which model that is', () => {
    __setApiOverride({ invoke: vi.fn(async () => {}), subscribe: () => () => {} } as unknown as MoxxyApi);
    render(<Telemetry workspaceId="ws-old" info={info} selectedModel={null} disabled={false} onPick={() => {}} />);
    expect(screen.getByTestId('instrument-telemetry')).toHaveTextContent('openai-codex');
    __setApiOverride(null);
  });
});

describe('Telemetry token count', () => {
  /**
   * Every call sends the whole conversation again, so the running total reaches
   * millions after a few dozen calls. Almost all of it is the same prefix read
   * back from the provider's cache, which costs a tenth of a new token; a bare
   * "2.4M" read as if every one of them was new.
   */
  const info = {
    sessionId: 's1', providers: [], modes: [], activeProvider: 'openai-codex',
    activeMode: null, activeModeBadge: null,
  };
  const usage = (workspaceId: string, tokens: Record<string, number>): void =>
    chatStore.dispatch(workspaceId, {
      type: 'event',
      event: {
        id: `${workspaceId}-1`, seq: 1, ts: 1, turnId: 'T1', sessionId: 'S', source: 'model',
        type: 'provider_response', provider: 'openai-codex', model: 'gpt-6-luna', ...tokens,
      } as unknown as MoxxyEvent,
    });
  const tokensCell = (): HTMLElement => {
    const cell = screen.getByTestId('instrument-telemetry').querySelector<HTMLElement>('[data-cell="tokens"]');
    if (!cell) throw new Error('no tokens cell');
    return cell;
  };

  it('says how much of the total was read back from the cache', () => {
    __setApiOverride({ invoke: async () => null, subscribe: () => () => {} } as unknown as MoxxyApi);
    usage('tok-cached', { inputTokens: 5_000, cacheReadTokens: 2_250_000, cacheCreationTokens: 0, outputTokens: 145_000 });
    render(<Telemetry workspaceId="tok-cached" info={info} selectedModel={null} disabled={false} onPick={() => {}} />);

    expect(tokensCell()).toHaveTextContent('tok2.4M · 94% cache');
    expect(tokensCell()).toHaveAttribute(
      'data-tip',
      `${(2_400_000).toLocaleString()} tokens over 1 calls — ${(2_250_000).toLocaleString()} read back from the cache, ${(150_000).toLocaleString()} new`,
    );
    __setApiOverride(null);
  });

  it('says nothing about a cache the provider did not report', () => {
    __setApiOverride({ invoke: async () => null, subscribe: () => () => {} } as unknown as MoxxyApi);
    usage('tok-uncached', { inputTokens: 12_000, outputTokens: 400 });
    render(<Telemetry workspaceId="tok-uncached" info={info} selectedModel={null} disabled={false} onPick={() => {}} />);

    expect(tokensCell()).toHaveTextContent(/^tok12\.4k$/);
    expect(tokensCell()).toHaveAttribute('data-tip', `${(12_400).toLocaleString()} tokens over 1 calls`);
    __setApiOverride(null);
  });
});
