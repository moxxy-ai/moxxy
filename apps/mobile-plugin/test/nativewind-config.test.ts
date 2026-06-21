import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

describe('mobile NativeWind configuration', () => {
  function loadBabelConfigFor(isNodeModule: boolean) {
    const buildConfig = require(join(root, 'mobile', 'babel.config.cjs')) as (api: {
      caller: <T>(callback: (caller: { readonly isNodeModule?: boolean }) => T) => T;
    }) => unknown;

    return buildConfig({
      caller: (callback) => callback({ isNodeModule }),
    }) as {
      readonly presets?: ReadonlyArray<unknown>;
    };
  }

  it('routes app JSX through Expo and NativeWind so className styles render on iOS', () => {
    const babel = loadBabelConfigFor(false);

    expect(babel.presets).toEqual([
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ]);
  });

  it('does not run app JSX transforms over node_modules during embedded iOS bundling', () => {
    const babel = loadBabelConfigFor(true);

    expect(babel.presets ?? []).toEqual([]);
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
});
