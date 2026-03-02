import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseEvent } from '../src/sse-consumer.js';

describe('parseSseEvent', () => {
  it('parses JSON data from SSE lines', () => {
    const lines = [
      'data: {"event_type":"run.started","agent_id":"a1","ts":1234}',
      '',
    ];
    const event = parseSseEvent(lines);
    assert.equal(event.event_type, 'run.started');
    assert.equal(event.agent_id, 'a1');
  });

  it('returns null for empty data', () => {
    const event = parseSseEvent(['', '']);
    assert.equal(event, null);
  });

  it('returns raw string for non-JSON data', () => {
    const lines = ['data: just plain text'];
    const event = parseSseEvent(lines);
    assert.equal(event.raw, 'just plain text');
  });

  it('concatenates multi-line data fields', () => {
    const lines = [
      'data: {"event_type":',
      'data: "model.response"}',
    ];
    const event = parseSseEvent(lines);
    assert.equal(event.event_type, 'model.response');
  });
});
