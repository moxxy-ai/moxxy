import { describe, expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { buildVoiceAdminPlugin } from './voice-admin-plugin.js';

/**
 * Focused unit test for the inline voice-admin tools — previously impossible to
 * exercise without booting the whole builtins assembly. Drives the tool
 * handlers directly against a bare Session's synthesizer registry.
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
});
