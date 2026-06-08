import { describe, expect, it } from 'vitest';
import {
  applyGitRef,
  buildInstallSpec,
  buildPluginActionOptions,
  INSTALLABLE_PLUGIN_CATALOG,
  formatPluginCatalogStatus,
  resolveCatalogEntry,
  resolveCatalogPackageName,
} from './catalog.js';

const entry = INSTALLABLE_PLUGIN_CATALOG[0];

describe('resolveCatalogEntry / resolveCatalogPackageName', () => {
  it('resolves by id and by package name', () => {
    expect(resolveCatalogEntry(entry.id)?.packageName).toBe(entry.packageName);
    expect(resolveCatalogEntry(entry.packageName)?.id).toBe(entry.id);
  });
  it('returns the target verbatim when unknown', () => {
    expect(resolveCatalogEntry('nope')).toBeUndefined();
    expect(resolveCatalogPackageName('@scope/unknown')).toBe('@scope/unknown');
  });
});

describe('applyGitRef', () => {
  it('appends a ref and replaces an existing one', () => {
    expect(applyGitRef('github:o/r', 'v1')).toBe('github:o/r#v1');
    expect(applyGitRef('github:o/r#main', 'v2')).toBe('github:o/r#v2');
  });
  it('strips a leading # and ignores an empty ref', () => {
    expect(applyGitRef('github:o/r', '#dev')).toBe('github:o/r#dev');
    expect(applyGitRef('github:o/r#main', '')).toBe('github:o/r#main');
  });
});

describe('buildInstallSpec', () => {
  it('uses the catalog installSpec for a known entry', () => {
    expect(buildInstallSpec({ target: entry.id })).toBe(entry.installSpec);
  });
  it('appends @version for a bare npm spec but never for git-like specs', () => {
    expect(buildInstallSpec({ target: '@scope/pkg', version: '1.2.3' })).toBe('@scope/pkg@1.2.3');
    expect(buildInstallSpec({ target: 'github:o/r', version: '1.2.3' })).toBe('github:o/r');
  });
  it('applies an explicit git ref', () => {
    expect(buildInstallSpec({ target: 'github:o/r', ref: 'feature' })).toBe('github:o/r#feature');
  });
});

describe('formatPluginCatalogStatus / buildPluginActionOptions', () => {
  const installed = new Set([entry.packageName]);
  const empty = new Set<string>();

  it('reports install status', () => {
    expect(formatPluginCatalogStatus(entry, empty, empty)).toContain('not installed');
    expect(formatPluginCatalogStatus(entry, installed, empty)).toContain('installed');
    expect(formatPluginCatalogStatus(entry, installed, installed)).toBe('disabled');
  });

  it('offers install when absent, and open/disable/remove when an installed UI plugin', () => {
    const absent = buildPluginActionOptions({ entry, installedPackageNames: empty, disabledPackageNames: empty });
    expect(absent.map((o) => o.value)).toEqual(['install', 'back']);

    const present = buildPluginActionOptions({ entry, installedPackageNames: installed, disabledPackageNames: empty });
    expect(present.map((o) => o.value)).toEqual(['open', 'disable', 'remove', 'back']);
  });
});
