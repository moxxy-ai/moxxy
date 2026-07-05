import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLISH_VOICE_ID,
  DEFAULT_VOICE_ID,
  findVoice,
  requireVoice,
  routeVoice,
  VOICE_CATALOG,
  voiceIds,
} from './voices.js';

describe('VOICE_CATALOG', () => {
  it('pins the three Piper voices with their sherpa checksum.txt sha256s', () => {
    // These MUST match sherpa-onnx's tts-models/checksum.txt verbatim — the
    // integrity story depends on them not drifting.
    const byId = Object.fromEntries(VOICE_CATALOG.map((v) => [v.id, v]));
    expect(byId['en_US-amy-medium']?.sha256).toBe(
      '9a5d1fc497f85e8022b785bff5f8105203b1e33099ee6265203efc70b0cb0264',
    );
    expect(byId['pl_PL-gosia-medium']?.sha256).toBe(
      '75bd34dcbdc4dd98d763954756b4b34b4208100497c836381542e4d73dcefa9c',
    );
    expect(byId['pl_PL-darkman-medium']?.sha256).toBe(
      '444727aa46eb6db645a2bc88fe73868e4bd7596b7f56ca39fad5ef53c41210d4',
    );
  });

  it('derives archive/model paths and language consistently', () => {
    for (const v of VOICE_CATALOG) {
      expect(v.archiveRootDir).toBe(`vits-piper-${v.id}`);
      expect(v.modelFile).toBe(`${v.id}.onnx`);
      expect(v.url).toBe(
        `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-${v.id}.tar.bz2`,
      );
      expect(/^[0-9a-f]{64}$/.test(v.sha256)).toBe(true);
    }
    expect(VOICE_CATALOG.filter((v) => v.language === 'pl').map((v) => v.id)).toEqual([
      'pl_PL-gosia-medium',
      'pl_PL-darkman-medium',
    ]);
  });

  it('exposes the default voice ids from the catalog', () => {
    expect(findVoice(DEFAULT_VOICE_ID)?.language).toBe('en');
    expect(findVoice(DEFAULT_POLISH_VOICE_ID)?.language).toBe('pl');
    expect(voiceIds()).toContain('en_US-amy-medium');
  });
});

describe('routeVoice', () => {
  const cfg = { defaultVoice: DEFAULT_VOICE_ID, polishVoice: DEFAULT_POLISH_VOICE_ID };

  it('uses the default voice with no hints', () => {
    expect(routeVoice({ ...cfg }).id).toBe('en_US-amy-medium');
  });

  it('routes pl* language hints to the Polish voice', () => {
    expect(routeVoice({ ...cfg, language: 'pl' }).id).toBe('pl_PL-gosia-medium');
    expect(routeVoice({ ...cfg, language: 'pl-PL' }).id).toBe('pl_PL-gosia-medium');
    expect(routeVoice({ ...cfg, language: 'PL_pl' }).id).toBe('pl_PL-gosia-medium');
  });

  it('routes a non-pl language to the default voice', () => {
    expect(routeVoice({ ...cfg, language: 'en-US' }).id).toBe('en_US-amy-medium');
    expect(routeVoice({ ...cfg, language: 'de' }).id).toBe('en_US-amy-medium');
  });

  it('lets an explicit requestedVoice override everything', () => {
    expect(routeVoice({ ...cfg, requestedVoice: 'pl_PL-darkman-medium', language: 'en' }).id).toBe(
      'pl_PL-darkman-medium',
    );
    expect(routeVoice({ ...cfg, requestedVoice: 'en_US-amy-medium', language: 'pl' }).id).toBe(
      'en_US-amy-medium',
    );
  });

  it('honors a configured Polish voice override', () => {
    expect(routeVoice({ defaultVoice: DEFAULT_VOICE_ID, polishVoice: 'pl_PL-darkman-medium', language: 'pl' }).id).toBe(
      'pl_PL-darkman-medium',
    );
  });

  it('throws a clear CONFIG_INVALID for an unknown requested voice, listing valid ids', () => {
    try {
      routeVoice({ ...cfg, requestedVoice: 'xx_ZZ-nobody' });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CONFIG_INVALID');
      expect((err as Error).message).toContain('xx_ZZ-nobody');
      expect((err as { hint?: string }).hint).toContain('en_US-amy-medium');
    }
  });

  it('throws when a configured polishVoice id is unknown', () => {
    expect(() => routeVoice({ defaultVoice: DEFAULT_VOICE_ID, polishVoice: 'bogus', language: 'pl' })).toThrow();
  });
});

describe('requireVoice', () => {
  it('returns the entry for a valid id', () => {
    expect(requireVoice('en_US-amy-medium', 'voice').id).toBe('en_US-amy-medium');
  });
  it('throws CONFIG_INVALID naming the field for an unknown id', () => {
    expect(() => requireVoice('nope', 'polishVoice')).toThrow(/Unknown local voice/);
  });
});
