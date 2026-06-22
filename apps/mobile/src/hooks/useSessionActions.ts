import { api, toErrorMessage } from '@moxxy/client-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  actionMatchesFilter,
  buildMobileSessionActionRows,
  encodeSessionCommandArgs,
  subcommandForSessionAction,
  type MobileCommandInfo,
  type MobileSessionActionRow,
} from '../sessionActions';

export interface UseSessionActionsInput {
  readonly workspaceId: string | null;
  readonly readOnly: boolean;
  readonly onRunCommand: (name: string, args?: string) => void;
}

export function useSessionActions(input: UseSessionActionsInput) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [commands, setCommands] = useState<ReadonlyArray<MobileCommandInfo> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [argsFor, setArgsFor] = useState<MobileSessionActionRow | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !input.workspaceId) return;
    let cancelled = false;
    setError(null);
    void api()
      .invoke('session.info', { workspaceId: input.workspaceId })
      .then((info) => {
        if (cancelled) return;
        setCommands(info?.commands ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setCommands(null);
        setError(toErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [input.workspaceId, open]);

  const actions = useMemo(() => buildMobileSessionActionRows(commands ?? undefined), [commands]);
  const filteredActions = useMemo(
    () => actions.filter((action) => actionMatchesFilter(action, filter)),
    [actions, filter],
  );

  const close = useCallback(() => {
    setOpen(false);
    setFilter('');
    setArgsFor(null);
    setArgValues({});
  }, []);

  const openSheet = useCallback(() => {
    setOpen(true);
  }, []);

  const selectAction = useCallback(
    (action: MobileSessionActionRow) => {
      if (input.readOnly) return;
      if (action.args.length > 0) {
        setArgsFor(action);
        setArgValues(Object.fromEntries(action.args.map((arg) => [arg.id, ''])));
        return;
      }
      input.onRunCommand(action.name, '');
      close();
    },
    [close, input],
  );

  const setArgValue = useCallback((id: string, value: string) => {
    setArgValues((current) => ({ ...current, [id]: value }));
  }, []);

  const runArgsAction = useCallback(() => {
    if (!argsFor || input.readOnly) return;
    const subcommand = subcommandForSessionAction(argsFor.name);
    const values = argsFor.args.map((arg) => argValues[arg.id] ?? '');
    input.onRunCommand(argsFor.name, encodeSessionCommandArgs([...(subcommand ? [subcommand] : []), ...values]));
    close();
  }, [argsFor, argValues, close, input]);

  const backToList = useCallback(() => {
    setArgsFor(null);
    setArgValues({});
  }, []);

  return {
    open,
    openSheet,
    close,
    filter,
    setFilter,
    actions: filteredActions,
    allActionsCount: actions.length,
    error,
    argsFor,
    argValues,
    selectAction,
    setArgValue,
    runArgsAction,
    backToList,
  };
}
