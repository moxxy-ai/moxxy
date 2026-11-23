import { expect, it, vi } from 'vitest';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { registerKeySyncSession, withAccountKeySync } from './keySyncTransport';

function setup() {
  const invoke = vi.fn(async (_command: string, _args: unknown) => {});
  const api = withAccountKeySync({ invoke, subscribe: vi.fn() } as unknown as MoxxyApi);
  return { api, invoke };
}

it('syncs only the edited credential in submission order across setup, settings and deletion', async () => {
  const { api, invoke } = setup();
  const off = registerKeySyncSession(() => async () => 'session-a');
  try {
    await Promise.all([
      api.invoke('onboarding.saveProviderKey', { provider: 'openai', secret: 'first' }),
      api.invoke('settings.vaultSet', { name: 'OPENAI_API_KEY', value: 'rotated' }),
      api.invoke('settings.vaultDelete', { name: 'OPENAI_API_KEY' }),
    ]);
    expect(invoke.mock.calls.filter(([command]) => command === 'account.syncKey').map(([, args]) => args))
      .toEqual(['first', 'rotated', null].map(value => ({ name: 'OPENAI_API_KEY', value, token: 'session-a' })));
    expect(invoke).not.toHaveBeenCalledWith('account.sync', expect.anything());
  } finally { off(); }
});

it('keeps signed-out, opted-out and unsupported entries local', async () => {
  const { api, invoke } = setup();
  const off = registerKeySyncSession(() => null);
  try {
    await api.invoke('settings.vaultSet', { name: 'OPENAI_API_KEY', value: 'local' });
  } finally { off(); }
  const token = vi.fn(async () => 'session');
  const active = registerKeySyncSession(() => token);
  try {
    await api.invoke('settings.vaultSet', { name: 'CLERK_SECRET_KEY', value: 'local' });
    expect(token).not.toHaveBeenCalled();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['settings.vaultSet', 'settings.vaultSet']);
  } finally { active(); }
});

it('reports a partial save, allows retry, and never uploads after a local write failure', async () => {
  const { api, invoke } = setup();
  const off = registerKeySyncSession(() => async () => 'session');
  const save = () => api.invoke('settings.vaultSet', { name: 'OPENAI_API_KEY', value: 'fixture' });
  try {
    invoke.mockRejectedValueOnce(new Error('vault locked'));
    await expect(save()).rejects.toThrow('vault locked');
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    await expect(save()).rejects.toThrow('saved on this device');
    await expect(save()).resolves.toBeUndefined();
  } finally { off(); }
});
