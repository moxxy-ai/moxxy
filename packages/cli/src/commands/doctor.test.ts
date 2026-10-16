import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { buildAgentCliDoctorChecks, buildMemoryDoctorCheck, buildPluginDoctorChecks, buildVoiceDoctorCheck } from './doctor.js';

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

describe('buildMemoryDoctorCheck', () => {
  it('checks the memory folder the plugin writes to, in MOXXY_HOME', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-doctor-'));
    vi.stubEnv('MOXXY_HOME', home);
    try {
      const check = await buildMemoryDoctorCheck({ list: async () => [] });
      expect(check).toMatchObject({ id: 'memory', status: 'ok' });
      expect(check.message).toContain(path.join(home, 'memory'));
    } finally {
      vi.unstubAllEnvs();
      await removeDir(home);
    }
  });
});

describe('buildAgentCliDoctorChecks', () => {
  const codex = (state: 'missing' | 'update-required' | 'update-available' | 'current' | 'unknown', installed: string | null) => ({
    provider: 'codex-agent',
    agentName: 'Codex',
    command: 'codex',
    report: { state, command: 'codex', installed, latest: '0.162.1', minimum: '0.155.1', checkedAt: 1 },
  });

  it("says where each agent connection's CLI stands, and the command that fixes it", () => {
    expect(buildAgentCliDoctorChecks([codex('current', '0.162.1')], new Set())).toEqual([
      { id: 'agent:codex-agent', status: 'ok', message: 'Codex 0.162.1, the latest' },
    ]);
    expect(buildAgentCliDoctorChecks([codex('update-available', '0.155.1')], new Set())).toEqual([
      { id: 'agent:codex-agent', status: 'warn', message: 'Codex 0.155.1; 0.162.1 is out — moxxy agents update codex' },
    ]);
    expect(buildAgentCliDoctorChecks([codex('unknown', null)], new Set())).toEqual([
      { id: 'agent:codex-agent', status: 'warn', message: 'Codex is installed, but its version could not be read' },
    ]);
  });

  it('fails only for the connection Moxxy is set to use', () => {
    expect(buildAgentCliDoctorChecks([codex('missing', null)], new Set())).toEqual([
      { id: 'agent:codex-agent', status: 'ok', message: 'Codex is not installed — moxxy agents install codex to use it' },
    ]);
    expect(buildAgentCliDoctorChecks([codex('missing', null)], new Set(['codex-agent']))[0]?.status).toBe('fail');
    expect(buildAgentCliDoctorChecks([codex('update-required', '0.150.0')], new Set(['codex-agent']))).toEqual([
      {
        id: 'agent:codex-agent',
        status: 'fail',
        message: 'Codex 0.150.0 is older than 0.155.1, the oldest Moxxy works with — moxxy agents update codex',
      },
    ]);
    expect(buildAgentCliDoctorChecks([codex('update-required', '0.150.0')], new Set())[0]?.status).toBe('warn');
  });
});
