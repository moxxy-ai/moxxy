import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createLogger, Session, silentLogger } from '@moxxy/core';
import { asEventId, asTurnId, eventForClient, type UserPromptEvent } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { connectUnixSocket, createUnixSocketServer, type TransportLimits } from './unix-socket.js';
import { startRunnerServer } from './server.js';
import { platformSocket } from './socket-path.js';
import { JsonRpcPeer } from './jsonrpc.js';
import {
  RunnerMethod,
  RunnerNotification,
  RUNNER_PROTOCOL_VERSION,
  type EventNotification,
} from './protocol.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(limits?: TransportLimits, beforeServe?: (session: Session) => void) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mx-history-'));
  cleanup.push(() => removeDir(dir));
  const socket = platformSocket(randomUUID(), path.join(dir, 's'));
  let dropReason: (reason: string) => void = () => undefined;
  const dropped = new Promise<string>((resolve) => {
    dropReason = resolve;
  });
  const logger = createLogger({
    sink: (line) => {
      const entry = JSON.parse(line);
      if (entry.msg === 'runner: client dropped') dropReason(entry.reason);
    },
  });
  const session = new Session({ cwd: dir, logger });
  cleanup.push(() => session.close());
  beforeServe?.(session);
  const transport = await createUnixSocketServer(socket, silentLogger, limits);
  const runner = await startRunnerServer(session, { transport });
  cleanup.push(() => runner.close());
  async function connect() {
    const peer = new JsonRpcPeer(await connectUnixSocket(socket));
    cleanup.push(() => peer.close());
    return peer;
  }
  function append(text: string) {
    const seq = session.log.baseSeq + session.log.length;
    const event: UserPromptEvent = {
      type: 'user_prompt',
      id: asEventId(String(seq)),
      sessionId: session.id,
      turnId: asTurnId('turn'),
      ts: seq,
      seq,
      source: 'user',
      text,
    };
    session.log.ingest(event);
    return event;
  }
  return { session, connect, append, socket, runner, dropped };
}

const params = { protocolVersion: RUNNER_PROTOCOL_VERSION, role: 'tui' };

it.each([
  [undefined, 40],
  ['full', 40],
  ['none', 43],
  [{ tail: 2 }, 41],
  [{ tail: 50 }, 40],
] as const)('preserves the replay frames and final reply for policy %j', async (replay, fromSeq) => {
  const { session, append, socket } = await fixture();
  session.log.rebase(40);
  const events = ['początek', 'środek', 'koniec'].map(append);
  const link = await connectUnixSocket(socket);
  cleanup.push(() => link.close());
  const frames: string[] = [];
  const done = new Promise<void>((resolve) =>
    link.onFrame((frame) => {
      frames.push(JSON.stringify(frame));
      if (typeof frame === 'object' && frame !== null && 'id' in frame) resolve();
    }),
  );
  link.send({ id: 7, method: RunnerMethod.Attach, params: { ...params, sinceSeq: 999, replay } });
  await done;
  expect(frames).toEqual(
    [
      { method: 'replay.start', params: { fromSeq } },
      ...events
        .filter((e) => e.seq >= fromSeq)
        .map((e) => ({ method: 'event', params: { event: eventForClient(e) } })),
      {
        id: 7,
        result: {
          sessionId: session.id,
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          info: { ...session.getInfo(), runningTurns: [] },
        },
      },
    ].map((frame) => JSON.stringify(frame)),
  );
});

it('delivers a full replay to an active reader without tripping the backlog guard', async () => {
  // A small hard ceiling exercises the production eviction path with a small fixture.
  const { append, connect } = await fixture({ maxOutboundHardBytes: 2 * 1024 * 1024 });
  const payload = 'a'.repeat(256 * 1024);
  for (let seq = 0; seq < 128; seq++) append(payload);
  const peer = await connect();
  const seen: number[] = [];
  peer.on(RunnerNotification.Event, (p) => seen.push((p as EventNotification).event.seq));
  await peer.request(RunnerMethod.Attach, params);
  expect(seen).toEqual(Array.from({ length: 128 }, (_, i) => i));
});

it.each([false, true])('catches up across concurrent appends and resets (reset=%s)', async (reset) => {
  const { session, append, connect } = await fixture();
  const other = await connect();
  await other.request(RunnerMethod.Attach, { ...params, replay: 'none' });
  const payload = 'x'.repeat(256 * 1024);
  for (let i = 0; i < 32; i++) append(payload);
  const peer = await connect();
  const seen: string[] = [];
  let otherInfo: Promise<unknown> | undefined;
  peer.on(RunnerNotification.ReplayStart, () => {
    otherInfo = other.request(RunnerMethod.GetInfo);
    if (reset) {
      session.log.clear();
      append('first reset');
      session.log.clear();
    }
    append('arrived during replay');
  });
  peer.on(RunnerNotification.SessionReset, () => {
    seen.length = 0;
  });
  peer.on(RunnerNotification.Event, (p) => {
    const { event } = p as EventNotification;
    if (event.type === 'user_prompt') seen.push(event.seq + '/' + event.text.slice(0, 22));
  });
  await peer.request(RunnerMethod.Attach, params);
  expect(seen).toEqual(session.log.ofType('user_prompt').map((e) => e.seq + '/' + e.text.slice(0, 22)));
  await expect(otherInfo).resolves.toHaveProperty('sessionId', session.id);
});

async function pausedAttach(socket: string) {
  const raw = net.connect(socket);
  cleanup.push(() => {
    raw.destroy();
  });
  await once(raw, 'connect');
  const started = once(raw, 'data');
  raw.once('data', () => raw.pause());
  raw.write(JSON.stringify({ id: 1, method: RunnerMethod.Attach, params }) + '\n');
  await started;
  return raw;
}

it('keeps another client responsive, then evicts only the idle reader', async () => {
  const { connect, append, socket, dropped } = await fixture({ outboundStallGraceMs: 250 });
  const payload = 'x'.repeat(256 * 1024);
  for (let i = 0; i < 64; i++) append(payload);
  const raw = await pausedAttach(socket);
  const other = await connect();
  await expect(other.request(RunnerMethod.Attach, { ...params, replay: 'none' })).resolves.toHaveProperty(
    'info',
  );
  await expect(dropped).resolves.toMatch(/slow reader/);
  raw.destroy();
  await expect(other.request(RunnerMethod.GetInfo)).resolves.toHaveProperty('sessionId');
});

it('shuts down a replay blocked on a reader without waiting for the stall grace', async () => {
  const { runner, append, socket } = await fixture({ outboundStallGraceMs: 60_000 });
  const payload = 'x'.repeat(256 * 1024);
  for (let i = 0; i < 64; i++) append(payload);
  await pausedAttach(socket);
  await runner.close();
}, 2500);

it('serializes overlapping attach requests on one connection', async () => {
  const { append, connect } = await fixture();
  const payload = 'x'.repeat(256 * 1024);
  for (let i = 0; i < 32; i++) append(payload);
  const peer = await connect();
  const frames: string[] = [];
  peer.on(RunnerNotification.ReplayStart, () => frames.push('start'));
  peer.on(RunnerNotification.Event, (p) => frames.push(String((p as EventNotification).event.seq)));
  const first = peer.request(RunnerMethod.Attach, params).then(() => frames.push('first reply'));
  const second = peer
    .request(RunnerMethod.Attach, { ...params, replay: 'none' })
    .then(() => frames.push('second reply'));
  await Promise.all([first, second]);
  expect(frames.filter((frame) => frame === 'start')).toHaveLength(2);
  expect(frames.filter((frame) => /^\d/.test(frame))).toEqual(
    Array.from({ length: 32 }, (_, i) => String(i)),
  );
  expect(frames.indexOf('31')).toBeLessThan(frames.lastIndexOf('start'));
});

it('sends a concurrent turn completion after its last event and replies with current settings', async () => {
  const { connect, append, session } = await fixture();
  const bulk = 'a'.repeat(256 * 1024);
  for (let i = 0; i < 64; i++) append(bulk);
  const observer = await connect();
  const driver = await connect();
  await driver.request(RunnerMethod.Attach, { ...params, replay: 'none' });
  const turnId = 'turn-during-replay';
  const seen: string[] = [];
  let operations: Promise<unknown> | undefined;
  observer.on(RunnerNotification.ReplayStart, () => {
    operations = driver
      .request(RunnerMethod.SessionSetAutoApprove, { enabled: true })
      .then(() => driver.request(RunnerMethod.RunTurn, { prompt: 'go', turnId }));
  });
  observer.on(RunnerNotification.Event, (p) => {
    const { event } = p as EventNotification;
    if (event.turnId === turnId) seen.push(event.type);
  });
  observer.on(RunnerNotification.TurnComplete, () => seen.push('complete'));
  const result = await observer.request<{ info: { autoApprove: boolean } }>(RunnerMethod.Attach, params);
  await operations;
  // With no provider configured this is a real failed turn. Its terminal
  // error event must reach the observer before the completion notification.
  expect(seen).toEqual([...session.log.byTurn(asTurnId(turnId)).map((e) => e.type), 'complete']);
  expect(seen).toContain('error');
  expect(result.info.autoApprove).toBe(true);
});

it('skips a delayed broadcast of an event already included in the attach reply', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { session, connect, append } = await fixture(undefined, (session) => {
    session.log.subscribe(() => held);
  });
  const pending = session.log.append({
    type: 'user_prompt',
    source: 'user',
    sessionId: session.id,
    turnId: asTurnId('turn'),
    text: 'already on disk',
  });
  try {
    const peer = await connect();
    const seqs: number[] = [];
    peer.on(RunnerNotification.Event, (p) => seqs.push((p as EventNotification).event.seq));
    await peer.request(RunnerMethod.Attach, params);
    release();
    await pending;
    append('live');
    await peer.request(RunnerMethod.GetInfo);
    expect(seqs).toEqual([0, 1]);
  } finally {
    release();
  }
});
