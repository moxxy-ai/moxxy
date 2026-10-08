import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS } from '../../settings/sections';
import { DESTINATIONS } from './destinations';
import { STATIC_PLACES, appPlace, channelPlace } from './places';

/** The palette can only take a person where a place says to go. */

const targets = STATIC_PLACES.map((place) => place.target);

describe('places', () => {
  it('has one for every destination, and those are what the palette opens on', () => {
    const top = STATIC_PLACES.filter((place) => place.top);
    expect(top.map((place) => place.target)).toEqual(DESTINATIONS.map((d) => ({ destination: d.id })));
  });

  it('has one for every settings section, in the view that lists it', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(targets, section.id).toContainEqual({ destination: section.view, section: section.id });
    }
  });

  it('has one for everything named inside a section, saying where it is', () => {
    for (const section of SETTINGS_SECTIONS) {
      for (const find of section.finds) {
        const place = STATIC_PLACES.find((candidate) => candidate.label === find.label);
        expect(place?.target, find.label).toEqual({ destination: section.view, section: section.id });
        expect(place?.trail, find.label).toContain(section.label);
      }
    }
  });

  it('has one for every kind of automation', () => {
    for (const section of ['workflows', 'schedules', 'webhooks']) {
      expect(targets).toContainEqual({ destination: 'automations', section });
    }
  });

  it('gives each a different id', () => {
    expect(new Set(STATIC_PLACES.map((place) => place.id)).size).toBe(STATIC_PLACES.length);
  });

  it('makes a place of a channel and of an app', () => {
    expect(channelPlace({ id: 'telegram', name: 'Telegram' })).toMatchObject({
      label: 'Telegram',
      trail: 'Channels',
      target: { destination: 'channels', section: 'telegram' },
    });
    expect(appPlace({ id: 'anonymizer', name: 'Document anonymizer', description: 'Redact personal data.' })).toMatchObject({
      label: 'Document anonymizer',
      trail: 'Apps',
      target: { destination: 'apps' },
    });
  });
});
