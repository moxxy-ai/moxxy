import { describe, expect, it } from 'vitest';
import { DESTINATIONS } from './destinations';
import { STATIC_PLACES, type PlaceTarget } from './places';
import { searchPlaces } from './search-places';

/** What a person types is the option they want, not the category it is filed under. */

const first = (query: string): PlaceTarget | undefined => searchPlaces(STATIC_PLACES, query)[0]?.target;

const VOICE: PlaceTarget = { destination: 'settings', section: 'voice' };
const PREFERENCES: PlaceTarget = { destination: 'settings', section: 'preferences' };

describe('searchPlaces', () => {
  it.each<[string, PlaceTarget]>([
    ['media', { destination: 'chat', pane: 'media' }],
    ['photos', { destination: 'chat', pane: 'media' }],
    ['shared links', { destination: 'chat', pane: 'media' }],
    ['background work', { destination: 'chat', pane: 'agents' }],
    ['helpers', { destination: 'chat', pane: 'agents' }],
    ['subagents', { destination: 'chat', pane: 'agents' }],
    ['provider', { destination: 'settings', section: 'providers' }],
    ['openai', { destination: 'settings', section: 'providers' }],
    ['default model', { destination: 'settings', section: 'providers' }],
    ['reasoning effort', { destination: 'settings', section: 'providers' }],
    ['fast mode', { destination: 'settings', section: 'providers' }],
    ['opencode', { destination: 'settings', section: 'providers' }],
    ['claude code', { destination: 'settings', section: 'providers' }],
    ['install codex', { destination: 'settings', section: 'providers' }],
    ['agent update', { destination: 'settings', section: 'providers' }],
    ['coding agents', { destination: 'settings', section: 'providers' }],
    ['model providers', { destination: 'settings', section: 'providers' }],
    ['api providers', { destination: 'settings', section: 'providers' }],
    ['chat', { destination: 'chat' }],
    ['conversation', { destination: 'chat' }],
    ['voice', VOICE],
    ['gpt live', VOICE],
    ['GPT-Live', VOICE],
    ['gemini flash', VOICE],
    ['voice', VOICE],
    ['transcription', VOICE],
    ['whisper', VOICE],
    ['parakeet', VOICE],
    ['dictation model', VOICE],
    ['supertonic', VOICE],
    ['offline voice', VOICE],
    ['speech to text', VOICE],
    ['local transcription', VOICE],
    ['openai transcription', VOICE],
    ['gpt-transcribe', VOICE],
    ['openai voice key', VOICE],
    ['classic voice', VOICE],
    ['theme', PREFERENCES],
    ['dark mode', PREFERENCES],
    ['notification', PREFERENCES],
    ['toast', PREFERENCES],
    ['update', PREFERENCES],
    ['vault', { destination: 'settings', section: 'vault' }],
    ['secrets', { destination: 'settings', section: 'vault' }],
    ['computer use', { destination: 'settings', section: 'jev' }],
    ['mcp', { destination: 'extensions', section: 'mcp' }],
    ['skills', { destination: 'extensions', section: 'skills' }],
    ['webhook', { destination: 'automations', section: 'webhooks' }],
    ['cron', { destination: 'automations', section: 'schedules' }],
    ['workflow', { destination: 'automations', section: 'workflows' }],
  ])('takes "%s" to where that option is', (query, target) => {
    expect(first(query)).toEqual(target);
  });

  it('has no place for pairing a phone, since the mobile app was removed', () => {
    for (const query of ['mobile', 'phone', 'pairing']) {
      const targets = searchPlaces(STATIC_PLACES, query).map((place) => place.target);
      expect(targets, query).not.toContainEqual({ destination: 'mobile' });
    }
  });

  it('lists only the places themselves until something is typed', () => {
    expect(searchPlaces(STATIC_PLACES, '  ').map((place) => place.target)).toEqual(
      DESTINATIONS.map((d) => ({ destination: d.id })),
    );
  });

  it('still offers a voice call beside the voice settings', () => {
    expect(searchPlaces(STATIC_PLACES, 'voice').map((place) => place.target)).toContainEqual({ destination: 'voice' });
  });

  it('finds the words in any order, whatever their case, accents or punctuation', () => {
    expect(first('flash gemini')).toEqual(VOICE);
    expect(first('  GEMINI   flash-lite ')).toEqual(VOICE);
    expect(first('gpt_live')).toEqual(VOICE);
  });

  it('puts the place named exactly before the ones that only mention the word', () => {
    const labels = searchPlaces(STATIC_PLACES, 'voice').map((place) => place.label);
    expect(labels[0]).toBe('Voice');
    expect(labels.indexOf('Voice engine')).toBeLessThan(labels.indexOf('Start a voice call'));
  });

  it('finds nothing for a word no place knows', () => {
    expect(searchPlaces(STATIC_PLACES, 'zzzz')).toEqual([]);
  });
});
