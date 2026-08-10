import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import path from 'node:path';
import { pickExamples } from '../logo-data.js';
import { Border, Colors, Glyphs } from '../theme.js';
import { terminalSafeText } from './terminal-text.js';
import { RunStageRail } from './RunStageRail.js';

/**
 * A single boot-progress event. Mirrors `BootStep` from
 * `@moxxy/cli/setup.ts` but without the import dependency — we don't
 * want plugin-cli pulling in the CLI package. Callers translate.
 */
export interface BootEvent {
  /** Stable key matched against the static checklist order. */
  readonly id: BootEventId;
  /** Time the event was recorded, used for the trailing `(Nms)` label. */
  readonly at: number;
  /** Optional detail rendered after the step name (e.g. provider name). */
  readonly detail?: string;
  /** Marks the step as failed — rendered in red, no checklist tick. */
  readonly failed?: boolean;
}

export type BootEventId =
  | 'config-loaded'
  | 'plugins-registered'
  | 'provider-activated'
  | 'prefs-applied'
  | 'skills-loaded'
  | 'init-hooks-done';

interface ChecklistStep {
  readonly id: BootEventId;
  readonly label: string;
}

const STEPS: ReadonlyArray<ChecklistStep> = [
  { id: 'config-loaded', label: 'config loaded' },
  { id: 'plugins-registered', label: 'plugins registered' },
  { id: 'provider-activated', label: 'provider activated' },
  { id: 'prefs-applied', label: 'preferences applied' },
  { id: 'skills-loaded', label: 'skills loaded' },
  { id: 'init-hooks-done', label: 'onInit hooks fired' },
];

export interface BootScreenProps {
  /**
   * Ordered list of events that have fired so far. Steps not yet
   * represented in the list render with the pending glyph.
   */
  readonly events: ReadonlyArray<BootEvent>;
  /**
   * When the bootstrap process started; each completed step shows
   * `(<elapsed>ms)` measured from this anchor.
   */
  readonly startedAt: number;
  /**
   * Fatal error from boot. Renders as a centered red block; the
   * failing step's label surfaces above the message.
   */
  readonly error?: { readonly failedStep?: BootEventId; readonly message: string };
  /** Project directory the ready session is scoped to. */
  readonly workspace?: string;
}

// Number of core developer tasks to surface on the ready screen.
const READY_EXAMPLE_COUNT = 2;

/**
 * Workspace-first boot panel. The product shell is already visible while the
 * runtime starts, then fills with the ready workspace and useful first tasks.
 * Internal boot architecture stays hidden unless it fails.
 *
 * Stays mounted until the InteractiveSession flips to `phase === 'ready'`,
 * at which point the parent swaps in the steady-state layout.
 */
export const BootScreen: React.FC<BootScreenProps> = ({ events, startedAt, error, workspace }) => {
  void startedAt;
  // `pickExamples` is itself process-cached, so re-renders never
  // shuffle the picks; the useMemo is for clarity.
  const examples = useMemo(() => pickExamples(READY_EXAMPLE_COUNT), []);

  const seen = new Map<BootEventId, BootEvent>();
  for (const e of events) seen.set(e.id, e);
  const failedStep = error?.failedStep
    ? STEPS.find((s) => s.id === error.failedStep) ?? null
    : null;
  const ready = !error && STEPS.every((s) => seen.has(s.id));

  return (
    <Box flexDirection="column" width="100%" marginTop={1}>
      <Box
        flexDirection="column"
        width="100%"
        borderStyle={Border.style}
        borderColor={Border.color}
        borderDimColor={Border.dim}
      >
        <Box justifyContent="space-between" paddingX={1} marginTop={1}>
          <Box>
            <Text color={error ? Colors.danger : Colors.busy}>{Glyphs.filled}</Text>
            <Text bold>{' moxxy'}</Text>
            <Text dimColor>{' · workspace run'}</Text>
          </Box>
          <Text color={error ? Colors.danger : ready ? Colors.active : Colors.busy} bold>
            {error ? 'START FAILED' : ready ? 'LOCAL' : 'STARTING'}
          </Text>
        </Box>

        <Box flexDirection="column" paddingX={1} marginTop={1}>
          {error ? (
            <>
              <Text color={Colors.danger} bold>
                {failedStep?.label ?? 'Could not start this run'}
              </Text>
              <Text color={Colors.danger}>{error.message}</Text>
              <Box marginTop={1}>
                <Text dimColor>Run </Text>
                <Text>moxxy doctor --check-keys</Text>
                <Text dimColor> in another terminal, then retry.</Text>
              </Box>
            </>
          ) : ready ? (
            <>
              {workspace ? (
                <Box flexDirection="column" marginBottom={1}>
                  <Box>
                    <Text color={Colors.active}>{Glyphs.filled}</Text>
                    <Text bold>{` ${workspaceLabel(workspace)}`}</Text>
                    <Text dimColor> workspace ready</Text>
                  </Box>
                  <Text dimColor>{`  ${terminalSafeText(workspace, 120)}`}</Text>
                </Box>
              ) : null}
              <Text dimColor>Try a task</Text>
              {examples.map((example, index) => (
                <Box key={index}>
                  <Text color={Colors.busy}>{`${Glyphs.prompt}  `}</Text>
                  <Text>{example}</Text>
                </Box>
              ))}
            </>
          ) : (
            <Box>
              <Text color={Colors.busy}>{Glyphs.pending}</Text>
              <Text dimColor>{' Preparing your workspace…'}</Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1} marginBottom={1}>
          <RunStageRail stage="understand" inset />
        </Box>
      </Box>
    </Box>
  );
};

export function workspaceLabel(workspace: string): string {
  const normalized = workspace.trim();
  if (!normalized) return 'current project';
  return terminalSafeText(path.basename(path.resolve(normalized)) || normalized, 40);
}
