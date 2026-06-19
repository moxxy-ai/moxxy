import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  builderReducer,
  emptyState,
  hydrateYaml,
  mapErrorsToNodes,
  serialize,
  type BuilderAction,
  type BuilderState,
  type SaveResult,
} from '@moxxy/workflows-builder';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

/**
 * The transport-neutral builder hook shared by the desktop canvas and the
 * mobile editor. It owns the canvas reducer, loads a saved workflow's YAML via
 * `workflows.getRun`, debounces a live `workflows.validateDraft` on every edit
 * (mapping issues back onto nodes), and persists via `workflows.save`. It is
 * DOM-free: it reaches the host only through the injected {@link api} transport,
 * so the same hook drives the Electron preload bridge and the mobile WS bridge.
 */

export interface UseWorkflowBuilder {
  readonly state: BuilderState;
  readonly dispatch: (action: BuilderAction) => void;
  /** Last validation outcome (null until the first run completes). */
  readonly valid: boolean | null;
  readonly validating: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  /** Load an existing workflow into the canvas (by name), or start empty. */
  readonly load: (name: string | null) => Promise<void>;
  /** Run validation now (also auto-runs, debounced, on edits). */
  readonly validateNow: () => Promise<void>;
  /** Validate + persist; returns the save result or null on failure. */
  readonly save: () => Promise<SaveResult | null>;
}

const VALIDATE_DEBOUNCE_MS = 400;

export function useWorkflowBuilder(): UseWorkflowBuilder {
  const [state, dispatch] = useReducer(builderReducer, undefined, () => emptyState());
  const [valid, setValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a live ref to the latest state so the debounced validator reads fresh
  // data without re-subscribing the timer on every keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;

  // The name the builder loaded (null for a fresh workflow). Carried to `save`
  // as `previousName` so renaming a workflow removes the old file/entry instead
  // of leaving an orphaned duplicate.
  const loadedNameRef = useRef<string | null>(null);

  // Monotonic load/validate epoch. Bumped on every `load()` so an in-flight
  // `getRun` (or a debounced `validateDraft`) that resolves AFTER a newer load
  // can't clobber the canvas with stale YAML / stale node errors. Without it,
  // two concurrent loads on one mounted instance race — whichever IPC lands last
  // wins, even if it was requested first — and a validation that started against
  // workflow A can paint A's errors onto B's freshly-loaded nodes.
  const loadEpochRef = useRef(0);
  // Guards async post-await writes after the hook unmounts (no setState on a
  // dead tree, no dispatch into a torn-down reducer).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runValidation = useCallback(async (): Promise<boolean> => {
    const snapshot = stateRef.current;
    const epoch = loadEpochRef.current;
    setValidating(true);
    try {
      const { yaml } = serialize(snapshot);
      const result = await api().invoke('workflows.validateDraft', { yaml });
      // A load() that swapped the canvas while this validation was in flight
      // makes the result stale — applying it would paint the old workflow's
      // errors onto the new nodes. Bail (still resolving the validity for the
      // caller, but no state writes against the stale epoch).
      if (!mountedRef.current || loadEpochRef.current !== epoch) return result.ok;
      dispatch({ type: 'apply-validation', errors: mapErrorsToNodes(result.errors, snapshot) });
      setValid(result.ok);
      setError(null);
      return result.ok;
    } catch (e) {
      if (mountedRef.current && loadEpochRef.current === epoch) {
        setError(toErrorMessage(e));
        setValid(null);
      }
      return false;
    } finally {
      if (mountedRef.current && loadEpochRef.current === epoch) setValidating(false);
    }
  }, []);

  // Debounced live validation: any content change re-validates after a pause.
  // `nodes`/`edges`/`meta` identity changes on edits; viewport-only pans don't.
  const validateNow = useCallback(async () => {
    await runValidation();
  }, [runValidation]);

  useEffect(() => {
    if (state.nodes.length === 0) {
      setValid(null);
      return;
    }
    const t = setTimeout(() => void runValidation(), VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state.nodes, state.edges, state.meta, runValidation]);

  const load = useCallback(async (name: string | null) => {
    // Open a new epoch: any in-flight load/validation from a prior call is now
    // stale and must not write back. The latest load() always wins.
    const epoch = (loadEpochRef.current += 1);
    setError(null);
    setValid(null);
    loadedNameRef.current = null;
    if (!name) {
      dispatch({ type: 'load', state: emptyState() });
      return;
    }
    try {
      const detail = await api().invoke('workflows.getRun', { name });
      // A newer load() (or unmount) superseded this one mid-flight — drop the
      // result so a slow getRun for an earlier name can't overwrite the canvas.
      if (!mountedRef.current || loadEpochRef.current !== epoch) return;
      if (!detail) {
        setError(`workflow "${name}" was not found`);
        return;
      }
      loadedNameRef.current = detail.name;
      dispatch({ type: 'load', state: hydrateYaml(detail.yaml) });
    } catch (e) {
      if (mountedRef.current && loadEpochRef.current === epoch) setError(toErrorMessage(e));
    }
  }, []);

  const save = useCallback(async (): Promise<SaveResult | null> => {
    setSaving(true);
    setError(null);
    try {
      const ok = await runValidation();
      if (!ok) {
        setError('Fix the highlighted errors before saving.');
        return null;
      }
      const { yaml } = serialize(stateRef.current);
      const previousName = loadedNameRef.current;
      const result = await api().invoke('workflows.save', {
        yaml,
        ...(previousName ? { previousName } : {}),
      });
      // The saved name becomes the new baseline so a subsequent rename in the
      // same session also cleans up correctly.
      loadedNameRef.current = result.name;
      dispatch({ type: 'mark-saved' });
      return result;
    } catch (e) {
      setError(toErrorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [runValidation]);

  return useMemo(
    () => ({ state, dispatch, valid, validating, saving, error, load, validateNow, save }),
    [state, valid, validating, saving, error, load, validateNow, save],
  );
}
