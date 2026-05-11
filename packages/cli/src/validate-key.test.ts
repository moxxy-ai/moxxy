import { describe, expect, it, vi } from 'vitest';
import { validateProviderKey } from './validate-key.js';

describe('validateProviderKey', () => {
  it('rejects empty / too-short keys before any network call', async () => {
    const res = await validateProviderKey('anthropic', '');
    expect(res).toEqual({ ok: false, message: 'key looks too short' });

    const tiny = await validateProviderKey('openai', 'abc');
    expect(tiny.ok).toBe(false);
  });

  it('anthropic: success path hits messages.create', async () => {
    const create = vi.fn().mockResolvedValue({});
    const make = vi.fn().mockReturnValue({ messages: { create } });
    const res = await validateProviderKey('anthropic', 'sk-ant-very-long-test-key', {
      makeAnthropic: make,
    });
    expect(res).toEqual({ ok: true });
    expect(make).toHaveBeenCalledWith('sk-ant-very-long-test-key');
    expect(create).toHaveBeenCalledOnce();
  });

  it('anthropic: SDK throw → ok:false with the underlying message', async () => {
    const make = () => ({
      messages: {
        create: async () => {
          throw new Error('401 invalid api key');
        },
      },
    });
    const res = await validateProviderKey('anthropic', 'sk-ant-bad-but-long-enough', {
      makeAnthropic: make,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('401');
  });

  it('openai: success path lists models', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });
    const make = vi.fn().mockReturnValue({ models: { list } });
    const res = await validateProviderKey('openai', 'sk-very-long-test-key', {
      makeOpenAI: make,
    });
    expect(res).toEqual({ ok: true });
    expect(list).toHaveBeenCalledOnce();
  });

  it('openai: SDK throw → ok:false with the underlying message', async () => {
    const make = () => ({
      models: {
        list: async () => {
          throw new Error('Incorrect API key provided');
        },
      },
    });
    const res = await validateProviderKey('openai', 'sk-bad-but-long-enough', {
      makeOpenAI: make,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('Incorrect API key');
  });

  it('unknown provider returns a clear error', async () => {
    const res = await validateProviderKey('vendor-z', 'long-enough-key-here');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('unknown provider');
  });
});
