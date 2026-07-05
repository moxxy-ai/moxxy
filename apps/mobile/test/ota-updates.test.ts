import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  initialOtaState,
  otaBusy,
  otaStatusLabel,
  otaUpdatesActive,
  reduceOta,
  type OtaState,
} from '../src/otaUpdates';

describe('OTA update reducer', () => {
  it('starts idle with nothing pending', () => {
    expect(initialOtaState).toEqual({ status: 'idle', pending: false });
  });

  it('checks for an update when the app becomes active', () => {
    const { state, action } = reduceOta(initialOtaState, { type: 'app-active' });
    expect(action).toBe('check');
    expect(state).toEqual({ status: 'checking', pending: false });
  });

  it('downloads when a check reports an available update', () => {
    const { state, action } = reduceOta(
      { status: 'checking', pending: false },
      { type: 'checked', available: true },
    );
    expect(action).toBe('download');
    expect(state.status).toBe('downloading');
  });

  it('settles back to idle when already up to date', () => {
    const { state, action } = reduceOta(
      { status: 'checking', pending: false },
      { type: 'checked', available: false },
    );
    expect(action).toBe('none');
    expect(state).toEqual({ status: 'idle', pending: false });
  });

  it('holds a downloaded update pending instead of reloading mid-session', () => {
    const { state, action } = reduceOta(
      { status: 'downloading', pending: false },
      { type: 'downloaded', ok: true },
    );
    expect(action).toBe('none');
    expect(state).toEqual({ status: 'ready', pending: true });
  });

  it('applies a pending update the next time the app becomes active', () => {
    const { state, action } = reduceOta(
      { status: 'ready', pending: true },
      { type: 'app-active' },
    );
    expect(action).toBe('reload');
    expect(state.pending).toBe(true);
  });

  it('does not stack a second check while one is in flight', () => {
    for (const status of ['checking', 'downloading'] as const) {
      const state: OtaState = { status, pending: false };
      expect(reduceOta(state, { type: 'app-active' })).toEqual({ state, action: 'none' });
    }
  });

  it('records download/network failures as an error and retries on next activation', () => {
    const failed = reduceOta({ status: 'downloading', pending: false }, { type: 'downloaded', ok: false });
    expect(failed).toEqual({ state: { status: 'error', pending: false }, action: 'none' });

    const errored = reduceOta({ status: 'checking', pending: false }, { type: 'failed' });
    expect(errored.state.status).toBe('error');

    // An error is not terminal — the next activation checks again.
    const retry = reduceOta({ status: 'error', pending: false }, { type: 'app-active' });
    expect(retry.action).toBe('check');
  });

  it('runs a full launch → download → apply lifecycle', () => {
    let state = initialOtaState;
    const run = (event: Parameters<typeof reduceOta>[1]) => {
      const t = reduceOta(state, event);
      state = t.state;
      return t.action;
    };

    expect(run({ type: 'app-active' })).toBe('check'); // launch
    expect(run({ type: 'checked', available: true })).toBe('download');
    expect(run({ type: 'downloaded', ok: true })).toBe('none'); // held pending
    expect(state).toEqual({ status: 'ready', pending: true });
    expect(run({ type: 'app-active' })).toBe('reload'); // next foreground applies it
  });

  it('reports busy only while checking or downloading', () => {
    expect(otaBusy({ status: 'checking', pending: false })).toBe(true);
    expect(otaBusy({ status: 'downloading', pending: false })).toBe(true);
    expect(otaBusy({ status: 'idle', pending: false })).toBe(false);
    expect(otaBusy({ status: 'ready', pending: true })).toBe(false);
    expect(otaBusy({ status: 'error', pending: false })).toBe(false);
  });
});

describe('otaUpdatesActive gate', () => {
  it('runs only when updates are enabled, not in dev, and not on web', () => {
    expect(otaUpdatesActive({ isEnabled: true, isDev: false, isWeb: false })).toBe(true);
    expect(otaUpdatesActive({ isEnabled: false, isDev: false, isWeb: false })).toBe(false);
    expect(otaUpdatesActive({ isEnabled: true, isDev: true, isWeb: false })).toBe(false);
    expect(otaUpdatesActive({ isEnabled: true, isDev: false, isWeb: true })).toBe(false);
  });
});

describe('otaStatusLabel', () => {
  it('has a label for every status', () => {
    const statuses: OtaState['status'][] = ['idle', 'checking', 'downloading', 'ready', 'error'];
    for (const status of statuses) {
      expect(otaStatusLabel({ status, pending: false })).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Config wiring — guards the pieces that actually make OTA reach a device.
// ---------------------------------------------------------------------------

const read = (relativeToApp: string) => readFileSync(resolve(process.cwd(), relativeToApp), 'utf8');

describe('EAS Update configuration is wired up', () => {
  it('declares expo-updates with an appVersion runtime policy in app config', () => {
    const app = JSON.parse(read('app.json')).expo;
    expect(app.version).toBe('1.0.0');
    expect(app.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(app.updates.enabled).toBe(true);
    expect(app.updates.checkAutomatically).toBe('ON_LOAD');

    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['expo-updates']).toBeTruthy();
  });

  it('derives the EAS Update URL from the resolved project id', () => {
    const config = read('app.config.ts');
    expect(config).toContain('https://u.expo.dev/');
    expect(config).toContain('updates');
  });

  it('stamps every build profile with an update channel', () => {
    const eas = JSON.parse(read('eas.json'));
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.production.channel).toBe('production');
  });

  it('enables OTA in the committed iOS native project', () => {
    const plist = read('ios/MoxxyMobileGateway/Supporting/Expo.plist');
    expect(plist).toMatch(/<key>EXUpdatesEnabled<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>EXUpdatesURL<\/key>\s*<string>https:\/\/u\.expo\.dev\//);
    expect(plist).toMatch(/<key>EXUpdatesRuntimeVersion<\/key>\s*<string>1\.0\.0<\/string>/);
  });

  it('mounts the OTA controller at the app root', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('OtaUpdateController');
  });

  it('ships a manual-trigger OTA publish workflow', () => {
    const workflow = read('../../.github/workflows/mobile-eas-update.yml');
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('eas update');
    expect(workflow).toContain('--branch');
  });
});
