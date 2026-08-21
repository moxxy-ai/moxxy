import { describe, expect, it } from 'vitest';
import { detectWall, wallNote } from './wall.js';
import type { AxNode } from './tree.js';

/**
 * Some pages stop being readable and start asking for a person: a cookie
 * choice, a CAPTCHA, a sign-in. The agent must not click through those — the
 * consent is the user's to give and the CAPTCHA is theirs to solve — so the
 * snapshot says what it is looking at and what to do instead of leaving the
 * model to work it out from a wall of buttons.
 */
const node = (role: string, name: string, children: AxNode[] = [], value?: string): AxNode =>
  ({ uid: '1', role, name, children, ...(value !== undefined ? { value } : {}) }) as AxNode;

const page = (...children: AxNode[]): AxNode => node('RootWebArea', 'Strona', children);

describe('detectWall', () => {
  it('says nothing about an ordinary page', () => {
    expect(detectWall(page(node('link', 'Learn more'), node('button', 'Szukaj')))).toBeNull();
  });

  it('spots a cookie wall by its buttons, in either language', () => {
    expect(detectWall(page(node('button', 'Zaakceptuj wszystko')))).toBe('consent');
    expect(detectWall(page(node('button', 'Accept all')))).toBe('consent');
    expect(detectWall(page(node('button', 'Odrzuć wszystko')))).toBe('consent');
  });

  it('does not call an article about cookies a cookie wall', () => {
    // The words have to be on something you can press, not in the prose.
    expect(detectWall(page(node('StaticText', 'Zaakceptuj wszystko, co przynosi los')))).toBeNull();
    expect(detectWall(page(node('paragraph', 'Accept all cookies, said the manual')))).toBeNull();
  });

  it('spots a sign-in by the field it must never fill', () => {
    expect(detectWall(page(node('textbox', 'Hasło')))).toBe('signin');
    expect(detectWall(page(node('textbox', 'Password')))).toBe('signin');
    expect(detectWall(page(node('textbox', 'Kod SMS')))).toBe('signin');
  });

  it('spots a captcha however it is labelled', () => {
    expect(detectWall(page(node('Iframe', 'reCAPTCHA')))).toBe('captcha');
    expect(detectWall(page(node('checkbox', "I'm not a robot")))).toBe('captcha');
    expect(detectWall(page(node('checkbox', 'Nie jestem robotem')))).toBe('captcha');
    expect(detectWall(page(node('Iframe', 'Cloudflare Turnstile')))).toBe('captcha');
  });

  it('names the most blocking thing when a page has several', () => {
    // A sign-in page behind a captcha behind a cookie banner is all three; the
    // captcha is the one the person has to clear first.
    const wall = page(node('button', 'Accept all'), node('textbox', 'Hasło'), node('Iframe', 'reCAPTCHA'));

    expect(detectWall(wall)).toBe('captcha');
  });

  it('looks all the way down, not just at the top', () => {
    expect(detectWall(page(node('main', 'main', [node('form', 'form', [node('textbox', 'Hasło')])])))).toBe('signin');
  });

  it('has nothing to say about a page with no tree at all', () => {
    expect(detectWall(null)).toBeNull();
  });
});

describe('wallNote', () => {
  it('tells the agent to hand over rather than to click through', () => {
    for (const kind of ['consent', 'captcha', 'signin'] as const) {
      const note = wallNote(kind);
      expect(note).toContain('browser_await_human');
      expect(note.toLowerCase()).toMatch(/do not|never/);
    }
  });

  it('says which kind of wall it is, so the agent can explain it', () => {
    expect(wallNote('consent').toLowerCase()).toContain('consent');
    expect(wallNote('captcha').toLowerCase()).toContain('captcha');
    expect(wallNote('signin').toLowerCase()).toContain('sign');
  });
});
