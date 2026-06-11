# @moxxy/mobile

## 0.0.9

### Patch Changes

- 54526cc: Fix the phone never connecting to the desktop-started mobile gateway on the same network. Two defects: (1) the advertised QR host picked the first non-internal IPv4, so a VPN/Docker/link-local interface could be advertised instead of the reachable LAN IP — `lanHost` now ranks candidates (RFC1918 on physical NICs first, skipping utun/vmnet/bridge/awdl-style interfaces unless nothing else exists); (2) the built mobile app was missing iOS's `NSLocalNetworkUsageDescription` (iOS 14+ silently denies LAN dials without it) and Android's cleartext-`ws://` allowance — both added to app.json (requires a new native build; OTA updates do not deliver Info.plist/manifest changes). Expo Go masked both, which is why dev pairing worked.

## 0.0.8

### Patch Changes

- Updated dependencies [d0e0bd2]
  - @moxxy/desktop-ipc-contract@0.5.0
  - @moxxy/client-core@0.3.0
  - @moxxy/design-tokens@0.2.0
  - @moxxy/client-transport-ws@0.1.5

## 0.0.7

### Patch Changes

- 4c594d8: Wave of desktop/mobile fixes. Runner protocol v6 (additive): clients can supply the turn id (`runTurn.turnId`) so renderer per-turn filters actually match — fixing the silently-broken "generate skill with AI" flow and hidden-turn leaks — and `attach` gains a replay policy (`'full' | 'none' | { tail }`) with EventLog rebase so the desktop no longer replays full session history on app start/desk switch (history comes from the paginated NDJSON log). Desktop settings gain a shared "ask moxxy to do it" background-agent modal: the skill generator is refactored onto it and MCP servers and Providers get Add buttons driving `mcp_add_server`/`provider_add`, with permission asks surfaced in-modal (plus a global ask fallback outside the chat view). Subagents now inherit the parent's resolved model: hallucinated model ids warn and fall back, workflow-trigger spawns use the session's last resolved model, and hardcoded model-id fallbacks are gone. Clerk sign-in returns to the app instead of stranding on the hosted My-account page (explicit fallback redirect URLs + a main-process account-portal recovery handler). Workflow canvas: Delete/Backspace removes the selected node and dropping a connector on empty canvas opens an insert-node menu. Mobile: reconnects re-prime the connection store (fixes the deaf "Connected" state after a runner restart), gateway URL commits on blur, the redundant header actions toggle is gone, menu entries are chips, executed tools open a diagnostics panel on tap, and the QR scanner starts scanning immediately.

## 0.0.6

### Patch Changes

- 52ec3d6: Mobile app: link the EAS project (projectId b5bb93ab-… + EAS Update URL), rename the app to "Workspaces", and use the moxxy logo for the icon/adaptive-icon/splash. Repo licensed under MIT (Moxxy, moxxy.ai); README badge + @moxxy/sdk and @moxxy/cli `license` fields updated.

## 0.0.5

### Patch Changes

- Updated dependencies [5ab8629]
- Updated dependencies [2796066]
- Updated dependencies [c050573]
  - @moxxy/desktop-ipc-contract@0.4.0
  - @moxxy/sdk@0.10.0
  - @moxxy/client-core@0.2.0
  - @moxxy/workflows-builder@0.1.1
  - @moxxy/client-transport-ws@0.1.4

## 0.0.4

### Patch Changes

- a1e5df1: Workflows visual builder GUI (phase 2 of 2): a drag-canvas on desktop + an outline editor on mobile, both built on one shared, DOM-free model.

  **New shared model — `@moxxy/workflows-builder`.** A genuinely DOM-free, RN-safe package (zero React, zero DOM, zero node built-ins — proven by the Expo iOS export) that both apps import. It holds: the canvas `BuilderState` + a typed `builderReducer`; pure operations (`addStep`/`removeStep`, `connectNeeds`/`disconnectNeeds`, `setBranchTargets`/`setSwitchCase`, `setLoopBody`/`setLoopExit`/`setLoopConfig`, `moveNode`/`setViewport`/`renameNode`/`updateNode`/`updateMeta`); a `serialize`↔`hydrate` pair that builds a `Workflow` object + `ui.layout` from the canvas and re-derives the node graph (incl. an auto-layout when `ui.layout` is absent); a dependency-free YAML codec scoped to the workflow shape (chosen over the `yaml` package, which reaches for `node:process`, so the RN bundle stays clean — authoritative validation is server-side); and the validate/save bridges that map `workflows.validateDraft` issues back onto the offending nodes. 32 unit tests cover operations, the serialize↔hydrate round-trip (loop body + exit + branches + layout), validation-error mapping, and the loop node's body/exit modeling.

  **The loop node's two-region visual model.** A `loop` node exposes (1) a BODY region — the steps that run inside the loop each iteration, toggled in the inspector and rendered as dashed "body" edges — and (2) a single EXIT edge to the next step, taken when the condition is met OR a body step errors, labeled "on done / error → next". The exit is modeled as the body-excluded step that `needs` the loop, so there's always exactly one exit edge and the on-disk schema is unchanged.

  **Desktop canvas (`apps/desktop/src/workflows/`).** `WorkflowsPanel` becomes a list↔builder switcher (keeping enable/disable + run-now + last-run, adding per-row Edit + New). The builder is a hand-rolled SVG drag-canvas (no react-flow — the graph is ≤40 nodes, so a graph lib's bundle cost wasn't justified): color-coded node cards per step kind, derived `needs`/branch/loop edges with labels, draggable nodes that persist x/y to `ui.layout`, a node inspector (edits each kind's action fields incl. the loop's body/exit/condition/maxIterations), an add-node palette, live validation that decorates the offending node, and Save (`validateDraft`→`save`). 7 testing-library tests.

  **Mobile editor (`apps/mobile/`).** New `app/workflow-edit.tsx` screen + `WorkflowEditor` component + `useWorkflowEditor` hook, consuming the same shared model over the mobile frame bridge (new `buildWorkflowValidateFrame`/`buildWorkflowSaveFrame`/`buildWorkflowDetailFrame`, wired to the `MobileSessionHost` handlers the engine added). v1 is an OUTLINE editor (a node list with the same operations, incl. the loop's body/exit/condition), not a touch-drag canvas — a graphical touch canvas was disproportionate for v1.

  **Shared IPC glue.** `client-core` gains `useWorkflowBuilder` (DOM-free) that drives `workflows.getRun`/`validateDraft`/`save` over the injected transport — the Electron preload bridge on desktop, the WebSocket bridge on mobile — so the validate/save flow is identical across platforms.

- Updated dependencies [1e4ed09]
- Updated dependencies [00d7425]
- Updated dependencies [cdc2cc5]
- Updated dependencies [e606178]
- Updated dependencies [a1e5df1]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/desktop-ipc-contract@0.3.0
  - @moxxy/workflows-builder@0.1.0
  - @moxxy/client-core@0.1.3
  - @moxxy/client-transport-ws@0.1.3

## 0.0.3

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/client-core@0.1.2
  - @moxxy/client-transport-ws@0.1.2

## 0.0.2

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0
  - @moxxy/client-transport-ws@0.1.1
  - @moxxy/client-core@0.1.1

## 0.0.1

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/client-core@0.1.0
  - @moxxy/client-transport-ws@0.1.0
  - @moxxy/design-tokens@0.1.0
