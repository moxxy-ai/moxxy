import type { RunnerPool } from '../runner-pool';
import { loadCategoryDefault, loadCategoryItemConfig, setCategoryItemConfig } from '@moxxy/config';
import { DEFAULT_VOICE, listGeminiVoicesWithSecret } from '@moxxy/plugin-tts-gemini';
import type { GeminiTtsUsageSnapshot, GeminiVoiceInfo } from '@moxxy/desktop-ipc-contract';
import {
  createLocalPiperInstaller,
  isLocalPiperInstalled,
} from '../local-piper';
import { createGeminiTtsInstaller } from '../gemini-tts';
import { getGeminiTtsUsage } from '../gemini-tts-usage';
import { getInProcessPlugins, handle, resolveSupervisor } from './shared';

type VoiceSettings = { readonly backend: string | null; readonly voiceId: string };

export interface VoiceHandlerDependencies {
  readonly isInstalled: () => Promise<boolean>;
  readonly install: () => Promise<void>;
  readonly listGeminiVoices: () => Promise<ReadonlyArray<GeminiVoiceInfo>>;
  readonly useGeminiTts: (voiceId: string) => Promise<void>;
  readonly useLocalPiper: () => Promise<void>;
  readonly getSettings: () => Promise<VoiceSettings>;
  readonly getUsage: () => Promise<GeminiTtsUsageSnapshot>;
  readonly setRealtimeCaptureActive: (active: boolean) => Promise<void> | void;
}

const installLocalPiper = createLocalPiperInstaller();
const installGeminiTts = createGeminiTtsInstaller();

export function registerVoiceHandlers(
  pool: RunnerPool,
  dependencies: Partial<VoiceHandlerDependencies> = {},
): void {
  const isInstalled = dependencies.isInstalled ?? (() => isLocalPiperInstalled());
  const install = dependencies.install ?? installLocalPiper;
  const setRealtimeCaptureActive = dependencies.setRealtimeCaptureActive ?? (() => undefined);
  const listGeminiVoices = dependencies.listGeminiVoices ?? (() =>
    listGeminiVoicesWithSecret((name) => getInProcessPlugins().vault.get(name))
  );
  const useGeminiTts = dependencies.useGeminiTts ?? (async (voiceId) => {
    await setCategoryItemConfig('synthesizer', 'gemini-tts', { voice: voiceId });
    await installGeminiTts();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
  const useLocalPiper = dependencies.useLocalPiper ?? (async () => {
    await installLocalPiper();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
  const getSettings = dependencies.getSettings ?? (async () => {
    const [backend, config] = await Promise.all([
      loadCategoryDefault('synthesizer'),
      loadCategoryItemConfig('synthesizer', 'gemini-tts'),
    ]);
    const remote = resolveSupervisor(pool)?.remote();
    return {
      backend: remote ? remote.getInfo().activeSynthesizer : backend,
      voiceId: typeof config.voice === 'string' ? config.voice : DEFAULT_VOICE,
    };
  });
  const getUsage = dependencies.getUsage ?? getGeminiTtsUsage;
  handle('voice.isLocalPiperInstalled', () => isInstalled());
  handle('voice.installLocalPiper', async () => {
    await install();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
  handle('voice.listGeminiVoices', async () => listGeminiVoices());
  handle('voice.useGeminiTts', async ({ voiceId }) => useGeminiTts(voiceId));
  handle('voice.useLocalPiper', async () => useLocalPiper());
  handle('voice.getSettings', async () => getSettings());
  handle('voice.getUsage', async () => getUsage());
  handle('voice.setRealtimeCaptureActive', async ({ active }) => {
    await setRealtimeCaptureActive(active);
  });
}
