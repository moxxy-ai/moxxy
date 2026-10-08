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
    ['provider', { destination: 'settings', section: 'providers' }],
    ['openai', { destination: 'settings', section: 'providers' }],
    ['chat', { destination: 'chat' }],
    ['conversation', { destination: 'chat' }],
    ['voice', VOICE],
    ['gpt live', VOICE],
    ['GPT-Live', VOICE],
    ['gemini flash', VOICE],
    ['piper', VOICE],
    ['theme', PREFERENCES],
    ['dark mode', PREFERENCES],
    ['notification', PREFERENCES],
    ['update', PREFERENCES],
    ['vault', { destination: 'settings', section: 'vault' }],
    ['secrets', { destination: 'settings', section: 'vault' }],
    ['computer use', { destination: 'settings', section: 'jev' }],
    ['mcp', { destination: 'extensions', section: 'mcp' }],
    ['skills', { destination: 'extensions', section: 'skills' }],
    ['webhook', { destination: 'automations', section: 'webhooks' }],
    ['cron', { destination: 'automations', section: 'schedules' }],
    ['workflow', { destination: 'automations', section: 'workflows' }],
    ['phone', { destination: 'mobile' }],
  ])('takes "%s" to where that option is', (query, target) => {
    expect(first(query)).toEqual(target);
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
