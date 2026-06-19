import { describe, expect, it } from 'vitest';

import {
  BRIDGE_TAG,
  METHOD_PERMISSION,
  RENDERER_DISPATCHED_METHODS,
  isBridgeRequest,
  isRendererDispatched,
  type BridgeMethod,
} from './bridge';
import { isAppPermission } from './permissions';

/**
 * Guards the renderer-dispatch contract: every bridge method maps to a real
 * permission, `session.send` is renderer-dispatched, and the renderer-dispatched
 * set stays a strict subset of the known methods. The DISJOINTNESS half of the
 * invariant (renderer-dispatched ∩ main `BridgeServices` = ∅) is asserted on the
 * host side in `@moxxy/desktop-host` where `BridgeServices` lives.
 */
describe('bridge method ↔ permission contract', () => {
  it('maps every method to a known permission', () => {
    for (const [method, perm] of Object.entries(METHOD_PERMISSION)) {
      expect(isAppPermission(perm), `${method} → ${perm}`).toBe(true);
    }
  });

  it('routes session.send through the session.send permission', () => {
    expect(METHOD_PERMISSION['session.send']).toBe('session.send');
  });
});

describe('RENDERER_DISPATCHED_METHODS', () => {
  it('only contains known bridge methods', () => {
    for (const method of RENDERER_DISPATCHED_METHODS) {
      expect(Object.prototype.hasOwnProperty.call(METHOD_PERMISSION, method)).toBe(true);
    }
  });

  it('marks session.send as renderer-dispatched and documents.open as not', () => {
    expect(isRendererDispatched('session.send' as BridgeMethod)).toBe(true);
    expect(isRendererDispatched('documents.open' as BridgeMethod)).toBe(false);
  });
});

describe('isBridgeRequest', () => {
  const base = { __moxxy: BRIDGE_TAG, kind: 'request', method: 'documents.open' };

  it('accepts a well-formed request with a non-negative safe-integer id', () => {
    expect(isBridgeRequest({ ...base, id: 0 })).toBe(true);
    expect(isBridgeRequest({ ...base, id: 42 })).toBe(true);
  });

  // A correlation id that can never round-trip a match on the client's pending
  // Map must be rejected at the gate, not echoed back to strand on the client.
  it.each([NaN, Infinity, -Infinity, -1, 1.5, '7', null, undefined])(
    'rejects a non-{safe int >= 0} id (%p)',
    (id) => {
      expect(isBridgeRequest({ ...base, id })).toBe(false);
    },
  );

  it('rejects non-request envelopes and foreign tags', () => {
    expect(isBridgeRequest(null)).toBe(false);
    expect(isBridgeRequest({ ...base, id: 1, kind: 'response' })).toBe(false);
    expect(isBridgeRequest({ ...base, id: 1, __moxxy: 'other' })).toBe(false);
    expect(isBridgeRequest({ ...base, id: 1, method: 123 })).toBe(false);
  });
});
