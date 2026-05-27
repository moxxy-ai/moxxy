import { describe, expect, it } from 'vitest';
import { Session } from '@moxxy/core';
import { buildViewPlugin, type PresentViewResult } from './index.js';

/**
 * Integration: a REAL Session (which seeds the default view renderer) with the
 * view plugin registered, exercising present_view through the real tool
 * registry — input is validated by the tool's zod schema, the handler reaches
 * the session's active renderer via the closure, and returns the AST.
 */
function sessionWithView(): Session {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.pluginHost.registerStatic(
    buildViewPlugin({ getRenderer: () => session.viewRenderers.getActive() }),
  );
  return session;
}

describe('plugin-view integration with a real Session', () => {
  it('registers present_view and the default renderer is active', () => {
    const session = sessionWithView();
    expect(session.tools.has('present_view')).toBe(true);
    expect(session.viewRenderers.getActive()?.name).toBe('moxxy/default');
  });

  it('executes present_view end-to-end and returns a validated AST', async () => {
    const session = sessionWithView();
    const out = (await session.tools.execute(
      'present_view',
      { spec: '<view title="Trip"><stack><text>hi</text></stack></view>' },
      new AbortController().signal,
    )) as PresentViewResult;
    expect(out.ok).toBe(true);
    expect(out.ast?.title).toBe('Trip');
    expect(out.ast?.root.kind === 'element' && out.ast.root.tag).toBe('view');
  });

  it('returns parse errors (not a throw) for a disallowed tag', async () => {
    const session = sessionWithView();
    const out = (await session.tools.execute(
      'present_view',
      { spec: '<view><iframe/></view>' },
      new AbortController().signal,
    )) as PresentViewResult;
    expect(out.ok).toBe(false);
    expect(out.errors?.some((e) => /unknown tag <iframe>/.test(e.message))).toBe(true);
  });

  it('rejects schema-invalid input at the registry boundary', async () => {
    const session = sessionWithView();
    await expect(
      session.tools.execute('present_view', { spec: '' }, new AbortController().signal),
    ).rejects.toThrow(/Invalid input/);
  });

  it('honours a swapped-in renderer via setActive', async () => {
    const session = sessionWithView();
    session.viewRenderers.replace({
      name: 'stub',
      allowList: [],
      parse: () => ({ ok: true, doc: { root: { kind: 'element', tag: 'view', props: {}, children: [] } } }),
      validate: () => [],
    });
    session.viewRenderers.setActive('stub');
    const out = (await session.tools.execute(
      'present_view',
      { spec: 'anything the stub ignores' },
      new AbortController().signal,
    )) as PresentViewResult;
    expect(out.ok).toBe(true);
    expect(out.ast?.root.kind === 'element' && out.ast.root.tag).toBe('view');
  });
});
