import { describe, expect, it, vi } from 'vitest';
import { validateKey } from './validate.js';

describe('openai validateKey', () => {
  it('rejects empty/short keys without any network call', async () => {
    const make = vi.fn();
    const res = await validateKey('', { client: make as never });
    expect(res).toEqual({ ok: false, message: 'key looks too short' });
    expect(make).not.toHaveBeenCalled();
  });

  it('success path lists models', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] });
    const make = vi.fn().mockReturnValue({ models: { list } });
    const res = await validateKey('sk-very-long-test-key', { client: make });
    expect(res).toEqual({ ok: true });
    expect(list).toHaveBeenCalledOnce();
  });

  it('SDK throw → ok:false with the underlying message', async () => {
    const make = () => ({
      models: {
        list: async () => {
          throw new Error('Incorrect API key provided');
        },
      },
    });
    const res = await validateKey('sk-bad-but-long-enough', { client: make });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('Incorrect API key');
  });

  it('strips URLs and caps length of the surfaced error message', async () => {
    const long = 'x'.repeat(500);
    const make = () => ({
      models: {
        list: async () => {
          throw new Error(`failed talking to https://evil.example/v1/models?key=leak ${long}`);
        },
      },
    });
    const res = await validateKey('sk-bad-but-long-enough', { client: make });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).not.toContain('https://');
      expect(res.message).toContain('[url]');
      expect(res.message.length).toBeLessThanOrEqual(201);
    }
  });

  it('does not crash on a non-Error thrown value and never returns an empty message', async () => {
    const make = () => ({
      models: {
        list: async () => {
          throw '   ';
        },
      },
    });
    const res = await validateKey('sk-bad-but-long-enough', { client: make });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message.length).toBeGreaterThan(0);
  });
});
