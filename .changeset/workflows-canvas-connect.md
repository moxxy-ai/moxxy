---
'@moxxy/desktop': minor
'@moxxy/workflows-builder': patch
---

Workflow builder canvas: drag-to-connect step wiring. You can now draw the
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
  dependency (routes through `disconnect-needs` / the relevant set-* op).
- Self-connects and cycle-closing connections are refused (the latter with a
  brief inline rejection), so the canvas can't author an invalid DAG.
- Each node shows its 1-based topological execution order so the flow reads
  source→target.

workflows-builder: `connectNeeds` now also rejects edges that would create a
cycle, and exports a pure `wouldCreateCycle(state, from, to)` guard for
interaction layers to check a gesture before dispatching.
