import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { PluginSetupSpec } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';
import {
  createPluginSetupFlow,
  type PluginSetupFlow,
} from '../session/plugin-setup-flow.js';

export interface PluginSetupDialogProps {
  readonly packageName: string;
  readonly spec: PluginSetupSpec;
  /** Collected values (null = cancelled). Parent persists via applySetup. */
  readonly onFinish: (values: Readonly<Record<string, string | boolean>> | null) => void;
}

/**
 * Post-install / `/setup` configuration dialog: walks the plugin's declared
 * fields right in the InteractiveZone slot — no leaving the TUI for
 * `moxxy init`. Secrets render masked; booleans are y/n; selects cycle with
 * ↑/↓. Tab skips optional fields; Esc cancels the whole step (a required
 * setup then leaves the package disabled, exactly like skipping it in init).
 */
export const PluginSetupDialog: React.FC<PluginSetupDialogProps> = ({
  packageName,
  spec,
  onFinish,
}) => {
  const flowRef = React.useRef<PluginSetupFlow | null>(null);
  if (flowRef.current === null) {
    flowRef.current = createPluginSetupFlow(spec, onFinish);
  }
  const flow = flowRef.current;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const [buffer, setBuffer] = React.useState('');
  const [selectIndex, setSelectIndex] = React.useState(0);

  const field = flow.current();
  const state = flow.state();

  useInput((input, key) => {
    if (key.escape) {
      flow.cancel();
      return;
    }
    if (!field) return;
    if (key.tab) {
      flow.skip();
      setBuffer('');
      setSelectIndex(0);
      bump();
      return;
    }
    if (field.kind === 'boolean') {
      const ch = input.toLowerCase();
      if (ch === 'y') flow.submit(true);
      else if (ch === 'n') flow.submit(false);
      else return;
      bump();
      return;
    }
    if (field.kind === 'select') {
      const choices = field.options ?? [];
      if (key.upArrow) setSelectIndex((i) => (i - 1 + choices.length) % choices.length);
      else if (key.downArrow) setSelectIndex((i) => (i + 1) % choices.length);
      else if (key.return && choices.length > 0) {
        flow.submit(choices[selectIndex]!);
        setSelectIndex(0);
        bump();
      }
      return;
    }
    // secret / string
    if (key.return) {
      flow.submit(buffer);
      setBuffer('');
      bump();
      return;
    }
    if (key.backspace || key.delete) {
      setBuffer((b) => b.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow) {
      setBuffer((b) => b + input);
    }
  });

  const progress = `${Math.min(state.index + 1, spec.fields.length)}/${spec.fields.length}`;

  return (
    <Modal title={`setup ${packageName}`} subtitle={spec.title}>
      {spec.description ? <Text color={Colors.chrome}>{spec.description}</Text> : null}
      {field ? (
        <Box flexDirection="column">
          {state.error ? <Text color={Colors.danger}>{state.error}</Text> : null}
          <Text>
            <Text color={Colors.chrome}>[{progress}] </Text>
            {field.label}
            {field.required === false ? <Text color={Colors.chrome}> (optional)</Text> : null}
          </Text>
          {field.description ? <Text color={Colors.chrome}>{field.description}</Text> : null}
          {field.kind === 'boolean' ? (
            <Text color={Colors.chrome}>y yes · n no · tab skip · esc cancel</Text>
          ) : field.kind === 'select' ? (
            <Box flexDirection="column">
              {(field.options ?? []).map((c, i) => (
                <Text key={c} color={i === selectIndex ? Colors.active : undefined}>
                  {i === selectIndex ? '› ' : '  '}
                  {c}
                </Text>
              ))}
              <Text color={Colors.chrome}>↑↓ choose · enter confirm · esc cancel</Text>
            </Box>
          ) : (
            <>
              <Text>
                <Text color={Colors.active}>
                  {field.kind === 'secret' ? '•'.repeat(buffer.length) : buffer}
                </Text>
                <Text color={Colors.chrome}>▏</Text>
              </Text>
              <Text color={Colors.chrome}>
                {field.kind === 'secret'
                  ? 'enter save (empty keeps an existing value) · esc cancel'
                  : 'enter save · tab skip · esc cancel'}
              </Text>
            </>
          )}
        </Box>
      ) : (
        <Text color={Colors.chrome}>saving…</Text>
      )}
    </Modal>
  );
};
