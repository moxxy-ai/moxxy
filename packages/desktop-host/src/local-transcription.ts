import { rm } from 'node:fs/promises';

import type {
  AppNotice,
  LocalTranscriptionModelId,
  TranscriptionSettings,
  TranscriptionSetup,
} from '@moxxy/desktop-ipc-contract';
import { ensureModelFiles, modelFilesReady, type ModelFilesProgress } from '@moxxy/model-fetch/files';
// Only the catalog: bundled into the main, so the installer never carries the
// plugin's native sherpa-onnx libraries (hence a devDependency).
import {
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

export const LOCAL_TRANSCRIPTION_PACKAGE = '@moxxy/plugin-stt-local';

const localTranscriptionPlugin = (transcriber: string): OptionalPlugin => ({
  packageName: LOCAL_TRANSCRIPTION_PACKAGE,
  category: 'transcriber',
  contribution: transcriber,
  label: 'offline transcription',
});

/** Short names, for messages. */
const MODEL_LABELS: Readonly<Record<LocalTranscriptionModelId, string>> = {
  parakeet: 'Parakeet',
  turbo: 'Whisper turbo',
};
/** What the settings call Cloud transcription. */
const CLOUD_LABEL = 'OpenAI';

/** Half a second of 16-bit mono silence at 24 kHz, in the desktop mic's format. */
const WARM_UP_AUDIO = new Uint8Array(24_000);
const DEFAULT_START_WAIT_MS = 10_000;
const START_POLL_MS = 100;
/** Progress reaches the windows at most this often. */
const DEFAULT_PROGRESS_INTERVAL_MS = 250;
const NOTICE_ID = 'transcription.local';
const NOTICE_TARGET = { destination: 'settings', section: 'voice' } as const;

/** Whether the on-device transcription package is complete on disk. */
export async function isLocalTranscriptionInstalled(home = moxxyHome()): Promise<boolean> {
  return isOptionalPluginInstalled(localTranscriptionPlugin(''), home);
}

/** Install (when missing), enable and select `transcriber`; single-flight. */
export function createLocalTranscriptionInstaller(
  transcriber: string,
  options: OptionalPluginInstallerOptions = {},
): () => Promise<void> {
  return createOptionalPluginInstaller(localTranscriptionPlugin(transcriber), options);
}

/** A local model's files on this computer. */
export interface LocalTranscriptionModel {
  readonly id: LocalTranscriptionModelId;
  readonly label: string;
  /** The transcriber that reads it. */
  readonly transcriber: string;
  /** Download size in bytes. */
  readonly bytes: number;
  /** Whether every file is on disk and verified. */
  ready(): Promise<boolean>;
  /** Fetch the files that are missing. */
  download(opts: { signal: AbortSignal; onProgress: (p: ModelFilesProgress) => void }): Promise<void>;
  /** Delete its files. */
  remove(): Promise<void>;
}

/** A model the local transcription plugin reads, downloaded by the host so the
 *  progress shows in every window (the plugin finds the files and skips it). */
export function localTranscriptionModel(
  id: LocalTranscriptionModelId,
  options: {
    readonly modelsDir?: string;
    readonly ensureFiles?: typeof ensureModelFiles;
  } = {},
): LocalTranscriptionModel {
  const entry = requireModel(id, 'model');
  const files = modelFiles(entry);
  const dir = modelDir(entry, options.modelsDir ?? defaultModelsDir());
  const ensureFiles = options.ensureFiles ?? ensureModelFiles;
  return {
    id,
    label: MODEL_LABELS[id],
    transcriber: entry.transcriber,
    bytes: modelBytes(entry),
    ready: () => modelFilesReady(files, dir),
    download: async ({ signal, onProgress }) => {
      await ensureFiles({ files, dir, signal, onProgress });
    },
    remove: () => rm(dir, { recursive: true, force: true }),
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
  /** Install, enable and select the transcriber of `model`. */
  readonly installLocal: (model: LocalTranscriptionModel) => Promise<void>;
  /** Choose a transcriber, or none so the runner falls back to Cloud. */
  readonly setChoice: (transcriber: string | null) => Promise<void>;
  /** Restart every desktop runner so it picks up the choice. */
  readonly restartRunners: () => Promise<void>;
  /** The active workspace's runner, once it is attached; `null` when none. */
  readonly runner: () => Promise<TranscriptionRunner | null>;
  readonly models: ReadonlyArray<LocalTranscriptionModel>;
  /** Every window learns of each change, download progress included. */
  readonly onChange?: (settings: TranscriptionSettings) => void;
  /** Says when a model is ready or could not start, wherever the person is. */
  readonly notify?: (notice: AppNotice) => void;
  /** How long to wait for the restarted runner to start the transcriber. */
  readonly startWaitMs?: number;
  /** The least time between two progress changes sent to the windows. */
  readonly progressIntervalMs?: number;
}

export interface TranscriptionSwitch {
  get(): Promise<TranscriptionSettings>;
  /** Switch to a local model: download it when it is missing, then install,
   *  restart and load it, so the first dictation does not wait. One switch runs
   *  at a time; a second call joins it. Resolves when it is done or cancelled;
   *  on failure the previous choice stays and the error says why. */
  useLocal(id: LocalTranscriptionModelId): Promise<void>;
  /** Stop the model download of a running switch. */
  cancelLocal(): Promise<void>;
  /** Switch back to Cloud transcription, stopping a running download first. */
  useCloud(): Promise<void>;
  /** Delete a downloaded model. Refuses the one in use. */
  removeModel(id: LocalTranscriptionModelId): Promise<void>;
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

  const modelOf = (id: LocalTranscriptionModelId): LocalTranscriptionModel => {
    const model = deps.models.find((candidate) => candidate.id === id);
    if (!model) throw new Error(`Unknown transcription model: ${id}.`);
    return model;
  };
  const chosenModel = (choice: string | null): LocalTranscriptionModel | undefined =>
    deps.models.find((model) => model.transcriber === choice);
  const labelOf = (choice: string | null): string => chosenModel(choice)?.label ?? CLOUD_LABEL;

  const read = async (): Promise<TranscriptionSettings> => {
    const [choice, runner, models] = await Promise.all([
      deps.loadChoice(),
      deps.runner(),
      Promise.all(deps.models.map(async ({ id, bytes, ready }) => ({ id, bytes, ready: await ready() }))),
    ]);
    last = {
      choice: chosenModel(choice)?.id ?? 'cloud',
      active: runner?.getInfo().activeTranscriber ?? null,
      models,
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

  const restoreChoice = async (choice: string | null): Promise<void> => {
    await deps.setChoice(choice);
    await deps.restartRunners();
  };

  const downloadModel = async (model: LocalTranscriptionModel, stayingOn: string): Promise<void> => {
    if (await model.ready()) return;
    const controller = new AbortController();
    download = controller;
    setup = { model: model.id, phase: 'downloading', receivedBytes: 0, totalBytes: model.bytes };
    await changed();
    let sentAt = 0;
    try {
      await model.download({
        signal: controller.signal,
        onProgress: ({ receivedBytes, totalBytes }) => {
          setup = { model: model.id, phase: 'downloading', receivedBytes, totalBytes };
          const now = Date.now();
          if (now - sentAt < progressIntervalMs && receivedBytes < totalBytes) return;
          sentAt = now;
          tick();
        },
      });
    } catch (cause) {
      if (controller.signal.aborted) throw new DownloadCancelled();
      throw new Error(`${model.label} could not be downloaded, so Moxxy stays on ${stayingOn}: ${reasonOf(cause)}`, { cause });
    } finally {
      download = null;
    }
  };

  const start = async (model: LocalTranscriptionModel, previous: string | null): Promise<void> => {
    const stayingOn = labelOf(previous);
    setup = { model: model.id, phase: 'starting' };
    await changed();
    try {
      await deps.installLocal(model);
    } catch (cause) {
      throw new Error(`${model.label} could not be set up, so Moxxy stays on ${stayingOn}: ${reasonOf(cause)}`, { cause });
    }
    await deps.restartRunners();
    try {
      await warmUp(await deps.runner(), model.transcriber, startWaitMs);
    } catch (cause) {
      await restoreChoice(previous);
      throw new Error(`${model.label} could not start, so Moxxy stays on ${stayingOn}: ${reasonOf(cause)}`, { cause });
    }
  };

  const switchToLocal = async (model: LocalTranscriptionModel): Promise<void> => {
    error = null;
    try {
      const previous = await deps.loadChoice();
      await downloadModel(model, labelOf(previous));
      await start(model, previous);
      setup = null;
      await changed();
      deps.notify?.({
        id: NOTICE_ID,
        tone: 'success',
        title: 'Local transcription is ready',
        body: `${model.label} now turns your speech into text on this computer.`,
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
    useLocal(id) {
      running ??= switchToLocal(modelOf(id)).finally(() => {
        running = null;
      });
      return running;
    },
    cancelLocal,
    async useCloud() {
      await cancelLocal();
      error = null;
      await restoreChoice(null);
      await changed();
    },
    async removeModel(id) {
      const model = modelOf(id);
      if (chosenModel(await deps.loadChoice()) === model) {
        throw new Error(`${model.label} is in use. Choose another model first.`);
      }
      await model.remove();
      await changed();
    },
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wait for the runner to start the transcriber, then transcribe a short
 *  silence, which loads the downloaded model into memory. */
async function warmUp(runner: TranscriptionRunner | null, transcriberName: string, startWaitMs: number): Promise<void> {
  if (!runner) throw new Error('no runner is attached.');
  const deadline = Date.now() + startWaitMs;
  while (runner.getInfo().activeTranscriber !== transcriberName) {
    if (Date.now() >= deadline) throw new Error(`the runner did not start ${transcriberName}.`);
    await new Promise((resolve) => setTimeout(resolve, START_POLL_MS));
  }
  const transcriber = runner.transcribers.tryGetActive();
  if (!transcriber) throw new Error(`the runner did not start ${transcriberName}.`);
  await transcriber.transcribe(WARM_UP_AUDIO, { mimeType: MOXXY_PCM16_24KHZ_MIME });
}
