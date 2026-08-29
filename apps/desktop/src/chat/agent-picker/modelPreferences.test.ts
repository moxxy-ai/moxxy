import { afterEach, describe, expect, it } from 'vitest';
import { getModelPreference, setModelPreference } from './modelPreferences';

afterEach(() => {
  localStorage.clear();
});

describe('model preferences', () => {
  it('keeps exact model ids independently per workspace and provider', () => {
    setModelPreference('workspace-a', 'local', 'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0');
    setModelPreference('workspace-a', 'openai-codex', 'gpt-5.6-luna');
    setModelPreference('workspace-b', 'local', 'glm-5:cloud');

    expect(getModelPreference('workspace-a', 'local')).toBe(
      'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0',
    );
    expect(getModelPreference('workspace-a', 'openai-codex')).toBe('gpt-5.6-luna');
    expect(getModelPreference('workspace-b', 'local')).toBe('glm-5:cloud');
  });

  it('clears only the selected provider and ignores malformed stored data', () => {
    setModelPreference('workspace-a', 'local', 'gpt-oss:20b');
    setModelPreference('workspace-a', 'openai-codex', 'gpt-5.6-luna');
    setModelPreference('workspace-a', 'local', null);

    expect(getModelPreference('workspace-a', 'local')).toBeNull();
    expect(getModelPreference('workspace-a', 'openai-codex')).toBe('gpt-5.6-luna');

    localStorage.setItem('moxxy.model-preferences.v1', '{broken');
    expect(getModelPreference('workspace-a', 'openai-codex')).toBeNull();
  });
});
