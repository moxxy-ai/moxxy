import { describe, expect, it } from 'vitest';
import { buildModelSelectorUiState } from '../mobile/src/modelSelector';

describe('mobile model selector ui model', () => {
  const providers = [
    {
      name: 'openai-codex',
      models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
    },
    {
      name: 'anthropic',
      models: [{ id: 'claude-sonnet-4' }],
    },
  ];

  it('builds the composer chip label from active provider and selected model', () => {
    expect(buildModelSelectorUiState({
      providers,
      activeProvider: 'openai-codex',
      activeModel: 'gpt-5',
    }).chipLabel).toBe('openai-codex/gpt-5');

    expect(buildModelSelectorUiState({
      providers,
      activeProvider: 'openai-codex',
      activeModel: null,
    }).chipLabel).toBe('openai-codex');

    expect(buildModelSelectorUiState({
      providers: [],
      activeProvider: null,
      activeModel: null,
    })).toMatchObject({
      chipLabel: 'pick',
      disabled: true,
    });
  });

  it('keeps provider browsing separate from the committed active provider', () => {
    const ui = buildModelSelectorUiState({
      providers,
      activeProvider: 'openai-codex',
      activeModel: 'gpt-5',
      selectedProvider: 'anthropic',
    });

    expect(ui.selectedProvider).toBe('anthropic');
    expect(ui.providerRows).toEqual([
      expect.objectContaining({ id: 'openai-codex', active: true, selected: false }),
      expect.objectContaining({ id: 'anthropic', active: false, selected: true }),
    ]);
    expect(ui.modelRows).toEqual([
      expect.objectContaining({ id: null, label: 'Default', active: false }),
      expect.objectContaining({ id: 'claude-sonnet-4', label: 'claude-sonnet-4', active: false }),
    ]);
  });

  it('marks the default model active when no sticky model is selected', () => {
    const ui = buildModelSelectorUiState({
      providers,
      activeProvider: 'openai-codex',
      activeModel: null,
    });

    expect(ui.modelRows[0]).toMatchObject({ id: null, label: 'Default', active: true });
    expect(ui.modelRows[1]).toMatchObject({ id: 'gpt-5', active: false });
  });
});
