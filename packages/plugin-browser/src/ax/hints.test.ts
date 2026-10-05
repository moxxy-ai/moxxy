import { describe, expect, it } from 'vitest';
import { markupHint } from './hints.js';

/**
 * A control the page gives no name — an icon-only button — read as a bare
 * "button". On Coolify the one beside "Please redeploy to apply the new
 * configuration." closed the notice; the agent took it for the redeploy and
 * clicked it. What the markup says about the control is all there is to go on.
 */
describe('markupHint', () => {
  it('reads what the click does from the handler the page wired to it', () => {
    expect(markupHint({ '@click': 'modalOpen=false', class: 'absolute top-0' })).toBe('@click="modalOpen=false"');
    expect(markupHint({ onclick: 'closeBanner()' })).toBe('onclick="closeBanner()"');
    expect(markupHint({ 'x-on:click.stop': 'toggle()' })).toBe('x-on:click.stop="toggle()"');
    expect(markupHint({ 'wire:click': 'deploy' })).toBe('wire:click="deploy"');
  });

  it('prefers a title, then a handler, then an id the page gave it', () => {
    expect(markupHint({ title: 'Dismiss', onclick: 'x()' })).toBe('title="Dismiss"');
    expect(markupHint({ 'data-testid': 'deploy-button', id: 'b1' })).toBe('data-testid="deploy-button"');
    expect(markupHint({ id: 'close-notice' })).toBe('id="close-notice"');
  });

  it('says nothing when the markup says nothing', () => {
    expect(markupHint({ class: 'px-1 text-warning', type: 'button' })).toBeUndefined();
    expect(markupHint({ onclick: '  ' })).toBeUndefined();
  });

  it('clips a long handler', () => {
    const hint = markupHint({ onclick: `doSomething(${'x'.repeat(200)})` });
    expect(hint?.length).toBeLessThanOrEqual(100);
    expect(hint).toMatch(/…"$/);
  });
});
