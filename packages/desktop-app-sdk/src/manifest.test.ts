import { describe, expect, it } from 'vitest';

import { parseAppManifest, appManifestSchema } from './manifest';

const VALID = {
  manifestVersion: 1,
  id: 'my-app',
  name: 'My App',
  description: 'Does a thing.',
  icon: 'sparkles',
  version: '1.0.0',
  permissions: ['documents.open'],
};

describe('parseAppManifest', () => {
  it('accepts a minimal valid manifest and fills UI/permission defaults', () => {
    const r = parseAppManifest(JSON.stringify({ ...VALID, permissions: undefined }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.ui.entry).toBe('index.html'); // default
    expect(r.manifest.permissions).toEqual([]); // default
  });

  it('reports malformed JSON cleanly', () => {
    expect(parseAppManifest('{not json')).toEqual({ ok: false, error: 'manifest is not valid JSON' });
  });

  it('rejects a bad id (path-unsafe)', () => {
    const r = parseAppManifest(JSON.stringify({ ...VALID, id: '../evil' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('id');
  });

  it('rejects an unknown permission', () => {
    const r = parseAppManifest(JSON.stringify({ ...VALID, permissions: ['fs.readAll'] }));
    expect(r.ok).toBe(false);
  });

  it('rejects unknown top-level fields (strict schema)', () => {
    const r = parseAppManifest(JSON.stringify({ ...VALID, danger: true }));
    expect(r.ok).toBe(false);
  });

  it('rejects a traversal in ui.entry', () => {
    const r = parseAppManifest(JSON.stringify({ ...VALID, ui: { entry: '../../etc/passwd' } }));
    expect(r.ok).toBe(false);
  });

  it('requires allowedHosts when install assets are present', () => {
    const r = parseAppManifest(
      JSON.stringify({
        ...VALID,
        install: { version: 'v1', assets: [{ url: 'https://x.co/a', dest: 'a' }] },
      }),
    );
    expect(r.ok).toBe(false); // allowedHosts missing
  });

  it('accepts an install bundle with assets + allowedHosts', () => {
    const r = parseAppManifest(
      JSON.stringify({
        ...VALID,
        permissions: ['anonymizer.engine'],
        install: {
          version: 'model-v1',
          assets: [{ url: 'https://huggingface.co/m/resolve/main/model.onnx', dest: 'model.onnx' }],
          allowedHosts: ['huggingface.co'],
        },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an absolute asset dest', () => {
    const parsed = appManifestSchema.safeParse({
      ...VALID,
      install: { version: 'v1', assets: [{ url: 'https://x.co/a', dest: '/etc/passwd' }], allowedHosts: ['x.co'] },
    });
    expect(parsed.success).toBe(false);
  });

  const withAllowedHosts = (hosts: unknown) => ({
    ...VALID,
    permissions: ['anonymizer.engine'],
    install: {
      version: 'v1',
      assets: [{ url: 'https://huggingface.co/m/resolve/main/model.onnx', dest: 'model.onnx' }],
      allowedHosts: hosts,
    },
  });

  it('accepts a plain hostname in allowedHosts', () => {
    const parsed = appManifestSchema.safeParse(withAllowedHosts(['huggingface.co', 'sub.hf.co']));
    expect(parsed.success).toBe(true);
  });

  // The installer regex-escapes each allowedHost, so anything that isn't a bare
  // hostname either matches nothing or is misread as broader than it looks —
  // reject it at parse time so the auditable egress promise is honest.
  it.each([
    ['*', 'wildcard'],
    ['*.huggingface.co', 'leading-wildcard'],
    ['https://huggingface.co', 'scheme'],
    ['huggingface.co:443', 'port'],
    ['huggingface.co/resolve', 'path'],
    ['.huggingface.co', 'leading dot'],
    ['huggingface.co.', 'trailing dot'],
    ['hugging face.co', 'whitespace'],
    ['127.0.0.1', 'raw IPv4'],
    ['', 'empty'],
  ])('rejects %s allowedHost (%s)', (bad) => {
    const parsed = appManifestSchema.safeParse(withAllowedHosts([bad]));
    expect(parsed.success).toBe(false);
  });
});
