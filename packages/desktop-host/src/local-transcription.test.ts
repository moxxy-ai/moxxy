import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOXXY_PCM16_24KHZ_MIME } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import {
  createLocalTranscriptionInstaller,
  createTranscriptionSwitch,
  isLocalTranscriptionInstalled,
  LOCAL_TRANSCRIPTION_PACKAGE,
  localTranscriptionModel,
  type LocalTranscriptionModel,
  type TranscriptionRunner,
  type TranscriptionSwitchDependencies,
} from './local-transcription';
import type { AppNotice, TranscriptionSettings } from '@moxxy/desktop-ipc-contract';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => removeDir(directory)));
});

async function temporaryMoxxyHome(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'moxxy-local-transcription-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('Local Whisper package probe', () => {
  it('requires the first-party package manifest and compiled plugin entry', async () => {
    const home = await temporaryMoxxyHome();
    expect(await isLocalTranscriptionInstalled(home)).toBe(false);

    const packageDirectory = path.join(home, 'plugins', 'node_modules', '@moxxy', 'plugin-stt-local');
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: LOCAL_TRANSCRIPTION_PACKAGE,
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));
    expect(await isLocalTranscriptionInstalled(home)).toBe(false);

    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');
    expect(await isLocalTranscriptionInstalled(home)).toBe(true);
  });

  it('rejects a substituted package manifest', async () => {
    const home = await temporaryMoxxyHome();
    const packageDirectory = path.join(home, 'plugins', 'node_modules', '@moxxy', 'plugin-stt-local');
    await mkdir(path.join(packageDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(packageDirectory, 'dist', 'index.js'), 'export default {};');
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@attacker/substitute',
      moxxy: { plugin: { entry: './dist/index.js' } },
    }));
    expect(await isLocalTranscriptionInstalled(home)).toBe(false);
  });
});

describe('Local Whisper installer', () => {
  it('installs, enables and selects only the fixed local-whisper transcriber', async () => {
    const run = vi.fn(async () => undefined);
    const install = createLocalTranscriptionInstaller('local-whisper', {
      runCommand: run,
      repairManifest: async () => undefined,
      isInstalled: async () => false,
    });

    await install();

    expect(run.mock.calls).toEqual([
      [['plugins', 'install', '@moxxy/plugin-stt-local']],
      [['plugins', 'enable', '@moxxy/plugin-stt-local']],
      [['plugins', 'set-default', 'transcriber', 'local-whisper']],
    ]);
  });

  it('selects the copy the installer shipped without going to npm', async () => {
    const run = vi.fn(async () => undefined);
    const install = createLocalTranscriptionInstaller('local-whisper', {
      runCommand: run,
      repairManifest: async () => undefined,
      isInstalled: async () => true,
    });

    await install();

    expect(run.mock.calls).toEqual([
      [['plugins', 'enable', '@moxxy/plugin-stt-local']],
      [['plugins', 'set-default', 'transcriber', 'local-whisper']],
    ]);
  });
});

describe('local transcription models', () => {
  it('is the pinned Whisper turbo files, missing in a fresh home', async () => {
    const home = await temporaryMoxxyHome();
    const model = localTranscriptionModel('turbo', { modelsDir: path.join(home, 'models', 'stt') });

    expect(model.bytes).toBe(674_716_297 + 361_080_764 + 816_730);
    await expect(model.ready()).resolves.toBe(false);
  });

  it('downloads those files into its own directory under the models root', async () => {
    const ensureFiles = vi.fn(async () => ({ dir: '', skipped: false }));
    const model = localTranscriptionModel('turbo', { modelsDir: '/models/stt', ensureFiles });
    const signal = new AbortController().signal;
    const onProgress = vi.fn();

    await model.download({ signal, onProgress });

    const [opts] = ensureFiles.mock.calls[0] as unknown as [
      { dir: string; files: { name: string }[]; signal: AbortSignal; onProgress: unknown },
    ];
    expect(opts.dir).toBe(path.join('/models/stt', 'turbo'));
    expect(opts.files.map((file) => file.name)).toEqual([
      'turbo-encoder.int8.onnx',
      'turbo-decoder.int8.onnx',
      'turbo-tokens.txt',
    ]);
    expect(opts.signal).toBe(signal);
    expect(opts.onProgress).toBe(onProgress);
  });

  it('knows Parakeet: four files, its own directory and transcriber', async () => {
    const ensureFiles = vi.fn(async () => ({ dir: '', skipped: false }));
    const model = localTranscriptionModel('parakeet', { modelsDir: '/models/stt', ensureFiles });

    await model.download({ signal: new AbortController().signal, onProgress: vi.fn() });

    const [opts] = ensureFiles.mock.calls[0] as unknown as [{ dir: string; files: { name: string }[] }];
    expect(opts.dir).toBe(path.join('/models/stt', 'parakeet'));
    expect(opts.files).toHaveLength(4);
    expect(model.transcriber).toBe('local-parakeet');
    expect(model.label).toBe('Parakeet');
    expect(model.bytes).toBe(652_184_281 + 11_845_275 + 6_355_277 + 93_939);
  });

  it('removes only its own directory', async () => {
    const home = await temporaryMoxxyHome();
    const modelsDir = path.join(home, 'models', 'stt');
    await mkdir(path.join(modelsDir, 'parakeet'), { recursive: true });
    await mkdir(path.join(modelsDir, 'turbo'), { recursive: true });
    await writeFile(path.join(modelsDir, 'parakeet', 'tokens.txt'), 'x');
    await writeFile(path.join(modelsDir, 'turbo', 'turbo-tokens.txt'), 'x');

    await localTranscriptionModel('parakeet', { modelsDir }).remove();

    await expect(readdir(modelsDir)).resolves.toEqual(['turbo']);
    await expect(readdir(path.join(modelsDir, 'turbo'))).resolves.toEqual(['turbo-tokens.txt']);
  });
});

/** A runner whose active transcriber is `active` and whose transcribe call is spied. */
function fakeRunner(active: string | null, transcribe = vi.fn(async () => ({ text: '' }))): TranscriptionRunner & {
  transcribe: typeof transcribe;
} {
  return {
    transcribe,
    getInfo: () => ({ activeTranscriber: active }),
    transcribers: { tryGetActive: () => (active ? { transcribe } : null) },
  };
}

const MODEL_BYTES = 1_000;

/** The model on disk: `ready` until a download is asked for, which then runs
 *  `download` (by default: two progress steps, then done). */
function fakeModel(over: Partial<LocalTranscriptionModel> & { present?: boolean } = {}): LocalTranscriptionModel & {
  downloads: number;
  removals: number;
} {
  const state = { present: over.present ?? false, downloads: 0, removals: 0 };
  return {
    id: over.id ?? 'turbo',
    label: over.label ?? 'Whisper turbo',
    transcriber: over.transcriber ?? 'local-whisper',
    bytes: MODEL_BYTES,
    ready: async () => state.present,
    remove: async () => {
      state.removals += 1;
      state.present = false;
    },
    download: async (opts) => {
      state.downloads += 1;
      if (over.download) await over.download(opts);
      else {
        opts.onProgress({ receivedBytes: 400, totalBytes: MODEL_BYTES });
        opts.onProgress({ receivedBytes: MODEL_BYTES, totalBytes: MODEL_BYTES });
      }
      state.present = true;
    },
    get downloads() {
      return state.downloads;
    },
    get removals() {
      return state.removals;
    },
  };
}

function fakeParakeet(present = true): ReturnType<typeof fakeModel> {
  return fakeModel({ id: 'parakeet', label: 'Parakeet', transcriber: 'local-parakeet', present });
}

function switchWith({ model, ...over }: Partial<TranscriptionSwitchDependencies> & {
  model?: LocalTranscriptionModel;
} = {}) {
  const calls: string[] = [];
  const changes: TranscriptionSettings[] = [];
  const notices: AppNotice[] = [];
  const deps: TranscriptionSwitchDependencies = {
    loadChoice: async () => null,
    installLocal: vi.fn(async () => { calls.push('install'); }),
    setChoice: vi.fn(async (choice) => { calls.push(`choose ${choice ?? 'cloud'}`); }),
    restartRunners: vi.fn(async () => { calls.push('restart'); }),
    runner: async () => fakeRunner('local-whisper'),
    models: [model ?? fakeModel({ present: true })],
    onChange: (settings) => changes.push(settings),
    notify: (notice) => notices.push(notice),
    startWaitMs: 50,
    progressIntervalMs: 0,
    ...over,
  };
  return { calls, changes, notices, deps, transcription: createTranscriptionSwitch(deps) };
}

describe('transcription switch', () => {
  it('reports Local only when local-whisper is the chosen transcriber, with what the runner runs', async () => {
    const local = switchWith({ loadChoice: async () => 'local-whisper' });
    await expect(local.transcription.get()).resolves.toEqual({
      choice: 'turbo',
      active: 'local-whisper',
      models: [{ id: 'turbo', ready: true, bytes: MODEL_BYTES }],
      setup: null,
      error: null,
    });

    const cloud = switchWith({
      loadChoice: async () => null,
      runner: async () => fakeRunner('openai-gpt-transcribe'),
      model: fakeModel({ present: false }),
    });
    await expect(cloud.transcription.get()).resolves.toMatchObject({
      choice: 'cloud',
      active: 'openai-gpt-transcribe',
      models: [{ id: 'turbo', ready: false, bytes: MODEL_BYTES }],
    });

    const none = switchWith({ runner: async () => null });
    await expect(none.transcription.get()).resolves.toMatchObject({ choice: 'cloud', active: null });
  });

  it('switching to Local installs, restarts, then loads the model with a short silence', async () => {
    const runner = fakeRunner('local-whisper');
    const model = fakeModel({ present: true });
    const { calls, transcription } = switchWith({ runner: async () => runner, model });

    await transcription.useLocal('turbo');

    expect(model.downloads).toBe(0);
    expect(calls).toEqual(['install', 'restart']);
    expect(runner.transcribe).toHaveBeenCalledOnce();
    const [audio, opts] = runner.transcribe.mock.calls[0] as unknown as [Uint8Array, { mimeType: string }];
    expect(opts).toEqual({ mimeType: MOXXY_PCM16_24KHZ_MIME });
    // Half a second of 16-bit silence at 24 kHz.
    expect(audio.byteLength).toBe(24_000);
    expect(audio.every((byte) => byte === 0)).toBe(true);
  });

  it('downloads a missing model first, sending its progress, before touching the runners', async () => {
    const order: string[] = [];
    const model = fakeModel({
      download: async (opts) => {
        order.push('download');
        opts.onProgress({ receivedBytes: 400, totalBytes: MODEL_BYTES });
      },
    });
    const { calls, changes, transcription } = switchWith({
      model,
      installLocal: vi.fn(async () => { calls.push('install'); order.push('install'); }),
    });

    await transcription.useLocal('turbo');

    expect(order).toEqual(['download', 'install']);
    expect(changes.map((change) => change.setup)).toEqual([
      { model: 'turbo', phase: 'downloading', receivedBytes: 0, totalBytes: MODEL_BYTES },
      { model: 'turbo', phase: 'downloading', receivedBytes: 400, totalBytes: MODEL_BYTES },
      { model: 'turbo', phase: 'starting' },
      null,
    ]);
    expect(changes.at(-1)).toMatchObject({
      models: [{ id: 'turbo', ready: true, bytes: MODEL_BYTES }],
      error: null,
    });
  });

  it('reports the running setup to a window that asks while it runs', async () => {
    let release = (): void => undefined;
    const model = fakeModel({
      download: async (opts) => {
        opts.onProgress({ receivedBytes: 250, totalBytes: MODEL_BYTES });
        await new Promise<void>((resolve) => { release = resolve; });
      },
    });
    const { transcription } = switchWith({ model });

    const switching = transcription.useLocal('turbo');
    await vi.waitFor(() => expect(model.downloads).toBe(1));
    await expect(transcription.get()).resolves.toMatchObject({
      choice: 'cloud',
      setup: { model: 'turbo', phase: 'downloading', receivedBytes: 250, totalBytes: MODEL_BYTES },
    });
    release();
    await switching;
  });

  it('runs one switch at a time: a second click joins the first', async () => {
    let release = (): void => undefined;
    const model = fakeModel({
      download: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
      },
    });
    const { calls, transcription } = switchWith({ model });

    const first = transcription.useLocal('turbo');
    const second = transcription.useLocal('turbo');
    await vi.waitFor(() => expect(model.downloads).toBe(1));
    release();
    await Promise.all([first, second]);

    expect(model.downloads).toBe(1);
    expect(calls).toEqual(['install', 'restart']);
  });

  it('cancelling the download leaves everything on Cloud, with no error', async () => {
    const model = fakeModel({
      download: (opts) => new Promise<void>((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('download aborted')), { once: true });
      }),
    });
    const { calls, changes, notices, transcription } = switchWith({ model });

    const switching = transcription.useLocal('turbo');
    await vi.waitFor(() => expect(model.downloads).toBe(1));
    await transcription.cancelLocal();
    await switching;

    expect(calls).toEqual([]);
    expect(changes.at(-1)).toMatchObject({ choice: 'cloud', setup: null, error: null });
    expect(notices).toEqual([]);
  });

  it('a failed download changes nothing, keeps the reason and tells the person', async () => {
    const model = fakeModel({
      download: async () => {
        throw new Error('download failed: HTTP 503');
      },
    });
    const { calls, notices, transcription } = switchWith({ model });

    await expect(transcription.useLocal('turbo')).rejects.toThrow(
      'Whisper turbo could not be downloaded, so Moxxy stays on OpenAI: download failed: HTTP 503',
    );
    expect(calls).toEqual([]);
    await expect(transcription.get()).resolves.toMatchObject({
      setup: null,
      error: 'Whisper turbo could not be downloaded, so Moxxy stays on OpenAI: download failed: HTTP 503',
    });
    expect(notices).toEqual([
      {
        id: 'transcription.local',
        tone: 'error',
        title: 'Local transcription could not start',
        body: 'Whisper turbo could not be downloaded, so Moxxy stays on OpenAI: download failed: HTTP 503',
        target: { destination: 'settings', section: 'voice' },
      },
    ]);
  });

  it('tells the person when Local is ready, wherever they are in the app', async () => {
    const { notices, transcription } = switchWith({ model: fakeModel() });

    await transcription.useLocal('turbo');

    expect(notices).toEqual([
      {
        id: 'transcription.local',
        tone: 'success',
        title: 'Local transcription is ready',
        body: 'Whisper turbo now turns your speech into text on this computer.',
        target: { destination: 'settings', section: 'voice' },
      },
    ]);
  });

  it('goes back to Cloud and says why when local-whisper does not start on the runner', async () => {
    const { calls, notices, transcription } = switchWith({ runner: async () => fakeRunner(null) });

    await expect(transcription.useLocal('turbo')).rejects.toThrow(
      'Whisper turbo could not start, so Moxxy stays on OpenAI: the runner did not start local-whisper.',
    );
    expect(calls).toEqual(['install', 'restart', 'choose cloud', 'restart']);
    expect(notices.map((notice) => notice.tone)).toEqual(['error']);
  });

  it('goes back to Cloud when the model cannot be loaded', async () => {
    const runner = fakeRunner('local-whisper', vi.fn(async () => {
      throw new Error('sidecar crashed');
    }));
    const { calls, transcription } = switchWith({ runner: async () => runner });

    await expect(transcription.useLocal('turbo')).rejects.toThrow(
      'Whisper turbo could not start, so Moxxy stays on OpenAI: sidecar crashed',
    );
    expect(calls).toEqual(['install', 'restart', 'choose cloud', 'restart']);
  });

  it('does not touch the choice or the runners when installation fails', async () => {
    const { calls, transcription } = switchWith({
      installLocal: vi.fn(async () => { throw new Error('npm offline'); }),
    });

    await expect(transcription.useLocal('turbo')).rejects.toThrow(
      'Whisper turbo could not be set up, so Moxxy stays on OpenAI: npm offline',
    );
    expect(calls).toEqual([]);
  });

  it('the next switch clears the last error', async () => {
    let fail = true;
    const { transcription } = switchWith({
      installLocal: vi.fn(async () => {
        if (fail) throw new Error('npm offline');
      }),
    });
    await transcription.useLocal('turbo').catch(() => undefined);
    fail = false;

    await transcription.useLocal('turbo');

    await expect(transcription.get()).resolves.toMatchObject({ error: null });
  });

  it('runs each model on its own transcriber', async () => {
    const parakeet = fakeParakeet();
    const runner = fakeRunner('local-parakeet');
    const installLocal = vi.fn(async () => undefined);
    const { transcription } = switchWith({ installLocal, runner: async () => runner, models: [fakeModel(), parakeet] });

    await transcription.useLocal('parakeet');

    expect(installLocal).toHaveBeenCalledWith(parakeet);
    expect(runner.transcribe).toHaveBeenCalledOnce();
  });

  it('reports a chosen Parakeet next to Whisper', async () => {
    const { transcription } = switchWith({
      loadChoice: async () => 'local-parakeet',
      runner: async () => fakeRunner('local-parakeet'),
      models: [fakeParakeet(), fakeModel()],
    });
    await expect(transcription.get()).resolves.toMatchObject({
      choice: 'parakeet',
      models: [{ id: 'parakeet', ready: true }, { id: 'turbo', ready: false }],
    });
  });

  it('goes back to the previous model, not to Cloud, when the new one fails', async () => {
    const { calls, transcription } = switchWith({
      loadChoice: async () => 'local-whisper',
      runner: async () => fakeRunner(null),
      models: [fakeModel({ present: true }), fakeParakeet()],
    });

    await expect(transcription.useLocal('parakeet')).rejects.toThrow(
      'Parakeet could not start, so Moxxy stays on Whisper turbo: the runner did not start local-parakeet.',
    );
    expect(calls).toEqual(['install', 'restart', 'choose local-whisper', 'restart']);
  });

  it('says so when a failed download leaves the previous model in place', async () => {
    const parakeet = fakeModel({
      id: 'parakeet',
      label: 'Parakeet',
      transcriber: 'local-parakeet',
      download: async () => { throw new Error('HTTP 503'); },
    });
    const { calls, transcription } = switchWith({
      loadChoice: async () => 'local-whisper',
      models: [fakeModel({ present: true }), parakeet],
    });

    await expect(transcription.useLocal('parakeet')).rejects.toThrow(
      'Parakeet could not be downloaded, so Moxxy stays on Whisper turbo: HTTP 503',
    );
    expect(calls).toEqual([]);
  });

  it('removes a model that is not in use and reports it gone', async () => {
    const parakeet = fakeParakeet();
    const { changes, transcription } = switchWith({
      loadChoice: async () => 'local-whisper',
      models: [fakeModel({ present: true }), parakeet],
    });

    await transcription.removeModel('parakeet');

    expect(parakeet.removals).toBe(1);
    expect(changes.at(-1)).toMatchObject({
      models: [{ id: 'turbo', ready: true }, { id: 'parakeet', ready: false }],
    });
  });

  it('refuses to remove the model in use', async () => {
    const parakeet = fakeParakeet();
    const { transcription } = switchWith({
      loadChoice: async () => 'local-parakeet',
      models: [fakeModel({ present: true }), parakeet],
    });

    await expect(transcription.removeModel('parakeet')).rejects.toThrow('Parakeet is in use');
    expect(parakeet.removals).toBe(0);
  });

  it('switching to Cloud clears the choice and restarts the runners', async () => {
    const { calls, changes, transcription } = switchWith();

    await transcription.useCloud();

    expect(calls).toEqual(['choose cloud', 'restart']);
    expect(changes.at(-1)).toMatchObject({ setup: null });
  });

  it('switching to Cloud during the download stops it first', async () => {
    const model = fakeModel({
      download: (opts) => new Promise<void>((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('download aborted')), { once: true });
      }),
    });
    const { calls, transcription } = switchWith({ model });

    const switching = transcription.useLocal('turbo');
    await vi.waitFor(() => expect(model.downloads).toBe(1));
    await transcription.useCloud();
    await switching;

    expect(calls).toEqual(['choose cloud', 'restart']);
  });
});
