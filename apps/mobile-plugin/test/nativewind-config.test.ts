import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

describe('mobile NativeWind configuration', () => {
  it('routes Expo JSX through NativeWind so className styles render on web', () => {
    const babel = require(join(root, 'mobile', 'babel.config.cjs'));

    expect(babel.presets).toContain('nativewind/babel');
    expect(babel.presets).toContainEqual([
      'babel-preset-expo',
      expect.objectContaining({ jsxImportSource: 'nativewind' }),
    ]);
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
