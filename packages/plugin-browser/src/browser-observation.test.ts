import { describe, expect, it } from 'vitest';

import {
  buildBrowserObservationScript,
  buildBrowserRefValidationScript,
  buildSanitizedDocumentHtmlScript,
  buildAccessibilityObservationNodes,
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
    expect(text).toContain('UNTRUSTED_PAGE_DATA');
  });

  it('redacts credential-like fields before returning page HTML', () => {
    const script = buildSanitizedDocumentHtmlScript();

    expect(script).toContain("element.type.toLowerCase() === 'password'");
    expect(script).toContain("element.value = '[REDACTED]'");
    expect(script).toContain('element.removeAttribute(attribute.name)');
    expect(script).toContain('clone.outerHTML');
  });

  it('projects actionable cross-frame accessibility nodes without exposing editable values', () => {
    const projected = buildAccessibilityObservationNodes(
      [
        {
          frameId: 'frame-mail',
          nodes: [
            {
              nodeId: 'ax-1',
              backendDOMNodeId: 41,
              role: { value: 'button' },
              name: { value: 'Compose' },
            },
            {
              nodeId: 'ax-2',
              backendDOMNodeId: 42,
              role: { value: 'textbox' },
              name: { value: 'Password' },
              value: { value: 'must-not-leak' },
              properties: [{ name: 'focused', value: { value: true } }],
            },
          ],
        },
      ],
      new Map([
        ['frame-mail:41', { x: 10, y: 20, width: 100, height: 30 }],
        ['frame-mail:42', { x: 10, y: 60, width: 200, height: 30 }],
      ]),
      20,
    );

    expect(projected.nodes).toEqual([
      expect.objectContaining({ role: 'button', name: 'Compose' }),
      expect.objectContaining({ role: 'textbox', name: 'Password', focused: true }),
    ]);
    expect(projected.nodes[1]).not.toHaveProperty('value');
    expect(projected.targets[0]).toMatchObject({
      backendDOMNodeId: 41,
      frameId: 'frame-mail',
    });
  });
});
