import { describe, it, expect } from 'vitest';
import { validateIpcInput, ipcInputSchemas } from './validation.js';
import type { IpcCommandName } from './index.js';

describe('IPC payload validation', () => {
  it('has no collaboration commands, since collaborative mode was removed', () => {
    expect(Object.keys(ipcInputSchemas).filter((name) => name.startsWith('collab.'))).toEqual([]);
  });
  it('has no mobile gateway commands, since the mobile app was removed', () => {
    expect(Object.keys(ipcInputSchemas).filter((name) => name.startsWith('mobileGateway.'))).toEqual([]);
  });
  it('requires exact workspace, session and turn for Computer Use human commands', () => {
    const command = 'computer.control' as IpcCommandName;
    const args = {workspaceId:'workspace',sessionId:'session',turnId:'turn',command:'stop'};
    expect(() => validateIpcInput(command, args)).not.toThrow();
    expect(() => validateIpcInput(command, {...args, workspaceId:undefined})).toThrow();
    expect(() => validateIpcInput(command, {...args, turnId:undefined})).toThrow();
    expect(() => validateIpcInput(command, {...args, command:'restart'})).toThrow();
    expect(() => validateIpcInput(command, {...args, executable:'other'})).toThrow();
  });
  it('accepts no payload for the fixed Local Piper installer commands', () => {
    expect(() => validateIpcInput(
      'voice.isLocalPiperInstalled' as IpcCommandName,
      undefined,
    )).not.toThrow();
    expect(() => validateIpcInput(
      'voice.installLocalPiper' as IpcCommandName,
      undefined,
    )).not.toThrow();
    expect(() => validateIpcInput(
      'voice.installLocalPiper' as IpcCommandName,
      { packageName: 'attacker-controlled-package' },
    )).toThrow();
  });

  it('accepts no payload for the fixed transcription switch commands', () => {
    for (const command of [
      'voice.getTranscription',
      'voice.useLocalTranscription',
      'voice.cancelLocalTranscription',
      'voice.useCloudTranscription',
    ] as IpcCommandName[]) {
      expect(() => validateIpcInput(command, undefined)).not.toThrow();
      expect(() => validateIpcInput(command, { packageName: 'attacker-controlled-package' })).toThrow();
    }
  });

  it('requires a strict boolean for the local realtime voice-capture lease', () => {
    expect(() => validateIpcInput(
      'voice.setRealtimeCaptureActive' as IpcCommandName,
      { active: true },
    )).not.toThrow();
    expect(() => validateIpcInput(
      'voice.setRealtimeCaptureActive' as IpcCommandName,
      { active: 'yes' },
    )).toThrow();
    expect(() => validateIpcInput(
      'voice.setRealtimeCaptureActive' as IpcCommandName,
      { active: true, workspaceId: 'smuggled' },
    )).toThrow();
  });

  it('pins the GPT-Live voice commands to host-owned, bounded payloads', () => {
    const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
    expect(() => validateIpcInput('voice.live.preflight', undefined)).not.toThrow();
    expect(() => validateIpcInput('voice.live.preflight', { force: true })).toThrow();
    expect(() => validateIpcInput('voice.live.start', { workspaceId: 'w1', sdp: offer })).not.toThrow();
    expect(() => validateIpcInput('voice.live.start', { workspaceId: 'w1', sdp: 'nope' })).toThrow();
    expect(() => validateIpcInput('voice.live.start', { workspaceId: 'w1', sdp: offer, instructions: 'x' })).toThrow();
    expect(() => validateIpcInput('voice.live.start', { sdp: offer })).toThrow();
  });

  it('bounds a recorded voice exchange and requires its workspace', () => {
    const command = 'session.recordVoiceExchange';
    expect(() => validateIpcInput(command, { workspaceId: 'w1', userText: 'hi', assistantText: 'hello' })).not.toThrow();
    expect(() => validateIpcInput(command, { workspaceId: 'w1', assistantText: 'hello' })).not.toThrow();
    expect(() => validateIpcInput(command, { userText: 'hi' })).toThrow();
    expect(() => validateIpcInput(command, { workspaceId: 'w1', userText: 'x'.repeat(100_001) })).toThrow();
    expect(() => validateIpcInput(command, { workspaceId: 'w1', userText: 'hi', turnId: 'smuggled' })).toThrow();
  });

  it('accepts only the known voice engines in prefs', () => {
    expect(() => validateIpcInput('prefs.update', { voiceEngine: 'gpt-live' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { voiceEngine: 'local' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { voiceEngine: 'cloud' })).toThrow();
  });

  it('bounds chat.readAttachment to one workspace and whole, non-negative indexes', () => {
    const command = 'chat.readAttachment' as IpcCommandName;
    const args = { workspaceId: 'w1', seq: 4, index: 0, offset: 0 };
    expect(() => validateIpcInput(command, args)).not.toThrow();
    expect(() => validateIpcInput(command, { ...args, workspaceId: '' })).toThrow();
    expect(() => validateIpcInput(command, { ...args, seq: -1 })).toThrow();
    expect(() => validateIpcInput(command, { ...args, offset: 1.5 })).toThrow();
    expect(() => validateIpcInput(command, { ...args, path: '/etc/passwd' })).toThrow();
  });

  it('asks for a chat media library by workspace only', () => {
    expect(() => validateIpcInput('chat.media', { workspaceId: 'w1' })).not.toThrow();
    expect(() => validateIpcInput('chat.media', { workspaceId: '' })).toThrow();
    expect(() => validateIpcInput('chat.media', { workspaceId: 'w1', dir: '/tmp' })).toThrow();
  });

  it('names a library item by its id, never by a path', () => {
    for (const command of ['chat.mediaThumbnail', 'chat.openMediaFile'] as const) {
      expect(() => validateIpcInput(command, { workspaceId: 'w1', id: 'a:4:0' })).not.toThrow();
      expect(() => validateIpcInput(command, { workspaceId: 'w1', id: '' })).toThrow();
      expect(() => validateIpcInput(command, { workspaceId: 'w1', id: 'x'.repeat(201) })).toThrow();
      expect(() => validateIpcInput(command, { workspaceId: 'w1', id: 'a:4:0', path: '/etc/passwd' })).toThrow();
    }
    const read = { workspaceId: 'w1', id: 't:9:1', offset: 0 };
    expect(() => validateIpcInput('chat.readMediaImage', read)).not.toThrow();
    expect(() => validateIpcInput('chat.readMediaImage', { ...read, offset: -4 })).toThrow();
    expect(() => validateIpcInput('chat.readMediaImage', { ...read, offset: 0.5 })).toThrow();
  });

  it('rejects non-http(s) openExternal URLs', () => {
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'https://ok.com' })).not.toThrow();
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'file:///etc/passwd' })).toThrow();
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'javascript:alert(1)' })).toThrow();
  });

  it('confines provider names to a slug', () => {
    expect(() => validateIpcInput('provider.login.start', { loginId: 'abc', provider: 'codex-agent' })).not.toThrow();
    expect(() => validateIpcInput('provider.login.start', { loginId: 'abc', provider: '--flag' })).toThrow();
    expect(() => validateIpcInput('onboarding.saveProviderKey', { provider: '../x', secret: 'k' })).toThrow();
  });

  it("runs only an agent CLI's install or update, by connection name", () => {
    expect(() => validateIpcInput('agents.run', { provider: 'codex-agent', action: 'install' })).not.toThrow();
    expect(() => validateIpcInput('agents.run', { provider: 'claude-code', action: 'update' })).not.toThrow();
    expect(() => validateIpcInput('agents.run', { provider: 'codex-agent', action: 'uninstall' })).toThrow();
    expect(() => validateIpcInput('agents.run', { provider: '; rm -rf /', action: 'install' })).toThrow();
    expect(() => validateIpcInput('agents.check', undefined)).not.toThrow();
    expect(() => validateIpcInput('agents.check', { workspaceId: '' })).toThrow();
  });

  it('remembers a dismissed agent update by connection and version only', () => {
    expect(() => validateIpcInput('prefs.update', { dismissedAgentUpdates: { 'codex-agent': '0.162.1' } })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { dismissedAgentUpdates: { '../x': '0.162.1' } })).toThrow();
    expect(() => validateIpcInput('prefs.update', { dismissedAgentUpdates: { opencode: 'v'.repeat(65) } })).toThrow();
  });

  it('guards interactive-login ids + bounds the pasted answer', () => {
    expect(() =>
      validateIpcInput('provider.login.start', { loginId: 'A1-b2', provider: 'claude-code' }),
    ).not.toThrow();
    // loginId must be a plain token — no path/shell text.
    expect(() => validateIpcInput('provider.login.cancel', { loginId: '../x' })).toThrow();
    expect(() => validateIpcInput('provider.login.cancel', { loginId: '' })).toThrow();
    // Empty answer is valid (the "take the browser branch" choice).
    expect(() => validateIpcInput('provider.login.answer', { loginId: 'x', value: '' })).not.toThrow();
    expect(() =>
      validateIpcInput('provider.login.answer', { loginId: 'x', value: 'y'.repeat(8193) }),
    ).toThrow();
  });

  it('blocks skill-name path traversal', () => {
    expect(() => validateIpcInput('settings.writeSkill', { name: 'my-skill', body: 'x' })).not.toThrow();
    expect(() => validateIpcInput('settings.deleteSkill', { name: '../../etc/passwd' })).toThrow();
    expect(() => validateIpcInput('settings.readSkill', { name: '/abs/path' })).toThrow();
  });

  it('rejects oversize transcribe payloads', () => {
    expect(() => validateIpcInput('session.transcribe', { audioBase64: 'AAAA' })).not.toThrow();
    expect(() =>
      validateIpcInput('session.transcribe', { audioBase64: 'A'.repeat(40_000_001) }),
    ).toThrow();
  });

  it('bounds synthesize text, language hints, and speaking rate', () => {
    expect(() =>
      validateIpcInput('session.synthesize', {
        workspaceId: 'workspace-1',
        text: 'Dzień dobry',
        language: 'pl-PL',
        rate: 1.06,
      }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'Hello', language: 'en' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'x'.repeat(100_001), language: 'pl' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'Hello', language: '../en' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'Hello', rate: 0.49 }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'Hello', rate: 2.01 }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'Hello', rate: Number.NaN }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.synthesize', { text: 'Hello', language: 'en', sneaky: true }),
    ).toThrow();
  });

  it('lets read-aloud ask to keep its speech, and asks only a workspace for the plan', () => {
    expect(() => validateIpcInput('session.synthesize', { text: 'Hello.', cache: true })).not.toThrow();
    expect(() => validateIpcInput('session.synthesize', { text: 'Hello.', cache: 'yes' })).toThrow();
    expect(() => validateIpcInput('session.readAloudPlan', undefined)).not.toThrow();
    expect(() => validateIpcInput('session.readAloudPlan', { workspaceId: 'workspace-1' })).not.toThrow();
    expect(() => validateIpcInput('session.readAloudPlan', { workspaceId: 'workspace-1', extra: 1 })).toThrow();
  });

  it('validates speech cancellation IDs and selected Gemini voice IDs', () => {
    expect(() => validateIpcInput('session.cancelSynthesis', {
      workspaceId: 'workspace-1',
      requestId: 'request-123',
    })).not.toThrow();
    expect(() => validateIpcInput('session.cancelSynthesis', {
      requestId: '../cancel-all',
    })).toThrow();
    expect(() => validateIpcInput('voice.useGeminiTts', { voiceId: 'voice_abc123' })).not.toThrow();
    expect(() => validateIpcInput('voice.useGeminiTts', { voiceId: '../bad' })).toThrow();
    expect(() => validateIpcInput('session.synthesize', {
      text: 'Hello.',
      requestId: 'request-123',
      voice: 'Fola',
    })).not.toThrow();
  });

  it('whitelists prefs.update fields (rejects unknown keys)', () => {
    expect(() => validateIpcInput('prefs.update', { onboardingComplete: true })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { version: 99 })).toThrow();
    expect(() => validateIpcInput('prefs.update', { evil: 'x' })).toThrow();
  });

  it('pins settings.setReasoning effort to the known enum', () => {
    for (const effort of ['off', 'low', 'medium', 'high', 'xhigh'] as const) {
      expect(() => validateIpcInput('settings.setReasoning', { effort })).not.toThrow();
    }
    expect(() =>
      validateIpcInput('settings.setReasoning', { workspaceId: 'ws', effort: 'high' }),
    ).not.toThrow();
    // Arbitrary strings can't reach the runner / provider request.
    expect(() => validateIpcInput('settings.setReasoning', { effort: 'maximum' })).toThrow();
    expect(() => validateIpcInput('settings.setReasoning', {})).toThrow();
    expect(() =>
      validateIpcInput('settings.setReasoning', { workspaceId: '', effort: 'low' }),
    ).toThrow();
  });

  it('takes a known change, whole or in part, for settings.setModelDefaults', () => {
    const model = { provider: 'codex-agent', model: 'gpt-6-luna' };
    expect(() => validateIpcInput('settings.setModelDefaults', { model, effort: 'medium', fast: true })).not.toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { model })).not.toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { effort: 'off' })).not.toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { fast: false })).not.toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { effort: 'default' })).toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { model: { ...model, model: '' } })).toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { model: { ...model, provider: '../x' } })).toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { model: { provider: 'codex-agent' } })).toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', { path: 'permissions' })).toThrow();
    expect(() => validateIpcInput('settings.setModelDefaults', {})).toThrow();
  });

  it('takes only a yes or no for settings.setFast', () => {
    expect(() => validateIpcInput('settings.setFast', { enabled: true })).not.toThrow();
    expect(() => validateIpcInput('settings.setFast', { workspaceId: 'ws', enabled: false })).not.toThrow();
    expect(() => validateIpcInput('settings.setFast', { enabled: 'yes' })).toThrow();
    expect(() => validateIpcInput('settings.setFast', {})).toThrow();
  });

  it('bounds session.runTurn prompt + attachments', () => {
    expect(() => validateIpcInput('session.runTurn', { prompt: 'hi' })).not.toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', { prompt: 'hidden', visibility: 'background' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', { prompt: 'bad', visibility: 'internal' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', {
        prompt: '',
        attachments: [{ path: '/abs/file.txt', name: 'file.txt' }],
      }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', { prompt: 'x'.repeat(1_000_001) }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', {
        prompt: 'x',
        attachments: Array.from({ length: 65 }, () => ({ path: '/a', name: 'a' })),
      }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', { prompt: 'x', attachments: [{ name: 'a' }] }),
    ).toThrow();
  });

  it('bounds a dropped file handed over as bytes', () => {
    const cmd = 'session.saveAttachment';
    expect(() => validateIpcInput(cmd, { dataBase64: 'aGk=', name: 'notes.md' })).not.toThrow();

    expect(() => validateIpcInput(cmd, { dataBase64: '', name: 'notes.md' })).toThrow();
    expect(() => validateIpcInput(cmd, { dataBase64: 'aGk=', name: '' })).toThrow();
    expect(() => validateIpcInput(cmd, { dataBase64: 'aGk=', name: 'n'.repeat(1025) })).toThrow();
    expect(() => validateIpcInput(cmd, { dataBase64: 'aGk=', name: 'notes.md', path: '/etc/passwd' })).toThrow();
    // Base64 of the largest file allowed, and not a character more than its encoding needs.
    expect(() => validateIpcInput(cmd, { dataBase64: 'a'.repeat(44_739_245), name: 'big.bin' })).toThrow();
  });

  it('bounds the question of whether a path can be attached', () => {
    const cmd = 'session.checkAttachment';
    expect(() => validateIpcInput(cmd, { path: '/tmp/a.png', name: 'a.png' })).not.toThrow();
    expect(() => validateIpcInput(cmd, { workspaceId: 'w1', path: '/tmp/a.png', name: 'a.png' })).not.toThrow();

    expect(() => validateIpcInput(cmd, { path: '', name: 'a.png' })).toThrow();
    expect(() => validateIpcInput(cmd, { path: '/tmp/a.png' })).toThrow();
    expect(() => validateIpcInput(cmd, { path: '/tmp/a.png', name: 'a.png', force: true })).toThrow();
  });

  it('bounds local session.previewAttachment payloads', () => {
    const cmd = 'session.previewAttachment';
    expect(() =>
      validateIpcInput(cmd, {
        workspaceId: 'workspace-1',
        path: '/tmp/moxxy-screen.png',
        name: 'moxxy-screen.png',
      }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput(cmd, {
        path: '/tmp/moxxy-screen.png',
        name: 'moxxy-screen.png',
      }),
    ).not.toThrow();

    expect(() =>
      validateIpcInput(cmd, { workspaceId: '', path: '/tmp/moxxy-screen.png', name: 'x.png' }),
    ).toThrow();
    expect(() => validateIpcInput(cmd, { path: '', name: 'x.png' })).toThrow();
    expect(() =>
      validateIpcInput(cmd, { path: 'x'.repeat(4097), name: 'x.png' }),
    ).toThrow();
    expect(() => validateIpcInput(cmd, { path: '/tmp/x.png', name: '' })).toThrow();
    expect(() =>
      validateIpcInput(cmd, { path: '/tmp/x.png', name: 'x'.repeat(1025) }),
    ).toThrow();
    expect(() =>
      validateIpcInput(cmd, { path: '/tmp/x.png', name: 'x.png', sneaky: true }),
    ).toThrow();
  });

  it('bounds desks.rename name', () => {
    expect(() => validateIpcInput('desks.rename', { id: 'd1', name: 'New name' })).not.toThrow();
    expect(() => validateIpcInput('desks.rename', { id: 'd1', name: '' })).toThrow();
    expect(() =>
      validateIpcInput('desks.rename', { id: 'd1', name: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('bounds sessions.create / rename names like desks.create / rename', () => {
    expect(() => validateIpcInput('sessions.create', undefined)).not.toThrow();
    expect(() => validateIpcInput('sessions.create', {})).not.toThrow();
    expect(() =>
      validateIpcInput('sessions.create', { deskId: 'd1', name: 'Research' }),
    ).not.toThrow();
    expect(() => validateIpcInput('sessions.create', { name: '' })).toThrow();
    expect(() => validateIpcInput('sessions.create', { name: 'x'.repeat(201) })).toThrow();
    expect(() =>
      validateIpcInput('sessions.rename', { id: 's1', name: 'New name' }),
    ).not.toThrow();
    expect(() => validateIpcInput('sessions.rename', { id: 's1', name: '' })).toThrow();
    expect(() =>
      validateIpcInput('sessions.rename', { id: 's1', name: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('requires bounded ids for sessions.setActive / remove', () => {
    expect(() => validateIpcInput('sessions.setActive', { id: 's1' })).not.toThrow();
    expect(() => validateIpcInput('sessions.setActive', { id: '' })).toThrow();
    expect(() => validateIpcInput('sessions.setActive', {})).toThrow();
    expect(() => validateIpcInput('sessions.remove', { id: 's1' })).not.toThrow();
    expect(() => validateIpcInput('sessions.remove', { id: 'x'.repeat(257) })).toThrow();
  });

  it('requires a boolean for setAutoApprove', () => {
    expect(() =>
      validateIpcInput('session.setAutoApprove', { workspaceId: 'ws', enabled: true }),
    ).not.toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', { enabled: false })).not.toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', { enabled: 'yes' })).toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', {})).toThrow();
  });

  it('takes an answer to a question as chosen option ids and bounded words of the person own', () => {
    const answer = (answers: unknown) => () =>
      validateIpcInput('session.answerQuestion', { workspaceId: 'ws', questionId: 'q-1', answers });
    expect(answer({ q1: { selected: ['o1'] } })).not.toThrow();
    expect(answer({ q1: { selected: [], other: 'Teal' } })).not.toThrow();
    expect(answer({ q1: { selected: 'o1' } })).toThrow();
    expect(answer({ q1: { selected: [], other: 'x'.repeat(10_001) } })).toThrow();
    expect(answer({ q1: { selected: ['o1'], extra: true } })).toThrow();
    expect(() => validateIpcInput('session.answerQuestion', { questionId: '', answers: {} })).toThrow();
  });

  it('takes the id of one background work to stop', () => {
    expect(() => validateIpcInput('session.stopBackgroundWork', { workspaceId: 'ws', workId: 'b1' })).not.toThrow();
    expect(() => validateIpcInput('session.stopBackgroundWork', { workId: '' })).toThrow();
    expect(() => validateIpcInput('session.stopBackgroundWork', { workId: 'x'.repeat(257) })).toThrow();
  });

  it('bounds local focus-window movement and resize payloads', () => {
    expect(() => validateIpcInput('focus.toggle', undefined)).not.toThrow();
    expect(() => validateIpcInput('focus.toggle', { sneaky: true })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 10, dy: -12 })).not.toThrow();
    expect(() =>
      validateIpcInput('focus.dragStart', { screenX: -1200, screenY: 240 }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('focus.dragMove', { screenX: 3200, screenY: 1800 }),
    ).not.toThrow();
    expect(() => validateIpcInput('focus.dragEnd', undefined)).not.toThrow();
    expect(() =>
      validateIpcInput('focus.resize', {
        width: 320,
        height: 176,
        resizable: false,
        verticalAnchor: 'bottom',
      }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('focus.resize', { width: 1600, height: 1600, resizable: true }),
    ).not.toThrow();

    expect(() => validateIpcInput('focus.moveBy', { dx: Number.POSITIVE_INFINITY, dy: 0 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: Number.NaN, dy: 0 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 10_001, dy: 0 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 0, dy: -10_001 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 0, dy: 0, sneaky: true })).toThrow();
    expect(() =>
      validateIpcInput('focus.dragStart', { screenX: Number.NaN, screenY: 0 }),
    ).toThrow();
    expect(() =>
      validateIpcInput('focus.dragMove', { screenX: 100_001, screenY: 0 }),
    ).toThrow();
    expect(() =>
      validateIpcInput('focus.dragMove', { screenX: 0, screenY: 0, sneaky: true }),
    ).toThrow();
    expect(() => validateIpcInput('focus.dragEnd', { sneaky: true })).toThrow();

    expect(() => validateIpcInput('focus.resize', { width: 39, height: 44 })).toThrow();
    expect(() => validateIpcInput('focus.resize', { width: 44, height: 1601 })).toThrow();
    expect(() => validateIpcInput('focus.resize', { width: Number.NaN, height: 44 })).toThrow();
    expect(() => validateIpcInput('focus.resize', {
      width: 320,
      height: 176,
      verticalAnchor: 'top',
    })).toThrow();
  });

  it('allows the reply sound to be switched in prefs.update', () => {
    expect(() => validateIpcInput('prefs.update', { replySound: false })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { replySound: 'loud' })).toThrow();
  });

  it('allows system notifications to be switched in prefs.update', () => {
    expect(() => validateIpcInput('prefs.update', { systemNotifications: false })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { systemNotifications: 'banner' })).toThrow();
  });

  it('allows in-app toasts to be switched in prefs.update', () => {
    expect(() => validateIpcInput('prefs.update', { inAppToasts: false })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { inAppToasts: 'corner' })).toThrow();
  });

  it('takes no arguments for window.presence', () => {
    expect(() => validateIpcInput('window.presence', undefined)).not.toThrow();
    expect(() => validateIpcInput('window.presence', { sneaky: true })).toThrow();
  });

  it('rejects the removed mobileGatewayEnabled in prefs.update', () => {
    expect(() => validateIpcInput('prefs.update', { mobileGatewayEnabled: true })).toThrow();
  });

  it('whitelists theme in prefs.update to the three known values', () => {
    expect(() => validateIpcInput('prefs.update', { theme: 'light' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: 'dark' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: 'system' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: 'hotdog' })).toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: true })).toThrow();
  });

  it('bounds focusMiniTextSize in prefs.update', () => {
    expect(() =>
      validateIpcInput('prefs.update', { focusMiniTextSize: { width: 320, height: 260 } }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('prefs.update', { focusMiniTextSize: { width: 1600, height: 1600 } }),
    ).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { focusMiniTextSize: null })).not.toThrow();
    expect(() =>
      validateIpcInput('prefs.update', { focusMiniTextSize: { width: 319, height: 260 } }),
    ).toThrow();
    expect(() =>
      validateIpcInput('prefs.update', { focusMiniTextSize: { width: 320, height: 259 } }),
    ).toThrow();
    expect(() =>
      validateIpcInput('prefs.update', { focusMiniTextSize: { width: 1601, height: 440 } }),
    ).toThrow();
    expect(() =>
      validateIpcInput('prefs.update', { focusMiniTextSize: { width: 380, height: 440, x: 1 } }),
    ).toThrow();
  });

  it('bounds the session.abortTurn turnId', () => {
    // Valid: a short turn id, with or without an explicit workspaceId.
    expect(() =>
      validateIpcInput('session.abortTurn', { turnId: 't-123' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.abortTurn', { workspaceId: 'ws', turnId: 't-123' }),
    ).not.toThrow();
    // turnId is required and bounded — empty / missing / oversized is rejected.
    expect(() => validateIpcInput('session.abortTurn', { turnId: '' })).toThrow();
    expect(() => validateIpcInput('session.abortTurn', {})).toThrow();
    expect(() =>
      validateIpcInput('session.abortTurn', { turnId: 't'.repeat(257) }),
    ).toThrow();
    // workspaceId, when present, is also bounded.
    expect(() =>
      validateIpcInput('session.abortTurn', { workspaceId: 'w'.repeat(257), turnId: 't' }),
    ).toThrow();
  });

  it('bounds the session.info workspaceId', () => {
    // Valid: no arg (active workspace) or a bounded workspaceId.
    expect(() => validateIpcInput('session.info', undefined)).not.toThrow();
    expect(() => validateIpcInput('session.info', {})).not.toThrow();
    expect(() => validateIpcInput('session.info', { workspaceId: 'ws' })).not.toThrow();
    expect(() =>
      validateIpcInput('session.info', { workspaceId: 'w'.repeat(257) }),
    ).toThrow();
    // An empty workspaceId (not undefined) is rejected.
    expect(() => validateIpcInput('session.info', { workspaceId: '' })).toThrow();
  });

  it('bounds the session.activeTurn workspaceId', () => {
    expect(() => validateIpcInput('session.activeTurn', undefined)).not.toThrow();
    expect(() => validateIpcInput('session.activeTurn', {})).not.toThrow();
    expect(() =>
      validateIpcInput('session.activeTurn', { workspaceId: 'ws' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.activeTurn', { workspaceId: 'w'.repeat(257) }),
    ).toThrow();
    expect(() => validateIpcInput('session.activeTurn', { workspaceId: '' })).toThrow();
  });

  it('bounds the sessions.list deskId', () => {
    // Valid: no arg (active desk) or a bounded deskId.
    expect(() => validateIpcInput('sessions.list', undefined)).not.toThrow();
    expect(() => validateIpcInput('sessions.list', {})).not.toThrow();
    expect(() => validateIpcInput('sessions.list', { deskId: 'd1' })).not.toThrow();
    expect(() =>
      validateIpcInput('sessions.list', { deskId: 'd'.repeat(257) }),
    ).toThrow();
    expect(() => validateIpcInput('sessions.list', { deskId: '' })).toThrow();
  });

  it('confines apps.* appId to a non-traversing slug', () => {
    // appId keys a per-app install dir + a network download, so it must be a
    // strict slug — no traversal, no separators, no uppercase, bounded length.
    for (const cmd of ['apps.status', 'apps.install', 'apps.uninstall'] as const) {
      expect(() => validateIpcInput(cmd, { appId: 'anonymizer' })).not.toThrow();
      expect(() => validateIpcInput(cmd, { appId: '../evil' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: 'a/b' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: 'Anonymizer' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: '' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: 'a'.repeat(65) })).toThrow();
      expect(() => validateIpcInput(cmd, {})).toThrow();
    }
  });

  it('confines channels.* channelId to a non-traversing slug', () => {
    // channelId is spawned as `moxxy <channelId>`, so it must be a strict slug —
    // no traversal, no separators, no leading dash (a flag), bounded length.
    for (const cmd of ['channels.start', 'channels.stop'] as const) {
      expect(() => validateIpcInput(cmd, { channelId: 'slack' })).not.toThrow();
      expect(() => validateIpcInput(cmd, { channelId: '../evil' })).toThrow();
      expect(() => validateIpcInput(cmd, { channelId: '-rf' })).toThrow();
      expect(() => validateIpcInput(cmd, { channelId: 'Slack' })).toThrow();
      expect(() => validateIpcInput(cmd, { channelId: '' })).toThrow();
      expect(() => validateIpcInput(cmd, {})).toThrow();
    }
  });

  it('bounds channels.saveConfig field count + value size (OOM/vault-bloat guard)', () => {
    expect(() =>
      validateIpcInput('channels.saveConfig', {
        channelId: 'slack',
        values: { botToken: 'xoxb-abc', signingSecret: 'sek' },
      }),
    ).not.toThrow();
    // Oversized secret value is rejected.
    expect(() =>
      validateIpcInput('channels.saveConfig', {
        channelId: 'slack',
        values: { botToken: 'x'.repeat(8193) },
      }),
    ).toThrow();
    // A traversing channelId is rejected even with a valid values bag.
    expect(() =>
      validateIpcInput('channels.saveConfig', { channelId: '../x', values: {} }),
    ).toThrow();
  });

  it('accepts channels.setModel only as provider::model or null (reset to default)', () => {
    const ok = (model: unknown) => () => validateIpcInput('channels.setModel', { channelId: 'discord', model });
    expect(ok('codex-agent::gpt-5.6-luna')).not.toThrow();
    expect(ok(null)).not.toThrow();
    expect(ok('gpt-5.6-luna')).toThrow();
    expect(ok('::m')).toThrow();
    expect(ok('p::')).toThrow();
    expect(ok(`p::${'m'.repeat(300)}`)).toThrow();
    expect(() =>
      validateIpcInput('channels.setModel', { channelId: '../x', model: 'p::m' }),
    ).toThrow();
  });

  it('pins channels.openChat to a channel slug (it picks the socket the host attaches to)', () => {
    const open = (args: unknown) => () => validateIpcInput('channels.openChat', args);
    expect(open({ channelId: 'discord' })).not.toThrow();
    expect(open({ channelId: '../x' })).toThrow();
    expect(open({ channelId: 'discord', socketPath: '/tmp/x.sock' })).toThrow();
  });

  it('accepts channels.setRunMode only for the three known modes', () => {
    for (const mode of ['manual', 'app', 'background']) {
      expect(() => validateIpcInput('channels.setRunMode', { channelId: 'discord', mode })).not.toThrow();
    }
    expect(() => validateIpcInput('channels.setRunMode', { channelId: 'discord', mode: 'forever' })).toThrow();
    expect(() => validateIpcInput('channels.setRunMode', { channelId: '../x', mode: 'app' })).toThrow();
  });

  it('bounds anonymizer.parseDocument path + pins pickDocument to no payload', () => {
    expect(() => validateIpcInput('anonymizer.parseDocument', { path: '/a/b.txt' })).not.toThrow();
    expect(() => validateIpcInput('anonymizer.parseDocument', { path: '' })).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocument', { path: 'x'.repeat(4097) }),
    ).toThrow();
    // pickDocument takes nothing — a payload can't be smuggled across.
    expect(() => validateIpcInput('anonymizer.pickDocument', undefined)).not.toThrow();
    expect(() => validateIpcInput('anonymizer.pickDocument', { sneaky: 1 })).toThrow();
  });

  it('caps anonymizer.parseDocumentBytes name + base64 size (OOM guard)', () => {
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', { name: 'doc.pdf', dataBase64: 'AAAA' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', { name: '', dataBase64: 'AAAA' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', {
        name: 'n'.repeat(256),
        dataBase64: 'AAAA',
      }),
    ).toThrow();
    // Empty body and an over-cap body both rejected at the boundary.
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', { name: 'doc.pdf', dataBase64: '' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', {
        name: 'doc.pdf',
        dataBase64: 'A'.repeat(67_000_001),
      }),
    ).toThrow();
  });

  it('bounds anonymizer.saveRedacted name + content (OOM guard)', () => {
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', { suggestedName: 'out.txt', content: 'hi' }),
    ).not.toThrow();
    // Empty content is valid (a fully-redacted-to-nothing doc); name is required.
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', { suggestedName: 'out.txt', content: '' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', { suggestedName: '', content: 'hi' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', {
        suggestedName: 'out.txt',
        content: 'x'.repeat(20_000_001),
      }),
    ).toThrow();
  });

  it('is a no-op for commands without a schema', () => {
    expect(() => validateIpcInput('connection.snapshotAll', undefined)).not.toThrow();
  });

  it('pins desks.list to no payload', () => {
    expect(() => validateIpcInput('desks.list', undefined)).not.toThrow();
    expect(() => validateIpcInput('desks.list', { sneaky: 1 })).toThrow();
  });

  it('bounds the desks.setActive id', () => {
    expect(() => validateIpcInput('desks.setActive', { id: 'desk-1' })).not.toThrow();
    expect(() => validateIpcInput('desks.setActive', { id: '' })).toThrow();
    expect(() => validateIpcInput('desks.setActive', { id: 'd'.repeat(257) })).toThrow();
  });

  it('accepts a provider switch for a workspace', () => {
    expect(() =>
      validateIpcInput('session.setProvider', { workspaceId: 'workspace-1', provider: 'codex-agent' }),
    ).not.toThrow();
  });

  it('bounds the model a workspace switches to', () => {
    expect(() =>
      validateIpcInput('session.setModel', { workspaceId: 'workspace-1', model: 'gpt-5.4' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.setModel', { workspaceId: 'workspace-1', model: null }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.setModel', {
        workspaceId: 'workspace-1', model: 'vendor/model-v2', contextWindow: 200_000,
      }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.setModel', {
        workspaceId: 'workspace-1', model: 'vendor/model-v2', contextWindow: 10_000_001,
      }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.setModel', { workspaceId: 'workspace-1', model: '' }),
    ).toThrow();
  });

  it('accepts a session-scoped auto-approve toggle', () => {
    expect(() =>
      validateIpcInput('session.setAutoApprove', { workspaceId: 'workspace-1', enabled: true }),
    ).not.toThrow();
  });

  it('bounds the ids of existing scheduler entries', () => {
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: 'daily-summary', enabled: false }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('scheduler.delete' as never, { id: 'daily-summary' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: '', enabled: true }),
    ).toThrow();
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: 's'.repeat(257), enabled: true }),
    ).toThrow();
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: 'daily-summary', enabled: 'yes' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('scheduler.delete' as never, { id: 's'.repeat(257) }),
    ).toThrow();
  });
  it('bounds what the pane may tell main about the agent’s browser pointer and control', () => {
    expect(() => validateIpcInput('browser.confirmCursor' as IpcCommandName, { requestId: 'cur1' })).not.toThrow();
    expect(() => validateIpcInput('browser.confirmCursor' as IpcCommandName, { requestId: '' })).toThrow();
    expect(() => validateIpcInput('browser.control' as IpcCommandName, { command: 'takeover' })).not.toThrow();
    expect(() => validateIpcInput('browser.control' as IpcCommandName, { command: 'resume' })).not.toThrow();
    expect(() => validateIpcInput('browser.control' as IpcCommandName, { command: 'stop' })).toThrow();
    expect(() =>
      validateIpcInput('browser.control' as IpcCommandName, { command: 'resume', driver: 'agent' }),
    ).toThrow();
  });
});
