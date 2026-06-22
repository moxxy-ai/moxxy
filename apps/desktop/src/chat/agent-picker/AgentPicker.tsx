/**
 * The composer's Mode chip:  [ Mode: default ▾ ]
 *
 * Model selection moved to the top-bar {@link ModelSelectorButton} (z.ai puts
 * the model name top-left), so the composer now only discloses the MODE — a
 * flat native-select chip (modes are flat, no sub-list). State is shared with
 * the top-bar selector and the sidebar Chat/Agent toggle via
 * {@link useSessionAgent}.
 */

import { ChipSelect } from './ChipSelect';
import { useSessionAgent } from './useSessionAgent';

/** Modes hidden from the chat mode chip — collaboration is launched from the
 *  Collaborate tab (single-flight), and its peer modes are internal. */
const COLLAB_MODES: ReadonlySet<string> = new Set([
  'collaborative',
  'collab-architect',
  'collab-peer',
]);

export function AgentPicker({
  workspaceId,
  disabled,
}: {
  readonly workspaceId: string;
  readonly disabled: boolean;
}): JSX.Element | null {
  const { info, setMode } = useSessionAgent(workspaceId);
  if (!info) return null;

  return (
    <ChipSelect
      label="Mode"
      value={info.activeMode ?? ''}
      // Collaboration is launched from the Collaborate tab (one at a time),
      // not as a chat mode — hide collaborative + its internal peer modes.
      options={info.modes.filter((m) => !COLLAB_MODES.has(m))}
      badge={info.activeModeBadge}
      disabled={disabled || info.modes.length === 0}
      onChange={(v) => void setMode(v)}
    />
  );
}
