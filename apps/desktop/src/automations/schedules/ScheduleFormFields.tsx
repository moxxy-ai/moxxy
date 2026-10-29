/**
 * The New schedule form, drawn from the state `useScheduleForm` holds. One
 * question per field, in the order a person thinks about it: what, how often,
 * between when, what to call it, where it shows. A field says what is wrong
 * under itself once it was left, and the sentence at the foot says what will
 * happen before anything is saved.
 */

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Icon, ModalFooter, Select, TextArea, TextInput } from '@moxxy/desktop-ui';
import { TargetSessionPicker } from '../../apps/TargetSessionPicker';
import { Switch } from '../../settings/settings-primitives';
import { WEEKDAY_NAMES } from './cron-words';
import { HOUR_STEPS, MINUTE_STEPS, REPEAT_CHOICES, toLocalInput, type ScheduleRepeat } from './schedule-form';
import type { ScheduleFormState } from './useScheduleForm';

export function ScheduleFormFields({
  form,
  onCancel,
}: {
  readonly form: ScheduleFormState;
  readonly onCancel: () => void;
}): JSX.Element {
  const { values: v, problems, set, touch } = form;
  const ids = {
    prompt: useId(),
    repeat: useId(),
    name: useId(),
    from: useId(),
    until: useId(),
  };
  const submitOnModEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void form.submit();
    }
  };

  return (
    <form
      className="sched-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit();
      }}
    >
      <Field label="What should Moxxy do?" htmlFor={ids.prompt} problem={problems.prompt}>
        <TextArea
          id={ids.prompt}
          tone="soft"
          rows={3}
          autoFocus
          value={v.prompt}
          placeholder="Summarise my unread email and send it to me on Telegram"
          aria-invalid={problems.prompt ? true : undefined}
          onChange={(e) => set({ prompt: e.target.value })}
          onBlur={() => touch('prompt')}
          onKeyDown={submitOnModEnter}
        />
      </Field>

      <div className="sched-form__pair">
        <Field label="How often" htmlFor={ids.repeat}>
          <Select
            id={ids.repeat}
            tone="soft"
            value={v.repeat}
            onChange={(e) => set({ repeat: e.target.value as ScheduleRepeat })}
          >
            {REPEAT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <RepeatDetail form={form} />
      </div>

      {v.repeat !== 'once' && (
        <div className="sched-form__window">
          <div className="sched-form__switch">
            <div>
              <span className="sched-form__label">Only between two dates</span>
              <span className="sched-form__hint">It turns itself off after the end.</span>
            </div>
            <Switch
              on={v.limitWindow}
              label="Only between two dates"
              onClick={() => set({ limitWindow: !v.limitWindow })}
            />
          </div>
          {v.limitWindow && (
            <div className="sched-form__pair">
              <Field label="From" htmlFor={ids.from} problem={problems.from}>
                <TextInput
                  id={ids.from}
                  tone="soft"
                  type="datetime-local"
                  value={v.from}
                  aria-invalid={problems.from ? true : undefined}
                  onChange={(e) => set({ from: e.target.value })}
                  onBlur={() => touch('from')}
                />
              </Field>
              <Field label="Until" htmlFor={ids.until} problem={problems.until}>
                <TextInput
                  id={ids.until}
                  tone="soft"
                  type="datetime-local"
                  value={v.until}
                  min={v.from}
                  aria-invalid={problems.until ? true : undefined}
                  onChange={(e) => set({ until: e.target.value })}
                  onBlur={() => touch('until')}
                />
              </Field>
            </div>
          )}
        </div>
      )}

      <div className="sched-form__pair">
        <Field
          label="Name"
          htmlFor={ids.name}
          problem={problems.name}
          hint="Filled in from what you wrote."
        >
          <TextInput
            id={ids.name}
            tone="soft"
            mono
            spellCheck={false}
            value={v.name}
            placeholder="morning-email"
            aria-invalid={problems.name ? true : undefined}
            onChange={(e) => set({ name: e.target.value })}
            onBlur={() => touch('name')}
          />
        </Field>
        <Field label="Runs in" hint="The chat that shows each run.">
          <TargetSessionPicker
            label=""
            value={v.targetSessionId}
            valueName={null}
            onChange={(targetSessionId) => set({ targetSessionId })}
          />
        </Field>
      </div>

      <p className="sched-form__summary" aria-live="polite">
        <Icon name="clock" size={14} />
        <span>{form.summary ?? 'Choose when it runs.'}</span>
      </p>

      {form.error && (
        <p className="sched-form__error" role="alert">
          {form.error}
        </p>
      )}

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="cta" type="submit" disabled={form.busy}>
          {form.busy ? 'Creating…' : 'Create schedule'}
        </Button>
      </ModalFooter>
    </form>
  );
}

/** The control that goes with the chosen repeat: a step, a time, a day, a moment or a cron. */
function RepeatDetail({ form }: { readonly form: ScheduleFormState }): JSX.Element {
  const { values: v, problems, set, touch } = form;
  const id = useId();
  const time = (
    <TextInput
      id={id}
      tone="soft"
      type="time"
      value={v.time}
      aria-invalid={problems.time ? true : undefined}
      onChange={(e) => set({ time: e.target.value })}
      onBlur={() => touch('time')}
    />
  );
  switch (v.repeat) {
    case 'minutes':
      return (
        <Field label="Every" htmlFor={id}>
          <Select id={id} tone="soft" value={v.everyMinutes} onChange={(e) => set({ everyMinutes: Number(e.target.value) })}>
            {MINUTE_STEPS.map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'hours':
      return (
        <Field label="Every" htmlFor={id}>
          <Select id={id} tone="soft" value={v.everyHours} onChange={(e) => set({ everyHours: Number(e.target.value) })}>
            {HOUR_STEPS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 hour' : `${n} hours`}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'daily':
    case 'weekdays':
      return (
        <Field label="At" htmlFor={id} problem={problems.time}>
          {time}
        </Field>
      );
    case 'weekly':
      return (
        <div className="sched-form__pair sched-form__pair--tight">
          <Field label="On">
            <Select
              tone="soft"
              aria-label="Day of the week"
              value={v.weekday}
              onChange={(e) => set({ weekday: Number(e.target.value) })}
            >
              {/* Monday first, the way a week is read here. */}
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_NAMES[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="At" htmlFor={id} problem={problems.time}>
            {time}
          </Field>
        </div>
      );
    case 'once':
      return (
        <Field label="On" htmlFor={id} problem={problems.at}>
          <TextInput
            id={id}
            tone="soft"
            type="datetime-local"
            value={v.at}
            min={toLocalInput(Date.now())}
            aria-invalid={problems.at ? true : undefined}
            onChange={(e) => set({ at: e.target.value })}
            onBlur={() => touch('at')}
          />
        </Field>
      );
    case 'custom':
      return (
        <Field label="Cron" htmlFor={id} problem={problems.cron} hint="minute hour day month weekday">
          <TextInput
            id={id}
            tone="soft"
            mono
            spellCheck={false}
            value={v.cron}
            placeholder="*/30 * * * *"
            aria-invalid={problems.cron ? true : undefined}
            onChange={(e) => set({ cron: e.target.value })}
            onBlur={() => touch('cron')}
          />
        </Field>
      );
  }
}

/** A label over its control, with what is wrong (or a hint) under it. */
function Field({
  label,
  htmlFor,
  problem,
  hint,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly problem?: string | undefined;
  readonly hint?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className="sched-form__field">
      {htmlFor ? (
        <label className="sched-form__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="sched-form__label">{label}</span>
      )}
      {children}
      {problem ? (
        <span className="sched-form__problem">{problem}</span>
      ) : (
        hint && <span className="sched-form__hint">{hint}</span>
      )}
    </div>
  );
}
