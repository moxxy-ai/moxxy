import React, { useRef, useState } from 'react';
import { Text, useInput } from 'ink';
import { ENV_SHARE_PRIVACY_NOTE } from '@moxxy/sdk/questions';
import type { QuestionItem } from '@moxxy/sdk';
import { terminalSafeText } from './terminal-text.js';
import { Modal } from './Modal.js';

export function EnvShareDialog({ item, submit }: {
  item: QuestionItem;
  submit(value: string | null): Promise<void>;
}): React.ReactElement {
  const value = useRef('');
  const locked = useRef(false);
  const [length, setLength] = useState(0);
  const [error, setError] = useState('');
  useInput((input, key) => {
    if (locked.current) return;
    if (key.return || key.escape) {
      if (!key.escape && !value.current) return;
      locked.current = true;
      void submit(key.escape ? null : value.current).then(() => { value.current = ''; }).catch(() => {
        locked.current = false;
        setError('Could not finish Env Share. Check the vault and try again.');
      });
      return;
    }
    if (key.backspace || key.delete) value.current = value.current.slice(0, -1);
    else if (!key.ctrl && !key.meta && input && !/[\x00-\x1f\x7f]/.test(input)) {
      if (value.current.length + input.length > 65536) {
        value.current = '';
        setLength(0);
        setError('The value exceeds 65536 characters.');
        return;
      }
      value.current += input;
    }
    setLength(value.current.length);
    setError('');
  });
  return (
    <Modal title="Env Share" hints="Enter save · Esc skip">
      <Text>{terminalSafeText(item.question, 440)}</Text>
      <Text dimColor>Save or replace {item.vaultName} in your vault.</Text>
      <Text>{'•'.repeat(Math.min(length, 32))}</Text>
      {error ? <Text>{error}</Text> : null}
      <Text dimColor>{ENV_SHARE_PRIVACY_NOTE}</Text>
    </Modal>
  );
}
