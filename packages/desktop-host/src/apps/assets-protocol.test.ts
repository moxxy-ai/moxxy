import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// assets-protocol imports `electron` (for protocol.handle); stub it so the pure
// `resolveAssetRequest` logic is unit-testable without the runtime.
vi.mock('electron', () => ({ protocol: { handle: () => undefined } }));

import { resolveAssetRequest } from './assets-protocol';

let root: string;
let appRoot: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-asset-test-'));
  appRoot = path.join(root, 'anonymizer');
  await mkdir(path.join(appRoot, 'onnx'), { recursive: true });
  await writeFile(path.join(appRoot, 'config.json'), '{"k":1}');
  await writeFile(path.join(appRoot, 'onnx', 'model.onnx'), 'BYTES');
  // A secret OUTSIDE the apps root that traversal attempts target.
  await writeFile(path.join(root, 'secret.txt'), 'TOP SECRET');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('resolveAssetRequest', () => {
  it('resolves a real nested asset', () => {
    const abs = resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/onnx/model.onnx');
    expect(abs).toBe(path.join(appRoot, 'onnx/model.onnx'));
  });

  it('resolves a top-level asset', () => {
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/config.json')).toBe(
      path.join(appRoot, 'config.json'),
    );
  });

  it('rejects a wrong host bucket', () => {
    expect(resolveAssetRequest(root, 'moxxy-app://other/anonymizer/config.json')).toBeNull();
  });

  it('rejects an unsafe app id', () => {
    expect(resolveAssetRequest(root, 'moxxy-app://assets/Foo/config.json')).toBeNull();
  });

  it('rejects an empty rest', () => {
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/')).toBeNull();
  });

  it('rejects a `..` traversal that escapes the app dir', () => {
    // `..%2f` decodes to `../`; the resolved path lands at root/secret.txt,
    // outside the app dir → null.
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/..%2f..%2fsecret.txt')).toBeNull();
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/../secret.txt')).toBeNull();
  });

  it('rejects a NUL byte', () => {
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/config%00.json')).toBeNull();
  });

  it('returns null for a missing file', () => {
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/nope.json')).toBeNull();
  });

  it('rejects a symlink that escapes the app dir', async () => {
    // A symlink INSIDE the app dir pointing at the outside secret must not be
    // served (realpath-escape insurance).
    await symlink(path.join(root, 'secret.txt'), path.join(appRoot, 'leak.txt'));
    expect(resolveAssetRequest(root, 'moxxy-app://assets/anonymizer/leak.txt')).toBeNull();
  });
});
