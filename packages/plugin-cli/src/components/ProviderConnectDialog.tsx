import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ProviderSetupView } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';
import {
  createConnectFlow,
  type ConnectFlow,
  type ConnectPhase,
} from '../session/provider-connect-flow.js';

export interface ProviderConnectDialogProps {
  readonly providerId: string;
  readonly setup: ProviderSetupView;
  /** Provider connected — parent applies the pending model switch + closes. */
  readonly onSuccess: (note?: string) => void;
  readonly onCancel: () => void;
}

/**
 * Inline provider onboarding, rendered in the InteractiveZone's exclusive
 * slot (so its useInput never fights PromptInput's raw stdin). All flow
 * semantics live in provider-connect-flow.ts; this renders phases and
 * forwards keystrokes.
 */
export const ProviderConnectDialog: React.FC<ProviderConnectDialogProps> = ({
  providerId,
  setup,
  onSuccess,
  onCancel,
}) => {
  const [phase, setPhase] = React.useState<ConnectPhase>({ kind: 'installing' });
  const [buffer, setBuffer] = React.useState('');
  const flowRef = React.useRef<ConnectFlow | null>(null);

  React.useEffect(() => {
    const flow = createConnectFlow({
      setup,
      providerId,
      onPhase: setPhase,
      onSuccess,
    });
    flowRef.current = flow;
    void flow.start();
    return () => flow.cancel();
    // The dialog is remounted per providerId by its parent key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const promptActive =
    phase.kind === 'key-entry' || (phase.kind === 'oauth' && phase.prompt !== null);

  useInput((input, key) => {
    if (key.escape) {
      flowRef.current?.cancel();
      onCancel();
      return;
    }
    if (phase.kind === 'failed') {
      if (phase.retryable && input.toLowerCase() === 'r') {
        setBuffer('');
        void flowRef.current?.start();
      }
      return;
    }
    if (!promptActive) return;
    if (phase.kind === 'key-entry' && phase.validating) return;
    if (key.return) {
      const value = buffer;
      setBuffer('');
      if (phase.kind === 'key-entry') void flowRef.current?.submitKey(value);
      else flowRef.current?.answerPrompt(value);
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((b) => b.slice(0, -1));
      return;
    }
    // Printable input only; ignore control sequences and arrows.
    if (input && !key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow) {
      setBuffer((b) => b + input);
    }
  });

  const masked =
    phase.kind === 'key-entry' || (phase.kind === 'oauth' && phase.prompt?.mask === true);
  const echo = masked ? '•'.repeat(buffer.length) : buffer;

  return (
    <Modal title={`connect ${providerId}`}>
      {phase.kind === 'installing' ? (
        <Text color={Colors.chrome}>installing {providerId} — this can take a minute…</Text>
      ) : null}

      {phase.kind === 'key-entry' ? (
        <Box flexDirection="column">
          {phase.error ? <Text color={Colors.danger}>{phase.error}</Text> : null}
          {phase.validating ? (
            <Text color={Colors.chrome}>validating key…</Text>
          ) : (
            <>
              <Text>
                API key: <Text color={Colors.active}>{echo}</Text>
                <Text color={Colors.chrome}>▏</Text>
              </Text>
              <Text color={Colors.chrome}>enter save · esc cancel — stored in the vault, never in config</Text>
            </>
          )}
        </Box>
      ) : null}

      {phase.kind === 'oauth' ? (
        <Box flexDirection="column">
          {phase.lines.slice(-8).map((line, i) => (
            <Text key={`${i}-${line.slice(0, 12)}`} color={Colors.chrome} wrap="truncate-end">
              {line}
            </Text>
          ))}
          {phase.prompt ? (
            <>
              <Text>{phase.prompt.question}</Text>
              <Text>
                <Text color={Colors.active}>{echo}</Text>
                <Text color={Colors.chrome}>▏</Text>
              </Text>
            </>
          ) : (
            <Text color={Colors.chrome}>waiting for sign-in to complete… esc to cancel</Text>
          )}
        </Box>
      ) : null}

      {phase.kind === 'done' ? (
        <Text color={Colors.active}>✓ connected{phase.note ? ` — ${phase.note}` : ''}</Text>
      ) : null}

      {phase.kind === 'failed' ? (
        <Box flexDirection="column">
          <Text color={Colors.danger}>{phase.message}</Text>
          <Text color={Colors.chrome}>{phase.retryable ? 'r retry · esc close' : 'esc close'}</Text>
        </Box>
      ) : null}
    </Modal>
  );
};
