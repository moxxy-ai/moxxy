import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Expo Go compatibility', () => {
  it('targets the Expo Go 54 runtime available on the test phone', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));

    expect(pkg.dependencies.expo).toMatch(/^~54\./);
    expect(pkg.dependencies.react).toMatch(/^\^?19\.1\./);
    expect(pkg.dependencies['react-native']).toMatch(/^\^?0\.81\./);
    expect(pkg.dependencies['expo-router']).toMatch(/^~6\.0\./);
  });

  it('declares native microphone recording support for Expo Go', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const app = JSON.parse(await readFile(join(process.cwd(), 'app.json'), 'utf8'));

    expect(pkg.dependencies['expo-audio']).toMatch(/^~1\./);
    expect(pkg.dependencies['expo-file-system']).toMatch(/^~19\./);
    expect(app.expo.plugins).toEqual(expect.arrayContaining([
      [
        'expo-audio',
        expect.objectContaining({
          microphonePermission: expect.stringContaining('Moxxy'),
        }),
      ],
    ]));
  });

  it('declares native camera scanning support for Expo Go QR pairing', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const app = JSON.parse(await readFile(join(process.cwd(), 'app.json'), 'utf8'));

    expect(pkg.dependencies['expo-camera']).toMatch(/^~17\./);
    expect(app.expo.plugins).toEqual(expect.arrayContaining([
      [
        'expo-camera',
        expect.objectContaining({
          cameraPermission: expect.stringContaining('Moxxy'),
        }),
      ],
    ]));
  });

  it('declares native media and document pickers for prompt attachments', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    const app = JSON.parse(await readFile(join(process.cwd(), 'app.json'), 'utf8'));

    expect(pkg.dependencies['expo-image-picker']).toMatch(/^~17\./);
    expect(pkg.dependencies['expo-document-picker']).toMatch(/^~14\./);
    expect(app.expo.plugins).toEqual(expect.arrayContaining([
      [
        'expo-image-picker',
        expect.objectContaining({
          photosPermission: expect.stringContaining('screenshots'),
        }),
      ],
    ]));
  });

  it('uses a CommonJS Metro config extension when the mobile package is ESM', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));

    expect(pkg.type).toBe('module');
    await expect(access(join(process.cwd(), 'metro.config.cjs'), constants.F_OK)).resolves.toBeUndefined();
    await expect(access(join(process.cwd(), 'metro.config.js'), constants.F_OK)).rejects.toThrow();
  });

  it('loads Metro config from the installed Expo package', async () => {
    const metroConfig = await readFile(join(process.cwd(), 'metro.config.cjs'), 'utf8');

    expect(metroConfig).toContain("require('expo/metro-config')");
    expect(metroConfig).not.toContain("require('@expo/metro-config')");
  });
});
