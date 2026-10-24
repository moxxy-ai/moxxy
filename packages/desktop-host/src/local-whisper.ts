import type { AppNotice, TranscriptionSettings, TranscriptionSetup } from '@moxxy/desktop-ipc-contract';
import { ensureModelFiles, modelFilesReady, type ModelFilesProgress } from '@moxxy/model-fetch/files';
// Only the catalog: bundled into the main, so the installer never carries the
// plugin's native sherpa-onnx libraries (hence a devDependency).
import {
  DEFAULT_MODEL_ID,
  defaultModelsDir,
  modelBytes,
  modelDir,
  modelFiles,
  requireModel,
} from '@moxxy/plugin-stt-local/models';
import { MOXXY_PCM16_24KHZ_MIME, type Transcriber } from '@moxxy/sdk';
import { moxxyHome } from '@moxxy/sdk/server';

import {
  createOptionalPluginInstaller,
  isOptionalPluginInstalled,
  type OptionalPlugin,
  type OptionalPluginInstallerOptions,
} from './optional-plugin';

export const LOCAL_WHISPER_PACKAGE = '@moxxy/plugin-stt-local';
/** `@moxxy/plugin-stt-local`'s transcriber (named here, the host does not import the plugin). */
export const LOCAL_WHISPER_TRANSCRIBER = 'local-whisper';

const LOCAL_WHISPER: OptionalPlugin = {
  packageName: LOCAL_WHISPER_PACKAGE,
  category: 'transcriber',
  contribution: LOCAL_WHISPER_TRANSCRIBER,
  label: 'offline transcription',
};

/** Half a second of 16-bit mono silence at 24 kHz, in the desktop mic's format. */
const WARM_UP_AUDIO = new Uint8Array(24_000);
const DEFAULT_START_WAIT_MS = 10_000;
const START_POLL_MS = 100;
/** Progress reaches the windows at most this often. */
const DEFAULT_PROGRESS_INTERVAL_MS = 250;
const NOTICE_ID = 'transcription.local';
const NOTICE_TARGET = { destination: 'settings', section: 'voice' } as const;

/** Whether the on-device Whisper package is complete on disk. */
export async function isLocalWhisperInstalled(home = moxxyHome()): Promise<boolean> {
  return isOptionalPluginInstalled(LOCAL_WHISPER, home);
}

/** Install (when missing), enable and select local Whisper as the transcriber; single-flight. */
export function createLocalWhisperInstaller(
  options: OptionalPluginInstallerOptions = {},
): () => Promise<void> {
  return createOptionalPluginInstaller(LOCAL_WHISPER, options);
}

/** Whisper turbo's files on this computer. */
export interface LocalWhisperModel {
  /** Download size in bytes. */
  readonly bytes: number;
  /** Whether every file is on disk and verified. */
  ready(): Promise<boolean>;
  /** Fetch the files that are missing. */
  download(opts: { signal: AbortSignal; onProgress: (p: ModelFilesProgress) => void }): Promise<void>;
}

/** The model the local-whisper plugin reads, downloaded by the host so the
 *  progress shows in every window (the plugin finds the files and skips it). */
export function localWhisperModel(options: {
  readonly modelsDir?: string;
  readonly ensureFiles?: typeof ensureModelFiles;
} = {}): LocalWhisperModel {
  const entry = requireModel(DEFAULT_MODEL_ID, 'model');
  const files = modelFiles(entry);
  const dir = modelDir(entry, options.modelsDir ?? defaultModelsDir());
  const ensureFiles = options.ensureFiles ?? ensureModelFiles;
  return {
    bytes: modelBytes(entry),
    ready: () => modelFilesReady(files, dir),
    download: async ({ signal, onProgress }) => {
      await ensureFiles({ files, dir, signal, onProgress });
    },
  };
}

/** The slice of a RemoteSession the switch reads. */
export interface TranscriptionRunner {
  getInfo(): { readonly activeTranscriber: string | null };
  readonly transcribers: { tryGetActive(): Pick<Transcriber, 'transcribe'> | null };
}

export interface TranscriptionSwitchDependencies {
  /** `plugins.transcriber.default` from the user config. */
  readonly loadChoice: () => Promise<string | null>;
  /** Install, enable and select local Whisper. */
  readonly installLocal: () => Promise<void>;
  /** Unselect the transcriber, so the runner falls back to Cloud. */
  readonly clearChoice: () => Promise<void>;
  /** Restart every desktop runner so it picks up the choice. */
  readonly restartRunners: () => Promise<void>;
  /** The active workspace's runner, once it is attached; `null` when none. */
  readonly runner: () => Promise<TranscriptionRunner | null>;
  readonly model: LocalWhisperModel;
  /** Every window learns of each change, download progress included. */
  readonly onChange?: (settings: TranscriptionSettings) => void;
  /** Says when Local is ready or could not start, wherever the person is. */
  readonly notify?: (notice: AppNotice) => void;
  /** How long to wait for the restarted runner to start local Whisper. */
  readonly startWaitMs?: number;
  /** The least time between two progress changes sent to the windows. */
  readonly progressIntervalMs?: number;
}

export interface TranscriptionSwitch {
  get(): Promise<TranscriptionSettings>;
  /** Switch to local Whisper: download the model when it is missing, then
   *  install, restart and load it, so the first dictation does not wait. One
   *  switch runs at a time; a second call joins it. Resolves when it is done or
   *  cancelled; on failure Moxxy stays on Cloud and the error says why. */
  useLocal(): Promise<void>;
  /** Stop the model download of a running switch to Local. */
  cancelLocal(): Promise<void>;
  /** Switch back to Cloud transcription, stopping a running download first. */
  useCloud(): Promise<void>;
}

/** Raised for a stopped download, so the switch can tell it from a failure. */
class DownloadCancelled extends Error {}

export function createTranscriptionSwitch(deps: TranscriptionSwitchDependencies): TranscriptionSwitch {
  const startWaitMs = deps.startWaitMs ?? DEFAULT_START_WAIT_MS;
  const progressIntervalMs = deps.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  let setup: TranscriptionSetup | null = null;
  let error: string | null = null;
  let running: Promise<void> | null = null;
  let download: AbortController | null = null;
  /** The last full reading, so progress ticks need no config or runner reads. */
  let last: TranscriptionSettings | null = null;

  const read = async (): Promise<TranscriptionSettings> => {
    const [choice, runner, modelReady] = await Promise.all([deps.loadChoice(), deps.runner(), deps.model.ready()]);
    last = {
      mode: choice === LOCAL_WHISPER_TRANSCRIBER ? 'local' : 'cloud',
      active: runner?.getInfo().activeTranscriber ?? null,
      modelReady,
      modelBytes: deps.model.bytes,
      setup,
      error,
    };
    return last;
  };
  const changed = async (): Promise<void> => {
    if (deps.onChange) deps.onChange(await read());
  };
  const tick = (): void => {
    if (deps.onChange && last) deps.onChange({ ...last, setup, error });
  };

  const switchBack = async (): Promise<void> => {
    await deps.clearChoice();
    await deps.restartRunners();
  };

  const downloadModel = async (): Promise<void> => {
    if (await deps.model.ready()) return;
    const controller = new AbortController();
    download = controller;
    setup = { phase: 'downloading', receivedBytes: 0, totalBytes: deps.model.bytes };
    await changed();
    let sentAt = 0;
    try {
      await deps.model.download({
        signal: controller.signal,
        onProgress: ({ receivedBytes, totalBytes }) => {
          setup = { phase: 'downloading', receivedBytes, totalBytes };
          const now = Date.now();
          if (now - sentAt < progressIntervalMs && receivedBytes < totalBytes) return;
          sentAt = now;
          tick();
        },
      });
    } catch (cause) {
      if (controller.signal.aborted) throw new DownloadCancelled();
      throw new Error(`Whisper turbo could not be downloaded, so Moxxy stays on Cloud: ${reasonOf(cause)}`, { cause });
    } finally {
      download = null;
    }
  };

  const start = async (): Promise<void> => {
    setup = { phase: 'starting' };
    await changed();
    try {
      await deps.installLocal();
    } catch (cause) {
      throw new Error(`Local transcription could not be set up, so Moxxy stays on Cloud: ${reasonOf(cause)}`, { cause });
    }
    await deps.restartRunners();
    try {
      await warmUp(await deps.runner(), startWaitMs);
    } catch (cause) {
      await switchBack();
      throw new Error(`Local transcription could not start, so Moxxy stays on Cloud: ${reasonOf(cause)}`, { cause });
    }
  };

  const switchToLocal = async (): Promise<void> => {
    error = null;
    try {
      await downloadModel();
      await start();
      setup = null;
      await changed();
      deps.notify?.({
        id: NOTICE_ID,
        tone: 'success',
        title: 'Local transcription is ready',
        body: 'Whisper turbo now turns your speech into text on this computer.',
        target: NOTICE_TARGET,
      });
    } catch (cause) {
      setup = null;
      if (cause instanceof DownloadCancelled) {
        await changed();
        return;
      }
      error = reasonOf(cause);
      await changed();
      deps.notify?.({
        id: NOTICE_ID,
        tone: 'error',
        title: 'Local transcription could not start',
        body: error,
        target: NOTICE_TARGET,
      });
      throw cause;
    }
  };

  const cancelLocal = async (): Promise<void> => {
    download?.abort();
    await running?.catch(() => undefined);
  };

  return {
    get: read,
    useLocal() {
      running ??= switchToLocal().finally(() => {
        running = null;
      });
      return running;
    },
    cancelLocal,
    async useCloud() {
      await cancelLocal();
      error = null;
      await switchBack();
      await changed();
    },
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wait for the runner to start local Whisper, then transcribe a short silence,
 *  which loads the downloaded model into memory. */
async function warmUp(runner: TranscriptionRunner | null, startWaitMs: number): Promise<void> {
  if (!runner) throw new Error('no runner is attached.');
  const deadline = Date.now() + startWaitMs;
  while (runner.getInfo().activeTranscriber !== LOCAL_WHISPER_TRANSCRIBER) {
    if (Date.now() >= deadline) throw new Error(`the runner did not start ${LOCAL_WHISPER_TRANSCRIBER}.`);
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
  }
  const transcriber = runner.transcribers.tryGetActive();
  if (!transcriber) throw new Error(`the runner did not start ${LOCAL_WHISPER_TRANSCRIBER}.`);
  await transcriber.transcribe(WARM_UP_AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
}
