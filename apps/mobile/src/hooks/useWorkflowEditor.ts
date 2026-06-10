import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, decodeError } from '@moxxy/client-core';
import {
  builderReducer,
  emptyState,
  hydrateYaml,
  mapErrorsToNodes,
  serialize,
  type BuilderAction,
  type BuilderState,
} from '@moxxy/workflows-builder';
import {
  buildWorkflowDetailFrame,
  buildWorkflowSaveFrame,
  buildWorkflowValidateFrame,
  invokeFrame,
} from '../clientFrames';

/**
 * Mobile builder hook — the same shared `@moxxy/workflows-builder` model that
 * powers the desktop canvas, driven over the mobile frame bridge instead of the
 * Electron preload. The mobile UI is an OUTLINE editor (a node list with the
 * same operations), so the hook exposes the reducer + the validate/save bridge;
 * there is no canvas-specific state here.
 *
 * `validateDraft` / `save` / `getRun` are wired on the host's MobileSessionHost
 * (the engine added them to the WorkflowsView pass-through). When the workflows
 * plugin is absent the host throws the coded `not-supported` error, which we
 * surface as a plain message rather than crashing the screen.
 */
export interface UseWorkflowEditor {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
  readonly valid: boolean | null;
  readonly validating: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly saved: boolean;
  readonly load: (name: string | null) => Promise<void>;
  readonly save: () => Promise<boolean>;
}

const VALIDATE_DEBOUNCE_MS = 500;

export function useWorkflowEditor(): UseWorkflowEditor {
  const [state, dispatch] = useReducer(builderReducer, undefined, () => emptyState());
  const [valid, setValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;

  const toMessage = useCallback((e: unknown): string => {
    const decoded = decodeError(e);
    return decoded.code === 'not-supported'
      ? 'The workflow builder is not available on this host.'
      : decoded.message;
  }, []);

  const runValidation = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    setValidating(true);
    try {
      const { yaml } = serialize(snapshot);
      const result = await invokeFrame(api(), buildWorkflowValidateFrame({ yaml }));
      dispatch({ type: 'apply-validation', errors: mapErrorsToNodes(result.errors, snapshot) });
      setValid(result.ok);
      setError(null);
      return result.ok;
    } catch (e) {
      setError(toMessage(e));
      setValid(null);
      return false;
    } finally {
      setValidating(false);
    }
  }, [toMessage]);

  useEffect(() => {
    setSaved(false);
    if (state.nodes.length === 0) {
      setValid(null);
      return;
    }
    const t = setTimeout(() => void runValidation(), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state.nodes, state.edges, state.meta, runValidation]);

  const load = useCallback(
    async (name: string | null) => {
      setError(null);
      setValid(null);
      setSaved(false);
      if (!name) {
        dispatch({ type: 'load', state: emptyState() });
        return;
      }
      try {
        const detail = await invokeFrame(api(), buildWorkflowDetailFrame({ name }));
        if (!detail) {
          setError(`Workflow "${name}" was not found.`);
          return;
        }
        dispatch({ type: 'load', state: hydrateYaml(detail.yaml) });
      } catch (e) {
        setError(toMessage(e));
      }
    },
    [toMessage],
  );

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const ok = await runValidation();
      if (!ok) {
        setError('Fix the highlighted issues before saving.');
        return false;
      }
      const { yaml } = serialize(stateRef.current);
      await invokeFrame(api(), buildWorkflowSaveFrame({ yaml }));
      dispatch({ type: 'mark-saved' });
      setSaved(true);
      return true;
    } catch (e) {
      setError(toMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [runValidation, toMessage]);

  return useMemo(
    () => ({ state, dispatch, valid, validating, saving, error, saved, load, save }),
    [state, valid, validating, saving, error, saved, load, save],
  );
}
