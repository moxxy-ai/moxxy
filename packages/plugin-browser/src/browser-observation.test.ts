import { describe, expect, it } from 'vitest';

import {
  buildBrowserInspectScript,
  buildBrowserObservationScript,
  buildBrowserRefPointScript,
  buildBrowserRefValidationScript,
  buildSanitizedDocumentHtmlScript,
  buildAccessibilityObservationNodes,
  formatBrowserObservationForModel,
  parseBrowserObservation,
  withBrowserObservationDelta,
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

  it('keeps an exact element reference valid across unrelated document mutations', () => {
    const script = buildBrowserObservationScript(120, 6_000);
    const target = {
      ref: 'b7',
      documentId: 'document-1',
      selector: '#continue',
      bounds: { x: 20, y: 40, width: 100, height: 30 },
    };
    const validation = buildBrowserRefValidationScript(target, 'rev-document-1-4');
    const point = buildBrowserRefPointScript(target, 'rev-document-1-4');

    expect(script).toContain('state.revision = null');
    expect(script).toContain('state.documentId');
    expect(script).toContain('refs: new WeakMap()');
    expect(script).toContain('elements: new Map()');
    expect(script).toContain('ref: refOf(element)');
    expect(script).toContain('visibleText');
    expect(script).not.toContain("'-' + nodes.length");
    expect(validation).toContain('state.documentId === "document-1"');
    expect(validation).toContain('state.elements.get("b7")');
    expect(validation).not.toContain('state.revision ===');
    expect(point).toContain('state.elements.get("b7")');
  });

  it('reports a visible canvas so auto observation can choose visual evidence', () => {
    const script = buildBrowserObservationScript(120, 6_000);

    expect(script).toContain("document.querySelectorAll('canvas')");
    expect(script).toContain('visualSurface');
    expect(script).toContain("'webgl' ? 'webgl' : 'canvas'");
  });

  it('inspects only safe control state and redacts password values', () => {
    const script = buildBrowserInspectScript({ selector: '#field' });

    expect(script).toContain('visible:');
    expect(script).toContain('checked:');
    expect(script).toContain('disabled:');
    expect(script).toContain("element.type.toLowerCase() === 'password'");
    expect(script).toContain('value: isPassword ? undefined');
  });

  it('returns a stable-ref delta while retaining the complete current target table', () => {
    const base = {
      revision: 'rev-1', title: 'Editor', url: 'https://example.com/editor', visibleText: 'Dark',
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      nodes: [
        { ref: 'b1', role: 'button', name: 'Background', bounds: { x: 10, y: 10, width: 100, height: 30 } },
        { ref: 'b2', role: 'button', name: 'Delete', bounds: { x: 120, y: 10, width: 80, height: 30 } },
      ],
    };
    const next = {
      ...base,
      revision: 'rev-2',
      visibleText: 'Light',
      nodes: [
        { ...base.nodes[0], name: 'Background color' },
        { ref: 'b3', role: 'button', name: 'Apply', bounds: { x: 220, y: 10, width: 80, height: 30 } },
      ],
    };

    expect(withBrowserObservationDelta(base, next)).toMatchObject({
      kind: 'diff',
      nodes: next.nodes,
      changedNodes: [next.nodes[0], next.nodes[1]],
      removedRefs: ['b2'],
    });
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
