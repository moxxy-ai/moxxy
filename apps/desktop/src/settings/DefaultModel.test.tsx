import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DefaultModel } from './DefaultModel';
import type { ModelDefaultsState } from './useModelDefaults';

const state = (over: Partial<ModelDefaultsState> = {}): ModelDefaultsState => ({
  loading: false,
  providers: [
    { name: 'anthropic', models: ['claude-sonnet-5-5'] },
    { name: 'openai-codex', models: ['gpt-plain', 'gpt-6-luna'] },
  ],
  provider: 'openai-codex',
  model: 'gpt-6-luna',
  effort: 'medium',
  effortLevels: ['off', 'low', 'medium', 'high', 'xhigh'],
  fast: true,
  canSetEffort: true,
  canSetFast: true,
  busy: false,
  error: null,
  setModel: vi.fn(async () => undefined),
  setEffort: vi.fn(async () => undefined),
  setFast: vi.fn(async () => undefined),
  ...over,
});

describe('DefaultModel', () => {
  it('shows the model, the effort and the fast tier new conversations start with', () => {
    render(<DefaultModel defaults={state()} />);

    expect(screen.getByLabelText('Default model')).toHaveValue('openai-codex/gpt-6-luna');
    expect(screen.getByTestId('default-model')).toHaveTextContent('openai-codex');
    expect(screen.getByLabelText('Default reasoning effort')).toHaveValue('medium');
    expect(screen.getByRole('switch', { name: 'Fast mode by default' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/terminal and in channels/)).toBeInTheDocument();
  });

  it('groups the models under their providers', () => {
    render(<DefaultModel defaults={state()} />);

    const groups = [...screen.getByLabelText('Default model').querySelectorAll('optgroup')];
    expect(groups.map((group) => [group.label, [...group.querySelectorAll('option')].map((option) => option.textContent)])).toEqual([
      ['anthropic', ['claude-sonnet-5-5']],
      ['openai-codex', ['gpt-plain', 'gpt-6-luna']],
    ]);
  });

  it('hands a pick to the hook as a provider and its model, also when the model id has a slash in it', () => {
    const defaults = state({ providers: [{ name: 'openrouter', models: ['meta/llama-4'] }], provider: 'openrouter', model: 'meta/llama-4' });
    render(<DefaultModel defaults={defaults} />);

    expect(screen.getByLabelText('Default model')).toHaveValue('openrouter/meta/llama-4');
    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'openrouter/meta/llama-4' } });

    expect(defaults.setModel).toHaveBeenCalledWith('openrouter', 'meta/llama-4');
  });

  it('switches the effort and the fast tier', () => {
    const defaults = state();
    render(<DefaultModel defaults={defaults} />);

    fireEvent.change(screen.getByLabelText('Default reasoning effort'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Fast mode by default' }));

    expect(defaults.setEffort).toHaveBeenCalledWith('high');
    expect(defaults.setFast).toHaveBeenCalledWith(false);
  });

  it('leaves out what the model does not have', () => {
    render(<DefaultModel defaults={state({ canSetEffort: false, canSetFast: false })} />);

    expect(screen.queryByLabelText('Default reasoning effort')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('holds the controls while a save is on its way, and says why one failed', () => {
    render(<DefaultModel defaults={state({ busy: true, error: 'config is read-only' })} />);

    expect(screen.getByLabelText('Default model')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Fast mode by default' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('config is read-only');
  });

  it('says to connect a provider when there is none to pick from', () => {
    render(<DefaultModel defaults={state({ providers: [], provider: null, model: null, canSetEffort: false, canSetFast: false })} />);

    expect(screen.queryByLabelText('Default model')).toBeNull();
    expect(screen.getByText(/Connect a provider/)).toBeInTheDocument();
  });
});
