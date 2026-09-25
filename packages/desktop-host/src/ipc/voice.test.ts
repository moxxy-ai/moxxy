import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { RunnerPool } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';
import { setActiveBus } from './shared';
import { registerVoiceHandlers } from './voice';
import type { GeminiVoiceInfo } from '@moxxy/desktop-ipc-contract';

type Handler = (...args: unknown[]) => Promise<unknown>;

function register(options: {
  readonly installed: boolean;
  readonly install?: () => Promise<void>;
  readonly setRealtimeCaptureActive?: (active: boolean) => Promise<void>;
  readonly listGeminiVoices?: () => Promise<ReadonlyArray<GeminiVoiceInfo>>;
  readonly useGeminiTts?: (voiceId: string) => Promise<void>;
  readonly useLocalPiper?: () => Promise<void>;
  readonly getSettings?: () => Promise<{ backend: string | null; voiceId: string }>;
}) {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus;
  const restart = vi.fn(async () => undefined);
  const pool = {
    list: () => [
      { id: 'workspace-a', supervisor: { restart } as unknown as RunnerSupervisor },
      { id: 'workspace-b', supervisor: { restart } as unknown as RunnerSupervisor },
    ],
  } as unknown as RunnerPool;
  const install = options.install ?? vi.fn(async () => undefined);
  setActiveBus(bus);
  registerVoiceHandlers(pool, {
    isInstalled: async () => options.installed,
    install,
    setRealtimeCaptureActive: options.setRealtimeCaptureActive ?? (async () => undefined),
    ...(options.listGeminiVoices ? { listGeminiVoices: options.listGeminiVoices } : {}),
    ...(options.useGeminiTts ? { useGeminiTts: options.useGeminiTts } : {}),
    ...(options.useLocalPiper ? { useLocalPiper: options.useLocalPiper } : {}),
    ...(options.getSettings ? { getSettings: options.getSettings } : {}),
  });
  return { handlers, install, restart };
}

describe('registerVoiceHandlers', () => {
  it('reports package presence and restarts every runner after installation', async () => {
    const { handlers, install, restart } = register({ installed: false });

    await expect(handlers.get('voice.isLocalPiperInstalled')?.()).resolves.toBe(false);
    await expect(handlers.get('voice.installLocalPiper')?.()).resolves.toBeUndefined();
    expect(install).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('does not restart runners after a failed installation', async () => {
    const failure = new Error('package download failed');
    const { handlers, restart } = register({
      installed: false,
      install: vi.fn(async () => { throw failure; }),
    });

    await expect(handlers.get('voice.installLocalPiper')?.()).rejects.toBe(failure);
    expect(restart).not.toHaveBeenCalled();
  });

  it('forwards the bounded realtime-capture lease without touching audio data', async () => {
    const setRealtimeCaptureActive = vi.fn(async () => undefined);
    const { handlers } = register({ installed: true, setRealtimeCaptureActive });

    await expect(handlers.get('voice.setRealtimeCaptureActive')?.({ active: true }))
      .resolves.toBeUndefined();
    await expect(handlers.get('voice.setRealtimeCaptureActive')?.({ active: false }))
      .resolves.toBeUndefined();

    expect(setRealtimeCaptureActive).toHaveBeenNthCalledWith(1, true);
    expect(setRealtimeCaptureActive).toHaveBeenNthCalledWith(2, false);
  });

  it('exposes the user voice library and routes backend/voice choices', async () => {
    const voices = [{ id: 'Fola', displayName: 'Fola', languageCode: 'en-US' }];
    const listGeminiVoices = vi.fn(async () => voices);
    const useGeminiTts = vi.fn(async (_voiceId: string) => undefined);
    const useLocalPiper = vi.fn(async () => undefined);
    const getSettings = vi.fn(async () => ({ backend: 'gemini-tts', voiceId: 'Fola' }));
    const { handlers } = register({
      installed: true,
      listGeminiVoices,
      useGeminiTts,
      useLocalPiper,
      getSettings,
    });

    await expect(handlers.get('voice.listGeminiVoices')?.()).resolves.toEqual(voices);
    await expect(handlers.get('voice.useGeminiTts')?.({ voiceId: 'Fola' })).resolves.toBeUndefined();
    await expect(handlers.get('voice.useLocalPiper')?.()).resolves.toBeUndefined();
    await expect(handlers.get('voice.getSettings')?.()).resolves.toEqual({
      backend: 'gemini-tts', voiceId: 'Fola',
    });
    expect(useGeminiTts).toHaveBeenCalledWith('Fola');
    expect(useLocalPiper).toHaveBeenCalledOnce();
  });
});
