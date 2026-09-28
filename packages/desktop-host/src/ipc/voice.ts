import {
  buildGptLiveHistory,
  readStoredTokens,
} from '@moxxy/plugin-provider-openai-codex';
import type { InProcessPlugins } from '../in-process-plugins';
import type { RunnerPool } from '../runner-pool';
import {
  createLocalPiperInstaller,
  isLocalPiperInstalled,
} from '../local-piper';
import { getInProcessPlugins, handle, resolveCtx } from './shared';

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
  "Delegate only when the user explicitly asks Moxxy to do, run, create, change, check or find something in the app or project; the Moxxy agent then carries out the user's exact words.",
  'When you delegate, say one short acknowledgement that you are passing it on, then wait. Never say or imply the work is done, started successfully, or what its result is until the delegation result arrives.',
  'When the result arrives, tell the user what it says, faithfully and briefly. If it reports a failure, say so plainly.',
  'Questions about the progress of a running task, its result, or the chat are conversation: answer them yourself from the progress and chat context you receive, and never delegate them.',
  'If you are told a delegated task is waiting, tell the user it is queued and has not started yet; it starts on its own when the agent is free.',
].join(' ');

/** Raw events read from the runner when a call opens; plenty to fill
 *  GPT-Live's 128-item history even with tool traffic in between. */
const HISTORY_PAGE_LIMIT = 2_000;

export interface VoiceHandlerDependencies {
  readonly isInstalled: () => Promise<boolean>;
  readonly install: () => Promise<void>;
  readonly setRealtimeCaptureActive: (active: boolean) => Promise<void> | void;
  readonly inProcessPlugins: () => Pick<InProcessPlugins, 'vault' | 'gptLive'>;
}

const installLocalPiper = createLocalPiperInstaller();

export function registerVoiceHandlers(
  pool: RunnerPool,
  dependencies: Partial<VoiceHandlerDependencies> = {},
): void {
  const isInstalled = dependencies.isInstalled ?? (() => isLocalPiperInstalled());
  const install = dependencies.install ?? installLocalPiper;
  const setRealtimeCaptureActive = dependencies.setRealtimeCaptureActive ?? (() => undefined);
  const inProcessPlugins = dependencies.inProcessPlugins ?? getInProcessPlugins;
  handle('voice.isLocalPiperInstalled', () => isInstalled());
  handle('voice.installLocalPiper', async () => {
    await install();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
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
