import { describe, expect, it } from 'vitest';
import { redact } from './redact.js';

describe('redact', () => {
  it('labels by default', () => {
    const { text, report } = redact('Call me at john@acme.com');
    expect(text).toBe('Call me at [EMAIL]');
    expect(report.total).toBe(1);
    expect(report.counts.email).toBe(1);
  });

  it('pseudonyms are consistent and numbered in document order', () => {
    const { text } = redact('a@x.com cc b@x.com, reply a@x.com', { mode: 'pseudonym' });
    expect(text).toBe('EMAIL_1 cc EMAIL_2, reply EMAIL_1');
  });

  it('hash mode is deterministic per value', () => {
    const r1 = redact('john@acme.com', { mode: 'hash' });
    const r2 = redact('john@acme.com', { mode: 'hash' });
    expect(r1.text).toBe(r2.text);
    expect(r1.text).toMatch(/^\[EMAIL:[0-9a-z]{8}\]$/);
  });

  it('redacts multiple categories and offsets stay correct', () => {
    const text = 'email a@b.com card 4111 1111 1111 1111 ip 10.0.0.1';
    const { text: out, report } = redact(text);
    expect(out).toBe('email [EMAIL] card [CARD] ip [IP]');
    expect(report.total).toBe(3);
    expect(report.counts.creditCard).toBe(1);
    expect(report.counts.ipv4).toBe(1);
  });

  it('handles empty input', () => {
    expect(redact('')).toEqual({
      text: '',
      report: { counts: expect.any(Object), total: 0, spans: [] },
    });
  });

  it('keeps Unicode offsets intact', () => {
    const { text } = redact('café → a@b.com ☕');
    expect(text).toBe('café → [EMAIL] ☕');
  });

  it('redacts custom terms with the REDACTED label', () => {
    const { text } = redact('Project Bluebird is internal', { customTerms: ['Project Bluebird'] });
    expect(text).toBe('[REDACTED] is internal');
  });

  it('keeps distinct values with a shared label distinct in pseudonym mode', () => {
    // ipv4 and ipv6 both render as the 'IP' label; two different addresses must
    // NOT collapse to the same token.
    const { text } = redact('v4 10.0.0.1 and v6 fe80::1', { mode: 'pseudonym' });
    expect(text).toBe('v4 IP_1 and v6 IP_2');
  });

  it('does not blow up quadratically redacting a document full of PII', () => {
    // 20k IPs is the pathological case for a per-span string-splice loop
    // (O(numSpans * docLength)); the single-pass join must stay near-linear. The
    // bound is generous so it never flakes yet still trips a quadratic regression.
    const ip = '10.0.0.1';
    const text = Array.from({ length: 20_000 }, () => ip).join(' ');
    const t0 = Date.now();
    const { report } = redact(text);
    expect(report.total).toBe(20_000);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});
