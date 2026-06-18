/**
 * The canvas' drag-to-connect gesture state machine as a focused hook.
 *
 * Owns the pending connection (the temp line dragged from an output handle),
 * its hover-target highlighting, the cycle-reject flash, and the drop-on-empty
 * "insert node" menu (which parks the pending edge until a kind is picked).
 * On drop over a target node it dispatches the matching graph op; on drop over
 * empty canvas it opens the insert menu wired to the same pending edge.
 *
 * Extracted from `WorkflowCanvas.tsx` verbatim. The canvas composes this with
 * the node-move + pan gestures (priority: move > connect > pan) by calling the
 * imperative `*` methods from its combined pointer handlers, so the gesture
 * disambiguation is unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  uniqueId,
  wouldCreateCycle,
  type BuilderAction,
  type BuilderNode,
  type BuilderState,
  type StepKind,
} from '@moxxy/workflows-builder';
import {
  ANCHOR_OFFSET,
  inBodyRegion,
  labelOf,
  nodeAt,
  portOrigin,
  type PortKind,
} from './canvas-graph';

export interface PendingConnection {
  readonly nodeId: string;
  readonly port: PortKind;
  /** Handle origin in surface coords (where the temp line starts). */
  readonly ox: number;
  readonly oy: number;
}

/** A connection dropped on empty canvas, parked while the insert menu is open. */
export interface InsertMenuState {
  /** Source node + port of the pending edge. */
  readonly nodeId: string;
  readonly port: PortKind;
  /** Drop point in content coords (the new node's input anchor lands here). */
  readonly x: number;
  readonly y: number;
  /** Pending-edge origin, kept so the preview line stays drawn. */
  readonly ox: number;
  readonly oy: number;
}

export interface DragConnect {
  /** The active pending connection (drives the temp line), or null. */
  readonly pending: PendingConnection | null;
  /** Current pointer position in world coords while connecting, or null. */
  readonly cursor: { x: number; y: number } | null;
  /** Id of the node the pending connection is hovering, or null. */
  readonly hoverTarget: string | null;
  /** Transient cycle-reject message shown as a toast, or null. */
  readonly reject: string | null;
  /** The parked drop-on-empty insert menu, or null. */
  readonly insertMenu: InsertMenuState | null;
  readonly setInsertMenu: (menu: InsertMenuState | null) => void;
  /** Begin a connection drag from a node's output handle. `p` is the pointer
   *  position in world coords (the canvas owns the coordinate transform). */
  readonly onHandlePointerDown: (
    e: React.PointerEvent,
    node: BuilderNode,
    port: PortKind,
    p: { x: number; y: number },
  ) => void;
  /** Track the pointer while connecting; returns true if it consumed the move. */
  readonly moveConnect: (p: { x: number; y: number }) => boolean;
  /** Finish a connection on pointerup (drop on node → op, on empty → menu). */
  readonly finishConnection: (p: { x: number; y: number }) => void;
  /** Insert a node of `kind` at the menu's drop point, wiring the pending edge. */
  readonly insertFromMenu: (kind: StepKind) => void;
  /** Cancel an active connection (pointer left the surface). Returns true if active. */
  readonly cancelConnect: () => boolean;
  /** True while a connection drag is active (priority gate in pointer handlers). */
  readonly connectActive: () => boolean;
}

export function useDragConnect(
  state: BuilderState,
  dispatch: (action: BuilderAction) => void,
): DragConnect {
  const connect = useRef<PendingConnection | null>(null);
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [insertMenu, setInsertMenu] = useState<InsertMenuState | null>(null);

  const byId = useMemo(() => new Map(state.nodes.map((n) => [n.id, n])), [state.nodes]);

  const flashReject = useCallback((msg: string) => {
    setReject(msg);
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setReject(null), 2600);
  }, []);

  // Clear a pending reject-flash timer on unmount so it can't fire setReject
  // after the canvas is gone.
  useEffect(
    () => () => {
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
    },
    [],
  );

  // --- connection drag (handle pointerdown) ---
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, node: BuilderNode, port: PortKind, p: { x: number; y: number }) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setInsertMenu(null);
      const origin = portOrigin(node, port);
      const start: PendingConnection = { nodeId: node.id, port, ox: origin.x, oy: origin.y };
      connect.current = start;
      setPending(start);
      setCursor(p);
    },
    [],
  );

  const moveConnect = useCallback(
    (p: { x: number; y: number }): boolean => {
      if (!connect.current) return false;
      setCursor(p);
      setHoverTarget(nodeAt(state.nodes, p, connect.current.nodeId));
      return true;
    },
    [state.nodes],
  );

  const finishConnection = useCallback(
    (p: { x: number; y: number }) => {
      const c = connect.current;
      connect.current = null;
      setPending(null);
      setCursor(null);
      setHoverTarget(null);
      if (!c) return;
      const targetId = nodeAt(state.nodes, p, c.nodeId);
      if (!targetId) {
        // Dropped on empty canvas → offer to insert a node right there, wired
        // to the pending connection (Escape / click-away cancels).
        setInsertMenu({ nodeId: c.nodeId, port: c.port, x: p.x, y: p.y, ox: c.ox, oy: c.oy });
        return;
      }
      const target = byId.get(targetId);
      const source = byId.get(c.nodeId);
      if (!target || !source || target.id === source.id) return;

      switch (c.port) {
        case 'needs': {
          // Dropping a plain output onto a LOOP is ambiguous, so we read the
          // drop sub-region: the lower "body" half adds the source to the loop
          // body (it runs INSIDE the loop); the upper half wires a plain `needs`
          // (the source runs BEFORE the loop).
          if (target.kind === 'loop' && target.loop) {
            if (inBodyRegion(target, p)) {
              if (target.loop.body.includes(source.id)) return;
              dispatch({ type: 'set-loop-body', loopId: target.id, body: [...target.loop.body, source.id] });
              return;
            }
          }
          if (wouldCreateCycle(state, source.id, target.id)) {
            flashReject(`Can't connect ${labelOf(source)} → ${labelOf(target)}: it would create a cycle.`);
            return;
          }
          dispatch({ type: 'connect-needs', from: source.id, to: target.id });
          return;
        }
        case 'then':
        case 'else': {
          const current = (c.port === 'then' ? source.then : source.else) ?? [];
          if (current.includes(target.id)) return;
          dispatch({ type: 'set-branch', nodeId: source.id, slot: c.port, targets: [...current, target.id] });
          return;
        }
        case 'loop-exit': {
          // Source is the loop; target becomes its single exit (on done/error → next).
          dispatch({ type: 'set-loop-exit', loopId: source.id, targetId: target.id });
          return;
        }
      }
    },
    [byId, dispatch, flashReject, state],
  );

  // Insert a node of `kind` at the menu's drop point and wire the pending edge
  // to it, through the same ops the drop-on-node path dispatches. The id is
  // precomputed (uniqueId) because dispatch can't return the id add-step picks;
  // sequential dispatches reduce in order, so the wire op sees the new node.
  const insertFromMenu = useCallback(
    (kind: StepKind) => {
      const menu = insertMenu;
      setInsertMenu(null);
      if (!menu) return;
      const source = byId.get(menu.nodeId);
      if (!source) return;
      const id = uniqueId(state, kind);
      const x = menu.x;
      // Offset so the new node's left input anchor lands at the drop point.
      const y = menu.y - ANCHOR_OFFSET;
      switch (menu.port) {
        case 'needs':
          dispatch({ type: 'add-step', input: { kind, id, x, y, after: source.id } });
          return;
        case 'then':
        case 'else': {
          dispatch({ type: 'add-step', input: { kind, id, x, y } });
          const current = (menu.port === 'then' ? source.then : source.else) ?? [];
          dispatch({ type: 'set-branch', nodeId: source.id, slot: menu.port, targets: [...current, id] });
          return;
        }
        case 'loop-exit':
          dispatch({ type: 'add-step', input: { kind, id, x, y } });
          dispatch({ type: 'set-loop-exit', loopId: source.id, targetId: id });
          return;
      }
    },
    [byId, dispatch, insertMenu, state],
  );

  const cancelConnect = useCallback((): boolean => {
    if (!connect.current) return false;
    connect.current = null;
    setPending(null);
    setCursor(null);
    setHoverTarget(null);
    return true;
  }, []);

  const connectActive = useCallback((): boolean => connect.current != null, []);

  return {
    pending,
    cursor,
    hoverTarget,
    reject,
    insertMenu,
    setInsertMenu,
    onHandlePointerDown,
    moveConnect,
    finishConnection,
    insertFromMenu,
    cancelConnect,
    connectActive,
  };
}
