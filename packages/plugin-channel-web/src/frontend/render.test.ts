import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { ViewNode } from '@moxxy/sdk';
import { renderNode } from './render.js';

const noop = (): void => undefined;
const handlers = { dispatch: noop, navigate: noop };
const render = (node: ViewNode): string => renderToStaticMarkup(renderNode(node, handlers) as ReactElement);

const el = (
  tag: string,
  props: Record<string, string | number | boolean> = {},
  children: ViewNode[] = [],
  action?: { name: string; fields: string[] },
  nav?: string,
): ViewNode => ({ kind: 'element', tag, props, children, ...(action ? { action } : {}), ...(nav ? { nav } : {}) });
const txt = (value: string): ViewNode => ({ kind: 'text', value });

describe('frontend renderNode — security (the second wall)', () => {
  it('escapes text so injected HTML cannot execute', () => {
    const html = render(el('view', {}, [el('text', {}, [txt('<img src=x onerror=alert(1)>')])]));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders an unknown tag as an inert placeholder, never the raw tag', () => {
    const html = render(el('view', {}, [el('script', {}, [txt('alert(1)')])]));
    expect(html.toLowerCase()).toContain('unsupported');
    expect(html).not.toContain('<script');
  });

  it('never emits event-handler attributes (handlers are functions, dropped by static render)', () => {
    const html = render(el('view', {}, [el('button', { label: 'Go' }, [], { name: 'go', fields: [] })]));
    expect(html).toContain('Go');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('onsubmit=');
  });

  it('neutralizes a javascript: href — rendered as plain text, never a clickable anchor', () => {
    const html = render(el('view', {}, [el('link', { href: 'javascript:alert(1)' }, [txt('click me')])]));
    expect(html).toContain('click me');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('javascript:');
  });

  it('neutralizes a data:text href', () => {
    const html = render(el('view', {}, [el('link', { href: 'data:text/html,<script>1</script>' }, [txt('x')])]));
    expect(html).not.toContain('href=');
    expect(html).not.toContain('data:text');
  });

  it('neutralizes a javascript: href split by ASCII whitespace/control chars (browser strips them on click)', () => {
    // The HTML5 URL parser strips tab/newline/CR (and leading C0 controls)
    // before scheme resolution, so each of these executes as `javascript:` on
    // click. The render-time gate must block them all → plain text, no href.
    for (const href of [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\rscript:alert(1)',
      'jav ascript:alert(1)',
      'javascript:alert(1)',
    ]) {
      const html = render(el('view', {}, [el('link', { href }, [txt('click me')])]));
      expect(html).toContain('click me');
      expect(html).not.toContain('href=');
      expect(html.toLowerCase()).not.toContain('script:');
    }
  });

  it('blocks an <img> whose src scheme is split by whitespace/control chars', () => {
    for (const src of ['java\tscript:alert(1)', 'javascript:alert(1)']) {
      const html = render(el('view', {}, [el('image', { src })]));
      expect(html).not.toContain('<img');
      expect(html.toLowerCase()).toContain('blocked image');
    }
  });

  it('still renders an https/relative link untouched (valid flows unchanged)', () => {
    const a = render(el('view', {}, [el('link', { href: 'https://example.com/p?q=1' }, [txt('site')])]));
    expect(a).toContain('href="https://example.com/p?q=1"');
    // a relative href stays a clickable external anchor
    const rel = render(el('view', {}, [el('link', { href: '/local/path' }, [txt('local')])]));
    expect(rel).toContain('href="/local/path"');
  });

  it('blocks an <img> with a non-image data: or javascript: src', () => {
    for (const src of ['javascript:alert(1)', 'data:text/html,<script>1</script>']) {
      const html = render(el('view', {}, [el('image', { src })]));
      expect(html).not.toContain('<img');
      expect(html.toLowerCase()).toContain('blocked image');
    }
  });

  it('still renders safe https links and data:image sources', () => {
    const a = render(el('view', {}, [el('link', { href: 'https://example.com' }, [txt('site')])]));
    expect(a).toContain('href="https://example.com"');
    const img = render(el('view', {}, [el('image', { src: 'data:image/png;base64,AAAA' })]));
    expect(img).toContain('<img');
  });
});

describe('frontend renderNode — correctness', () => {
  it('renders the view title and nested content', () => {
    const html = render(el('view', { title: 'Trip' }, [el('card', { title: 'Flight' }, [el('text', {}, [txt('hi')])])]));
    expect(html).toContain('Trip');
    expect(html).toContain('Flight');
    expect(html).toContain('hi');
  });

  it('renders a form with a named input and the submit label', () => {
    const html = render(
      el('view', {}, [el('form', { submit: 'Search' }, [el('input', { name: 'from', label: 'From' })], { name: 'search', fields: ['from'] })]),
    );
    expect(html).toContain('<form');
    expect(html).toContain('name="from"');
    expect(html).toContain('Search');
    expect(html).toContain('From');
  });

  it('renders a table with header and cell', () => {
    const html = render(
      el('view', {}, [el('table', {}, [el('tr', {}, [el('th', {}, [txt('H')]), el('td', {}, [txt('1')])])])]),
    );
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('H');
  });

  it('renders the heading at the requested level (clamped 1–3)', () => {
    expect(render(el('view', {}, [el('heading', { level: 2 }, [txt('Hi')])]))).toContain('<h2');
    expect(render(el('view', {}, [el('heading', { level: 9 }, [txt('Hi')])]))).toContain('<h3');
  });

  it('renders an ordered vs unordered list', () => {
    expect(render(el('view', {}, [el('list', { ordered: true }, [el('item', {}, [txt('a')])])]))).toContain('<ol');
    expect(render(el('view', {}, [el('list', {}, [el('item', {}, [txt('a')])])]))).toContain('<ul');
  });

  it('renders a spinner and a skeleton with the requested rows', () => {
    expect(render(el('view', {}, [el('spinner', { label: 'Loading…' })]))).toContain('v-spin');
    const sk = render(el('view', {}, [el('skeleton', { rows: 4 })]));
    expect((sk.match(/v-skel-row/g) ?? []).length).toBe(4);
  });

  it('renders an external link with safe rel/target', () => {
    const html = render(el('view', {}, [el('link', { href: 'https://example.com' }, [txt('site')])]));
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('renders a nav link (to) as a clickable anchor, not an external target', () => {
    const html = render(el('view', {}, [el('link', { to: 'search' }, [txt('Back')], undefined, 'search')]));
    expect(html).toContain('Back');
    expect(html).toContain('<a');
    expect(html).not.toContain('rel="noreferrer"'); // not an external link
    expect(html).not.toContain('onclick='); // handler is a function, never an attribute
  });

  it('renders a nav button (to) with no handler attribute', () => {
    const html = render(el('view', {}, [el('button', { to: 'results', label: 'See results' }, [], undefined, 'results')]));
    expect(html).toContain('See results');
    expect(html).not.toContain('onclick=');
  });
});
