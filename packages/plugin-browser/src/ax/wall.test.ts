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
   * The rule now: either the label mentions cookies, or it is one of the phrases
   * that only ever appear on a consent banner.
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
    expect(pressed('Manage cookies')?.kind).toBe('consent');
    expect(pressed('Ustawienia plików cookie')?.kind).toBe('consent');
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
