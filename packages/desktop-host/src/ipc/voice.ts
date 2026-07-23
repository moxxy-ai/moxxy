import type { RunnerPool } from '../runner-pool';
import {
  createLocalPiperInstaller,
  isLocalPiperInstalled,
} from '../local-piper';
import { handle } from './shared';

export interface VoiceHandlerDependencies {
  readonly isInstalled: () => Promise<boolean>;
  readonly install: () => Promise<void>;
  readonly setRealtimeCaptureActive: (active: boolean) => Promise<void> | void;
}

const installLocalPiper = createLocalPiperInstaller();

export function registerVoiceHandlers(
  pool: RunnerPool,
  dependencies: Partial<VoiceHandlerDependencies> = {},
): void {
  const isInstalled = dependencies.isInstalled ?? (() => isLocalPiperInstalled());
  const install = dependencies.install ?? installLocalPiper;
  const setRealtimeCaptureActive = dependencies.setRealtimeCaptureActive ?? (() => undefined);
  handle('voice.isLocalPiperInstalled', () => isInstalled());
  handle('voice.installLocalPiper', async () => {
    await install();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
  handle('voice.setRealtimeCaptureActive', async ({ active }) => {
    await setRealtimeCaptureActive(active);
  });
}
