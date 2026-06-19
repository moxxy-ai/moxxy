import {
  defineTool,
  definePlugin,
  z,
  type Plugin,
  type ViewDoc,
  type ViewNode,
  type ToolContext,
  type ViewRendererDef,
} from '@moxxy/sdk';

/**
 * Hard ceiling on the validated AST size. The zod `spec` cap (20k chars) only
 * bounds the *source* — rich components (e.g. `results`) expand at parse time
 * into many primitives, and a swapped-in custom renderer is not bound by core's
 * parse-depth cap at all. The full AST is JSON-serialized into the tool_result,
 * round-trips back into model context, and is streamed verbatim to every
 * web-surface client, so it must be bounded independently of the source length.
 */
const MAX_VIEW_NODES = 2_000;

/**
 * Iterative (stack-safe) node count. Unlike the recursive `countNodes` in the
 * SDK, this cannot overflow the call stack on a pathologically deep AST that a
 * custom renderer might return (core's default parser caps depth, but a
 * swapped-in renderer need not). Short-circuits once `limit` is exceeded so a
 * huge tree is rejected without walking all of it.
 */
function countNodesBounded(root: ViewNode, limit: number): number {
  const stack: ViewNode[] = [root];
  let count = 0;
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    if (count > limit) return count;
    if (node.kind === 'element') {
      for (const child of node.children) stack.push(child);
    }
  }
  return count;
}

/**
 * A live view surface the tool can query for the public URL + the next view id
 * (supplied by the web channel once it co-attaches). Optional: when absent,
 * `present_view` still parses + validates, it just returns no URL.
 */
export interface ViewSurface {
  /** The currently reachable URL of the surface, or null if not yet up. */
  readonly url: string | null;
  /** Allocate the next view id for the turn that is presenting. */
  nextViewId(): string;
}

export interface BuildViewPluginOptions {
  /**
   * Returns the session's active view renderer. A closure (not the renderer
   * itself) so `setActive`/plugin replacement is honored at call time —
   * ToolContext exposes no session handle, so this is how the tool reaches it.
   */
  getRenderer: () => ViewRendererDef | null;
  /** Returns the live web surface, if one is co-attached. */
  getSurface?: () => ViewSurface | null;
}

export function buildViewPlugin(opts: BuildViewPluginOptions): Plugin {
  const presentView = defineTool({
    name: 'present_view',
    description:
      'Render a screen of a generative UI (a "generative / dynamic / agentic UI") from a view-spec ' +
      '(JSX-like, allow-listed tags). Read the `generative-ui` skill first. Use this only when the ' +
      'user explicitly asks for a generative / dynamic / agentic UI (or interactive UI) for X — NOT ' +
      "for ordinary searches or questions, which stay plain text. Give each screen a <view name>; " +
      'call once per screen. The view appears on the user’s web surface; share the returned `url` ' +
      'with them. When the user interacts (submits a form / clicks a button) it arrives as a normal ' +
      'follow-up user message containing a `[ui-action]` block — read it and respond, usually by ' +
      'calling present_view again under the same `name` to update the screen in place.',
    inputSchema: z.object({
      spec: z
        .string()
        .min(1)
        .max(20_000)
        .describe('The view-spec source, a single <view>…</view> root with allow-listed tags.'),
      fallbackText: z
        .string()
        .max(2_000)
        .optional()
        .describe('Plain-text summary shown on channels that cannot render views.'),
    }),
    handler: (input, ctx?: ToolContext): PresentViewResult => {
      // Short-circuit a cancelled turn before the heaviest work (parse + count
      // + AST serialization on a near-20k spec). ctx is optional only so unit
      // tests can call the handler bare; the registry always supplies it.
      if (ctx?.signal?.aborted) {
        return { ok: false, rendered: false, errors: [{ message: 'aborted' }] };
      }
      const renderer = opts.getRenderer();
      if (!renderer) {
        return { ok: false, rendered: false, errors: [{ message: 'no active view renderer' }] };
      }
      // `renderer.parse` is a caller-supplied closure: core's default renderer
      // never throws (it wraps everything, even a RangeError, into a structured
      // result), but a swapped-in custom renderer carries no such guarantee. A
      // throw here would surface as a generic turn-level error instead of a
      // structured tool result, so guard it like every other external closure.
      let result: ReturnType<ViewRendererDef['parse']>;
      try {
        result = renderer.parse(input.spec);
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : 'view renderer failed';
        return { ok: false, rendered: false, errors: [{ message }] };
      }
      if (!result.ok) {
        // `errors` may be malformed (custom renderer); degrade to a single
        // generic error rather than throwing on a non-iterable `.map`.
        const errs = Array.isArray(result.errors)
          ? result.errors.map((e) => ({ message: e?.message ?? 'parse error', line: e?.line }))
          : [{ message: 'view renderer reported a parse failure' }];
        return { ok: false, rendered: false, errors: errs };
      }
      // A custom renderer can return `ok:true` with a missing/null doc or root;
      // reject with an honest message instead of letting the count below crash
      // and report "too deeply nested".
      const root = result.doc?.root;
      if (root == null || (root.kind !== 'element' && root.kind !== 'text')) {
        return { ok: false, rendered: false, errors: [{ message: 'view renderer returned a malformed AST' }] };
      }
      // Bound the AST independently of the source length. countNodesBounded is
      // iterative so a deep tree from a custom renderer cannot overflow the
      // stack; we still wrap defensively so the handler can never throw.
      let nodeCount: number;
      try {
        nodeCount = countNodesBounded(root, MAX_VIEW_NODES);
      } catch {
        return { ok: false, rendered: false, errors: [{ message: 'view too deeply nested' }] };
      }
      if (nodeCount > MAX_VIEW_NODES) {
        return {
          ok: false,
          rendered: false,
          errors: [{ message: `view too large (${nodeCount}+ nodes; max ${MAX_VIEW_NODES})` }],
        };
      }
      // The surface closures are caller-supplied and read mutable shared state
      // (web channel minter); never let a fault there turn a successful parse
      // into a turn-level throw — degrade to the documented parsed-only result.
      let surface: ViewSurface | null = null;
      let viewId: string | undefined;
      try {
        surface = opts.getSurface?.() ?? null;
        viewId = surface?.nextViewId();
        // An empty-string id is a minter fault, not "no surface": treat the
        // surface as absent rather than claiming rendered:true with no id.
        if (surface != null && (viewId == null || viewId === '')) {
          surface = null;
          viewId = undefined;
        }
      } catch {
        surface = null;
        viewId = undefined;
      }
      return {
        ok: true,
        rendered: surface != null,
        ...(surface?.url ? { url: surface.url } : {}),
        ...(viewId != null ? { viewId } : {}),
        nodeCount,
        ast: result.doc,
      };
    },
  });

  // No hardcoded `version`: it only ever drifts from package.json. The real
  // package version is captured from the resolved plugin manifest at load time.
  return definePlugin({
    name: '@moxxy/plugin-view',
    tools: [presentView],
  });
}

export interface PresentViewResult {
  readonly ok: boolean;
  /**
   * Whether a live web surface is ATTACHED (false = parsed only, no surface).
   * NOT a delivery confirmation: the view is handed to the surface
   * asynchronously when the channel's projector observes this tool_result, so
   * `rendered: true` only means a surface exists to deliver to — a browser may
   * not yet be connected to it. Do not treat it as "the user definitely sees
   * the screen".
   */
  readonly rendered: boolean;
  readonly url?: string;
  readonly viewId?: string;
  readonly nodeCount?: number;
  /** Validated AST — the web surface reads this from the tool_result. */
  readonly ast?: ViewDoc;
  readonly errors?: ReadonlyArray<{ message: string; line?: number }>;
}
