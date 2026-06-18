import {
  countNodes,
  defineTool,
  definePlugin,
  z,
  type Plugin,
  type ViewDoc,
  type ViewRendererDef,
} from '@moxxy/sdk';

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
    handler: (input): PresentViewResult => {
      const renderer = opts.getRenderer();
      if (!renderer) {
        return { ok: false, rendered: false, errors: [{ message: 'no active view renderer' }] };
      }
      const result = renderer.parse(input.spec);
      if (!result.ok) {
        return { ok: false, rendered: false, errors: result.errors.map((e) => ({ message: e.message, line: e.line })) };
      }
      const surface = opts.getSurface?.() ?? null;
      const viewId = surface?.nextViewId();
      return {
        ok: true,
        rendered: surface != null,
        ...(surface?.url ? { url: surface.url } : {}),
        ...(viewId ? { viewId } : {}),
        nodeCount: countNodes(result.doc.root),
        ast: result.doc,
      };
    },
  });

  return definePlugin({
    name: '@moxxy/plugin-view',
    version: '0.0.0',
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
