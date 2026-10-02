import { z } from 'zod';
import { parseKeyCombo, type KeyCombo } from './keys.js';

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
    .describe('Modifier keys held during the click, e.g. "shift" or "cmd+alt".'),
  text: z.string().min(1).max(20_000),
  key: chord().describe('One chord in xdotool syntax: "Return", "Tab", "Escape", "BackSpace", "Delete" (forward delete), "Up", "Page_Down", "F5", "KP_0", "super+c" (super = Command on macOS, Windows key on Windows, Super on Linux), "ctrl+shift+Tab".'),
  repeat: z.number().int().min(1).max(100),
  direction: z.enum(['up', 'down', 'left', 'right']),
  pages: z.number().min(0.1).max(50).describe('How far to scroll, in visible pages.'),
  value: z.string().max(100_000),
  secondary_action: z.string().min(1).max(64).describe('An action listed for this element in the app state, e.g. "AXShowMenu". Never guess one.'),
};

const app = z.string().min(1).max(512)
  .describe('App display name or bundle identifier (macOS), or app id from computer_list_apps (Windows, Linux).');

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
    if (required && input.element_index === undefined && input.x === undefined) {
      ctx.addIssue({ code: 'custom', message: `Give exactly one target: element_index, or x and y${required ? '' : ' (or neither for the focused element)'}` });
    }
  };
}

const target = { element_index: fields.element_index.optional(), x: fields.x.optional(), y: fields.y.optional() };
type TargetRule = 'required' | 'optional' | undefined;
interface ActionDef<S extends z.ZodRawShape> { readonly shape: S; readonly target: TargetRule }
const define = <S extends z.ZodRawShape>(shape: S, rule?: TargetRule): ActionDef<S> => ({ shape, target: rule });
const targeted = <S extends z.ZodRawShape>(shape: S, rule: 'required' | 'optional') => define({ ...target, ...shape }, rule);

/**
 * Models fill every field of a tool. null, "" and a 0,0 point are filler; a real point sent next to an element is
 * where the model looked, so the point is the target (a control under it is still pressed through accessibility).
 */
function dropFiller(input: unknown, optionalTarget = false): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const kept = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null));
  for (const name of ['modifiers', 'window_id']) if (kept[name] === '') delete kept[name];
  const zeroPoint = kept.x === 0 && kept.y === 0;
  const realPoint = kept.x !== undefined && kept.y !== undefined && !zeroPoint;
  // The window itself (index 0) is no target for typing or keys, so all zeros there mean the focused element.
  if (realPoint || (optionalTarget && kept.element_index === 0)) delete kept.element_index;
  if (zeroPoint && (kept.element_index !== undefined || optionalTarget)) { delete kept.x; delete kept.y; }
  return kept;
}

function build<S extends z.ZodRawShape>(shape: S, rule: TargetRule) {
  const object = z.object(shape).strict();
  return z.preprocess((input) => dropFiller(input, rule === 'optional'), rule ? object.superRefine(checkTarget(rule === 'required')) : object);
}

/** Actions on one app, without the `app` field. */
const actions = {
  click: targeted({ mouse_button: fields.mouse_button.default('left'), click_count: fields.click_count.default(1), modifiers: fields.modifiers.optional() }, 'required'),
  type_text: define({ element_index: fields.element_index.optional(), text: fields.text }, 'optional'),
  press_key: define({ key: fields.key, repeat: fields.repeat.default(1) }),
  scroll: targeted({ direction: fields.direction, pages: fields.pages.default(1) }, 'required'),
  drag: define({
    from_x: coordinate.describe('Where the button goes down: horizontal pixel in the latest screenshot of this app.'), from_y: coordinate,
    to_x: coordinate.describe('Where the button comes up.'), to_y: coordinate,
  }),
  set_value: define({ element_index: fields.element_index, value: fields.value }),
  perform_secondary_action: define({ element_index: fields.element_index, secondary_action: fields.secondary_action }),
};

type ActionName = keyof typeof actions;
type ActionOutput<N extends ActionName> = z.output<z.ZodObject<(typeof actions)[N]['shape'], 'strict'>>;
export const actionNames = Object.keys(actions) as ActionName[];
/** One action as the backend hands it on: its name and its parsed fields. */
export type ComputerAction = { [N in ActionName]: { action: N } & ActionOutput<N> }[ActionName];

/** The single tool for an action: the same fields with the target `app` first. */
const onApp = <N extends ActionName>(name: N) =>
  build({ app, ...actions[name].shape }, actions[name].target) as unknown as z.ZodType<ActionOutput<N> & { app: string }, z.ZodTypeDef, unknown>;

/** One step of computer_run: what to do, the element in words, and what must show afterwards. */
const runStepShape = z.object({
  do: z.enum(['click', 'type', 'set_value', 'key', 'scroll']),
  target: z.string().min(1).max(300).optional()
    .describe('The element in words, the way it reads on screen: its label and kind, and where it is when that matters ("the Export button", "the file name field of the dialog"). Needed for click, set_value and scroll; leave it out of type to type into the focus.'),
  text: z.string().max(20_000).optional().describe('The exact text for type and set_value.'),
  key: chord().optional().describe('The chord for key, in xdotool syntax.'),
  direction: fields.direction.optional().describe('For scroll.'),
  expect: z.string().min(1).max(300).optional()
    .describe('What the window shows once this step worked ("an export dialog is open"). The step is checked against it and tried another way when it does not hold.'),
}).strict();
export type RunStep = z.infer<typeof runStepShape>;

const needs: Record<RunStep['do'], ReadonlyArray<keyof RunStep>> = {
  click: ['target'], type: ['text'], set_value: ['target', 'text'], key: ['key'], scroll: ['target', 'direction'],
};

/** null and "" are filler, except an empty text for set_value, which clears the field. */
function dropStepFiller(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const step = input as Record<string, unknown>;
  return Object.fromEntries(Object.entries(step).filter(([name, value]) => value !== null && (value !== '' || (name === 'text' && step.do === 'set_value'))));
}

const runStep = z.preprocess(dropStepFiller, runStepShape.superRefine((step, ctx) => {
  for (const field of needs[step.do]) {
    if (step[field] === undefined || (field === 'text' && step.do === 'type' && step.text === '')) ctx.addIssue({ code: 'custom', path: [field], message: `${step.do} needs ${field}` });
  }
}));

const region = z.array(z.number().int().nonnegative()).length(4).refine(([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => x1 > x0 && y1 > y0, 'region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0')
  .describe('[x0, y0, x1, y1] in the coordinate frame of the latest screenshot.');
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
    description: 'Observe one app: its focused window as indexed accessibility elements plus a screenshot. Launches the app in the background if needed and waits for it to settle. Returns only what changed since your last look unless disable_diff is true. Call it before the first action; every action returns the fresh state itself, so look again only when that is not enough.',
    input: z.preprocess((input) => dropFiller(input), z.object({
      app,
      window_id: z.string().min(1).max(160).optional().describe('Windows only: a window from computer_list_apps. Leave it out for the app\'s main window.'),
      disable_diff: z.boolean().default(false),
    }).strict()),
  },
  computer_click: { description: `Click an element by element_index (preferred) or a point in the latest screenshot.${AFTER}`, input: onApp('click') },
  computer_type_text: { description: `Type text into the focused element of the app, or into element_index. On a canvas or a spreadsheet cell, click the place first, then type with no element_index.${AFTER}`, input: onApp('type_text') },
  computer_press_key: { description: `Press one key or chord in the app, in xdotool syntax.${AFTER}`, input: onApp('press_key') },
  computer_scroll: { description: `Scroll an element or the content under a point.${AFTER}`, input: onApp('scroll') },
  computer_drag: { description: `Drag with the left button from one screenshot point to another: moving or trimming clips on a timeline, sliders, selections. The grab point decides what happens (a clip's edge trims, its body moves), so aim it exactly.${AFTER}`, input: onApp('drag') },
  computer_set_value: { description: `Set the value of an editable element directly (text fields, sliders, steppers).${AFTER}`, input: onApp('set_value') },
  computer_perform_secondary_action: { description: `Run an accessibility action an element lists besides a click (show menu, expand, increment, cancel).${AFTER}`, input: onApp('perform_secondary_action') },
  computer_run: {
    description: 'Run several steps on one app in a row, without a round trip per step. Describe each element in words; the element is found on the live window, also on a screen you have not seen yet, each `expect` is checked, and a step that does not work is tried another way. Stops at the first step that cannot be done and returns what was done plus the fresh app state. Use it whenever the next steps are known; use the single tools for work by x and y.',
    input: z.object({
      app,
      goal: z.string().min(1).max(500).describe('What these steps achieve, in one sentence. It tells similar elements apart.'),
      steps: z.array(runStep).min(1).max(30),
    }).strict(),
  },
  computer_zoom: {
    description: 'Look closer at a region of the latest screenshot of an app, to read small text or find an exact edge. Reading aid only: coordinates keep referring to the screenshot, never to the zoomed image.',
    input: z.object({ app, region }).strict(),
  },
} satisfies Record<string, ComputerToolSpec>;
