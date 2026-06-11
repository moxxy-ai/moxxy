/**
 * Shared simulation types. Everything in `sim/` and `map/` is pure TypeScript
 * — no Phaser, no DOM — so the office's behavior is unit-testable. The Phaser
 * scene is a renderer of {@link ActorSnapshot}s plus a drain for one-shot
 * {@link SceneEffect}s.
 */

export const TILE = 16;
export const MAP_W = 44;
export const MAP_H = 30;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

/** walkable[y][x] — derived from the office map, never hand-duplicated. */
export type Walkability = ReadonlyArray<ReadonlyArray<boolean>>;

export interface Seat {
  readonly tile: Vec2;
  readonly facing: Facing;
}

export type BubbleTone = 'speech' | 'thought' | 'tool' | 'alert' | 'error';

export type StatusIcon = 'alert' | 'tool' | 'zzz' | 'coffee' | 'denied' | null;

/** What the renderer needs to draw one office worker this frame. */
export interface ActorSnapshot {
  readonly id: string;
  readonly name: string;
  readonly role: 'agent' | 'subagent';
  readonly lookIdx: number;
  /** Pixel-space position of the actor's FEET (bottom-center anchor). */
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly moving: boolean;
  readonly seated: boolean;
  /** True while the agent is at its desk running a turn (typing animation). */
  readonly typing: boolean;
  readonly bubble: { readonly text: string; readonly tone: BubbleTone } | null;
  readonly icon: StatusIcon;
}

/** One-shot effects the scene plays once and forgets. */
export type SceneEffect =
  | { readonly kind: 'poof'; readonly at: Vec2 }
  | { readonly kind: 'monitor'; readonly officeIndex: number; readonly on: boolean };

export function tileCenterPx(tile: Vec2): Vec2 {
  return { x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE };
}

export function sameTile(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

// ---------- map zones -------------------------------------------------------

export interface OfficeRoom {
  readonly index: number;
  /** Walkable tile just inside the doorway. */
  readonly door: Vec2;
  /** Where the agent sits to think (chair tile + facing toward the desk). */
  readonly seat: Seat;
  /** The desk's monitor tile — lights up while the agent types. */
  readonly monitorTile: Vec2;
}

export interface Zones {
  readonly offices: ReadonlyArray<OfficeRoom>;
  readonly warRoom: { readonly door: Vec2; readonly seats: ReadonlyArray<Seat> };
  readonly hotDesks: ReadonlyArray<Seat>;
  readonly coffee: Seat;
  readonly cooler: Seat;
  /** Spawn/despawn tile just inside the entrance doors. */
  readonly entrance: Vec2;
  /** Open-space tiles agents wander between while idle. */
  readonly wanderTiles: ReadonlyArray<Vec2>;
}

// ---------- director inputs -------------------------------------------------

/**
 * The director's input language. `bridge/storeTap.ts` translates live moxxy
 * store/event traffic into these; the `?demo=1` feed produces them directly.
 * `workspaceId` is the owning session; `childId` keys a subagent sprite.
 */
export type DirectorInput =
  | {
      readonly kind: 'roster';
      readonly sessions: ReadonlyArray<{ readonly id: string; readonly name: string }>;
      readonly activeId: string | null;
    }
  | { readonly kind: 'turn-started'; readonly workspaceId: string }
  | { readonly kind: 'turn-complete'; readonly workspaceId: string }
  | { readonly kind: 'assistant-delta'; readonly workspaceId: string; readonly delta: string }
  | { readonly kind: 'assistant-final'; readonly workspaceId: string; readonly text: string }
  | { readonly kind: 'tool-call'; readonly workspaceId: string; readonly tool: string }
  | { readonly kind: 'tool-denied'; readonly workspaceId: string }
  | { readonly kind: 'tool-failed'; readonly workspaceId: string }
  | { readonly kind: 'ask-opened'; readonly workspaceId: string }
  | { readonly kind: 'ask-cleared'; readonly workspaceId: string }
  | {
      readonly kind: 'subagent-started';
      readonly workspaceId: string;
      readonly childId: string;
      readonly label: string;
    }
  | { readonly kind: 'subagent-delta'; readonly childId: string; readonly delta: string }
  | { readonly kind: 'subagent-tool'; readonly childId: string; readonly tool: string }
  | {
      readonly kind: 'subagent-done';
      readonly childId: string;
      readonly text?: string;
      readonly failed?: boolean;
    }
  | { readonly kind: 'session-removed'; readonly workspaceId: string };
