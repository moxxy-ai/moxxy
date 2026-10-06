import {
  buildGptLiveHistory,
  readStoredTokens,
} from '@moxxy/plugin-provider-openai-codex';
import type { InProcessPlugins } from '../in-process-plugins';
import type { RunnerPool } from '../runner-pool';
import { loadCategoryDefault, loadCategoryItemConfig, setCategoryItemConfig } from '@moxxy/config';
import { DEFAULT_VOICE, listGeminiVoicesWithSecret } from '@moxxy/plugin-tts-gemini';
import type { GeminiVoiceInfo } from '@moxxy/desktop-ipc-contract';
import { SELF_REFERENCE_NOTE } from '@moxxy/sdk';
import {
  createLocalPiperInstaller,
  isLocalPiperInstalled,
} from '../local-piper';
import { createGeminiTtsInstaller } from '../gemini-tts';
import { getInProcessPlugins, handle, resolveCtx, resolveSupervisor } from './shared';

type VoiceSettings = { readonly backend: string | null; readonly voiceId: string };

/**
 * GPT-Live holds the conversation itself and delegates only explicit requests
 * to act. The renderer then runs the user's own words as an agent turn and
 * hands back that turn's real reply — so the model must never report an
 * outcome before it arrives (the failure the earlier voice mode shipped).
 */
export const GPT_LIVE_INSTRUCTIONS = [
  'You are Moxxy Voice, the spoken interface of the Moxxy desktop app.',
  'Hold the conversation yourself: answer questions, chat, and use the Moxxy chat history you were given, briefly and in the language the user speaks. Treat later developer context as new chat messages.',
  'You cannot run tools, read or edit files, or act in the app yourself.',
  'You cannot check live facts (prices, timetables, availability, news, weather): never state them as current; say they need checking and that Moxxy can check them if the user asks.',
  "Delegate only when the user explicitly asks Moxxy to do, run, create, change, check or find something in the app or project; the Moxxy agent then carries out the user's exact words.",
  'When you delegate, say one short acknowledgement that you are passing it on, then wait. Never say or imply the work is done, started successfully, or what its result is until the delegation result arrives.',
  'When the result arrives, tell the user what it says, faithfully and briefly. If it reports a failure, say so plainly.',
  'Questions about the progress of a running task, its result, or the chat are conversation: answer them yourself from the progress and chat context you receive, and never delegate them.',
  'The agent works on one task at a time and must finish it before starting another. If a delegation comes back as not started because the agent is busy, tell the user so plainly and never pretend it will run later.',
  SELF_REFERENCE_NOTE,
].join(' ');

/** Raw events read from the runner when a call opens; plenty to fill
 *  GPT-Live's 128-item history even with tool traffic in between. */
const HISTORY_PAGE_LIMIT = 2_000;

export interface VoiceHandlerDependencies {
  readonly isInstalled: () => Promise<boolean>;
  readonly install: () => Promise<void>;
  readonly listGeminiVoices: () => Promise<ReadonlyArray<GeminiVoiceInfo>>;
  readonly useGeminiTts: (voiceId: string) => Promise<void>;
  readonly useLocalPiper: () => Promise<void>;
  readonly getSettings: () => Promise<VoiceSettings>;
  readonly setRealtimeCaptureActive: (active: boolean) => Promise<void> | void;
  readonly inProcessPlugins: () => Pick<InProcessPlugins, 'vault' | 'gptLive'>;
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
  const inProcessPlugins = dependencies.inProcessPlugins ?? getInProcessPlugins;
  handle('voice.isLocalPiperInstalled', () => isInstalled());
  handle('voice.installLocalPiper', async () => {
    await install();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
  handle('voice.listGeminiVoices', async () => listGeminiVoices());
  handle('voice.useGeminiTts', async ({ voiceId }) => useGeminiTts(voiceId));
  handle('voice.useLocalPiper', async () => useLocalPiper());
  handle('voice.getSettings', async () => getSettings());
  handle('voice.setRealtimeCaptureActive', async ({ active }) => {
    await setRealtimeCaptureActive(active);
  });
  handle('voice.live.preflight', async () => {
    try {
      return { authenticated: (await readStoredTokens(inProcessPlugins().vault)) !== null };
    } catch {
      return { authenticated: false };
    }
  });
  handle('voice.live.start', async ({ workspaceId, sdp }) => {
    const { session } = resolveCtx(pool, { workspaceId });
    const { events } = await session.loadHistory(null, HISTORY_PAGE_LIMIT);
    return inProcessPlugins().gptLive.start({
      sdp,
      instructions: GPT_LIVE_INSTRUCTIONS,
      history: buildGptLiveHistory(events),
    });
  });
}
