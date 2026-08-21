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

const CONSENT =
  /(accept all|reject all|accept cookies|manage cookies|i agree|agree and continue|only necessary|zaakceptuj wszystk|odrzuć wszystk|akceptuj|zgadzam się|zgoda na cookies|tylko niezbędne|więcej opcji)/i;

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
export function detectWall(tree: AxNode | null): WallKind | null {
  if (!tree) return null;
  let captcha = false;
  let signin = false;
  let consent = false;

  walk(tree, (n) => {
    const name = n.name ?? '';
    if (!name) return;
    if (CAPTCHA.test(name)) captcha = true;
    if (FILLABLE.has(n.role) && SECRET_LABEL.test(name)) signin = true;
    if (PRESSABLE.has(n.role) && CONSENT.test(name)) consent = true;
  });

  if (captcha) return 'captcha';
  if (signin) return 'signin';
  if (consent) return 'consent';
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
