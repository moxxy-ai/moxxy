import { describe, expect, it, vi } from 'vitest';
import { validateKey } from './validate.js';

describe('anthropic validateKey', () => {
  it('rejects empty/short keys without any network call', async () => {
    const make = vi.fn();
    const res = await validateKey('', { client: make as never });
    expect(res).toEqual({ ok: false, message: 'key looks too short' });
    expect(make).not.toHaveBeenCalled();
  });

  it('success path issues a 1-token messages.create', async () => {
    const create = vi.fn().mockResolvedValue({});
    const make = vi.fn().mockReturnValue({ messages: { create } });
    const res = await validateKey('sk-ant-very-long-test-key', { client: make });
    expect(res).toEqual({ ok: true });
    expect(make).toHaveBeenCalledWith('sk-ant-very-long-test-key');
    expect(create).toHaveBeenCalledOnce();
    const args = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.max_tokens).toBe(1);
  });

  it('SDK throw → ok:false with the underlying message', async () => {
    const make = () => ({
      messages: {
        create: async () => {
          throw new Error('401 invalid api key');
        },
      },
    });
    const res = await validateKey('sk-ant-bad-but-long-enough', { client: make });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('401');
  });

  it('respects model override', async () => {
    const create = vi.fn().mockResolvedValue({});
    const make = () => ({ messages: { create } });
    await validateKey('sk-ant-key-of-reasonable-length', { client: make, model: 'claude-opus-4-7' });
    const args = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.model).toBe('claude-opus-4-7');
  });

  it('maps a 401 to a fixed friendly message (no raw SDK text echoed)', async () => {
    const make = () => ({
      messages: {
        create: async () => {
          throw Object.assign(new Error('GET https://proxy.internal/v1 401 x-api-key=...'), { status: 401 });
        },
      },
    });
    const res = await validateKey('sk-ant-some-long-enough-key', { client: make });
    expect(res).toEqual({ ok: false, message: 'key was rejected' });
  });

  it('scrubs the key from a fallback (status-less) error message', async () => {
    const key = 'sk-ant-secret-but-long-enough';
    const make = () => ({
      messages: {
        create: async () => {
          throw new Error(`request failed with key ${key}`);
        },
      },
    });
    const res = await validateKey(key, { client: make });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).not.toContain(key);
      expect(res.message).toContain('[redacted]');
    }
  });
});
