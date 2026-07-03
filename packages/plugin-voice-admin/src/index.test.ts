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
    expect(plugin.name).toBe('@moxxy/plugin-voice-admin');
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

  // --- failure-path / hostile-input regressions ---------------------------

  it('the input schema (the production gate) rejects empty / missing synthesizer', () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    const { setVoice } = tools(session);
    // The framework parses tool input against `inputSchema` BEFORE the handler
    // runs (see defineTool). An empty string or a missing field must be rejected
    // at that gate, never reaching the handler.
    expect(setVoice.inputSchema.safeParse({ synthesizer: '' }).success).toBe(false);
    expect(setVoice.inputSchema.safeParse({}).success).toBe(false);
    expect(setVoice.inputSchema.safeParse({ synthesizer: 42 }).success).toBe(false);
    expect(setVoice.inputSchema.safeParse({ synthesizer: 'elevenlabs' }).success).toBe(true);
  });

  it('set_voice degrades (does not crash) on whitespace-only and space-padded names', () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    session.synthesizers.register(fakeSynth('elevenlabs'));
    const { setVoice } = tools(session);
    // A single space passes the schema's min(1) but is not a real synthesizer
    // and must NOT be coerced into the 'system' sentinel — it throws cleanly.
    expect(() => setVoice.handler({ synthesizer: ' ' }, ctx)).toThrow(/No synthesizer named " "/);
    // A padded form of a real name does not match (no trimming/normalization):
    // hostile/typo'd input is rejected, the active backend is untouched.
    expect(() => setVoice.handler({ synthesizer: ' elevenlabs ' }, ctx)).toThrow(
      /No synthesizer named/,
    );
    // The pre-existing active backend (auto-adopted on register) survives the
    // rejected switches — hostile input never silently flips or clears it.
    expect(session.synthesizers.getActiveName()).toBe('elevenlabs');
  });

  it('the unknown-name error hint lists available voices without crashing', () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    session.synthesizers.register(fakeSynth('elevenlabs'));
    const { setVoice } = tools(session);
    // The error message is the model's recovery hint — it must enumerate the
    // real options (including the 'system' sentinel) and not throw building it.
    expect(() => setVoice.handler({ synthesizer: 'nope' }, ctx)).toThrow(
      /Available: system, elevenlabs\./,
    );
  });

  it('after activating "system" (the real backend), switching to another name then back to the sentinel still works', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    session.synthesizers.register(fakeSynth('system'));
    session.synthesizers.register(fakeSynth('elevenlabs'));
    const { setVoice } = tools(session);

    // Activate the real 'system' backend (collision branch).
    await setVoice.handler({ synthesizer: 'system' }, ctx);
    expect(session.synthesizers.getActiveName()).toBe('system');
    // Switch away to another registered backend.
    await setVoice.handler({ synthesizer: 'elevenlabs' }, ctx);
    expect(session.synthesizers.getActiveName()).toBe('elevenlabs');
    // Switch back to the 'system'-named backend — still resolves the real def,
    // never the clear-active sentinel, because `has('system')` is true.
    await setVoice.handler({ synthesizer: 'system' }, ctx);
    expect(session.synthesizers.getActiveName()).toBe('system');
  });

  it('list_voices puts the "system" sentinel first and is deterministic', async () => {
    const session = new Session({ cwd: process.cwd(), logger: silentLogger });
    session.synthesizers.register(fakeSynth('zeta'));
    session.synthesizers.register(fakeSynth('alpha'));
    const { listVoices } = tools(session);
    const listed = (await listVoices.handler({}, ctx)) as { active: string; available: string[] };
    // Stable, registration-order output with the sentinel always leading — the
    // agent gets a predictable list to reason over.
    expect(listed.available).toEqual(['system', 'zeta', 'alpha']);
  });
});
