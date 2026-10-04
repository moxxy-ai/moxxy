import { SECRET_LABEL } from './labels.js';
import type { AxNode } from './tree.js';

/**
 * Pages that have stopped being readable and started asking for a person.
 *
 * The agent must not click through any of these. A cookie choice is the user's
 * to make, a CAPTCHA is theirs to solve, and a password is theirs to type — and
 * an agent that presses "Accept all" on their behalf has made a decision nobody
 * asked it to make. Every browser tool that acts is permission-gated, so this is
 * not the only guard; it is the one that arrives *before* the model has to work
 * out what it is looking at from a wall of buttons.
 */
export type WallKind = 'captcha' | 'signin' | 'consent';

/** Roles a person can actually press. Prose that merely mentions cookies is prose. */
const PRESSABLE = new Set(['button', 'link', 'checkbox', 'switch', 'menuitem', 'menuitemcheckbox', 'radio', 'tab']);

/** Anything a text field can be called when it wants a credential. */
const FILLABLE = new Set(['textbox', 'searchbox', 'combobox', 'TextField', 'InputText']);

const CAPTCHA =
  /(recaptcha|hcaptcha|turnstile|captcha|not a robot|nie jestem robotem|jestem człowiekiem|i am human)/i;

/**
 * Where a CAPTCHA actually lives: its frame, its checkbox, its answer field.
 *
 * Text does not count. Coolify's catalogue of deployable services lists "Cap
 * Captcha — The self-hosted CAPTCHA for the modern web", and while any node
 * could name one, that sentence made the whole page a wall the agent stopped
 * at and the user could not clear.
 */
const CAPTCHA_WIDGET = new Set(['Iframe', 'IframePresentational', 'checkbox', ...FILLABLE]);

/**
 * A control belongs to a consent banner if it says so, or if it uses a phrase
 * that appears nowhere else.
 *
 * The first draft matched loose stems — `akceptuj`, `więcej opcji` — and paid
 * for it: Canva's account menu is called "Więcej opcji konta i zespołu", so
 * every snapshot of a logged-in Canva reported a consent wall that did not
 * exist, and the agent asked the user to answer it. Three times, before the
 * banner started naming what it had found.
 *
 * Over-matching here is not a small cost: it sends the person looking for
 * something that is not there, and pressing Done changes nothing, so the
 * question comes straight back.
 */
const CONSENT_WORD = /(cookie|ciasteczk)/i;
const CONSENT_PHRASE =
  /(accept all|reject all|i agree|agree and continue|only necessary|zaakceptuj wszystk|odrzuć wszystk|odrzuc wszystk|zgadzam się|zgadzam sie|tylko niezbędne|tylko niezbedne)/i;
/**
 * A link that names cookies leads to a policy — Wikipedia's footer carries one
 * on every page — so a link counts only when it uses a banner's own phrase.
 */
const isConsent = (role: string, name: string): boolean =>
  CONSENT_PHRASE.test(name) || (role !== 'link' && CONSENT_WORD.test(name));

/** What a control that signs you in is called. */
const SIGNIN = /(sign in|sign-in|log in|log-in|login|zaloguj|logowanie|continue with|kontynuuj z|anmelden|iniciar sesi)/i;

/**
 * More fields than a sign-in asks for. A sign-in wants an identifier and the
 * credential, perhaps a code; a form with more than that besides the password
 * is a form, and the rest of it is the agent's to fill.
 */
const SIGNIN_FIELDS = 2;

/** Walk the tree once, shallow-first is irrelevant — every node gets looked at. */
function walk(node: AxNode, visit: (n: AxNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/**
 * What, if anything, this page is waiting on a person for.
 *
 * Where a page is several of these at once — a sign-in behind a CAPTCHA behind
 * a cookie banner — the most blocking one is named, because that is the one the
 * person has to clear first.
 */
export interface Wall {
  readonly kind: WallKind;
  /**
   * The node that made it one.
   *
   * Named so a caller with geometry can check the thing is actually drawn. A
   * control can sit in the accessibility tree without being on screen — hidden
   * by opacity, moved off by a transform, inside a collapsed container — and a
   * wall reported from one of those traps the agent in a hand-off nobody can
   * answer: the person is told to click something they cannot see.
   */
  readonly uid: string;
}

export function detectWall(tree: AxNode | null): Wall | null {
  if (!tree) return null;
  let captcha: string | null = null;
  let secret: string | null = null;
  let consent: string | null = null;
  let otherFields = 0;
  let saysSignIn = false;

  walk(tree, (n) => {
    const name = n.name ?? '';
    if (!name) return;
    if (captcha === null && CAPTCHA_WIDGET.has(n.role) && CAPTCHA.test(name)) captcha = n.uid;
    if (FILLABLE.has(n.role)) {
      if (SECRET_LABEL.test(name)) secret ??= n.uid;
      else otherFields++;
    }
    if (PRESSABLE.has(n.role) && SIGNIN.test(name)) saysSignIn = true;
    if (consent === null && PRESSABLE.has(n.role) && isConsent(n.role, name)) consent = n.uid;
  });

  if (captcha !== null) return { kind: 'captcha', uid: captcha };
  if (secret !== null && (saysSignIn || otherFields <= SIGNIN_FIELDS)) return { kind: 'signin', uid: secret };
  if (consent !== null) return { kind: 'consent', uid: consent };
  return null;
}

const NOTES: Record<WallKind, string> = {
  captcha:
    'This page is running a CAPTCHA. Do NOT try to solve it and do not click around it — ' +
    'call browser_await_human explaining that the page wants a CAPTCHA cleared, and read the page ' +
    'again once they say they are done.',
  signin:
    'This page is asking to be signed in. Do NOT type a password, code or any other credential, and ' +
    'never ask the user to tell you one — call browser_await_human explaining what the page wants, ' +
    'let them type it themselves, and read the page again afterwards to confirm it worked.',
  consent:
    'This page is asking for a cookie or consent choice. That choice belongs to the user, so do NOT ' +
    'accept or reject it on their behalf — call browser_await_human explaining what is being asked, ' +
    'and read the page again once they have answered.',
};

/** What the agent should do about a wall, in the agent's own instructions. */
export function wallNote(kind: WallKind): string {
  return NOTES[kind];
}
