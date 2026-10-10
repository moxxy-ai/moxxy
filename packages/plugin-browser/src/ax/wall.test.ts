import { describe, expect, it } from 'vitest';
import { declineNote, detectWall, wallNote } from './wall.js';
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
    expect(detectWall(page(node('button', 'Zaakceptuj wszystko')))?.kind).toBe('consent');
    expect(detectWall(page(node('button', 'Accept all')))?.kind).toBe('consent');
    expect(detectWall(page(node('button', 'Odrzuć wszystko')))?.kind).toBe('consent');
  });

  it('does not call an article about cookies a cookie wall', () => {
    // The words have to be on something you can press, not in the prose.
    expect(detectWall(page(node('StaticText', 'Zaakceptuj wszystko, co przynosi los')))).toBeNull();
    expect(detectWall(page(node('paragraph', 'Accept all cookies, said the manual')))).toBeNull();
  });

  it('spots a sign-in by the field it must never fill', () => {
    expect(detectWall(page(node('textbox', 'Hasło')))?.kind).toBe('signin');
    expect(detectWall(page(node('textbox', 'Password')))?.kind).toBe('signin');
    expect(detectWall(page(node('textbox', 'Kod SMS')))?.kind).toBe('signin');
  });

  it('spots a captcha however it is labelled', () => {
    expect(detectWall(page(node('Iframe', 'reCAPTCHA')))?.kind).toBe('captcha');
    expect(detectWall(page(node('checkbox', "I'm not a robot")))?.kind).toBe('captcha');
    expect(detectWall(page(node('checkbox', 'Nie jestem robotem')))?.kind).toBe('captcha');
    expect(detectWall(page(node('Iframe', 'Cloudflare Turnstile')))?.kind).toBe('captcha');
  });

  it('names the most blocking thing when a page has several', () => {
    // A sign-in page behind a captcha behind a cookie banner is all three; the
    // captcha is the one the person has to clear first.
    const wall = page(node('button', 'Accept all'), node('textbox', 'Hasło'), node('Iframe', 'reCAPTCHA'));

    expect(detectWall(wall)?.kind).toBe('captcha');
  });

  it('looks all the way down, not just at the top', () => {
    expect(detectWall(page(node('main', 'main', [node('form', 'form', [node('textbox', 'Hasło')])])))?.kind).toBe('signin');
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

describe('detectWall — agreements with the full terms label', () => {
  it.each([
    'I agree to the terms',
    'Zgadzam się na regulamin',
    'By continuing, I agree to the terms',
    'Nie zgadzam się na regulamin',
    'I agree: terms and conditions',
    'I agree—terms and conditions',
    'Agree and continue with the terms',
    '  ZGADZAM  SIE\u00a0na regulamin  ',
  ])('leaves "%s" to the user', (name) => {
    const agreement: AxNode = { uid: '2', role: 'checkbox', name, children: [] };
    expect(detectWall(page(agreement))).toEqual({ kind: 'consent', uid: '2' });
  });

  it.each(['Accept all terms and conditions', 'Accept all terms-of-service', 'Zaakceptuj wszystkie warunki regulaminu'])('leaves the explicit terms button "%s" to the user', (name) => {
    const agreement: AxNode = { uid: '2', role: 'button', name, children: [] };
    expect(detectWall(page(agreement))).toEqual({ kind: 'consent', uid: '2' });
  });

  it('does not borrow an invitation decline or a cookie policy for terms', () => {
    const agreement: AxNode = { uid: '2', role: 'button', name: 'I agree to the terms', children: [] };
    const invitations: AxNode = { uid: '3', role: 'button', name: 'Reject all invitations', children: [] };
    expect(detectWall(page(agreement, invitations, node('link', 'Cookie policy'))))
      .toEqual({ kind: 'consent', uid: '2' });
  });

  it('does not treat agreement-like names or ordinary prose as a consent control', () => {
    expect(detectWall(page(node('button', 'I agreement settings')))).toBeNull();
    expect(detectWall(page(node('paragraph', 'I agree to the terms')))).toBeNull();
  });
});

describe('detectWall — naming the element, so it can be checked', () => {
  /**
   * A control can sit in the accessibility tree without being drawn: hidden by
   * opacity, moved away by a transform, inside a collapsed container. Reported
   * as a wall it traps the agent in a hand-off nobody can answer — the person
   * is told to click something that is not on their screen. So the detector
   * names the node it matched, and a caller with geometry decides whether it is
   * really there.
   */
  it('says which node made it a wall', () => {
    const button = { uid: '7', role: 'button', name: 'Accept all', children: [] } as AxNode;

    expect(detectWall(page(button))).toEqual({ kind: 'consent', uid: '7' });
  });

  it('names the node of the most blocking wall, not the first one seen', () => {
    const wall = page(
      { uid: '2', role: 'button', name: 'Accept all', children: [] } as AxNode,
      { uid: '9', role: 'Iframe', name: 'reCAPTCHA', children: [] } as AxNode,
    );

    expect(detectWall(wall)).toEqual({ kind: 'captcha', uid: '9' });
  });
});

describe('detectWall — not everything that sounds like consent is consent', () => {
  /**
   * The pattern used to include "więcej opcji" — a phrase some cookie banners
   * use for their settings link, and also an ordinary label on ordinary menus.
   * Canva's account menu is called "Więcej opcji konta i zespołu", so every
   * snapshot of a logged-in Canva reported a consent wall that did not exist and
   * the agent dutifully asked the user to answer it. Seen live, three times.
   *
   * A settings opener is not a choice. Only a complete consent label counts.
   */
  const pressed = (name: string): AxNode | null =>
    detectWall(page({ uid: '2', role: 'button', name, children: [] } as AxNode));

  it('leaves ordinary menus alone', () => {
    expect(pressed('Więcej opcji konta i zespołu')).toBeNull();
    expect(pressed('Więcej opcji')).toBeNull();
    expect(pressed('More options')).toBeNull();
    expect(pressed('Akceptuj zaproszenie')).toBeNull();
    expect(pressed('Ustawienia')).toBeNull();
  });

  it('still catches a banner that names cookies', () => {
    expect(pressed('Zaakceptuj wszystkie pliki cookie')?.kind).toBe('consent');
    expect(pressed('Odrzuć wszystkie pliki cookie')?.kind).toBe('consent');
  });

  it.each(['Manage cookies', 'Ustawienia plików cookie', 'Cookie settings'])('does not mistake the settings opener "%s" for an open consent panel', (label) => {
    expect(detectWall(page(node('main', 'Koszyk'), node('contentinfo', 'Stopka', [node('button', label)])))).toBeNull();
  });

  it('still catches the phrases only a consent banner uses', () => {
    expect(pressed('Accept all')?.kind).toBe('consent');
    expect(pressed('Reject all')?.kind).toBe('consent');
    expect(pressed('I agree')?.kind).toBe('consent');
    expect(pressed('Agree and continue')?.kind).toBe('consent');
    expect(pressed('Zgadzam się')?.kind).toBe('consent');
    expect(pressed('Tylko niezbędne')?.kind).toBe('consent');
  });
});

describe('detectWall — a page that links to its cookie policy is not asking', () => {
  /**
   * Wikipedia's footer has a link called "Oświadczenie o ciasteczkach" on every
   * page. It mentions cookies and it can be pressed, so it was reported as a
   * consent wall, and the agent stopped a search to ask the user for a choice no
   * page was asking for. Seen live on pl.wikipedia.org. A link that names
   * cookies leads to a policy; a banner asks with buttons, or with the phrases
   * only a banner uses.
   */
  const link = (name: string): AxNode | null =>
    detectWall(page({ uid: '2', role: 'link', name, children: [] } as AxNode));

  it('leaves policy links alone', () => {
    expect(link('Oświadczenie o ciasteczkach')).toBeNull();
    expect(link('Cookie policy')).toBeNull();
    expect(link('Polityka plików cookie')).toBeNull();
  });

  it('still catches a banner that asks with a link', () => {
    expect(link('Accept all cookies')?.kind).toBe('consent');
    expect(link('Zgadzam się')?.kind).toBe('consent');
  });
});

describe('detectWall — a form with a password field is not a sign-in wall', () => {
  /**
   * A test form with a dozen fields, one of them "Password", was reported as a
   * sign-in, and the agent handed over instead of filling the rest — the task
   * had said to leave the password alone. Seen live on Selenium's web form. A
   * sign-in is a page that asks for little but the credential, or says so on a
   * button; the password field itself is still never filled, by the redactor
   * and by the snapshot's own rules.
   */
  const field = (uid: string, role: string, name: string): AxNode => ({ uid, role, name, children: [] }) as AxNode;

  it('leaves a long form alone', () => {
    const form = page(
      field('2', 'textbox', 'Text input'),
      field('3', 'textbox', 'Password'),
      field('4', 'textbox', 'Textarea'),
      field('5', 'combobox', 'Dropdown (select)'),
      field('6', 'textbox', 'Date picker'),
      field('7', 'button', 'Submit'),
    );
    expect(detectWall(form)).toBeNull();
  });

  it('still spots a sign-in that says so on a button', () => {
    const signIn = page(
      field('2', 'textbox', 'E-mail'),
      field('3', 'textbox', 'Hasło'),
      field('4', 'textbox', 'Imię'),
      field('5', 'textbox', 'Nazwisko'),
      field('6', 'button', 'Zaloguj się'),
    );
    expect(detectWall(signIn)).toEqual({ kind: 'signin', uid: '3' });
  });

  it('still spots a page that asks for nothing but the credential', () => {
    expect(detectWall(page(field('2', 'textbox', 'Login'), field('3', 'textbox', 'Password'), field('4', 'button', 'Dalej')))?.kind).toBe(
      'signin',
    );
  });
});

describe('detectWall — a page that talks about CAPTCHAs is not running one', () => {
  /**
   * Coolify's "New resource" page lists every service it can deploy, and one of
   * them is "Cap Captcha — The self-hosted CAPTCHA for the modern web". The
   * word alone made the whole catalogue a CAPTCHA wall: the agent stopped at it,
   * asked the user to clear a CAPTCHA that was not there, and gave up when
   * Done changed nothing. A CAPTCHA is a widget — its frame, its checkbox, its
   * answer field — never a sentence.
   */
  const card = (...lines: string[]): AxNode => node('generic', '', lines.map((line) => node('StaticText', line)));

  it('leaves a catalogue entry about a CAPTCHA service alone', () => {
    expect(detectWall(page(card('Cap Captcha', 'The self-hosted CAPTCHA for the modern web.')))).toBeNull();
  });

  it('leaves headings, paragraphs and links about CAPTCHAs alone', () => {
    expect(detectWall(page(node('heading', 'How reCAPTCHA works')))).toBeNull();
    expect(detectWall(page(node('paragraph', 'We use hCaptcha to keep bots out.')))).toBeNull();
    expect(detectWall(page(node('link', 'reCAPTCHA Privacy Policy')))).toBeNull();
  });

  it('still spots the widget itself', () => {
    expect(detectWall(page(card('Cap Captcha'), node('Iframe', 'reCAPTCHA')))?.kind).toBe('captcha');
    expect(detectWall(page(node('IframePresentational', 'hCaptcha challenge')))?.kind).toBe('captcha');
    expect(detectWall(page(node('textbox', 'Enter the CAPTCHA')))?.kind).toBe('captcha');
  });
});

describe('detectWall — a cookie banner that can be turned down', () => {
  /**
   * The owner's decision: what a site does not need is declined without asking.
   * So the wall names the control that does it, and only that one — accepting
   * stays the user's, and so does a banner that offers no way to decline.
   */
  const named = (uid: string, role: string, name: string): AxNode => ({ uid, role, name, children: [] }) as AxNode;

  it('names the control that declines, in either language', () => {
    for (const name of ['Reject all', 'Only necessary cookies', 'Accept only necessary cookies', 'Odrzuć wszystkie', 'Tylko niezbędne', 'Akceptuj tylko niezbędne pliki cookie', 'Odrzuć opcjonalne', 'Continue without accepting']) {
      const wall = detectWall(page(node('dialog', 'Cookies', [named('2', 'button', 'Accept all'), named('3', 'button', name)])));

      expect(wall, name).toMatchObject({ kind: 'consent', decline: { uid: '3', name } });
    }
  });

  it('hands an ambiguous choice to the user rather than treating it as cookies', () => {
    const wall = detectWall(page(named('2', 'button', 'Akceptuję'), named('3', 'button', 'Odrzuć opcjonalne')));
    expect(wall).toMatchObject({
      kind: 'consent',
    });
    expect(wall).not.toHaveProperty('decline');
  });

  it('names none when the banner only lets you accept or open its settings', () => {
    const wall = detectWall(page(named('2', 'button', 'Zaakceptuj wszystkie'), named('3', 'button', 'Ustawienia plików cookie')));

    expect(wall?.kind).toBe('consent');
    expect(wall).not.toHaveProperty('decline');
  });

  it('does not take refusing terms for declining cookies', () => {
    // "I do not agree" to a contract is a decision of another weight.
    const wall = detectWall(page(named('2', 'button', 'Zgadzam się'), named('3', 'button', 'Nie zgadzam się')));

    expect(wall?.kind).toBe('consent');
    expect(wall).not.toHaveProperty('decline');
  });

  it('does not take a box in the banner settings for the answer', () => {
    const wall = detectWall(page(named('2', 'button', 'Accept all'), named('3', 'checkbox', 'Only necessary')));

    expect(wall).not.toHaveProperty('decline');
  });

  it('keeps the more blocking wall, with nothing to decline on it', () => {
    const wall = detectWall(page(named('2', 'button', 'Reject all'), named('3', 'textbox', 'Hasło')));

    expect(wall?.kind).toBe('signin');
    expect(wall).not.toHaveProperty('decline');
  });
});

describe('detectWall — declining only the cookie banner', () => {
  const button = (uid: string, name: string, states: AxNode['states'] = []): AxNode => ({ uid, role: 'button', name, children: [], states });
  const banner = (...children: AxNode[]): AxNode => ({ uid: 'banner', role: 'dialog', name: 'Your privacy', children: [node('StaticText', 'We use cookies for statistics and advertising.'), ...children] });

  it('does not mistake invitations for a cookie choice, in either language', () => {
    for (const name of ['Reject all invitations', 'Accept all invitations', 'Accept only necessary invitations', 'Odrzuć wszystkie zaproszenia', 'Zaakceptuj wszystkie zaproszenia', 'Akceptuj tylko niezbędne zaproszenia']) {
      expect(detectWall(page(button('2', name))), name).toBeNull();
    }
  });

  it('declines the cookie button rather than an identically named button elsewhere', () => {
    expect(detectWall(page(button('2', 'Reject all'), banner(button('3', 'Accept all'), button('4', 'Reject all')))))
      .toEqual({ kind: 'consent', uid: '3', decline: { uid: '4', name: 'Reject all' } });
  });

  it('does not borrow a decline button from another dialog', () => {
    const invitations = node('dialog', 'Invitations', [button('4', 'Reject all')]);
    const wall = detectWall(page(banner(button('3', 'Accept all')), invitations));
    expect(wall).toEqual({ kind: 'consent', uid: '3' });
  });

  it('keeps the banner context through a nested group of its controls', () => {
    const wall = detectWall(page(banner(button('3', 'Accept all'), node('group', 'Actions', [button('4', 'Reject all')]))));
    expect(wall).toMatchObject({ decline: { uid: '4' } });
  });

  it('does not use a footer policy as the context for an unrelated decline button', () => {
    const wall = detectWall(page(node('link', 'Cookie policy'), button('3', 'Reject all')));
    expect(wall?.kind).toBe('consent');
    expect(wall).not.toHaveProperty('decline');
  });

  it('does not use a settings opener as cookie context for an unrelated choice in a region', () => {
    const opener = { ...button('3', 'Ustawienia plików cookie'), children: [node('StaticText', 'Ustawienia plików cookie')] };
    const wall = detectWall(page(node('region', 'Invitations', [button('2', 'Reject all'), opener])));
    expect(wall).not.toHaveProperty('decline');
  });

  it('normalizes a complete label and recognizes cookies named by the control itself', () => {
    expect(detectWall(page(button('3', '  REJECT   ALL COOKIES  '))))
      .toMatchObject({ decline: { uid: '3', name: '  REJECT   ALL COOKIES  ' } });
    expect(detectWall(page(button('3', 'Odrzuć wszystkie pliki cookie'))))
      .toMatchObject({ decline: { uid: '3' } });
  });

  it('limits the permission to decline to cookies rather than other choices on the page', () => {
    expect(declineNote('Reject all cookies', '3')).toContain('This exception is only for cookies.');
    expect(declineNote('Reject all cookies', '3')).toContain('Do not reject invitations, requests or other choices unless the user asked for that.');
  });

  it('uses an explicitly named cookie decline after an unscoped accept control', () => {
    expect(detectWall(page(button('2', 'Accept all cookies'), button('3', 'Reject all cookies'))))
      .toEqual({ kind: 'consent', uid: '3', decline: { uid: '3', name: 'Reject all cookies' } });
  });

  it('does not borrow an explicit decline from outside the first scoped banner', () => {
    const wall = detectWall(page(banner(button('2', 'Accept all cookies')), button('3', 'Reject all cookies')));
    expect(wall).not.toHaveProperty('decline');
  });

  it('does not recommend pressing a disabled cookie control', () => {
    const wall = detectWall(page(banner(button('3', 'Accept all'), button('4', 'Reject all', ['disabled']))));
    expect(wall?.kind).toBe('consent');
    expect(wall).not.toHaveProperty('decline');
  });
});

describe('declineNote', () => {
  it('tells the agent to press the declining control itself and carry on, never to accept', () => {
    const note = declineNote('Tylko niezbędne');

    expect(note).toContain('"Tylko niezbędne"');
    expect(note).toMatch(/press it yourself and carry on/i);
    expect(note).toMatch(/do not ask the user/i);
    expect(note).toMatch(/never press a control that accepts/i);
    expect(note).toContain('browser_await_human');
  });

  it('explains that accepting only necessary cookies still declines optional cookies', () => {
    expect(declineNote('Akceptuj tylko niezbędne', '3')).toContain('A necessary-only choice may use the word "Accept"');
  });
});
