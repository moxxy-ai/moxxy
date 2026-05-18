import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { LOGO_LINES, pickSlogan } from '../logo-data.js';
import { Colors, Glyphs } from '../theme.js';

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
  readonly version?: string;
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
   * Fatal error from boot. Renders as a centered red block after the
   * checklist; the failing step shows the failed glyph.
   */
  readonly error?: { readonly failedStep?: BootEventId; readonly message: string };
}

/**
 * Full-screen boot panel: centered logo + version + tips + live
 * progress checklist. Stays mounted until the InteractiveSession flips
 * to `phase === 'ready'`, at which point the parent swaps in the
 * steady-state layout.
 */
export const BootScreen: React.FC<BootScreenProps> = ({ version, events, startedAt, error }) => {
  const slogan = useMemo(() => pickSlogan(), []);
  const width = process.stdout.columns ?? 80;
  const useFullLogo = width >= 60;

  const seen = new Map<BootEventId, BootEvent>();
  for (const e of events) seen.set(e.id, e);

  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      {useFullLogo ? (
        <Box flexDirection="column" alignItems="center">
          {LOGO_LINES.map((line, i) => (
            <Text key={i} bold>{line}</Text>
          ))}
        </Box>
      ) : (
        <Text bold>{width >= 40 ? 'M O X X Y' : 'MOXXY'}</Text>
      )}
      <Box marginTop={1}>
        <Text dimColor italic>{slogan}</Text>
        {version ? <Text dimColor>{`  ${Glyphs.midDot}  v${version}`}</Text> : null}
      </Box>

      <Box flexDirection="column" marginTop={2} alignItems="flex-start">
        {STEPS.map((step) => {
          const event = seen.get(step.id);
          const failed = event?.failed === true;
          const done = event != null && !failed;
          const elapsed = event ? event.at - startedAt : null;
          return (
            <Box key={step.id}>
              <Text
                {...(failed ? { color: Colors.danger } : done ? {} : { dimColor: true })}
              >
                {done || failed ? Glyphs.filled : Glyphs.pending}
              </Text>
              <Text> </Text>
              <Text
                {...(failed
                  ? { color: Colors.danger }
                  : done
                    ? {}
                    : { dimColor: true })}
              >
                {step.label}
                {event?.detail ? ` · ${event.detail}` : ''}
                {failed ? ' — failed' : ''}
              </Text>
              {elapsed != null && !failed ? (
                <Text dimColor>{`  (${elapsed}ms)`}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      {error ? (
        <Box flexDirection="column" marginTop={2} alignItems="center">
          <Text color={Colors.danger}>{error.message}</Text>
          <Box marginTop={1}>
            <Text dimColor>Run </Text>
            <Text>moxxy init</Text>
            <Text dimColor> in another terminal, then relaunch.</Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
};
