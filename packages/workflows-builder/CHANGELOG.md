# @moxxy/workflows-builder

## 0.1.24

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.1.23

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.1.22

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.1.21

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.1.20

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.1.19

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.1.18

### Patch Changes

- 08f927a: feat: pick which session ambient triggers run in + a compact trigger marker

  Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
  session **created** them, and the synthesized prompt — often a large block
  carrying an untrusted webhook payload — rendered as a giant user bubble. Two
  changes:

  **Pick the target session.** Each trigger can now be pinned to a chosen session
  (where its run executes _and_ displays), decoupled from who created it:

  - `webhook_create` / `schedule_create` take an optional `targetSessionId`
    (defaulting to the creating session), and `webhook_update` /
    `schedule_set_target` reassign it. These map onto the existing
    `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
    owner-gate already deliver to the right runner — no routing change.
  - Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
    onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
    watched only by the target runner; a cross-session `afterWorkflow` dependent
    is skipped with a warning (the completion event is in-process to the parent's
    runner). The visual builder preserves the field across a round-trip.
  - Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
    gain a session picker (new `*.setTargetSession` IPC commands), and each
    summary surfaces the resolved target-session name.

  **Compact trigger marker.** A fired trigger now renders as a one-line,
  expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
  "Workflow ran · digest") instead of the raw prompt — click to reveal the full
  payload. The prompt still lives in the model's context (security fences intact);
  only the display changes (new optional `origin` on the `user_prompt` event,
  threaded from the fired turn via `RunTurnOptions.origin`).

  Unset everywhere preserves today's behavior; single-process CLI/TUI is
  unaffected.

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.1.17

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.1.16

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.1.15

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.1.14

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.1.13

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.1.12

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.1.11

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.1.10

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.1.9

### Patch Changes

- 897a1fc: Long-tail review fixes (quality sweep, t3 cluster):

  - plugin-oauth: thread the flow's abort signal into device-flow poll fetches (and the OpenAI token exchange) so a hung in-flight poll cancels, not just the inter-poll sleep; drop redundant clearTimeout calls in the callback server (settle() is the single cleanup chokepoint); document the credential-lock stale-takeover TOCTOU window.
  - plugin-vault: randomCode now draws width-appropriate entropy and rejection-samples — fixes the silent leading-digit cap for codes >= 10 digits and the modulo bias.
  - plugin-mcp: one malformed mcp.json entry no longer discards the whole server catalog (per-entry parse keeps valid rows); MCP resource results pass through inline text instead of a bare [resource]; createMcpPlugin connects servers in parallel (boot bounded at the slowest, not the sum).
  - plugin-scheduler: describeEntry shares the poller's next-fire baseline so the displayed next-fire agrees with when isDue fires; tickOnce counts due-and-attempted schedules (counts a fired-but-failed run).
  - workflows-builder: block-scalar parser strips indentation by the minimum body indent (no longer corrupts a literal block whose lines are shallower than the first).
  - runner: createUnixSocketServer.onConnection is single-handler (last-write-wins), consistent with Transport.onFrame/onClose.
  - mobile-poc: boot the env-URL transport in an effect (not a render-phase useState initializer); guard approval allow/deny against forwarding an empty optionId.

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.1.8

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.1.7

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.1.6

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.1.5

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.1.4

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.1.3

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.1.2

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.1.1

### Patch Changes

- c050573: Workflow builder canvas: drag-to-connect step wiring. You can now draw the
  dependency DAG directly on the canvas instead of only typing into the
  inspector's NEEDS field — and those connections ARE the workflow's execution
  order (an A→B edge means A runs before B).

  - Each node card gets connection handles: a left INPUT and a right OUTPUT
    (plain `needs`). Condition nodes expose labeled `then`/`else` output handles;
    loop nodes expose an `exit` output handle plus a distinct lower-half "body"
    drop region (upper-half input = the loop's own `needs`).
  - A pointerdown on a HANDLE starts a connection drag (live temp line following
    the cursor); a pointerdown on the card BODY still moves the node. Dropping on
    another node's card dispatches the matching shared op (`connect-needs`,
    `set-branch`, `set-loop-body`, `set-loop-exit`); dropping on empty canvas or
    the source's own card cancels cleanly.
  - Existing edges are interactive: click the edge or its midpoint ✕ to remove the
    dependency (routes through `disconnect-needs` / the relevant set-\* op).
  - Self-connects and cycle-closing connections are refused (the latter with a
    brief inline rejection), so the canvas can't author an invalid DAG.
  - Each node shows its 1-based topological execution order so the flow reads
    source→target.

  workflows-builder: `connectNeeds` now also rejects edges that would create a
  cycle, and exports a pure `wouldCreateCycle(state, from, to)` guard for
  interaction layers to check a gesture before dispatching.

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.1.0

### Minor Changes

- a1e5df1: Workflows visual builder GUI (phase 2 of 2): a drag-canvas on desktop + an outline editor on mobile, both built on one shared, DOM-free model.

  **New shared model — `@moxxy/workflows-builder`.** A genuinely DOM-free, RN-safe package (zero React, zero DOM, zero node built-ins — proven by the Expo iOS export) that both apps import. It holds: the canvas `BuilderState` + a typed `builderReducer`; pure operations (`addStep`/`removeStep`, `connectNeeds`/`disconnectNeeds`, `setBranchTargets`/`setSwitchCase`, `setLoopBody`/`setLoopExit`/`setLoopConfig`, `moveNode`/`setViewport`/`renameNode`/`updateNode`/`updateMeta`); a `serialize`↔`hydrate` pair that builds a `Workflow` object + `ui.layout` from the canvas and re-derives the node graph (incl. an auto-layout when `ui.layout` is absent); a dependency-free YAML codec scoped to the workflow shape (chosen over the `yaml` package, which reaches for `node:process`, so the RN bundle stays clean — authoritative validation is server-side); and the validate/save bridges that map `workflows.validateDraft` issues back onto the offending nodes. 32 unit tests cover operations, the serialize↔hydrate round-trip (loop body + exit + branches + layout), validation-error mapping, and the loop node's body/exit modeling.

  **The loop node's two-region visual model.** A `loop` node exposes (1) a BODY region — the steps that run inside the loop each iteration, toggled in the inspector and rendered as dashed "body" edges — and (2) a single EXIT edge to the next step, taken when the condition is met OR a body step errors, labeled "on done / error → next". The exit is modeled as the body-excluded step that `needs` the loop, so there's always exactly one exit edge and the on-disk schema is unchanged.

  **Desktop canvas (`apps/desktop/src/workflows/`).** `WorkflowsPanel` becomes a list↔builder switcher (keeping enable/disable + run-now + last-run, adding per-row Edit + New). The builder is a hand-rolled SVG drag-canvas (no react-flow — the graph is ≤40 nodes, so a graph lib's bundle cost wasn't justified): color-coded node cards per step kind, derived `needs`/branch/loop edges with labels, draggable nodes that persist x/y to `ui.layout`, a node inspector (edits each kind's action fields incl. the loop's body/exit/condition/maxIterations), an add-node palette, live validation that decorates the offending node, and Save (`validateDraft`→`save`). 7 testing-library tests.

  **Mobile editor (`apps/mobile/`).** New `app/workflow-edit.tsx` screen + `WorkflowEditor` component + `useWorkflowEditor` hook, consuming the same shared model over the mobile frame bridge (new `buildWorkflowValidateFrame`/`buildWorkflowSaveFrame`/`buildWorkflowDetailFrame`, wired to the `MobileSessionHost` handlers the engine added). v1 is an OUTLINE editor (a node list with the same operations, incl. the loop's body/exit/condition), not a touch-drag canvas — a graphical touch canvas was disproportionate for v1.

  **Shared IPC glue.** `client-core` gains `useWorkflowBuilder` (DOM-free) that drives `workflows.getRun`/`validateDraft`/`save` over the injected transport — the Electron preload bridge on desktop, the WebSocket bridge on mobile — so the validate/save flow is identical across platforms.

### Patch Changes

- 4a8ec5d: Workflows round-2 correctness: gate the unshippable `awaitInput` resume, make the visual builder work on the desktop, and fix loop/validation correctness.

  **`awaitInput` is gated (was a hang-forever dead-end).** The executor can pause + checkpoint an `awaitInput` step, but the resume trigger/channel that delivers the operator's reply never shipped to `main` — `resumeWorkflowRun` had zero production callers. So an agent-drafted "ask me, then act" workflow would pause forever, leak a retained child session for the process lifetime, and orphan a checkpoint file. `awaitInput` is now **rejected at validate/save time** with a clear "requires the resume channel, not available in this build" message, and `draft.ts` no longer teaches it (it steers the author to `inputs` fields instead). Defense-in-depth: the CLI runner treats a `paused` result as non-terminal (no inbox delivery), `Session.close()` clears retained child sessions so they can't leak, and a `WorkflowRunStore.sweepStale()` sweeper (7-day TTL, run on workflows boot) reaps orphaned `~/.moxxy/workflow-runs/active/` checkpoints. The executor pause/resume path is kept intact so re-enabling is a matter of landing a resume trigger and removing the schema gate.

  **Visual builder works on the desktop now.** The desktop drives a `RemoteSession`, whose workflows view only forwarded `list`/`setEnabled`/`run` — so the builder's `validateDraft`/`save`/`getRun` were `undefined` and threw "not supported on this session". Added a `workflow.validateDraft|save|getRun` runner-RPC family (**protocol bumped to v4**) with RemoteSession client methods + server handlers, so the desktop builder validates/saves/loads against the runner.

  **Loop + validation correctness.** A condition/switch step used as a loop body is rejected (its branch routing was silently ignored). A non-loop-body step that `needs` a loop-body step is rejected (it would stall — body steps are excluded from the main DAG). A loop-body step's own `when` guard and any `needs` other than its loop step / a sibling body step are rejected (body steps run unconditionally each iteration). Logic-step `vars` now drop `__proto__`/`constructor`/`prototype` keys (prototype-pollution guard). Paused-run checkpoints persist + restore `vars` set before the pause. Renaming a workflow via the builder removes the old file/entry instead of leaving an orphaned duplicate (`save(workflow, previousName)`, threaded through the view → IPC → runner RPC → builder hook).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
