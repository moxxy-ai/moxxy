import { describe, expect, it } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { asToolCallId, type PendingToolCall, type PermissionContext } from '@moxxy/sdk';
import {
  HttpPermissionBroker,
  PERMISSION_REQUESTED_SUBTYPE,
  PERMISSION_RESOLVED_SUBTYPE,
} from './permission-broker.js';

function buildSession(): Session {
  return new Session({ cwd: process.cwd(), logger: silentLogger });
}

function call(name = 'web_fetch'): PendingToolCall {
  return { name, callId: asToolCallId('call-1'), input: { url: 'https://example.com' } };
}

function context(session: Session, overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    sessionId: session.id,
    toolDescription: 'Fetch a URL',
    ...overrides,
  } as PermissionContext;
}

describe('HttpPermissionBroker', () => {
  it('denies when no session is attached', async () => {
    const broker = new HttpPermissionBroker();
    const decision = await broker.check(call(), { sessionId: 'orphan' } as PermissionContext);
    expect(decision.mode).toBe('deny');
  });

  it('publishes a permission.requested event and stays pending until decided', async () => {
    const session = buildSession();
    const broker = new HttpPermissionBroker();
    broker.attachSession(session);

    let resolved = false;
    const pending = broker.check(call(), context(session)).then((decision) => {
      resolved = true;
      return decision;
    });

    // Give the broker a tick to append the request event.
    await new Promise((r) => setTimeout(r, 10));
    const request = session.log
      .ofType('plugin_event')
      .find((event) => event.subtype === PERMISSION_REQUESTED_SUBTYPE);
    expect(request?.payload).toMatchObject({ agent_id: 'session', tool_name: 'web_fetch' });
    const requestId = (request?.payload as { request_id?: string }).request_id;
    expect(requestId).toBeTruthy();
    expect(resolved).toBe(false);

    expect(await broker.decide(requestId!, { mode: 'allow', reason: 'ok' })).toBe(true);
    const decision = await pending;
    expect(decision.mode).toBe('allow');
    expect(resolved).toBe(true);

    expect(
      session.log.ofType('plugin_event').some((event) => event.subtype === PERMISSION_RESOLVED_SUBTYPE),
    ).toBe(true);
  });

  it('tags requests with the office agent id registered for the calling session', async () => {
    const session = buildSession();
    const broker = new HttpPermissionBroker();
    broker.attachSession(session);
    broker.registerAgentSession('office-session-99', 'office-agent-0007');

    void broker.check(call(), context(session, { sessionId: 'office-session-99' as PermissionContext['sessionId'] }));
    await new Promise((r) => setTimeout(r, 10));

    const request = session.log
      .ofType('plugin_event')
      .find((event) => event.subtype === PERMISSION_REQUESTED_SUBTYPE);
    expect(request?.payload).toMatchObject({ agent_id: 'office-agent-0007' });

    broker.abortAll();
  });

  it('remembers allow_session decisions and short-circuits subsequent checks for that tool', async () => {
    const session = buildSession();
    const broker = new HttpPermissionBroker();
    broker.attachSession(session);

    const first = broker.check(call(), context(session));
    await new Promise((r) => setTimeout(r, 10));
    const requestId = (
      session.log.ofType('plugin_event').find((e) => e.subtype === PERMISSION_REQUESTED_SUBTYPE)
        ?.payload as { request_id?: string }
    ).request_id;
    await broker.decide(requestId!, { mode: 'allow_session' });
    await first;

    // A second check for the same tool resolves immediately without a new event.
    const before = session.log.ofType('plugin_event').filter((e) => e.subtype === PERMISSION_REQUESTED_SUBTYPE).length;
    const second = await broker.check(call(), context(session));
    expect(second.mode).toBe('allow_session');
    const after = session.log.ofType('plugin_event').filter((e) => e.subtype === PERMISSION_REQUESTED_SUBTYPE).length;
    expect(after).toBe(before);
  });

  it('returns false when deciding an unknown request id', async () => {
    const session = buildSession();
    const broker = new HttpPermissionBroker();
    broker.attachSession(session);
    expect(await broker.decide('perm-does-not-exist', { mode: 'allow' })).toBe(false);
  });

  it('abortAll denies every pending request', async () => {
    const session = buildSession();
    const broker = new HttpPermissionBroker();
    broker.attachSession(session);

    const pending = broker.check(call(), context(session));
    await new Promise((r) => setTimeout(r, 10));
    broker.abortAll('shutting down');
    const decision = await pending;
    expect(decision.mode).toBe('deny');
    expect(decision.reason).toBe('shutting down');
  });
});
