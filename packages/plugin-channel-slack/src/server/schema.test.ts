import { describe, expect, it } from 'vitest';
import { slackEnvelopeSchema, urlVerificationSchema, eventCallbackSchema } from './schema.js';

describe('slack schemas', () => {
  it('parses a url_verification challenge', () => {
    const parsed = slackEnvelopeSchema.safeParse({
      type: 'url_verification',
      token: 'verif-token',
      challenge: 'the-challenge-string',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'url_verification') {
      expect(parsed.data.challenge).toBe('the-challenge-string');
    }
  });

  it('rejects a url_verification with an empty challenge', () => {
    const parsed = urlVerificationSchema.safeParse({ type: 'url_verification', challenge: '' });
    expect(parsed.success).toBe(false);
  });

  it('parses an app_mention event_callback', () => {
    const parsed = slackEnvelopeSchema.safeParse({
      type: 'event_callback',
      team_id: 'T123',
      event_id: 'Ev999',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@UBOT> hello',
        channel: 'C123',
        ts: '1700000000.000100',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'event_callback') {
      expect(parsed.data.event.type).toBe('app_mention');
      expect(parsed.data.team_id).toBe('T123');
    }
  });

  it('rejects a body that is neither handshake nor event_callback', () => {
    const parsed = slackEnvelopeSchema.safeParse({ type: 'something_else', foo: 1 });
    expect(parsed.success).toBe(false);
  });

  it('rejects an event_callback whose event is not an object', () => {
    const parsed = eventCallbackSchema.safeParse({ type: 'event_callback', event: 'nope' });
    expect(parsed.success).toBe(false);
  });

  it('rejects an event_callback missing the inner event type', () => {
    const parsed = eventCallbackSchema.safeParse({
      type: 'event_callback',
      event: { text: 'hi' },
    });
    expect(parsed.success).toBe(false);
  });

  it('tolerates unknown extra fields on the inner event (passthrough)', () => {
    const parsed = eventCallbackSchema.safeParse({
      type: 'event_callback',
      event: { type: 'app_mention', some_future_field: { nested: true } },
    });
    expect(parsed.success).toBe(true);
  });
});
