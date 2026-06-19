import { describe, expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { buildVoiceAdminPlugin } from './index.js';

/**
 * Focused unit test for the voice-admin tools. Drives the tool handlers
 * directly against a bare Session's synthesizer registry.
 */
function tools(session: Session) {
  const plugin = buildVoiceAdminPlugin(session);
  const byName = new Map((plugin.tools ?? []).map((t) => [t.name, t]));
  return {
    listVoices: byName.get('list_voices')!,
    setVoice: byName.get('set_voice')!,
  };
}

const ctx = { sessionId: 's', turnId: 't' } as never;

/** Minimal registrable synthesizer def (create() is never invoked here — the
 *  registry is buildOnRead, so set_voice only flips the active slot). */
function fakeSynth(name: string) {
  return {
    name,
    create: () => ({
      name,
      synthesize: async () => ({ audio: new Uint8Array(), mimeType: 'audio/mpeg' }),
    }),
  };
}

describe('voice-admin plugin', () => {
  it('registers list_voices and set_voice', () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const plugin = buildVoiceAdminPlugin(session);
    expect(plugin.name).toBe('@moxxy/voice-admin');
    expect((plugin.tools ?? []).map((t) => t.name).sort()).toEqual(['list_voices', 'set_voice']);
  });

  it('list_voices reports "system" active by default and lists registered synthesizers', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const { listVoices } = tools(session);
    const result = (await listVoices.handler({}, ctx)) as { active: string; available: string[] };
    expect(result.active).toBe('system');
    expect(result.available).toContain('system');
  });

  it('set_voice "system" clears the active synthesizer', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const { setVoice } = tools(session);
    const result = (await setVoice.handler({ synthesizer: 'system' }, ctx)) as { active: string };
    expect(result.active).toBe('system');
    expect(session.synthesizers.getActiveName() ?? 'system').toBe('system');
  });

  it('set_voice throws on an unknown synthesizer name', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const { setVoice } = tools(session);
    // The handler is synchronous, so it throws synchronously.
    expect(() => setVoice.handler({ synthesizer: 'nope' }, ctx)).toThrow(/No synthesizer named "nope"/);
  });

  it('set_voice activates a registered synthesizer and list_voices reflects it', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    session.synthesizers.register(fakeSynth('elevenlabs'));
    const { setVoice, listVoices } = tools(session);

    const result = (await setVoice.handler({ synthesizer: 'elevenlabs' }, ctx)) as { active: string };
    expect(result.active).toBe('elevenlabs');
    expect(session.synthesizers.getActiveName()).toBe('elevenlabs');

    const listed = (await listVoices.handler({}, ctx)) as { active: string; available: string[] };
    expect(listed.active).toBe('elevenlabs');
    expect(listed.available).toContain('elevenlabs');
  });

  it('a synthesizer literally named "system" is reachable and not double-listed', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    session.synthesizers.register(fakeSynth('system'));
    const { setVoice, listVoices } = tools(session);

    // "system" no longer always clears — it activates the real backend.
    const result = (await setVoice.handler({ synthesizer: 'system' }, ctx)) as { active: string };
    expect(result.active).toBe('system');
    expect(session.synthesizers.getActiveName()).toBe('system');

    // ...and it appears exactly once in the listing (sentinel de-duped).
    const listed = (await listVoices.handler({}, ctx)) as { active: string; available: string[] };
    expect(listed.available.filter((n) => n === 'system')).toHaveLength(1);
  });
});
