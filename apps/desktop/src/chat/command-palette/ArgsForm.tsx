/**
 * The args phase of the actions palette — shown only when the picked
 * action takes parameters. Every arg field is rendered AT ONCE (no
 * step-by-step); the user fills them all in and clicks Run (or Cmd/
 * Ctrl+Enter). Back returns to the list; Cancel closes the palette.
 */

import { useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { Button, Icon, Modal, TextInput } from '@moxxy/desktop-ui';
import { humanize } from './steppers';
import type { ArgStep, CommandInfo } from './types';

export function ArgsForm({
  command,
  steps,
  running,
  onBack,
  onRun,
  onCancel,
}: {
  readonly command: CommandInfo;
  readonly steps: ReadonlyArray<ArgStep>;
  readonly running: boolean;
  readonly onBack: () => void;
  readonly onRun: (values: ReadonlyArray<string>) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [values, setValues] = useState<string[]>(() => steps.map(() => ''));
  const canRun =
    steps.every((_, i) => {
      const v = values[i];
      assertDefined(v, 'values holds one entry per step');
      return v.trim().length > 0;
    }) && !running;

  return (
    <Modal title={humanize(command.name)} onClose={onCancel} width={520}>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canRun) {
            e.preventDefault();
            onRun(values);
          }
        }}
      >
        {command.description && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {command.description}
          </p>
        )}
        {steps.map((step, i) => (
          <label key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
              {step.label}
            </span>
            <TextInput
              tone="soft"
              mono={!step.secret}
              autoFocus={i === 0}
              type={step.secret ? 'password' : 'text'}
              value={values[i]}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                setValues(next);
              }}
              placeholder={step.placeholder}
              spellCheck={false}
              autoComplete="off"
              disabled={running}
              style={step.secret ? { fontFamily: 'inherit' } : undefined}
            />
            {step.help && (
              <span style={{ fontSize: 11, color: 'var(--color-text-dim)' }}>{step.help}</span>
            )}
          </label>
        ))}
        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Button variant="ghost" onClick={onBack} disabled={running}>
            ← Back
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onCancel} disabled={running}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={() => onRun(values)}
              disabled={!canRun}
              style={{ opacity: canRun ? 1 : 0.5 }}
            >
              {running ? 'Running…' : 'Run'}
              <Icon name="send" size={13} />
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
