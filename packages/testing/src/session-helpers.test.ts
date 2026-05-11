import { describe, expect, it } from 'vitest';
import { FakeProvider, textReply } from './fake-provider.js';
import { createFakeSession } from './session-helpers.js';

describe('createFakeSession', () => {
  it('wires a fake provider as active', () => {
    const provider = new FakeProvider({ script: [textReply('hi')] });
    const session = createFakeSession({ provider });
    expect(session.providers.getActive().name).toBe(provider.name);
  });
});
