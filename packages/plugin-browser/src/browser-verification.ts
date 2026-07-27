import type { z } from '@moxxy/sdk';
import type { browserExpectationSchema, BrowserTarget } from './browser-action.js';
import type { BrowserSessionAction } from './browser-action.js';
import { BrowserOperationError } from './browser-errors.js';

export type BrowserExpectation = z.infer<typeof browserExpectationSchema>;

interface BrowserStateLike {
  readonly revision?: unknown;
  readonly domRevision?: unknown;
  readonly visualRevision?: unknown;
  readonly url?: unknown;
  readonly visibleText?: unknown;
  readonly nodes?: unknown;
}

export interface BrowserStateDiff {
  readonly changed: boolean;
  readonly urlChanged: boolean;
  readonly textChanged: boolean;
  readonly domChanged: boolean;
  readonly addedNodes: ReadonlyArray<unknown>;
  readonly removedRefs: ReadonlyArray<string>;
}

export type BrowserVerificationStatus =
  | 'verified'
  | 'changed_but_unverified'
  | 'no_state_change'
  | 'verification_failed';

export interface VerifiedBrowserActionResult {
  readonly actionResult: unknown;
  readonly before: unknown;
  readonly after: unknown;
  readonly diff: BrowserStateDiff;
  readonly status: BrowserVerificationStatus;
  readonly verification?: { readonly ok: boolean; readonly evidence: string };
}

export async function executeVerifiedBrowserAction(
  action: BrowserSessionAction,
  invoke: (action: BrowserSessionAction) => Promise<unknown>,
  options: { readonly stabilizationMs: number; readonly signal?: AbortSignal },
): Promise<unknown> {
  if (!isMutatingBrowserAction(action)) return invoke(action);
  const observationAction: BrowserSessionAction = {
    kind: 'observe', mode: 'auto',
    ...('tabId' in action && action.tabId ? { tabId: action.tabId } : {}),
  };
  const before = await invoke(observationAction);
  const actionResult = await invoke(action);
  let after = await stableObservation(observationAction, invoke, options);
  const expectation = 'expect' in action ? action.expect : undefined;
  if (expectationNeedsInspection(expectation)) {
    let inspection: unknown = null;
    try {
      const inspected = await invoke({
        kind: 'inspect',
        target: expectation.target,
        ...('tabId' in action && action.tabId ? { tabId: action.tabId } : {}),
      });
      inspection = asRecord(inspected).inspection ?? inspected;
    } catch {
      inspection = null;
    }
    after = { ...asRecord(after), inspection };
  }
  const diff = diffBrowserStates(before, after);
  if (!hasObservableState(before) || !hasObservableState(after)) {
    return {
      actionResult,
      before: stripImageBytes(before),
      after: stripImageBytes(after),
      diff,
      status: 'changed_but_unverified',
      verificationRequired: true,
    };
  }
  const verification = expectation
    ? verifyBrowserExpectation(expectation, after, before)
    : undefined;
  const status: BrowserVerificationStatus = !diff.changed
    ? 'no_state_change'
    : verification
      ? verification.ok ? 'verified' : 'verification_failed'
      : 'changed_but_unverified';
  const result = packageVerifiedResult({
    actionResult,
    before: stripImageBytes(before),
    after: stripImageBytes(after),
    diff,
    status,
    ...(verification ? { verification } : {}),
  }, after);
  if (status === 'no_state_change') {
    throw new BrowserOperationError({
      code: 'NO_STATE_CHANGE',
      message: `Browser action produced no observable state change. Evidence: ${JSON.stringify(result)}`,
      nextAction: 'observe',
      retryable: true,
    });
  }
  if (status === 'verification_failed') {
    throw new BrowserOperationError({
      code: 'VERIFICATION_FAILED',
      message: `Browser postcondition failed: ${verification?.evidence ?? 'no evidence'}`,
      nextAction: 'observe',
      retryable: true,
    });
  }
  return result;
}

export function diffBrowserStates(before: unknown, after: unknown): BrowserStateDiff {
  const previous = asState(before);
  const current = asState(after);
  const beforeNodes = nodesByIdentity(previous.nodes);
  const afterNodes = nodesByIdentity(current.nodes);
  const addedNodes = [...afterNodes.entries()]
    .filter(([key]) => !beforeNodes.has(key))
    .map(([, node]) => node);
  const removedRefs = [...beforeNodes.keys()].filter((key) => !afterNodes.has(key));
  const changedNode = [...afterNodes.entries()].some(([key, node]) => {
    const previousNode = beforeNodes.get(key);
    return previousNode !== undefined && JSON.stringify(previousNode) !== JSON.stringify(node);
  });
  const urlChanged = stringValue(previous.url) !== stringValue(current.url);
  const textChanged = stringValue(previous.visibleText) !== stringValue(current.visibleText);
  const domChanged =
    revisionValue(previous) !== revisionValue(current) ||
    addedNodes.length > 0 || changedNode ||
    removedRefs.length > 0;
  return {
    changed: urlChanged || textChanged || domChanged,
    urlChanged,
    textChanged,
    domChanged,
    addedNodes,
    removedRefs,
  };
}

export function verifyBrowserExpectation(
  expectation: BrowserExpectation,
  state: unknown,
  previousState?: unknown,
): { readonly ok: boolean; readonly evidence: string } {
  const current = asState(state);
  if (expectation.type === 'url') {
    const url = stringValue(current.url);
    return {
      ok: url.includes(expectation.includes),
      evidence: `URL ${url.includes(expectation.includes) ? 'contains' : 'does not contain'} "${expectation.includes}"`,
    };
  }
  if (expectation.type === 'text') {
    const visibleText = stringValue(current.visibleText);
    const previousText = stringValue(asState(previousState).visibleText);
    if (previousText.includes(expectation.text)) {
      return {
        ok: false,
        evidence: `visible text already contained "${expectation.text}" before the action`,
      };
    }
    return {
      ok: visibleText.includes(expectation.text),
      evidence: `visible text ${visibleText.includes(expectation.text) ? 'contains' : 'does not contain'} "${expectation.text}"`,
    };
  }
  if (expectation.type === 'visual_region') {
    const currentVisual = stringValue(asRecord(state).visualRevision);
    const previousVisual = stringValue(asRecord(previousState).visualRevision);
    const changed = currentVisual.length > 0 && currentVisual !== previousVisual;
    return { ok: changed, evidence: changed ? 'visual region changed' : 'visual region did not change' };
  }
  const nodes = Array.isArray(current.nodes) ? current.nodes : [];
  const targetNode = nodes.find((node) => matchesTarget(node, expectation.target));
  const inspected = asRecord(asRecord(state).inspection);
  if (expectation.type === 'element') {
    const visible = typeof inspected.visible === 'boolean'
      ? inspected.visible
      : targetNode !== undefined;
    const ok = expectation.state === 'visible' ? visible : !visible;
    return { ok, evidence: `element is ${visible ? 'visible' : 'hidden or absent'}` };
  }
  if (expectation.type === 'control') {
    const value = inspected[expectation.property] ??
      (targetNode ? asRecord(targetNode)[expectation.property] : undefined);
    const ok = value === expectation.equals;
    return { ok, evidence: `control ${expectation.property} is ${JSON.stringify(value)}` };
  }
  const styles = asRecord(inspected.styles);
  const actual = asRecord(styles)[expectation.property];
  return {
    ok: actual === expectation.equals,
    evidence: `computed ${expectation.property} is ${JSON.stringify(actual)}`,
  };
}

function asState(value: unknown): BrowserStateLike {
  return asRecord(value) as BrowserStateLike;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isMutatingBrowserAction(action: BrowserSessionAction): boolean {
  return [
    'goto', 'click', 'type', 'press', 'scroll', 'drag', 'select', 'upload',
    'back', 'forward', 'reload', 'eval',
  ].includes(action.kind);
}

function expectationNeedsInspection(
  expectation: BrowserExpectation | undefined,
): expectation is Extract<BrowserExpectation, { readonly target: unknown }> {
  if (!expectation || !('target' in expectation)) return false;
  return expectation.type === 'computed_style' || expectation.target.type === 'selector';
}

async function stableObservation(
  action: BrowserSessionAction,
  invoke: (action: BrowserSessionAction) => Promise<unknown>,
  options: { readonly stabilizationMs: number; readonly signal?: AbortSignal },
): Promise<unknown> {
  const started = Date.now();
  let previous: unknown;
  let hasPrevious = false;
  let current: unknown = null;
  do {
    await abortableDelay(options.stabilizationMs, options.signal);
    current = await invoke(action);
    if (!hasObservableState(current)) return current;
    if (hasPrevious && revisionValue(asState(previous)) === revisionValue(asState(current))) {
      return preserveLatestImage(previous, current);
    }
    previous = current;
    hasPrevious = true;
  } while (Date.now() - started < 5_000);
  return current;
}

function preserveLatestImage(previous: unknown, current: unknown): unknown {
  const prior = asRecord(previous);
  const next = asRecord(current);
  if (typeof next.base64 === 'string' || typeof prior.base64 !== 'string') return current;
  return {
    ...next,
    base64: prior.base64,
    ...(typeof prior.mediaType === 'string' ? { mediaType: prior.mediaType } : {}),
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function stripImageBytes(value: unknown): unknown {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return value;
  const { base64: _base64, data: _data, forModel: _forModel, ...safe } = record;
  return safe;
}

function packageVerifiedResult(result: VerifiedBrowserActionResult, after: unknown): unknown {
  const state = asRecord(after);
  const base64 = typeof state.base64 === 'string' ? state.base64 : null;
  const mediaType = typeof state.mediaType === 'string' ? state.mediaType : null;
  if (base64 === null || mediaType === null) return result;
  return {
    ...result,
    mediaType,
    base64,
    forModel: JSON.stringify({
      status: result.status,
      verification: result.verification,
      diff: result.diff,
      after: result.after,
    }),
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function revisionValue(state: BrowserStateLike): string {
  return [state.revision, state.domRevision, state.visualRevision]
    .filter((value): value is string => typeof value === 'string')
    .join(':');
}

function nodesByIdentity(value: unknown): ReadonlyMap<string, unknown> {
  const result = new Map<string, unknown>();
  if (!Array.isArray(value)) return result;
  for (const node of value) {
    const record = asRecord(node);
    const identity =
      typeof record.backendDOMNodeId === 'number'
        ? `${String(record.frameId ?? '')}:${String(record.backendDOMNodeId)}`
        : typeof record.ref === 'string'
          ? record.ref
          : null;
    if (identity !== null) result.set(identity, node);
  }
  return result;
}

function hasObservableState(value: unknown): boolean {
  const record = asRecord(value);
  return typeof record.revision === 'string' || typeof record.domRevision === 'string';
}

function matchesTarget(node: unknown, target: Exclude<BrowserTarget, { readonly type: 'point' }>): boolean {
  const record = asRecord(node);
  if (target.type === 'ref') return record.ref === target.ref;
  return record.selector === target.selector;
}
