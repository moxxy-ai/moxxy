import { describe, expect, it } from 'vitest';
import { buildContextMeterUiState } from '../contextMeterUi';

describe('mobile context meter ui model', () => {
  it('mirrors the desktop context percentage calculation', () => {
    expect(buildContextMeterUiState({
      latestPrompt: 1024,
      contextWindow: 20_480,
    })).toMatchObject({
      visible: true,
      label: '5%',
      fraction: 0.05,
      fillPercent: 5,
      tone: 'primary',
    });
  });

  it('uses desktop warning thresholds for the context fill color', () => {
    expect(buildContextMeterUiState({ latestPrompt: 7_000, contextWindow: 10_000 })).toMatchObject({
      label: '70%',
      tone: 'amber',
    });
    expect(buildContextMeterUiState({ latestPrompt: 9_000, contextWindow: 10_000 })).toMatchObject({
      label: '90%',
      tone: 'red',
    });
  });

  it('hides the percent meter until the model context window is known', () => {
    expect(buildContextMeterUiState({ latestPrompt: 1024, contextWindow: null })).toEqual({
      visible: false,
      label: 'Context',
      fraction: null,
      fillPercent: 0,
      tone: 'neutral',
    });
  });
});
