import { describe, expect, it } from 'vitest';

import { injectNativeBrowserRouting } from './browser-routing.js';

const request = {
  model: 'test-model',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }],
};

describe('injectNativeBrowserRouting', () => {
  it('adds the Moxxy Browser routing contract only for the native desktop backend', () => {
    const routed = injectNativeBrowserRouting(request, {
      MOXXY_BROWSER_BACKEND: 'native',
    });

    expect(routed.system).toContain('Moxxy Browser');
    expect(routed.system).toContain('browser_session');
    expect(routed.system).toContain('Never use computer_');
  });

  it('does not change CLI or Playwright-only provider requests', () => {
    expect(injectNativeBrowserRouting(request, {})).toBe(request);
    expect(
      injectNativeBrowserRouting(request, { MOXXY_BROWSER_BACKEND: 'playwright' }),
    ).toBe(request);
  });

  it('preserves existing system instructions', () => {
    const routed = injectNativeBrowserRouting(
      { ...request, system: 'Keep this instruction.' },
      { MOXXY_BROWSER_BACKEND: 'native' },
    );

    expect(routed.system).toContain('Keep this instruction.');
    expect(routed.system).toContain('Moxxy Browser');
  });
});
