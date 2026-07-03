import type { PluginSetupField, PluginSetupSpec } from '@moxxy/sdk';

/**
 * Headless field-walk behind the post-install / `/setup` dialog: one field
 * at a time, values accumulate, Tab skips an optional field, Esc cancels the
 * whole step. Pure state transitions so the Ink component stays a renderer
 * and the semantics are unit-testable.
 */
export interface PluginSetupFlowState {
  readonly index: number;
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly error: string | null;
  readonly done: boolean;
  readonly cancelled: boolean;
}

export interface PluginSetupFlow {
  readonly spec: PluginSetupSpec;
  state(): PluginSetupFlowState;
  current(): PluginSetupField | null;
  /** Submit the current field's value. Empty string on a required field
   *  errors (secrets excluded — an existing vault entry may satisfy it;
   *  completeness is decided by applySetup). */
  submit(value: string | boolean): void;
  /** Skip the current field (optional fields; secrets = keep existing). */
  skip(): void;
  cancel(): void;
}

export function createPluginSetupFlow(
  spec: PluginSetupSpec,
  onFinish: (values: Readonly<Record<string, string | boolean>> | null) => void,
): PluginSetupFlow {
  let index = 0;
  let error: string | null = null;
  let done = false;
  let cancelled = false;
  const values: Record<string, string | boolean> = {};

  const finish = (): void => {
    if (done || cancelled) return;
    done = true;
    onFinish(values);
  };

  const advance = (): void => {
    error = null;
    index += 1;
    if (index >= spec.fields.length) finish();
  };

  return {
    spec,
    state: () => ({ index, values: { ...values }, error, done, cancelled }),
    current: () => (done || cancelled ? null : (spec.fields[index] ?? null)),
    submit: (value) => {
      const field = spec.fields[index];
      if (!field || done || cancelled) return;
      if (typeof value === 'string' && value.trim().length === 0) {
        // Empty submit = skip semantics; required non-secret fields refuse
        // (a required SECRET may be satisfied by an existing vault entry —
        // applySetup decides completeness).
        if (field.required !== false && field.kind !== 'secret') {
          error = `${field.label} is required`;
          return;
        }
        advance();
        return;
      }
      values[field.key] = typeof value === 'string' ? value.trim() : value;
      advance();
    },
    skip: () => {
      const field = spec.fields[index];
      if (!field || done || cancelled) return;
      if (field.required !== false && field.kind !== 'secret') {
        error = `${field.label} is required (esc to cancel the whole setup)`;
        return;
      }
      advance();
    },
    cancel: () => {
      if (done || cancelled) return;
      cancelled = true;
      onFinish(null);
    },
  };
}
