import { describe, expect, it } from 'vitest';

import {
  METHOD_PERMISSION,
  RENDERER_DISPATCHED_METHODS,
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
