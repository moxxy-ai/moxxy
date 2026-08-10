import { describe, expect, it } from 'vitest';
import { summarizeModalTabs } from './Modal.js';

describe('summarizeModalTabs', () => {
  const tabs = [
    { id: 'anthropic', label: 'anthropic (5)' },
    { id: 'openai', label: 'openai (18)' },
    { id: 'openai-codex', label: 'openai-codex (offline)' },
  ];

  it('shows one active provider and its position instead of an overflowing strip', () => {
    expect(summarizeModalTabs(tabs, 'openai', 20)).toEqual({
      label: 'openai (18)',
      index: 2,
      total: 3,
    });
  });

  it('truncates a long provider label to the available header width', () => {
    const summary = summarizeModalTabs(tabs, 'openai-codex', 12);
    expect(summary?.label.length).toBeLessThanOrEqual(12);
    expect(summary?.label).toContain('…');
  });
});
