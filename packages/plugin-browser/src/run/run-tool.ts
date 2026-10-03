import { JEV_OFF, JEV_SECRET, RunMemory, appTreeSchema, jevClient, tracedFromEnv, type AskJev } from '@moxxy/jev';
import { MoxxyError, defineTool, z, type ProviderRequest, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import { formatRunReport, runBrowserSteps, runStepSchema, stepProblem, type PageRead, type RunPort, type RunStep } from './browser-run.js';

export const RUN_TOOL = 'browser_run';

/**
 * Whether a session has a TypeSafe key, as the last tool call found it. The
 * switch is a vault entry, so every surface of the session reads the same one;
 * until a call has looked, the environment answers.
 */
export class JevAccess {
  private readonly keyed = new Map<string, boolean>();

  async key(ctx: Pick<ToolContext, 'sessionId' | 'getSecret'>): Promise<string | undefined> {
    const secret = async (name: string) => (await ctx.getSecret?.(name)?.catch(() => null)) || undefined;
    const key = (await secret(JEV_OFF)) ? undefined : (await secret(JEV_SECRET)) || process.env[JEV_SECRET] || undefined;
    this.keyed.set(ctx.sessionId, key !== undefined);
    return key;
  }

  on(sessionId: string): boolean {
    return this.keyed.get(sessionId) ?? Boolean(process.env[JEV_SECRET]);
  }
}

const MARKER = '[Moxxy Browser Runs]';
const GUIDANCE = `${MARKER}
${RUN_TOOL} carries out a run of steps on the page in one call, and is the fastest way to act whenever you can name the elements: name each one in words as it reads on the page ("Add to basket button of the second book", "Search field"), send every step you already know together, and give "expect" to the steps that open or change something. It finds each element from its name, from what worked on this site before, or by asking Jev, checks every "expect", and stops at the first step that does not work, saying why; the page after the run comes with its answer, so do not read it again. Use the single tools (uids from browser_snapshot) for what a run reports as not done, for what has no name on the page, and when a step depends on reading something first. Allow the site with browser_allow_site before the first run there, like any action.`;

/**
 * Hides browser_run from a session without a key, and tells a session with one
 * when to use it — once.
 */
export function withBrowserRunGuidance(
  access: JevAccess,
): (request: ProviderRequest, ctx?: { readonly sessionId: string }) => ProviderRequest {
  return (request, ctx) => {
    const offered = request.tools;
    if (!offered?.some((tool) => tool.name === RUN_TOOL)) return request;
    if (ctx !== undefined && !access.on(ctx.sessionId)) return { ...request, tools: offered.filter((tool) => tool.name !== RUN_TOOL) };
    if (request.system?.includes(MARKER)) return request;
    return { ...request, system: request.system ? `${request.system}\n\n${GUIDANCE}` : GUIDANCE };
  };
}

const pageReadSchema = z.object({ tabId: z.string(), url: z.string(), title: z.string(), tree: appTreeSchema, page: z.string() });

type Call = (method: string, params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

function portOver(call: Call, ctx: ToolContext): RunPort {
  return {
    read: async (tabId) => {
      const read = pageReadSchema.safeParse(await call('tree', { tab_id: tabId }, ctx));
      if (!read.success) throw new MoxxyError({ code: 'INTERNAL', message: 'The browser answered the page in an unknown shape.' });
      return read.data as PageRead;
    },
    act: async (step: RunStep, uid, tabId) => {
      const reply = (step.do === 'select'
        ? await call('select', { uid, option: step.option, tab_id: tabId }, ctx)
        : step.do === 'key'
          ? await call('key', { key: step.key, tab_id: tabId }, ctx)
          : await call(
              'act',
              { action: step.do, uid, ...(step.do === 'type' ? { text: step.text, ...(step.submit ? { submit: true } : {}) } : {}), tab_id: tabId },
              ctx,
            )) as { opened?: { tabId?: unknown } } | undefined;
      const opened = reply?.opened?.tabId;
      return typeof opened === 'string' ? { opened: { tabId: opened } } : {};
    },
  };
}

export interface RunToolOptions {
  readonly access: JevAccess;
  /** Jev for a key; a seam so tests need no network. */
  readonly jev?: (apiKey: string) => AskJev;
  readonly memory?: RunMemory;
}

export function buildRunTool(call: Call, opts: RunToolOptions): ToolDef {
  const jev = opts.jev ?? ((apiKey: string) => tracedFromEnv(jevClient(apiKey)));
  let memory = opts.memory;
  return defineTool({
    name: RUN_TOOL,
    icon: 'globe',
    description:
      'Carry out several steps on the page in one call — click, type, select, key, hover — naming each element ' +
      'in words as it reads on the page. Each element is found from its name, from what worked on this site ' +
      'before, or by Jev reading the page; each "expect" is checked the same way, and the run stops at the first ' +
      'step that does not work, saying why. Returns what every step did and the page after the last one.',
    inputSchema: z.object({
      goal: z.string().min(1).max(300).describe('What the steps achieve together, in a few words — remembered with them.'),
      steps: z
        .array(
          runStepSchema.extend({
            do: runStepSchema.shape.do.describe('click, type (text, submit), select (option), key (key) or hover.'),
            target: runStepSchema.shape.target.describe(
              'The element, in words as it reads on the page: "Add to basket button of the second book". ' +
                'A type step without a target types into the focused field; a key step needs none.',
            ),
            expect: runStepSchema.shape.expect.describe('What the page shows once the step worked: "the basket says 1 item".'),
          }),
        )
        .min(1)
        .max(20),
      tab_id: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().optional()),
    }),
    permission: { action: 'allow' },
    compact: { verb: 'Running', noun: { one: 'step', other: 'steps' }, previewKey: 'goal' },
    // The bridge to the page and Jev (api.typesafe.ai) are both reached from here, like the other acting tools.
    isolation: { capabilities: { subprocess: true, net: { mode: 'any' as const }, timeMs: 5 * 60_000 } },
    handler: async ({ goal, steps, tab_id }, ctx) => {
      const problems = steps.map((step, at) => [at, stepProblem(step)] as const).filter(([, problem]) => problem);
      if (problems.length > 0) {
        throw new MoxxyError({ code: 'INTERNAL', message: problems.map(([at, problem]) => `step ${at + 1}: ${problem}`).join('; ') });
      }
      const apiKey = await opts.access.key(ctx);
      if (!apiKey) {
        throw new MoxxyError({
          code: 'INTERNAL',
          message: `${RUN_TOOL} needs a TypeSafe key and Jev switched on; use the single browser tools instead.`,
        });
      }
      memory ??= new RunMemory(moxxyPath('browser-use', 'learned'));
      const report = await runBrowserSteps(
        { goal, steps, ...(tab_id ? { tabId: tab_id } : {}) },
        { port: portOver(call, ctx), ask: jev(apiKey), memory, signal: ctx.signal },
      );
      const after = (await call('snapshot', { tab_id: report.tabId }, ctx)) as { text?: unknown } | undefined;
      const page = typeof after?.text === 'string' ? after.text : '';
      return { ...(after ?? {}), text: `${formatRunReport(report)}\n\n${page}`.trimEnd() };
    },
  });
}
