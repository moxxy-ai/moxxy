import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  appDir,
  appStatus,
  installApp,
  isAllowedAssetUrl,
  resolveAssetDest,
  uninstallApp,
  type AppInstallSpec,
  type FetchLike,
} from './installer';
import type { AppInstallProgress } from '@moxxy/desktop-ipc-contract';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-apps-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A `fetch` stub backed by an in-memory `url → bytes` map. Each call returns a
 *  real web `Response` (so the installer's `.body.getReader()` /
 *  `headers.get('content-length')` work unchanged). */
function fakeFetch(files: Record<string, string>): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = files[url];
    if (body === undefined) return new Response(null, { status: 404 });
    const bytes = Buffer.from(body, 'utf8');
    return new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.byteLength) },
    });
  }) as FetchLike;
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('resolveAssetDest containment', () => {
  it('rejects a `..` traversal dest', () => {
    expect(() => resolveAssetDest(path.join(root, 'anonymizer'), '../x')).toThrow(/escapes/);
  });
  it('rejects an absolute dest', () => {
    expect(() => resolveAssetDest(path.join(root, 'anonymizer'), '/etc/passwd')).toThrow(
      /must be relative/,
    );
  });
  it('rejects a NUL byte', () => {
    expect(() => resolveAssetDest(path.join(root, 'anonymizer'), 'a\0b')).toThrow(/NUL/);
  });
  it('accepts a nested relative dest', () => {
    const dir = path.join(root, 'anonymizer');
    expect(resolveAssetDest(dir, 'onnx/model.onnx')).toBe(path.join(dir, 'onnx/model.onnx'));
  });
});

describe('appDir', () => {
  it('rejects an unsafe app id', () => {
    expect(() => appDir(root, '../evil')).toThrow(/invalid app id/);
    expect(() => appDir(root, 'Foo')).toThrow(/invalid app id/);
  });
});

describe('install ↔ status lifecycle', () => {
  const spec: AppInstallSpec = {
    id: 'anonymizer',
    version: 'v1',
    assets: [
      { url: 'https://huggingface.co/config.json', dest: 'config.json' },
      { url: 'https://huggingface.co/onnx/model.onnx', dest: 'onnx/model.onnx' },
    ],
  };

  it('reports not-installed before install', async () => {
    expect(await appStatus(spec, root)).toEqual({ appId: 'anonymizer', state: 'not-installed' });
  });

  it('downloads every asset, writes the marker, and flips to installed', async () => {
    const fetchImpl = fakeFetch({
      'https://huggingface.co/config.json': '{"k":1}',
      'https://huggingface.co/onnx/model.onnx': 'ONNXBYTES',
    });
    const phases: AppInstallProgress['phase'][] = [];
    const status = await installApp(spec, root, (p) => phases.push(p.phase), fetchImpl);

    expect(status).toEqual({ appId: 'anonymizer', state: 'installed', version: 'v1' });
    expect(phases).toContain('downloading');
    expect(phases.at(-1)).toBe('done');
    expect(await readFile(path.join(root, 'anonymizer', 'config.json'), 'utf8')).toBe('{"k":1}');
    expect(await readFile(path.join(root, 'anonymizer', 'onnx/model.onnx'), 'utf8')).toBe(
      'ONNXBYTES',
    );
    expect(await appStatus(spec, root)).toEqual({
      appId: 'anonymizer',
      state: 'installed',
      version: 'v1',
    });
  });

  it('a version mismatch in the marker reports not-installed', async () => {
    const fetchImpl = fakeFetch({
      'https://huggingface.co/config.json': '{"k":1}',
      'https://huggingface.co/onnx/model.onnx': 'ONNXBYTES',
    });
    await installApp(spec, root, () => {}, fetchImpl);
    // The same files but the spec now wants a newer version.
    const bumped: AppInstallSpec = { ...spec, version: 'v2' };
    expect((await appStatus(bumped, root)).state).toBe('not-installed');
  });

  it('a missing asset file reports not-installed even with a matching marker', async () => {
    const fetchImpl = fakeFetch({
      'https://huggingface.co/config.json': '{"k":1}',
      'https://huggingface.co/onnx/model.onnx': 'ONNXBYTES',
    });
    await installApp(spec, root, () => {}, fetchImpl);
    await rm(path.join(root, 'anonymizer', 'onnx/model.onnx'));
    expect((await appStatus(spec, root)).state).toBe('not-installed');
  });

  it('uninstall removes the dir and reports not-installed', async () => {
    const fetchImpl = fakeFetch({
      'https://huggingface.co/config.json': '{"k":1}',
      'https://huggingface.co/onnx/model.onnx': 'ONNXBYTES',
    });
    await installApp(spec, root, () => {}, fetchImpl);
    expect(await uninstallApp('anonymizer', root)).toEqual({
      appId: 'anonymizer',
      state: 'not-installed',
    });
    expect((await appStatus(spec, root)).state).toBe('not-installed');
  });
});

describe('integrity verification', () => {
  it('a sha256 mismatch returns an error status and writes no file', async () => {
    const spec: AppInstallSpec = {
      id: 'anonymizer',
      version: 'v1',
      assets: [{ url: 'https://huggingface.co/a.bin', dest: 'a.bin', sha256: sha256('EXPECTED') }],
    };
    const fetchImpl = fakeFetch({ 'https://huggingface.co/a.bin': 'WRONG' });
    const phases: AppInstallProgress['phase'][] = [];
    const status = await installApp(spec, root, (p) => phases.push(p.phase), fetchImpl);

    expect(status.state).toBe('error');
    expect(status.error).toMatch(/integrity check failed/);
    expect(phases).toContain('verifying');
    expect(phases.at(-1)).toBe('error');
    // No file published, no marker → still not-installed.
    expect((await appStatus(spec, root)).state).toBe('not-installed');
  });

  it('a matching sha256 installs and a re-run skips the verified asset', async () => {
    const spec: AppInstallSpec = {
      id: 'anonymizer',
      version: 'v1',
      assets: [{ url: 'https://huggingface.co/a.bin', dest: 'a.bin', sha256: sha256('GOOD') }],
    };
    const fetchImpl = fakeFetch({ 'https://huggingface.co/a.bin': 'GOOD' });
    expect((await installApp(spec, root, () => {}, fetchImpl)).state).toBe('installed');

    // A re-run with a fetch that would FAIL proves the present+correct asset is
    // skipped (idempotent install).
    const wouldThrow: FetchLike = (() => {
      throw new Error('should not be called — asset already present');
    }) as FetchLike;
    expect((await installApp(spec, root, () => {}, wouldThrow)).state).toBe('installed');
  });
});

describe('partial-install resume', () => {
  it('a leftover .partial does not satisfy status; re-install completes', async () => {
    const spec: AppInstallSpec = {
      id: 'anonymizer',
      version: 'v1',
      assets: [{ url: 'https://huggingface.co/a.bin', dest: 'a.bin' }],
    };
    // Simulate a crash mid-download: only the .partial exists.
    await mkdir(path.join(root, 'anonymizer'), { recursive: true });
    await writeFile(path.join(root, 'anonymizer', 'a.bin.partial'), 'half');
    expect((await appStatus(spec, root)).state).toBe('not-installed');

    const fetchImpl = fakeFetch({ 'https://huggingface.co/a.bin': 'FULL' });
    expect((await installApp(spec, root, () => {}, fetchImpl)).state).toBe('installed');
    expect(await readFile(path.join(root, 'anonymizer', 'a.bin'), 'utf8')).toBe('FULL');
  });
});

describe('download-source allow-list (SSRF / egress guard)', () => {
  it('isAllowedAssetUrl admits https on huggingface.co + its CDN, refuses everything else', () => {
    expect(isAllowedAssetUrl('https://huggingface.co/Xenova/x/resolve/main/config.json')).toBe(true);
    expect(isAllowedAssetUrl('https://us.aws.cdn.hf.co/xet-bridge-us/abc')).toBe(true);
    // Non-https, internal hosts, file scheme, and look-alike domains are all refused.
    expect(isAllowedAssetUrl('http://huggingface.co/x')).toBe(false);
    expect(isAllowedAssetUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedAssetUrl('https://localhost/x')).toBe(false);
    expect(isAllowedAssetUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedAssetUrl('https://huggingface.co.evil.test/x')).toBe(false);
    expect(isAllowedAssetUrl('not a url')).toBe(false);
  });

  it('refuses to fetch an asset whose url is off-allow-list — no bytes touch the network', async () => {
    const spec: AppInstallSpec = {
      id: 'anonymizer',
      version: 'v1',
      // A url that the allow-list rejects (SSRF target / internal metadata host).
      assets: [{ url: 'http://169.254.169.254/secret', dest: 'a.bin' }],
    };
    let fetched = false;
    const spyFetch: FetchLike = (async () => {
      fetched = true;
      return new Response('SHOULD NEVER BE READ', { status: 200 });
    }) as FetchLike;

    const status = await installApp(spec, root, () => {}, spyFetch);
    expect(status.state).toBe('error');
    expect(status.error).toMatch(/not on an allowed host/);
    // The gate fires BEFORE the network call — fetch is never reached.
    expect(fetched).toBe(false);
    // Nothing written, marker absent.
    expect((await appStatus(spec, root)).state).toBe('not-installed');
  });
});

describe('download size cap (disk-fill DoS guard)', () => {
  const spec: AppInstallSpec = {
    id: 'anonymizer',
    version: 'v1',
    assets: [{ url: 'https://huggingface.co/big.bin', dest: 'big.bin' }],
  };

  it('rejects up front when content-length declares more than the cap', async () => {
    // Honest server: a content-length larger than the cap is refused before the
    // body is read.
    const cap = 8;
    const oversized: FetchLike = (async () =>
      new Response('x'.repeat(4), {
        status: 200,
        headers: { 'content-length': '999' },
      })) as FetchLike;
    const status = await installApp(spec, root, () => {}, oversized, cap);
    expect(status.state).toBe('error');
    expect(status.error).toMatch(/exceeds the 8-byte cap/);
    expect((await appStatus(spec, root)).state).toBe('not-installed');
  });

  it('aborts mid-stream when a lying / chunked server streams past the cap, leaving no large partial', async () => {
    const cap = 4;
    // No content-length (chunked); the body is bigger than the cap, so only the
    // streaming guard can catch it.
    const lying: FetchLike = (async () =>
      new Response('0123456789', { status: 200 })) as FetchLike;
    const status = await installApp(spec, root, () => {}, lying, cap);
    expect(status.state).toBe('error');
    expect(status.error).toMatch(/exceeds the 4-byte cap mid-stream/);
    // The aborted .partial must be cleaned up (don't strand a near-cap file).
    expect((await appStatus(spec, root)).state).toBe('not-installed');
    await expect(readFile(path.join(root, 'anonymizer', 'big.bin.partial'))).rejects.toThrow();
  });

  it('a download exactly at the cap still installs', async () => {
    const cap = 5;
    const exact = fakeFetch({ 'https://huggingface.co/big.bin': 'GROWS' }); // 5 bytes
    const status = await installApp(spec, root, () => {}, exact, cap);
    expect(status.state).toBe('installed');
    expect(await readFile(path.join(root, 'anonymizer', 'big.bin'), 'utf8')).toBe('GROWS');
  });
});
