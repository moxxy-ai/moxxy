import { type Session } from '@moxxy/core';
import { definePlugin, defineTool, z, type Plugin } from '@moxxy/sdk';

/**
 * Voice/TTS control plugin — lets the agent switch which text-to-speech backend
 * read-aloud surfaces (the desktop's speaker button) use, without a settings UI.
 * `set_voice` activates a registered synthesizer by name, or 'system' to
 * deactivate (fall back to the OS voice). `list_voices` reports what's available
 * + which is active. A synthesizer authored via self-update auto-activates on
 * load, so this is for switching afterwards.
 *
 * The synthesizer registry lives on the live Session, so this is built via a
 * factory closing over it (mirroring `buildViewPlugin` / `buildSubagentsPlugin`)
 * and wired into the cli's builtin `entries` list.
 */
export function buildVoiceAdminPlugin(session: Session): Plugin {
  // 'system' (the OS voice) plus every registered synthesizer — the one
  // list both tools speak in terms of (list_voices' result and
  // set_voice's "unknown name" hint). The synthesizer namespace is
  // attacker-influenced (any plugin / a self-update-authored backend can
  // register a name), so de-dupe in case one is literally named 'system' —
  // otherwise it would be listed twice.
  const voiceNames = (): string[] => [
    'system',
    ...session.synthesizers
      .list()
      .map((s) => s.name)
      .filter((n) => n !== 'system'),
  ];
  return definePlugin({
    name: '@moxxy/voice-admin',
    version: '0.0.1',
    tools: [
      defineTool({
        name: 'list_voices',
        description:
          'List the text-to-speech (synthesizer) backends registered on this ' +
          'session and which one is active. "system" means the OS voice (no ' +
          'plugin synthesizer active).',
        inputSchema: z.object({}),
        permission: { action: 'allow' },
        handler: () => ({
          active: session.synthesizers.getActiveName() ?? 'system',
          available: voiceNames(),
        }),
      }),
      defineTool({
        name: 'set_voice',
        description:
          'Choose which text-to-speech backend read-aloud uses. Pass a ' +
          'registered synthesizer name (see list_voices) to activate it, or ' +
          '"system" to fall back to the OS voice. Use this to switch between ' +
          'an installed TTS plugin (e.g. ElevenLabs) and the built-in voice.',
        inputSchema: z.object({
          synthesizer: z
            .string()
            .min(1)
            .describe('Synthesizer name to activate, or "system" for the OS voice.'),
        }),
        // Auto-allowed because switching the active TTS backend has a low blast
        // radius: it only flips the registry's active slot. The synthesizer is
        // not built here (the registry is buildOnRead), so no secret read or
        // network call happens at set_voice time — the first read-aloud builds
        // it under the same vault/network gates a registered plugin already has.
        permission: { action: 'allow' },
        handler: ({ synthesizer }) => {
          // Treat 'system' as the OS-voice sentinel only when no real
          // synthesizer claims that name. A backend literally named 'system'
          // (registrations are attacker-influenced) is otherwise permanently
          // unreachable; fall through to activate it.
          if (synthesizer === 'system' && !session.synthesizers.has('system')) {
            session.synthesizers.clearActive();
            return { active: 'system' };
          }
          if (!session.synthesizers.has(synthesizer)) {
            throw new Error(
              `No synthesizer named "${synthesizer}". Available: ${voiceNames().join(', ')}.`,
            );
          }
          session.synthesizers.setActive(synthesizer);
          return { active: synthesizer };
        },
      }),
    ],
  });
}
