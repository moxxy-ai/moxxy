import { describe, expect, it } from 'vitest';
import { renderPrompt } from './template.js';
import type { WebhookTrigger } from './store.js';

function mkTrigger(prompt: string): WebhookTrigger {
  return {
    id: '01ABC',
    name: 'test',
    prompt,
    allowedTools: [],
    verification: { type: 'none' },
    enabled: true,
    createdAt: 0,
    fireCount: 0,
  };
}

describe('renderPrompt', () => {
  it('substitutes body, method, path, trigger_name', () => {
    const out = renderPrompt({
      trigger: mkTrigger('{method} {path} for {trigger_name}: {body}'),
      headers: {},
      body: Buffer.from('hello'),
      method: 'POST',
      path: '/webhook/abc',
      firedAt: new Date(0),
    });
    expect(out).toBe('POST /webhook/abc for test: hello');
  });

  it('pretty-prints body_json when body is JSON', () => {
    const out = renderPrompt({
      trigger: mkTrigger('Payload:\n{body_json}'),
      headers: {},
      body: Buffer.from('{"action":"opened","number":42}'),
      method: 'POST',
      path: '/',
      firedAt: new Date(0),
    });
    expect(out).toContain('"action": "opened"');
    expect(out).toContain('"number": 42');
  });

  it('falls back to raw body when body_json fails to parse', () => {
    const out = renderPrompt({
      trigger: mkTrigger('{body_json}'),
      headers: {},
      body: Buffer.from('not json'),
      method: 'POST',
      path: '/',
      firedAt: new Date(0),
    });
    expect(out).toBe('not json');
  });

  it('substitutes header values case-insensitively', () => {
    const out = renderPrompt({
      trigger: mkTrigger('delivery={header.x-github-delivery}'),
      headers: { 'x-github-delivery': 'abc-123' },
      body: Buffer.from(''),
      method: 'POST',
      path: '/',
      firedAt: new Date(0),
    });
    expect(out).toBe('delivery=abc-123');
  });

  it('leaves unknown placeholders intact', () => {
    const out = renderPrompt({
      trigger: mkTrigger('static {unknown} text'),
      headers: {},
      body: Buffer.from(''),
      method: 'POST',
      path: '/',
      firedAt: new Date(0),
    });
    expect(out).toBe('static {unknown} text');
  });
});
