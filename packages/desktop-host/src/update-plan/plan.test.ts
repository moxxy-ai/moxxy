import { describe, expect, it } from 'vitest';
import type { AppUpdateCheck } from '@moxxy/desktop-ipc-contract';
import { buildUpdatePlan } from './plan.js';

const appCurrent: AppUpdateCheck = { available: false, currentVersion: '0.5.0', latestVersion: '0.5.0', compatible: true };
const appHot: AppUpdateCheck = { available: true, currentVersion: '0.5.0', latestVersion: '0.6.0', compatible: true };
const appInstaller: AppUpdateCheck = { ...appHot, compatible: false, requiresFullUpdate: true };

const plan = (app: AppUpdateCheck) => buildUpdatePlan({ app, id: 'plan-1', now: 1_000 });

describe('buildUpdatePlan', () => {
  it('plans nothing when the app is current', () => {
    expect(plan(appCurrent)).toBeNull();
  });

  it('stages the app bundle and restarts once', () => {
    expect(plan(appHot)).toEqual({
      id: 'plan-1',
      createdAt: 1_000,
      route: 'hot',
      version: '0.6.0',
      steps: [
        { id: 'app', status: 'pending' },
        { id: 'restart', status: 'pending' },
      ],
    });
  });

  it('takes the installer when the bundle needs a newer runner protocol', () => {
    const result = plan(appInstaller);
    expect(result?.route).toBe('installer');
    expect(result?.steps.map((step) => step.id)).toEqual(['installer', 'restart']);
  });

  it('takes the installer for a bundle this shell cannot load', () => {
    expect(plan({ ...appHot, compatible: false })?.route).toBe('installer');
  });

  it('plans nothing from a check that failed', () => {
    expect(plan({ ...appHot, error: 'offline' })).toBeNull();
  });
});
