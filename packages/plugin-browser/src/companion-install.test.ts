import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(
    readFileSync(new URL(`../../${packageDir}/package.json`, import.meta.url), 'utf8'),
  ) as PackageManifest;
}

describe('native web-search provider companion install', () => {
  it.each([
    'plugin-provider-anthropic',
    'plugin-provider-openai-codex',
    'plugin-provider-claude-code',
  ])('%s installs the local browser fallback', (packageDir) => {
    expect(readManifest(packageDir).dependencies?.['@moxxy/plugin-browser']).toBe('workspace:*');
  });

  it('keeps the automatic fallback lightweight until interactive browsing is requested', () => {
    const browser = readManifest('plugin-browser');
    expect(browser.dependencies).not.toHaveProperty('playwright');
    expect(browser.peerDependencies?.playwright).toBeDefined();
    expect(browser.peerDependenciesMeta?.playwright?.optional).toBe(true);
    expect(browser.scripts).not.toHaveProperty('postinstall');
  });
});
