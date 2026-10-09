import { describe, expect, it } from 'vitest';

import { needsNewerRunner, shellIsBehind, shellRunnerProtocol } from './shell-protocol';

describe('shellRunnerProtocol', () => {
  it('is what the installed app says about itself', () => {
    expect(shellRunnerProtocol({ declared: '25', shellVersion: '0.43.0' })).toBe(25);
  });

  it('is known for the one release that had the current runner before apps said so', () => {
    expect(shellRunnerProtocol({ declared: undefined, shellVersion: '0.42.0' })).toBe(24);
  });

  it('is behind any runner for an older app that says nothing', () => {
    expect(shellRunnerProtocol({ declared: undefined, shellVersion: '0.40.3' })).toBe(0);
    expect(shellRunnerProtocol({ declared: undefined, shellVersion: '0.41.1' })).toBe(0);
  });

  it('does not trust a value that is not a whole number', () => {
    expect(shellRunnerProtocol({ declared: 'latest', shellVersion: '0.40.3' })).toBe(0);
    expect(shellRunnerProtocol({ declared: '', shellVersion: '0.42.0' })).toBe(24);
    expect(shellRunnerProtocol({ declared: '-3', shellVersion: '0.40.3' })).toBe(0);
  });
});

describe('shellIsBehind', () => {
  const on = (shellVersion: string, declared?: string) => ({ bundleVersion: '0.43.0', declared, shellVersion, needed: 24 });

  it('holds for a bundle an older installed app loaded', () => {
    expect(shellIsBehind(on('0.40.3'))).toBe(true);
    expect(shellIsBehind(on('0.41.1'))).toBe(true);
    expect(shellIsBehind(on('0.43.0', '23'))).toBe(true);
  });

  it('does not hold on an installed app that carries the runner the bundle needs', () => {
    expect(shellIsBehind(on('0.42.0'))).toBe(false);
    expect(shellIsBehind(on('0.43.0', '24'))).toBe(false);
    expect(shellIsBehind(on('0.44.0', '25'))).toBe(false);
  });

  it('never holds for the installed app running its own bundle', () => {
    expect(shellIsBehind({ bundleVersion: undefined, declared: undefined, shellVersion: '0.40.3', needed: 24 })).toBe(false);
  });
});

describe('needsNewerRunner', () => {
  it('holds for a bundle that needs a newer runner, signed or only said', () => {
    expect(needsNewerRunner({ runnerProtocol: 7 }, 6)).toBe(true);
    expect(needsNewerRunner({ needsRunnerProtocol: 7 }, 6)).toBe(true);
    expect(needsNewerRunner({ runnerProtocol: 5, needsRunnerProtocol: 7 }, 6)).toBe(true);
  });

  it('does not hold for a runner this app already has', () => {
    expect(needsNewerRunner({ needsRunnerProtocol: 6 }, 6)).toBe(false);
    expect(needsNewerRunner({ runnerProtocol: 6, needsRunnerProtocol: 5 }, 6)).toBe(false);
  });

  it('does not hold when either side is unknown', () => {
    expect(needsNewerRunner({}, 6)).toBe(false);
    expect(needsNewerRunner({ needsRunnerProtocol: 7 }, undefined)).toBe(false);
  });
});
