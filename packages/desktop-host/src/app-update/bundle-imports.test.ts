/**
 * A hot-update bundle is only `dist/` + `dist-electron/` staged under
 * `<userData>/app/<version>/` — no `node_modules`. A main that imports a
 * package from outside the bundle dies at boot ("Cannot find package 'zod'")
 * and every update is reverted, so the builder refuses to produce one.
 */

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAppBundle } from './build.js';
import { unbundledImports } from './bundle-imports.js';

const js = (code: string) => Buffer.from(code, 'utf8');

describe('unbundledImports', () => {
  it('names packages the main imports but the bundle does not carry', () => {
    const files = {
      'dist-electron/main/index.js': js(`import { z } from "zod";\nimport OpenAI from 'openai';\nimport { app } from "electron";import{x}from"electron-updater";`),
      'dist-electron/main/chunks/a.js': js(`const u = await import("electron-updater");\nconst r = require('zod');`),
      'dist-electron/preload/index.cjs': js(`const q = require("qrcode");`),
    };

    expect(unbundledImports(files)).toEqual(['electron-updater', 'openai', 'qrcode', 'zod']);
  });

  it("allows Node built-ins, electron, the bundle's own files and guarded optional natives", () => {
    const files = {
      'dist-electron/main/index.js': js(
        `import fs from "fs";\nimport path from "node:path";\nimport { app } from "electron";\nimport "./chunks/a.js";\n` +
          `try { await import("@napi-rs/keyring"); } catch {}\ntry { require("bufferutil"); } catch {}`,
      ),
    };

    expect(unbundledImports(files)).toEqual([]);
  });

  it('ignores code and prose that only looks like an import', () => {
    const files = {
      'dist-electron/main/index.js': js(
        'const p = `a message from "human" or read from "vault"`;\n' +
          'const wrapper = `await import("${url}");`;\n' +
          'const types = ["import", "remerge"];\n' +
          'const vault = ctx.services.require("vault");\n' +
          "throw new Error(`you must \\`import 'openai/shims/${kind}'\\` first`);\n" +
          "/**\n * or add `import 'openai/shims/node'` before your first import\n */",
      ),
    };

    expect(unbundledImports(files)).toEqual([]);
  });

  it('only reads the main and preload code, not renderer assets', () => {
    const files = { 'dist/assets/index.js': js(`import x from "react";`) };

    expect(unbundledImports(files)).toEqual([]);
  });
});

describe('buildAppBundle', () => {
  it('refuses a bundle whose main imports a package it does not carry', () => {
    const { privateKey } = generateKeyPairSync('ed25519');

    expect(() =>
      buildAppBundle({
        version: '0.0.7',
        minElectron: '33.0.0',
        nodeAbi: '',
        bundleUrl: 'https://example.invalid/bundle.json.gz',
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        files: { 'dist/index.html': js('<html>'), 'dist-electron/main/index.js': js(`import { z } from "zod";`) },
      }),
    ).toThrow(/zod/);
  });
});
