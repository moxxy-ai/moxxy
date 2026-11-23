import { expect, it, vi } from 'vitest';
import { syncAccount } from './account-sync';

vi.mock('./prefs', () => ({
  readPrefs: () => ({ theme: 'light', onboardingComplete: true, clerkUserId: 'device-local' }),
  updatePrefs: vi.fn(),
}));
import { updatePrefs } from './prefs';

it('only sends portable entries, never follows redirects and only returns a count', async () => {
  const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const vault = { get: vi.fn(async (key: string) => key === 'OPENAI_API_KEY' ? 'fake' : null), setMany: vi.fn() };
  expect(await syncAccount('https://sync.example', 'token', 'save', vault, request)).toBe(1);
  expect(vault.get).not.toHaveBeenCalledWith('CLERK_SECRET_KEY');
  const init = request.mock.calls[0]?.[1];
  expect(init.redirect).toBe('error');
  expect(JSON.parse(init.body)).toEqual({ keys: { OPENAI_API_KEY: 'fake' }, prefs: { theme: 'light' } });
});

it('validates the entire restore payload before applying keys or preferences', async () => {
  const vault = { get: vi.fn(), setMany: vi.fn() };
  const run = (prefs: unknown) => syncAccount('https://sync.example', 'token', 'restore', vault,
    vi.fn().mockResolvedValue(Response.json({ keys: { OPENAI_API_KEY: 'fixture' }, prefs })));
  await expect(run({ onboardingComplete: true })).rejects.toThrow();
  expect(vault.setMany).not.toHaveBeenCalled();
  expect(updatePrefs).not.toHaveBeenCalled();
  await expect(run({ theme: 'dark' })).resolves.toBe(1);
  expect(vault.setMany).toHaveBeenCalledWith([{ name: 'OPENAI_API_KEY', value: 'fixture', referenceOnly: true }]);
  expect(updatePrefs).toHaveBeenCalledWith({ theme: 'dark' });
});
