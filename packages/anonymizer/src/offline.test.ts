/**
 * The offline guarantee, codified. If this fails, the engine has grown a way to
 * reach the network (a dependency or a network API) and is no longer provably
 * offline — so the desktop's "documents never leave your machine" claim breaks.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

describe('offline guarantee', () => {
  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('source references no network or filesystem API', () => {
    const banned: Array<[RegExp, string]> = [
      [/\bfetch\s*\(/, 'fetch()'],
      [/XMLHttpRequest/, 'XMLHttpRequest'],
      [/\bWebSocket\b/, 'WebSocket'],
      [/\bEventSource\b/, 'EventSource'],
      [/node:https?\b/, 'node:http(s)'],
      [/node:net\b/, 'node:net'],
      [/node:dns\b/, 'node:dns'],
      [/node:tls\b/, 'node:tls'],
      [/node:fs\b/, 'node:fs'],
      [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
    ];
    const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const content = readFileSync(path.join(here, file), 'utf8');
      for (const [re, label] of banned) {
        expect(content, `${file} must not reference ${label}`).not.toMatch(re);
      }
    }
  });
});
