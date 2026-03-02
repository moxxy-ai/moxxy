import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  parseUpdateFlags,
  compareVersions,
  parseChecksumFile,
  findAssetUrl,
  findChecksumUrl,
} from '../src/commands/update.js';

describe('parseUpdateFlags', () => {
  it('parses --check flag', () => {
    const flags = parseUpdateFlags(['--check']);
    assert.equal(flags.check, true);
    assert.equal(flags.rollback, false);
    assert.equal(flags.force, false);
    assert.equal(flags.json, false);
  });

  it('parses --rollback flag', () => {
    const flags = parseUpdateFlags(['--rollback']);
    assert.equal(flags.rollback, true);
  });

  it('parses --force flag', () => {
    const flags = parseUpdateFlags(['--force']);
    assert.equal(flags.force, true);
  });

  it('parses --json flag', () => {
    const flags = parseUpdateFlags(['--json']);
    assert.equal(flags.json, true);
  });

  it('parses multiple flags combined', () => {
    const flags = parseUpdateFlags(['--check', '--force', '--json']);
    assert.equal(flags.check, true);
    assert.equal(flags.force, true);
    assert.equal(flags.json, true);
    assert.equal(flags.rollback, false);
  });

  it('returns all false for empty args', () => {
    const flags = parseUpdateFlags([]);
    assert.equal(flags.check, false);
    assert.equal(flags.rollback, false);
    assert.equal(flags.force, false);
    assert.equal(flags.json, false);
  });

  it('ignores unknown flags', () => {
    const flags = parseUpdateFlags(['--verbose', '--dry-run']);
    assert.equal(flags.check, false);
    assert.equal(flags.rollback, false);
    assert.equal(flags.force, false);
    assert.equal(flags.json, false);
  });
});

describe('compareVersions', () => {
  it('detects update available when latest is newer', () => {
    assert.equal(compareVersions('0.1.0', '0.2.0'), 'update-available');
  });

  it('returns up-to-date for same versions', () => {
    assert.equal(compareVersions('1.2.3', '1.2.3'), 'up-to-date');
  });

  it('returns newer when local is ahead', () => {
    assert.equal(compareVersions('0.3.0', '0.2.0'), 'newer');
  });

  it('handles v prefix', () => {
    assert.equal(compareVersions('v0.1.0', 'v0.2.0'), 'update-available');
    assert.equal(compareVersions('v1.0.0', '1.0.0'), 'up-to-date');
  });

  it('handles missing patch version', () => {
    assert.equal(compareVersions('1.0', '1.0.0'), 'up-to-date');
    assert.equal(compareVersions('1.0', '1.1.0'), 'update-available');
  });
});

describe('parseChecksumFile', () => {
  it('parses standard checksum format', () => {
    const hash1 = 'a'.repeat(64);
    const hash2 = 'b'.repeat(64);
    const content = [
      `${hash1}  moxxy-gateway-darwin-arm64`,
      `${hash2}  moxxy-gateway-linux-x86_64`,
    ].join('\n');
    const result = parseChecksumFile(content);
    assert.equal(result['moxxy-gateway-darwin-arm64'], hash1);
    assert.equal(result['moxxy-gateway-linux-x86_64'], hash2);
  });

  it('returns empty object for empty string', () => {
    assert.deepEqual(parseChecksumFile(''), {});
  });

  it('skips malformed lines', () => {
    const content = 'not a valid checksum line\n\nabc123  too-short-hash';
    const result = parseChecksumFile(content);
    assert.deepEqual(result, {});
  });
});

describe('findAssetUrl', () => {
  const assets = [
    { name: 'moxxy-gateway-darwin-arm64', browser_download_url: 'https://example.com/darwin-arm64' },
    { name: 'moxxy-gateway-linux-x86_64', browser_download_url: 'https://example.com/linux-x86_64' },
    { name: 'checksums.sha256', browser_download_url: 'https://example.com/checksums' },
  ];

  it('finds matching platform asset', () => {
    assert.equal(findAssetUrl(assets, 'moxxy-gateway-darwin-arm64'), 'https://example.com/darwin-arm64');
  });

  it('returns null for missing platform', () => {
    assert.equal(findAssetUrl(assets, 'moxxy-gateway-windows-x86_64'), null);
  });
});

describe('findChecksumUrl', () => {
  it('finds checksums.sha256 asset', () => {
    const assets = [
      { name: 'moxxy-gateway-darwin-arm64', browser_download_url: 'https://example.com/binary' },
      { name: 'checksums.sha256', browser_download_url: 'https://example.com/checksums' },
    ];
    assert.equal(findChecksumUrl(assets), 'https://example.com/checksums');
  });

  it('returns null when no checksum asset', () => {
    const assets = [
      { name: 'moxxy-gateway-darwin-arm64', browser_download_url: 'https://example.com/binary' },
    ];
    assert.equal(findChecksumUrl(assets), null);
  });
});

describe('detectPlatform', () => {
  it('returns os, arch, and binaryName', () => {
    const result = detectPlatform();
    assert.ok(result.os);
    assert.ok(result.arch);
    assert.ok(result.binaryName);
  });

  it('binaryName matches expected pattern', () => {
    const result = detectPlatform();
    const pattern = /^moxxy-gateway-[a-z]+-[a-z0-9_]+$/;
    assert.match(result.binaryName, pattern);
    assert.equal(result.binaryName, `moxxy-gateway-${result.os}-${result.arch}`);
  });
});
