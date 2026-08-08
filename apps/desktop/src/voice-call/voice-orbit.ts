import type { VoiceActiveOperation, VoiceOperationKind } from '@moxxy/client-core';

export type VoiceOrbitItemState = 'running' | 'succeeded' | 'failed' | 'cancelled';

interface StoredVoiceOrbitItem {
  readonly callId: string;
  readonly kind: VoiceOperationKind;
  readonly ordinal: number;
  readonly slot: number | null;
  readonly state: VoiceOrbitItemState;
  readonly expiresAt: number | null;
}

export interface VoiceOrbitState {
  readonly items: ReadonlyArray<StoredVoiceOrbitItem>;
}

export interface VoiceOrbitItem {
  readonly callId: string;
  readonly kind: VoiceOperationKind;
  readonly label: string;
  readonly slot: number;
  readonly state: VoiceOrbitItemState;
}

export interface VoiceOrbitView {
  readonly items: ReadonlyArray<VoiceOrbitItem>;
  readonly overflowCount: number;
  readonly nextExpiry: number | null;
}

const MAX_VISIBLE = 3;
const SUCCESS_MS = 600;
const FAILURE_MS = 1_500;
const CANCEL_MS = 180;

const LABELS: Readonly<Record<VoiceOperationKind, string>> = Object.freeze({
  'web-search': 'Searching the web',
  'project-read': 'Reading project files',
  editing: 'Writing changes',
  verification: 'Running focused tests',
  command: 'Running commands',
  application: 'Working in the app',
  delegation: 'Delegating work',
  generic: 'Working on your request',
});

export function createVoiceOrbitState(): VoiceOrbitState {
  return Object.freeze({ items: Object.freeze([]) });
}

function firstFreeSlot(items: ReadonlyArray<StoredVoiceOrbitItem>): number | null {
  const occupied = new Set(items.flatMap((item) => item.slot === null ? [] : [item.slot]));
  for (let slot = 0; slot < MAX_VISIBLE; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export function syncVoiceOrbit(
  previous: VoiceOrbitState,
  active: ReadonlyArray<VoiceActiveOperation>,
  outcomes: ReadonlyMap<string, boolean>,
  now: number,
): VoiceOrbitState {
  const activeById = new Map(active.map((operation) => [operation.callId, operation]));
  const next: StoredVoiceOrbitItem[] = [];

  for (const item of previous.items) {
    if (item.expiresAt !== null && item.expiresAt <= now) continue;
    const live = activeById.get(item.callId);
    if (live) {
      next.push(Object.freeze({ ...item, kind: live.kind, ordinal: live.ordinal, state: 'running', expiresAt: null }));
      activeById.delete(item.callId);
      continue;
    }
    if (item.state === 'cancelled' && outcomes.has(item.callId)) {
      const succeeded = outcomes.get(item.callId) === true;
      next.push(Object.freeze({
        ...item,
        state: succeeded ? 'succeeded' : 'failed',
        expiresAt: now + (succeeded ? SUCCESS_MS : FAILURE_MS),
      }));
      continue;
    }
    if (item.state !== 'running') {
      next.push(item);
      continue;
    }
    const outcome = outcomes.get(item.callId);
    const state: VoiceOrbitItemState = outcome === true
      ? 'succeeded'
      : outcome === false
        ? 'failed'
        : 'cancelled';
    const duration = state === 'succeeded' ? SUCCESS_MS : state === 'failed' ? FAILURE_MS : CANCEL_MS;
    next.push(Object.freeze({ ...item, state, expiresAt: now + duration }));
  }

  const additions = [...activeById.values()].sort((a, b) => a.ordinal - b.ordinal);
  for (const operation of additions) {
    next.push(Object.freeze({
      ...operation,
      slot: firstFreeSlot(next),
      state: 'running',
      expiresAt: null,
    }));
  }

  for (let index = 0; index < next.length; index += 1) {
    const item = next[index];
    if (!item) continue;
    if (item.slot !== null || item.state !== 'running') continue;
    const slot = firstFreeSlot(next);
    if (slot === null) break;
    next[index] = Object.freeze({ ...item, slot });
  }

  return Object.freeze({ items: Object.freeze(next) });
}

export function buildVoiceOrbit(state: VoiceOrbitState, now: number): VoiceOrbitView {
  const live = state.items.filter((item) => item.expiresAt === null || item.expiresAt > now);
  const items = live
    .filter((item): item is StoredVoiceOrbitItem & { readonly slot: number } => item.slot !== null)
    .sort((a, b) => a.slot - b.slot)
    .map((item): VoiceOrbitItem => Object.freeze({
      callId: item.callId,
      kind: item.kind,
      label: LABELS[item.kind],
      slot: item.slot,
      state: item.state,
    }));
  const overflowCount = live.filter((item) => item.slot === null && item.state === 'running').length;
  const expiries = live.flatMap((item) => item.expiresAt === null ? [] : [item.expiresAt]);
  return Object.freeze({
    items: Object.freeze(items),
    overflowCount,
    nextExpiry: expiries.length > 0 ? Math.min(...expiries) : null,
  });
}
