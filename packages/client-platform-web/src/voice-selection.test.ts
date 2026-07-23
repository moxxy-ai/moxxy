import { describe, expect, it } from 'vitest';
import { selectBestVoice } from './tts.js';

const VOICES = [
  { name: 'Samantha', lang: 'en-US', localService: true },
  { name: 'Zosia', lang: 'pl-PL', localService: true },
  { name: 'Cloud Polish', lang: 'pl-PL', localService: false },
];

describe('selectBestVoice', () => {
  it('selects a local voice matching the requested Polish language', () => {
    expect(selectBestVoice(VOICES, 'pl')?.name).toBe('Zosia');
  });

  it('retains the preferred natural voice ordering for English', () => {
    expect(selectBestVoice(VOICES, 'en')?.name).toBe('Samantha');
  });
});
