/**
 * Agent-authored UI view-spec — the contract shared by the parser (core) and
 * the renderer (web channel frontend).
 *
 * An agent emits a small JSX/XML-like document; a {@link ViewRendererDef} parses
 * it into a validated {@link ViewDoc} AST against a strict tag/attribute
 * **allow-list** (no raw HTML / script passthrough). One renderer is active per
 * session, registered via plugins exactly like compactors / cache-strategies.
 *
 * The tag vocabulary ({@link VIEW_PRIMITIVES} / {@link VIEW_COMPONENTS}) is plain
 * data so the browser frontend can import the SAME allow-list the parser
 * validates against — preventing the two-list drift that would open an XSS gap.
 */

/** A node in the validated view AST. After parsing, only primitives remain. */
export type ViewNode =
  | {
      readonly kind: 'element';
      readonly tag: string;
      readonly props: Readonly<Record<string, string | number | boolean>>;
      readonly children: ReadonlyArray<ViewNode>;
      /** Present on interactive elements (`form`, `button`) — drives an agent turn. */
      readonly action?: ViewAction;
      /**
       * Client-side navigation target (a `view` `name`). Set from a `to` attr on
       * `link`/`button`. The frontend switches to the named cached view WITHOUT an
       * agent turn; if it isn't cached yet it falls back to a `navigate:<name>` turn.
       */
      readonly nav?: string;
    }
  | { readonly kind: 'text'; readonly value: string };

/** Declared on an interactive element; the transport turns it into a turn. */
export interface ViewAction {
  /** Opaque name the agent chose, e.g. `search_flights`, `select:UA42`. */
  readonly name: string;
  /** Input `name`s whose current values this action carries back. */
  readonly fields: ReadonlyArray<string>;
}

export interface ViewDoc {
  readonly root: ViewNode;
  readonly title?: string;
}

export interface ViewParseError {
  readonly message: string;
  readonly line?: number;
  readonly col?: number;
}

export type ViewParseResult =
  | { readonly ok: true; readonly doc: ViewDoc }
  | { readonly ok: false; readonly errors: ReadonlyArray<ViewParseError> };

// ---------------------------------------------------------------------------
// Shared vocabulary — plain data, the single source of truth.
// ---------------------------------------------------------------------------

export type AttrType = 'string' | 'number' | 'boolean' | 'enum';

export interface AttrSpec {
  readonly type: AttrType;
  readonly required?: boolean;
  /** Allowed values when `type === 'enum'`. */
  readonly values?: ReadonlyArray<string>;
  /** Inclusive bounds when `type === 'number'`. */
  readonly min?: number;
  readonly max?: number;
}

export interface ViewTagSpec {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, AttrSpec>>;
  /** Allowed child tags; `'any'` = any element + text, `'none'` = void. */
  readonly allowedChildren: ReadonlyArray<string> | 'any' | 'none';
  /** Carries a {@link ViewAction} (the parser synthesizes `node.action`). */
  readonly interactive?: boolean;
  /** A rich component the renderer expands into primitives at parse time. */
  readonly component?: boolean;
}

/**
 * A swappable view-spec renderer. `parse` turns source into a validated AST
 * (rich components already expanded to primitives); `validate` re-checks an
 * already-built AST against {@link allowList} — note it runs on EXPANDED
 * primitives, a contract replacement renderers must preserve.
 */
export interface ViewRendererDef {
  readonly name: string;
  readonly allowList: ReadonlyArray<ViewTagSpec>;
  parse(source: string): ViewParseResult;
  validate(doc: ViewDoc): ReadonlyArray<ViewParseError>;
}

const TONE = ['default', 'muted', 'success', 'warn', 'danger'] as const;
const GAP = ['none', 'sm', 'md', 'lg'] as const;

/** Primitives — the frontend renders these directly (keymap === these tags). */
export const VIEW_PRIMITIVES: ReadonlyArray<ViewTagSpec> = [
  // layout / containers
  { tag: 'view', attrs: { title: { type: 'string' }, name: { type: 'string' } }, allowedChildren: 'any' },
  { tag: 'stack', attrs: { gap: { type: 'enum', values: GAP }, align: { type: 'enum', values: ['start', 'center', 'end', 'stretch'] } }, allowedChildren: 'any' },
  { tag: 'row', attrs: { gap: { type: 'enum', values: GAP }, align: { type: 'enum', values: ['start', 'center', 'end', 'stretch'] }, justify: { type: 'enum', values: ['start', 'center', 'end', 'between'] } }, allowedChildren: 'any' },
  { tag: 'grid', attrs: { cols: { type: 'number', required: true, min: 1, max: 6 }, gap: { type: 'enum', values: GAP } }, allowedChildren: 'any' },
  { tag: 'card', attrs: { title: { type: 'string' }, accent: { type: 'enum', values: TONE } }, allowedChildren: 'any' },
  { tag: 'divider', attrs: {}, allowedChildren: 'none' },
  // loading states (show while fetching real data, then replace with results)
  { tag: 'spinner', attrs: { label: { type: 'string' } }, allowedChildren: 'none' },
  { tag: 'skeleton', attrs: { rows: { type: 'number', min: 1, max: 12 } }, allowedChildren: 'none' },
  // display
  { tag: 'heading', attrs: { level: { type: 'number', min: 1, max: 3 } }, allowedChildren: 'any' },
  { tag: 'text', attrs: { tone: { type: 'enum', values: TONE }, weight: { type: 'enum', values: ['normal', 'bold'] } }, allowedChildren: 'any' },
  { tag: 'badge', attrs: { tone: { type: 'enum', values: TONE } }, allowedChildren: 'any' },
  { tag: 'image', attrs: { src: { type: 'string', required: true }, alt: { type: 'string' }, w: { type: 'number' }, h: { type: 'number' } }, allowedChildren: 'none' },
  { tag: 'link', attrs: { href: { type: 'string' }, to: { type: 'string' } }, allowedChildren: 'any' },
  { tag: 'list', attrs: { ordered: { type: 'boolean' } }, allowedChildren: ['item'] },
  { tag: 'item', attrs: {}, allowedChildren: 'any' },
  { tag: 'table', attrs: {}, allowedChildren: ['tr'] },
  { tag: 'tr', attrs: {}, allowedChildren: ['th', 'td'] },
  { tag: 'th', attrs: { align: { type: 'enum', values: ['left', 'center', 'right'] } }, allowedChildren: 'any' },
  { tag: 'td', attrs: { align: { type: 'enum', values: ['left', 'center', 'right'] } }, allowedChildren: 'any' },
  // inputs (only meaningful inside `form`)
  { tag: 'form', attrs: { action: { type: 'string', required: true }, submit: { type: 'string' } }, allowedChildren: 'any', interactive: true },
  { tag: 'input', attrs: { name: { type: 'string', required: true }, type: { type: 'enum', values: ['text', 'number', 'date', 'email'] }, label: { type: 'string' }, placeholder: { type: 'string' }, value: { type: 'string' }, required: { type: 'boolean' } }, allowedChildren: 'none' },
  { tag: 'select', attrs: { name: { type: 'string', required: true }, label: { type: 'string' }, value: { type: 'string' }, required: { type: 'boolean' } }, allowedChildren: ['option'] },
  { tag: 'option', attrs: { value: { type: 'string', required: true }, selected: { type: 'boolean' } }, allowedChildren: 'any' },
  { tag: 'checkbox', attrs: { name: { type: 'string', required: true }, label: { type: 'string' }, checked: { type: 'boolean' } }, allowedChildren: 'none' },
  // `action` drives an agent turn; `to` navigates client-side to a named view.
  { tag: 'button', attrs: { action: { type: 'string' }, to: { type: 'string' }, label: { type: 'string', required: true }, variant: { type: 'enum', values: ['primary', 'secondary', 'danger'] }, fields: { type: 'string' } }, allowedChildren: 'none', interactive: true },
];

/**
 * Rich components — accepted by the parser, expanded to primitives, never reach the
 * frontend. Generic + domain-agnostic: a `results` list of selectable `result`s is
 * the backbone of any "search engine / platform for X" the agent builds.
 */
export const VIEW_COMPONENTS: ReadonlyArray<ViewTagSpec> = [
  { tag: 'results', attrs: {}, allowedChildren: ['result'], component: true },
  {
    tag: 'result',
    attrs: {
      title: { type: 'string', required: true },
      subtitle: { type: 'string' },
      badge: { type: 'string' },
      id: { type: 'string' },
      action: { type: 'string' }, // agent turn on select (default: open:<id>)
      to: { type: 'string' }, // or client-side nav to a named view
    },
    allowedChildren: 'none',
    component: true,
  },
];

/** The default renderer's full allow-list (primitives + components). */
export const DEFAULT_VIEW_TAGS: ReadonlyArray<ViewTagSpec> = [...VIEW_PRIMITIVES, ...VIEW_COMPONENTS];
