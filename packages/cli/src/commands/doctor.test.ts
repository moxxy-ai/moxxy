import { describe, expect, it } from 'vitest';
import { buildPluginDoctorChecks, buildVoiceDoctorCheck } from './doctor.js';

function transcribers(active: string | null, registered: string[] = []) {
  return {
    transcribers: {
      getActiveName: () => active,
      list: () => registered.map((name) => ({ name })),
    },
  } as never;
}

describe('buildVoiceDoctorCheck', () => {
  it('requires an active transcriber as well as capture', () => {
    expect(buildVoiceDoctorCheck(transcribers(null), { ready: true, issues: [] })).toEqual({
      id: 'voice', status: 'warn', message: 'audio capture available; no transcriber installed',
    });
    expect(buildVoiceDoctorCheck(transcribers('whisper'), { ready: true, issues: [] })).toEqual({
      id: 'voice', status: 'ok', message: 'ready — transcriber=whisper',
    });
  });
  it('reports capture failures without assuming a provider', () => {
    expect(buildVoiceDoctorCheck(transcribers('whisper'), { ready: false, issues: [{
      requirement: { kind: 'runtime', name: 'voice:capture', state: 'ready' },
      code: 'not_ready', message: 'capture missing', hint: 'Install a recorder.',
    }] })).toEqual({ id: 'voice', status: 'warn', message: 'Install a recorder' });
  });
});

describe('buildPluginDoctorChecks', () => {
  it('reports skipped plugins with hints', () => {
    expect(buildPluginDoctorChecks({
      registered: new Set(['base']),
      skipped: [{ pluginName: 'needs-base', source: 'static', reason: 'unmet_requirements', message: 'Required plugin is not registered: base-plugin', hints: ['Enable base-plugin.'] }],
    })).toEqual([
      { id: 'plugins', status: 'warn', message: '1 loaded, 1 skipped' },
      { id: 'plugin:needs-base', status: 'warn', message: 'skipped — Required plugin is not registered: base-plugin (Enable base-plugin.)' },
    ]);
  });
});
