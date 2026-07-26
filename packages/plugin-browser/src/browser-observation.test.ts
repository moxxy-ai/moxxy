import { describe, expect, it } from 'vitest';

import {
  buildBrowserObservationScript,
  buildBrowserRefValidationScript,
  formatBrowserObservationForModel,
  parseBrowserObservation,
} from './browser-observation.js';

describe('browser observation boundary', () => {
  it('keeps bounded visible page text while removing internal selectors', () => {
    const parsed = parseBrowserObservation({
      revision: 'rev-document-1',
      title: 'Example',
      url: 'https://example.com/',
      visibleText: 'A visible article heading',
      viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
      nodes: [
        {
          ref: 'b1',
          role: 'button',
          name: 'Continue',
          selector: '#continue',
          bounds: { x: 20, y: 40, width: 100, height: 30 },
        },
      ],
    });

    expect(parsed.observation).toMatchObject({
      visibleText: 'A visible article heading',
      nodes: [{ ref: 'b1', name: 'Continue' }],
    });
    expect(parsed.observation.nodes[0]).not.toHaveProperty('selector');
    expect(parsed.targets.get('b1')).toMatchObject({ selector: '#continue' });
  });

  it('never exposes password values to the model', () => {
    const parsed = parseBrowserObservation({
      revision: 'rev-document-1',
      title: 'Sign in',
      url: 'https://example.com/login',
      visibleText: 'Sign in',
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      nodes: [
        {
          ref: 'b1',
          role: 'textbox',
          name: 'Password',
          value: 'secret-value',
          inputType: 'password',
          selector: '#password',
          bounds: { x: 20, y: 40, width: 200, height: 30 },
        },
      ],
    });

    expect(parsed.observation.nodes[0]).not.toHaveProperty('value');
  });

  it('invalidates element references as soon as the document mutates', () => {
    const script = buildBrowserObservationScript(120, 6_000);
    const validation = buildBrowserRefValidationScript('rev-document-1');

    expect(script).toContain('state.revision = null');
    expect(script).toContain('state.documentId');
    expect(script).toContain('visibleText');
    expect(validation).toContain('state.revision === "rev-document-1"');
  });

  it('formats semantic refs without embedding screenshot bytes', () => {
    const text = formatBrowserObservationForModel({
      revision: 'rev-document-1',
      title: 'Example',
      url: 'https://example.com/',
      visibleText: 'A visible article heading',
      viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
      nodes: [
        {
          ref: 'b1',
          role: 'button',
          name: 'Continue',
          bounds: { x: 20, y: 40, width: 100, height: 30 },
        },
      ],
      screenshot: { mediaType: 'image/png', base64: 'SECRETPIXELS' },
    });

    expect(text).toContain('"ref":"b1"');
    expect(text).toContain('A visible article heading');
    expect(text).not.toContain('SECRETPIXELS');
  });
});
