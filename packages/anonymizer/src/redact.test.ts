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
});
