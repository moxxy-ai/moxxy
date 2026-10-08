import { UpdateScreen } from './UpdateScreen';
import { useUpdateScreen } from './useUpdateScreen';
import type { RunnerState } from './update-screen-model';

/** Mounts the installer screen for as long as there is something to show. */
export function UpdateFlow(props: { readonly runner: RunnerState; readonly onboarded: boolean }): JSX.Element | null {
  const { model, leaving, onExited, onRetry, onClose } = useUpdateScreen(props);
  if (!model) return null;
  return <UpdateScreen model={model} leaving={leaving} onExited={onExited} onRetry={onRetry} onClose={onClose} />;
}
