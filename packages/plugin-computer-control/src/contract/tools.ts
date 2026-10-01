import { z } from 'zod';
import { parseKeyCombo, type KeyCombo } from './keys.js';
import { MIN_SCALE } from './image.js';

const coordinate = z.number().finite().nonnegative();

/** A chord string checked by the xdotool parser, plus an optional rule on the parsed chord. */
const chord = (rule: (combo: KeyCombo) => string | undefined = () => undefined) =>
  z.string().max(64).superRefine((value, ctx) => {
    let problem: string | undefined;
    try { problem = rule(parseKeyCombo(value)); } catch (error) { problem = (error as Error).message; }
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

/** Field schemas without defaults; each action decides what is required, optional or defaulted. */
const fields = {
  element_index: z.number().int().nonnegative()
    .describe('Index of an element ([N]) in the latest computer_get_app_state of this app. Prefer it over coordinates.'),
  x: coordinate.describe('Horizontal pixel in the latest screenshot of this app, from its left edge. Give together with y.'),
  y: coordinate.describe('Vertical pixel in the latest screenshot of this app, from its top edge. Give together with x.'),
  mouse_button: z.enum(['left', 'right', 'middle']),
  click_count: z.number().int().min(1).max(3),
  modifiers: chord((combo) => combo.key === null ? undefined : 'modifiers only, e.g. "shift" or "cmd+shift"')
    .describe('Modifier keys held during the action, e.g. "shift" or "cmd+alt".'),
  text: z.string().min(1).max(20_000),
  format: z.enum(['text', 'md', 'html']),
  key: chord().describe('One chord in xdotool syntax: "Return", "Tab", "Escape", "BackSpace", "Delete" (forward delete), "Up", "Page_Down", "F5", "KP_0", "super+c" (super = Command on macOS, Windows key on Windows), "ctrl+shift+Tab".'),
  repeat: z.number().int().min(1).max(100),
  duration_s: z.number().positive().max(100).describe('Seconds.'),
  direction: z.enum(['up', 'down', 'left', 'right']),
  pages: z.number().min(0.1).max(50).describe('How far to scroll, in visible pages.'),
  path: z.array(z.array(coordinate).length(2)).min(2).max(20)
    .describe('[[x, y], ...] 2 to 20 points in the latest screenshot of this app. The button goes down at the first point, moves through each point in order and comes up at the last.'),
  duration_ms: z.number().int().min(0).max(10_000).describe('How long the whole drag takes; slow drags help timelines and sliders.'),
  event: z.enum(['down', 'move', 'up']),
  value: z.string().max(100_000),
  prefix: z.string().max(1000),
  suffix: z.string().max(1000),
  selection_type: z.enum(['text', 'cursor_before', 'cursor_after']),
  secondary_action: z.string().min(1).max(64).describe('An action listed for this element in the app state, e.g. "AXShowMenu". Never guess one.'),
};

const app = z.string().min(1).max(512)
  .describe('App display name or bundle identifier (macOS), or app id from computer_list_apps (Windows).');

type TargetInput = { element_index?: number; x?: number; y?: number };
export type Target = { kind: 'element'; index: number } | { kind: 'point'; x: number; y: number } | { kind: 'focused' };

export function resolveTarget(input: TargetInput): Target {
  if (input.element_index !== undefined) return { kind: 'element', index: input.element_index };
  if (input.x !== undefined && input.y !== undefined) return { kind: 'point', x: input.x, y: input.y };
  return { kind: 'focused' };
}

function checkTarget(required: boolean) {
  return (input: TargetInput, ctx: z.RefinementCtx) => {
    if ((input.x === undefined) !== (input.y === undefined)) {
      ctx.addIssue({ code: 'custom', path: [input.x === undefined ? 'x' : 'y'], message: 'x and y go together' });
      return;
    }
    const count = Number(input.element_index !== undefined) + Number(input.x !== undefined);
    if (count > 1 || (required && count === 0)) {
      ctx.addIssue({ code: 'custom', message: `Give exactly one target: element_index, or x and y${required ? '' : ' (or neither for the focused element)'}` });
    }
  };
}

const target = { element_index: fields.element_index.optional(), x: fields.x.optional(), y: fields.y.optional() };
type TargetRule = 'required' | 'optional' | undefined;
interface ActionDef<S extends z.ZodRawShape> { readonly shape: S; readonly target: TargetRule }
const define = <S extends z.ZodRawShape>(shape: S, rule?: TargetRule): ActionDef<S> => ({ shape, target: rule });
const targeted = <S extends z.ZodRawShape>(shape: S, rule: 'required' | 'optional') => define({ ...target, ...shape }, rule);

function build<S extends z.ZodRawShape>(shape: S, rule: TargetRule) {
  const object = z.object(shape).strict();
  return rule ? object.superRefine(checkTarget(rule === 'required')) : object;
}

/** Actions on one app, without the `app` field; shared by the single tools and `computer_batch`. */
const actions = {
  click: targeted({ mouse_button: fields.mouse_button.default('left'), click_count: fields.click_count.default(1), modifiers: fields.modifiers.optional() }, 'required'),
  type_text: targeted({ text: fields.text }, 'optional'),
  paste: targeted({ text: fields.text.max(100_000), format: fields.format.default('text') }, 'optional'),
  press_key: define({ key: fields.key, repeat: fields.repeat.default(1) }),
  scroll: targeted({ direction: fields.direction, pages: fields.pages.default(1) }, 'required'),
  drag: define({ path: fields.path, duration_ms: fields.duration_ms.optional(), modifiers: fields.modifiers.optional(), mouse_button: fields.mouse_button.default('left') }),
  set_value: define({ element_index: fields.element_index, value: fields.value }),
  select_text: define({ element_index: fields.element_index, text: fields.text, prefix: fields.prefix.optional(), suffix: fields.suffix.optional(), selection_type: fields.selection_type.default('text') }),
  perform_secondary_action: define({ element_index: fields.element_index, secondary_action: fields.secondary_action }),
  mouse: define({ event: fields.event, x: fields.x, y: fields.y, mouse_button: fields.mouse_button.default('left'), modifiers: fields.modifiers.optional() }),
  hold_key: define({ key: fields.key, duration_s: fields.duration_s }),
  wait: define({ duration_s: fields.duration_s.max(10) }),
};

type ActionName = keyof typeof actions;
type ActionOutput<N extends ActionName> = z.output<z.ZodObject<(typeof actions)[N]['shape'], 'strict'>>;
export const batchActionNames = Object.keys(actions) as ActionName[];
export type BatchAction = { [N in ActionName]: { action: N } & ActionOutput<N> }[ActionName];

const optionalFields = Object.fromEntries(Object.entries(fields).map(([name, schema]) => [name, schema.optional()]));
// One flat object keeps the JSON schema a plain object for every provider; each step is then parsed exactly.
const batchStep = z.object({ action: z.enum(batchActionNames as [ActionName, ...ActionName[]]), ...optionalFields }).strict()
  .transform((step, ctx): BatchAction => {
    const { action, ...rest } = step;
    const parsed = build(actions[action].shape, actions[action].target).safeParse(rest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return { action, ...parsed.data } as BatchAction;
  });

/** The single tool for an action: the same fields with the target `app` first. */
const onApp = <N extends ActionName>(name: N) =>
  build({ app, ...actions[name].shape }, actions[name].target) as unknown as z.ZodType<ActionOutput<N> & { app: string }, z.ZodTypeDef, unknown>;

const region = z.array(z.number().int().nonnegative()).length(4).refine(([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => x1 > x0 && y1 > y0, 'region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0')
  .describe('[x0, y0, x1, y1] in the coordinate frame of the latest screenshot.');
const scale = z.number().min(MIN_SCALE, `scale must be in [${MIN_SCALE}, 1]`).max(1, `scale must be in [${MIN_SCALE}, 1]`)
  .describe('Image scale in [0.1, 1]; smaller images cost fewer tokens. Coordinates always stay in the full-size frame.');

export interface ComputerToolSpec<I = unknown> { readonly description: string; readonly input: z.ZodType<I, z.ZodTypeDef, unknown> }

const AFTER = ' Returns the technical outcome and the fresh app state; check that the intended change happened.';

export const computerTools = {
  computer_status: {
    description: 'Report whether Computer Use can work on this computer and which system permission is missing. Call it when a tool reports missing permissions; open_settings shows the user the settings pane to allow one.',
    input: z.object({ open_settings: z.enum(['accessibility', 'screen_recording']).optional().describe('Open the system settings pane where the user allows this permission.') }).strict(),
  },
  computer_list_apps: {
    description: 'List installed and running applications (and their windows on Windows) with the identifier to pass as `app`. No side effects.',
    input: z.object({ query: z.string().max(256).optional().describe('Case-insensitive filter on name and identifier.'), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  },
  computer_request_access: {
    description: 'Ask the user, in one dialog, to let you control a set of applications for this conversation. Required before acting on an app. Browsers default to read-only and terminals to click-only; the user can raise the level.',
    input: z.object({
      apps: z.array(app).min(1).max(32),
      reason: z.string().min(1).max(500).describe('One sentence for the dialog: the task, not the mechanism.'),
      clipboard_read: z.boolean().optional(),
      clipboard_write: z.boolean().optional(),
      system_key_combos: z.boolean().optional().describe('Also allow system chords such as quit, switch app or lock screen.'),
      full_access: z.array(app).max(32).optional()
        .describe('Apps from `apps` that need full control although their kind is restricted by default (browsers read-only, terminals click-only). The user sees this list before approving.'),
    }).strict().refine((input) => (input.full_access ?? []).every((name) => input.apps.includes(name)), {
      message: 'full_access may only name apps listed in apps', path: ['full_access'],
    }),
  },
  computer_get_app_state: {
    description: 'Observe one app: its focused window as indexed accessibility elements plus a screenshot. Launches the app in the background if needed and waits for it to settle. Returns only what changed since your last look unless disable_diff is true. Call it before acting and after every action you need to verify.',
    input: z.object({
      app,
      window_id: z.string().min(1).max(160).optional().describe('A window from computer_list_apps; omit for the app\'s main window.'),
      disable_diff: z.boolean().default(false),
      include_screenshot: z.boolean().default(true),
    }).strict(),
  },
  computer_click: { description: `Click an element by element_index (preferred) or a point in the latest screenshot.${AFTER}`, input: onApp('click') },
  computer_type_text: { description: `Type text into the focused element of the app, or into element_index / the point first.${AFTER}`, input: onApp('type_text') },
  computer_paste: { description: `Paste text, markdown or html through the clipboard, then restore the clipboard. Prefer it for long or formatted content.${AFTER}`, input: onApp('paste') },
  computer_press_key: { description: `Press one key or chord in the app, in xdotool syntax.${AFTER}`, input: onApp('press_key') },
  computer_scroll: { description: `Scroll an element or the content under a point.${AFTER}`, input: onApp('scroll') },
  computer_drag: { description: `Drag along a path of screenshot points with optional duration and held modifiers: moving clips on a timeline, sliders, selections, drawing.${AFTER}`, input: onApp('drag') },
  computer_set_value: { description: `Set the value of an editable element directly (text fields, sliders, steppers).${AFTER}`, input: onApp('set_value') },
  computer_select_text: { description: `Select matching text inside an editable element, or put the caret before or after it; prefix and suffix pick between repeats.${AFTER}`, input: onApp('select_text') },
  computer_perform_secondary_action: { description: `Run an accessibility action an element lists besides a click (show menu, expand, increment, cancel).${AFTER}`, input: onApp('perform_secondary_action') },
  computer_mouse: { description: `Press, move or release a mouse button at a screenshot point, for gestures a drag cannot express (scrubbing, trimming, press-and-hold). Always release what you press.${AFTER}`, input: onApp('mouse') },
  computer_hold_key: { description: `Hold a key or modifier for a number of seconds, then release it.${AFTER}`, input: onApp('hold_key') },
  computer_batch: {
    description: 'Run several actions on one app in one call when you can predict the steps (click a field, type, press Return). Every step passes the same checks as its single tool; the batch stops at the first step that is not delivered. Returns each outcome and the final app state.',
    input: z.object({ app, actions: z.array(batchStep).min(1).max(50) }).strict(),
  },
  computer_screenshot: {
    description: 'Capture the whole display with only granted apps visible, as a fallback when one app\'s state is not enough. Coordinates of later full-screen actions refer to this image.',
    input: z.object({ scale: scale.optional() }).strict(),
  },
  computer_zoom: {
    description: 'Look closer at a region of the latest screenshot to read small text or detail. Reading aid only: coordinates keep referring to the screenshot, never to the zoomed image.',
    input: z.object({ region, app: app.optional().describe('Zoom into this app\'s latest screenshot instead of the full-screen one.'), scale: scale.optional() }).strict(),
  },
} satisfies Record<string, ComputerToolSpec>;
