import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@moxxy/config';
import { findProfile, PROFILES } from './profiles.js';

describe('deployment profiles', () => {
  let home: string;
  let project: string;
  let sysFile: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-profile-home-'));
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-profile-proj-'));
    const sysDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-profile-etc-'));
    sysFile = path.join(sysDir, 'config.yaml');
    for (const k of ['MOXXY_HOME', 'MOXXY_SYSTEM_CONFIG']) saved[k] = process.env[k];
    process.env.MOXXY_HOME = home;
    process.env.MOXXY_SYSTEM_CONFIG = sysFile;
  });

  afterEach(async () => {
    for (const k of ['MOXXY_HOME', 'MOXXY_SYSTEM_CONFIG']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await Promise.all([home, project].map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  it('every profile names a target and a description', () => {
    expect(PROFILES.length).toBeGreaterThan(0);
    for (const p of PROFILES) {
      expect(p.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.target.length).toBeGreaterThan(0);
    }
  });

  // The profile is shipped as text, so nothing else would catch a typo in it.
  // Load it through the REAL loader rather than a YAML parser, so schema drift
  // (a renamed key, a tightened enum) fails here too.
  it('the enterprise profile parses and applies through the real loader', async () => {
    const profile = findProfile('enterprise');
    expect(profile).toBeDefined();
    await fs.writeFile(sysFile, profile!.yaml);

    const { config, sources } = await loadConfig({ cwd: project });

    expect(sources.some((s) => s.scope === 'system')).toBe(true);
    expect(config.security?.enabled).toBe(true);
    expect(config.security?.requireDeclaration).toBe(true);
    expect(config.security?.thirdPartyRequireDeclaration).toBe('enforce');
    expect(config.plugins?.isolator?.default).toBe('subprocess');
    expect(config.config?.allowExecutable).toBe(false);
    expect(config.audit?.enabled).toBe(true);
  });

  // The whole point of the profile: these cannot be switched off downstream.
  it('locks the security controls against a user config', async () => {
    await fs.writeFile(sysFile, findProfile('enterprise')!.yaml);
    await fs.writeFile(
      path.join(home, 'config.yaml'),
      [
        'security:',
        '  enabled: false',
        '  requireDeclaration: false',
        '  thirdPartyRequireDeclaration: "off"',
        'config:',
        '  allowExecutable: true',
        'audit:',
        '  enabled: false',
        '',
      ].join('\n'),
    );

    const { config, lockedOverrides } = await loadConfig({ cwd: project, warn: () => {} });

    expect(config.security?.enabled).toBe(true);
    expect(config.security?.requireDeclaration).toBe(true);
    expect(config.security?.thirdPartyRequireDeclaration).toBe('enforce');
    expect(config.config?.allowExecutable).toBe(false);
    expect(config.audit?.enabled).toBe(true);
    expect(lockedOverrides.map((o) => o.key).sort()).toContain('security.enabled');
  });

  // Locking `audit` as a subtree must take a sibling with it, not just the leaf.
  it('locking a subtree pins the whole subtree', async () => {
    await fs.writeFile(sysFile, findProfile('enterprise')!.yaml);
    await fs.writeFile(
      path.join(home, 'config.yaml'),
      'audit:\n  enabled: false\n  includePromptText: true\n',
    );
    const { config } = await loadConfig({ cwd: project, warn: () => {} });
    expect(config.audit?.enabled).toBe(true);
    expect(config.audit?.includePromptText).toBe(false);
  });

  // With allowExecutable pinned false, a project's moxxy.config.ts must not run
  // even for a user who would happily approve it.
  it('forbids executable project configs once installed', async () => {
    await fs.writeFile(sysFile, findProfile('enterprise')!.yaml);
    await fs.writeFile(path.join(project, 'moxxy.config.ts'), 'export default { maxIterations: 99 }\n');

    const { config, skipped } = await loadConfig({
      cwd: project,
      trustPrompt: async () => true,
      warn: () => {},
    });

    expect(config.maxIterations).toBeUndefined();
    expect(skipped[0]?.reason).toContain('disabled by the system config');
  });

  // Site-specific values have no safe default, so they must ship commented out
  // rather than as a guess a deployment would silently inherit.
  it('leaves the proxy unset rather than guessing one', async () => {
    await fs.writeFile(sysFile, findProfile('enterprise')!.yaml);
    const { config } = await loadConfig({ cwd: project });
    expect(config.network).toBeUndefined();
  });
});

describe('enterprise profile: mobile bind', () => {
  // The mobile channel binds 0.0.0.0 by default so a physical phone works out
  // of the box. Correct for a consumer install, wrong for a corporate laptop:
  // it puts a token-gated listener on the office network.
  it('pins the mobile channel to loopback and locks it', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-mob-home-'));
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-mob-proj-'));
    const sysDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-mob-etc-'));
    const sysFile = path.join(sysDir, 'config.yaml');
    const prevHome = process.env.MOXXY_HOME;
    const prevSys = process.env.MOXXY_SYSTEM_CONFIG;
    process.env.MOXXY_HOME = home;
    process.env.MOXXY_SYSTEM_CONFIG = sysFile;
    try {
      await fs.writeFile(sysFile, findProfile('enterprise')!.yaml);
      await fs.writeFile(
        path.join(home, 'config.yaml'),
        'channels:\n  mobile:\n    bindHost: 0.0.0.0\n',
      );
      const { config } = await loadConfig({ cwd: project, warn: () => {} });
      const mobile = config.channels?.mobile as { bindHost?: string } | undefined;
      expect(mobile?.bindHost).toBe('127.0.0.1');
    } finally {
      if (prevHome === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = prevHome;
      if (prevSys === undefined) delete process.env.MOXXY_SYSTEM_CONFIG;
      else process.env.MOXXY_SYSTEM_CONFIG = prevSys;
      await Promise.all([home, project, sysDir].map((d) => fs.rm(d, { recursive: true, force: true })));
    }
  });
});
