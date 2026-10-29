/**
 * State of the New schedule form: the values, which problems to show (a field's
 * only after it was left, all of them after a save was tried), the sentence
 * that says what will happen, and the save itself. The rules live in
 * `schedule-form.ts`; this hook only decides when to apply them.
 */

import { useCallback, useState } from 'react';
import type { ScheduleCreateInput, ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import type { ScheduleCreateOutcome } from '@moxxy/client-core';
import {
  cleanNameInput,
  initialScheduleForm,
  scheduleFormProblems,
  scheduleFormSummary,
  slugifyScheduleName,
  toScheduleCreateInput,
  type ScheduleFormField,
  type ScheduleFormProblems,
  type ScheduleFormValues,
} from './schedule-form';

export interface ScheduleFormState {
  readonly values: ScheduleFormValues;
  /** The problems to show now. */
  readonly problems: ScheduleFormProblems;
  readonly summary: string | null;
  readonly busy: boolean;
  /** Why the host refused the last save. */
  readonly error: string | null;
  readonly set: (patch: Partial<ScheduleFormValues>) => void;
  /** The person left this field. */
  readonly touch: (field: ScheduleFormField) => void;
  readonly submit: () => Promise<void>;
}

export function useScheduleForm({
  create,
  onCreated,
  now = Date.now,
}: {
  readonly create: (input: ScheduleCreateInput) => Promise<ScheduleCreateOutcome>;
  readonly onCreated: (schedule: ScheduleSummary) => void;
  readonly now?: () => number;
}): ScheduleFormState {
  const [values, setValues] = useState(() => initialScheduleForm(now()));
  const [touched, setTouched] = useState<ReadonlySet<ScheduleFormField>>(() => new Set());
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((patch: Partial<ScheduleFormValues>) => {
    setError(null);
    setValues((cur) => {
      const next = { ...cur, ...patch };
      if (patch.name !== undefined) {
        const name = cleanNameInput(patch.name);
        return { ...next, name, nameEdited: name !== '' };
      }
      if (patch.prompt !== undefined && !cur.nameEdited) {
        return { ...next, name: slugifyScheduleName(patch.prompt) };
      }
      return next;
    });
  }, []);

  const touch = useCallback((field: ScheduleFormField) => {
    setTouched((cur) => (cur.has(field) ? cur : new Set(cur).add(field)));
  }, []);

  const all = scheduleFormProblems(values, now());
  const problems = tried ? all : shownProblems(all, touched);

  const submit = useCallback(async () => {
    setTried(true);
    if (Object.keys(scheduleFormProblems(values, now())).length > 0 || busy) return;
    setBusy(true);
    const outcome = await create(toScheduleCreateInput(values));
    setBusy(false);
    if (outcome.ok) onCreated(outcome.schedule);
    else setError(outcome.error);
  }, [values, busy, create, onCreated, now]);

  return { values, problems, summary: scheduleFormSummary(values), busy, error, set, touch, submit };
}

function shownProblems(
  all: ScheduleFormProblems,
  touched: ReadonlySet<ScheduleFormField>,
): ScheduleFormProblems {
  const shown: ScheduleFormProblems = {};
  for (const field of touched) if (all[field]) shown[field] = all[field];
  return shown;
}
