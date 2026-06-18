import { describe, expect, it, vi } from 'vitest';

import type { AppManifest } from '@moxxy/desktop-app-sdk';

import { dispatchBridge, type BridgeServices } from './bridge-host';

const manifest = (permissions: AppManifest['permissions']): AppManifest => ({
  manifestVersion: 1,
  id: 'demo',
  name: 'Demo',
  description: 'd',
  icon: 'sparkles',
  version: '1.0.0',
  ui: { entry: 'index.html' },
  permissions,
});

const services = (): BridgeServices => ({
  'documents.open': vi.fn(async () => ({ text: 'hello', name: 'a.txt' })),
  'documents.save': vi.fn(async () => ({ path: '/tmp/out.txt' })),
  'anonymizer.detect': vi.fn(async () => ({ spans: [] })),
});

describe('dispatchBridge (capability gate)', () => {
  it('refuses a method whose permission the app did not declare', async () => {
    const svc = services();
    const r = await dispatchBridge(manifest([]), 'documents.open', undefined, svc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('not permitted');
    expect(svc['documents.open']).not.toHaveBeenCalled(); // never ran
  });

  it('dispatches a granted method to its service', async () => {
    const svc = services();
    const r = await dispatchBridge(manifest(['documents.open']), 'documents.open', undefined, svc);
    expect(r).toEqual({ ok: true, result: { text: 'hello', name: 'a.txt' } });
    expect(svc['documents.open']).toHaveBeenCalledOnce();
  });

  it('refuses an unknown / forged method name', async () => {
    const r = await dispatchBridge(manifest(['documents.open']), 'fs.readAll', undefined, services());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('unknown bridge method');
  });

  it('passes params through to documents.save and returns its result', async () => {
    const svc = services();
    const r = await dispatchBridge(
      manifest(['documents.save']),
      'documents.save',
      { suggestedName: 'redacted.txt', content: 'x' },
      svc,
    );
    expect(r).toEqual({ ok: true, result: { path: '/tmp/out.txt' } });
    expect(svc['documents.save']).toHaveBeenCalledWith({ suggestedName: 'redacted.txt', content: 'x' });
  });

  it('turns a service error into a clean { ok:false } (never throws)', async () => {
    const svc = services();
    svc['anonymizer.detect'] = vi.fn(async () => {
      throw new Error('engine boom');
    });
    const r = await dispatchBridge(manifest(['anonymizer.engine']), 'anonymizer.detect', { text: 'x' }, svc);
    expect(r).toEqual({ ok: false, error: 'engine boom' });
  });

  it('grant of one capability does not imply another', async () => {
    // App declared documents.open but tries documents.save → refused.
    const svc = services();
    const r = await dispatchBridge(
      manifest(['documents.open']),
      'documents.save',
      { suggestedName: 'x', content: 'y' },
      svc,
    );
    expect(r.ok).toBe(false);
    expect(svc['documents.save']).not.toHaveBeenCalled();
  });
});
