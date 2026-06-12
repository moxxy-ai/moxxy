import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

describe('package manifest', () => {
  it('declares the mobile gateway as a hybrid ui cli Moxxy plugin', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

    expect(pkg).toMatchObject({
      name: '@moxxy/mobile-gateway-plugin',
      moxxy: {
        plugin: {
          entry: './serve.js',
          kind: ['ui', 'cli'],
          port: 17902,
          title: 'Moxxy Mobile Gateway',
          openInBrowser: false,
        },
      },
    });
  });

  it('declares native permissions required for LAN websocket pairing', async () => {
    const app = JSON.parse(await readFile(join(root, 'mobile', 'app.json'), 'utf8'));

    expect(app.expo.ios.infoPlist.NSLocalNetworkUsageDescription).toContain('local');
    expect(app.expo.plugins).toContainEqual([
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ]);
  });
});
