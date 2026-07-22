import type { RunnerPool } from '../runner-pool';
import {
  createLocalPiperInstaller,
  isLocalPiperInstalled,
} from '../local-piper';
import { handle } from './shared';

export interface VoiceHandlerDependencies {
  readonly isInstalled: () => Promise<boolean>;
  readonly install: () => Promise<void>;
}

const installLocalPiper = createLocalPiperInstaller();

export function registerVoiceHandlers(
  pool: RunnerPool,
  dependencies: VoiceHandlerDependencies = {
    isInstalled: () => isLocalPiperInstalled(),
    install: installLocalPiper,
  },
): void {
  handle('voice.isLocalPiperInstalled', () => dependencies.isInstalled());
  handle('voice.installLocalPiper', async () => {
    await dependencies.install();
    await Promise.all(pool.list().map(({ supervisor }) => supervisor.restart()));
  });
}
