import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyDelivery } from './verify.js';

describe('verifyDelivery', () => {
  it('accepts when type=none', () => {
    expect(
      verifyDelivery({
        verification: { type: 'none' },
        headers: {},
        body: Buffer.from('hello'),
      }).ok,
    ).toBe(true);
  });

  it('accepts a matching bearer token', () => {
    const res = verifyDelivery({
      verification: { type: 'bearer', secret: 'secret-token-1234' },
      headers: { authorization: 'Bearer secret-token-1234' },
      body: Buffer.from(''),
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a missing or wrong bearer token', () => {
    expect(
      verifyDelivery({
        verification: { type: 'bearer', secret: 'secret-token-1234' },
        headers: {},
        body: Buffer.from(''),
      }).ok,
    ).toBe(false);
    expect(
      verifyDelivery({
        verification: { type: 'bearer', secret: 'secret-token-1234' },
        headers: { authorization: 'Bearer wrong' },
        body: Buffer.from(''),
      }).ok,
    ).toBe(false);
  });

  it('verifies a plain HMAC-SHA256 with prefix (GitHub style)', () => {
    const secret = 'hunter2hunter2';
    const body = '{"action":"opened"}';
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const res = verifyDelivery({
      verification: {
        type: 'hmac',
        secret,
        signatureHeader: 'x-hub-signature-256',
        algorithm: 'sha256',
        prefix: 'sha256=',
        scheme: 'plain',
        timestampToleranceSec: 300,
      },
      headers: { 'x-hub-signature-256': sig },
      body: Buffer.from(body),
    });
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered HMAC body', () => {
    const secret = 'hunter2hunter2';
    const sig = `sha256=${createHmac('sha256', secret).update('original').digest('hex')}`;
    const res = verifyDelivery({
      verification: {
        type: 'hmac',
        secret,
        signatureHeader: 'x-hub-signature-256',
        algorithm: 'sha256',
        prefix: 'sha256=',
        scheme: 'plain',
        timestampToleranceSec: 300,
      },
      headers: { 'x-hub-signature-256': sig },
      body: Buffer.from('tampered'),
    });
    expect(res.ok).toBe(false);
  });

  it('verifies a Stripe-style timestamp+body HMAC', () => {
    const secret = 'whsec_test_1234567890';
    const body = '{"id":"evt_1"}';
    const now = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
    const res = verifyDelivery({
      verification: {
        type: 'hmac',
        secret,
        signatureHeader: 'stripe-signature',
        algorithm: 'sha256',
        scheme: 'stripe',
        timestampToleranceSec: 300,
      },
      headers: { 'stripe-signature': `t=${now},v1=${sig}` },
      body: Buffer.from(body),
    });
    expect(res.ok).toBe(true);
  });

  it('rejects Stripe deliveries outside the timestamp tolerance', () => {
    const secret = 'whsec_test_1234567890';
    const body = '{}';
    const old = Math.floor(Date.now() / 1000) - 600;
    const sig = createHmac('sha256', secret).update(`${old}.${body}`).digest('hex');
    const res = verifyDelivery({
      verification: {
        type: 'hmac',
        secret,
        signatureHeader: 'stripe-signature',
        algorithm: 'sha256',
        scheme: 'stripe',
        timestampToleranceSec: 60,
      },
      headers: { 'stripe-signature': `t=${old},v1=${sig}` },
      body: Buffer.from(body),
    });
    expect(res.ok).toBe(false);
  });
});
