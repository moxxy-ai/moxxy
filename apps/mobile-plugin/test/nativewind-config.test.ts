import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

describe('mobile NativeWind configuration', () => {
  function loadBabelConfigFor(caller: { readonly isNodeModule?: boolean; readonly name?: string }) {
    const buildConfig = require(join(root, 'mobile', 'babel.config.cjs')) as (api: {
      caller: <T>(callback: (caller: { readonly isNodeModule?: boolean; readonly name?: string }) => T) => T;
    }) => unknown;

    return buildConfig({
      caller: (callback) => callback(caller),
    }) as {
      readonly plugins?: ReadonlyArray<unknown>;
      readonly presets?: ReadonlyArray<unknown>;
    };
  }

  it('lets Metro transform app JSX through Expo while NativeWind owns className styles', () => {
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

  it('keeps Expo dev JSX metadata out of app output so Metro can bundle NativeWind screens', () => {
    const babelPresetExpoRequire = createRequire(require.resolve('babel-preset-expo'));
    const babel = babelPresetExpoRequire('@babel/core') as typeof import('@babel/core');
    const configFile = join(root, 'mobile', 'babel.config.cjs');
    const inputFile = join(root, 'mobile', 'app', '_layout.tsx');

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

  it('installs the Expo Web interop shim before the router entrypoint', async () => {
    const entry = await readFile(join(root, 'mobile', 'index.ts'), 'utf8');
    const shimImport = "import './src/nativeWindWebInterop';";
    const routerImport = "import 'expo-router/entry';";

    expect(entry).toContain(shimImport);
    expect(entry.indexOf(shimImport)).toBeLessThan(entry.indexOf(routerImport));

    const shim = await readFile(join(root, 'mobile', 'src', 'nativeWindWebInterop.ts'), 'utf8');
    expect(shim).toContain('react-native-web/dist/exports/View');
    expect(shim).toContain('cssInterop');
  });

  it('keeps NativeWind wired through Metro so className styles are generated without duplicate JSX transforms', async () => {
    const metroConfig = await readFile(join(root, 'mobile', 'metro.config.cjs'), 'utf8');

    expect(metroConfig).toContain("require('nativewind/metro')");
    expect(metroConfig).toContain('withNativeWind(config');
    expect(metroConfig).toContain("input: './global.css'");
  });
});
