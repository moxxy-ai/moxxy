import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { useProviderMigrationNotice } from './useProviderMigrationNotice';

/** Says the provider migration once, from where toasts are on screen. */
export function ProviderMigrationToast({ phase }: { readonly phase: ConnectionPhase | undefined }): null {
  useProviderMigrationNotice(phase, { toast: true });
  return null;
}
