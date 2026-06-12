import { describe, expect, it } from 'vitest';
import { buildAskResponseFrame } from '../mobile/src/clientFrames';
import { permissionResponseForAction } from '../mobile/src/permissionResponse';

function expectValidAskResponsePayload(payload: Record<string, unknown>): void {
  expect(payload).toMatchObject({
    type: 'ask.respond',
    requestId: expect.any(String),
    response: expect.any(Object),
  });
  const response = payload.response as { mode?: unknown };
  expect(['allow', 'allow_session', 'allow_always', 'deny']).toContain(response.mode);
}

describe('mobile permission responses', () => {
  it('maps Allow once to the IPC-compatible allow mode', () => {
    const response = permissionResponseForAction('allow_once');

    expect(response).toEqual({ mode: 'allow' });
    expectValidAskResponsePayload(buildAskResponseFrame({ requestId: 'ask-1', response }));
  });

  it('keeps the session, always, and deny decisions IPC-compatible', () => {
    for (const action of ['allow_session', 'allow_always', 'deny'] as const) {
      const response = permissionResponseForAction(action);
      expectValidAskResponsePayload(buildAskResponseFrame({ requestId: `ask-${action}`, response }));
    }
  });
});
