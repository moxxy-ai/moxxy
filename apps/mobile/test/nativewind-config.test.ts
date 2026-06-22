import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mobileRoot = root;
const require = createRequire(import.meta.url);

const bannedStylePatterns = [
  { label: 'className prop', pattern: /className\s*=/ },
  { label: 'NativeWind runtime', pattern: /nativewind/i },
  { label: 'NativeWind Metro wrapper', pattern: /withNativeWind/ },
  { label: 'CSS interop', pattern: /cssInterop/ },
  { label: 'remap props interop', pattern: /remapProps/ },
  { label: 'Tailwind runtime', pattern: /tailwind/i },
  { label: 'global CSS import', pattern: /global\.css/ },
] as const;

const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs', '.json']);
const sourceRoots = [
  join(mobileRoot, 'app'),
  join(mobileRoot, 'src'),
  join(mobileRoot, 'babel.config.cjs'),
  join(mobileRoot, 'metro.config.cjs'),
  join(mobileRoot, 'package.json'),
  join(mobileRoot, 'tsconfig.json'),
] as const;

async function listFiles(path: string): Promise<string[]> {
  const entryStat = await stat(path);
  if (entryStat.isFile()) return sourceExtensions.has(extname(path)) ? [path] : [];

  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'ios')
      .map((entry) => listFiles(join(path, entry.name))),
  );
  return nested.flat();
}

describe('mobile StyleSheet configuration', () => {
  function loadBabelConfigFor(caller: { readonly isNodeModule?: boolean; readonly name?: string }) {
    const buildConfig = require(join(mobileRoot, 'babel.config.cjs')) as (api: {
      caller: <T>(callback: (caller: { readonly isNodeModule?: boolean; readonly name?: string }) => T) => T;
    }) => unknown;

    return buildConfig({
      caller: (callback) => callback(caller),
    }) as {
      readonly plugins?: ReadonlyArray<unknown>;
      readonly presets?: ReadonlyArray<unknown>;
    };
  }

  it('lets Metro transform app JSX through Expo without a style compiler', () => {
    const babel = loadBabelConfigFor({ name: 'metro' });

    expect(babel.plugins).toHaveLength(1);
    expect(babel.presets).toEqual([['babel-preset-expo', { jsxRuntime: 'classic' }]]);
    expect(babel.presets).not.toContain('nativewind/babel');
  });

  it('keeps an Expo preset fallback for non-Metro transforms', () => {
    const babel = loadBabelConfigFor({});

    expect(babel.plugins).toHaveLength(1);
    expect(babel.presets).toEqual([['babel-preset-expo', { jsxRuntime: 'classic' }]]);
    expect(babel.presets).not.toContain('nativewind/babel');
  });

  it('does not run app JSX transforms over node_modules during embedded iOS bundling', () => {
    const babel = loadBabelConfigFor({ isNodeModule: true });

    expect(babel.presets ?? []).toEqual([]);
  });

  it('keeps Expo dev JSX metadata out of app output so Metro can bundle mobile screens', () => {
    const babelPresetExpoRequire = createRequire(require.resolve('babel-preset-expo'));
    const babel = babelPresetExpoRequire('@babel/core') as {
      transformFileSync: (
        filename: string,
        opts: Record<string, unknown>,
      ) => { code?: string | null } | null;
    };
    const configFile = join(mobileRoot, 'babel.config.cjs');
    const inputFile = join(mobileRoot, 'app', '_layout.tsx');

    const result = babel.transformFileSync(inputFile, {
      babelrc: false,
      caller: {
        bundler: 'metro',
        engine: 'hermes',
        isDev: true,
        isServer: false,
        name: 'metro',
        platform: 'ios',
      },
      configFile,
      filename: inputFile,
    });
    const code = result?.code ?? '';

    expect(code).toContain('React.createElement');
    expect(code).not.toContain('__self');
    expect(code).not.toContain('__source');
  });

  it('loads the Expo Router entrypoint without a web style interop shim', async () => {
    const entry = await readFile(join(mobileRoot, 'index.ts'), 'utf8');

    expect(entry).toContain("import 'expo-router/entry';");
    expect(entry).not.toContain('nativeWindWebInterop');
    expect(entry).not.toContain('global.css');
  });

  it('keeps Metro plain Expo-managed so runtime styles come from React Native StyleSheet', async () => {
    const metroConfig = await readFile(join(mobileRoot, 'metro.config.cjs'), 'utf8');

    expect(metroConfig).toContain('getDefaultConfig');
    expect(metroConfig).not.toContain("require('nativewind/metro')");
    expect(metroConfig).not.toContain('withNativeWind');
    expect(metroConfig).not.toContain('global.css');
  });

  it('does not keep legacy style compiler files around', () => {
    const removedFiles = [
      'global.css',
      'tailwind.config.ts',
      'nativewind-env.d.ts',
      'nativewind-preset.d.ts',
      join('src', 'nativeWindWebInterop.ts'),
    ];

    for (const file of removedFiles) {
      expect(existsSync(join(mobileRoot, file)), file).toBe(false);
    }
  });

  it('does not depend on NativeWind, Tailwind, or React Native CSS interop packages', async () => {
    const pkg = JSON.parse(await readFile(join(mobileRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(deps).not.toHaveProperty('nativewind');
    expect(deps).not.toHaveProperty('tailwindcss');
    expect(deps).not.toHaveProperty('react-native-css-interop');
    expect(deps).not.toHaveProperty('react-native-css');
  });

  it('keeps mobile source free of NativeWind and className styling hooks', async () => {
    const files = (await Promise.all(sourceRoots.map((path) => listFiles(path)))).flat();
    const failures: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const banned of bannedStylePatterns) {
        if (banned.pattern.test(source)) {
          failures.push(`${relative(mobileRoot, file)} contains ${banned.label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
