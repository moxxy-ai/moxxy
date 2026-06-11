import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tsconfigPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const mobileMetroConfigPath = fileURLToPath(new URL('../mobile/metro.config.cjs', import.meta.url));

describe('mobile gateway build config', () => {
  it('keeps the plugin runtime build independent from the nested Expo app', () => {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8')) as {
      include?: string[];
    };

    expect(tsconfig.include).toEqual(['serve.js', 'serve.d.ts', 'src/**/*.js']);
    expect(tsconfig.include?.some((entry) => entry.startsWith('mobile/'))).toBe(false);
    expect(tsconfig.include).not.toContain('test/**/*.ts');
  });

  it('keeps the full Expo app monorepo-aware with a single React instance', () => {
    const metroConfig = readFileSync(mobileMetroConfigPath, 'utf8');

    expect(metroConfig).toContain('watchFolders');
    expect(metroConfig).toContain('nodeModulesPaths');
    expect(metroConfig).toContain("const singletons = ['react', 'react-dom']");
    expect(metroConfig).toContain('resolveRequest');
  });
});
