/**
 * Per-actor finite-state machines. An AgentBrain is one office worker (one
 * moxxy session): it wanders while idle, walks to its desk when a turn runs,
 * sits and types, freezes on a pending permission ask, and walks out when its
 * session goes away. A SubagentBrain is a temporary visitor that walks from
 * its parent to the war room, sits, bubbles, then leaves.
 *
 * Brains are pure: they advance only via update(dtMs, nowMs) and communicate
 * one-shot effects through drainEffects().
 */

import { findPath } from './astar.js';
import { BubbleChannel, firstSentence } from './bubbles.js';
import { Mover } from './mover.js';
import { sameTile, tileCenterPx } from './types.js';
import type {
  ActorSnapshot,
  Facing,
  SceneEffect,
  Seat,
  StatusIcon,
  Vec2,
  Walkability,
} from './types.js';
import type { Rng } from './rng.js';

export type AgentPhase =
  | 'entering'
  | 'idle'
  | 'wandering'
  | 'walking-to-seat'
  | 'seated'
  | 'walking-back'
  | 'frozen'
  | 'leaving'
  | 'gone';

export type SubagentPhase = 'walking-to-warroom' | 'seated' | 'leaving' | 'gone';

const DWELL_MIN_MS = 2000;
const DWELL_SPAN_MS = 4000;
const ZZZ_AFTER_MS = 30_000;
const FINAL_BUBBLE_TTL_MS = 4000;
const SUBAGENT_FINAL_TTL_MS = 3000;

export interface AgentBrainDeps {
  readonly walkable: Walkability;
  readonly rng: Rng;
  /** Open-space tiles to wander between while idle. */
  readonly wanderTiles: ReadonlyArray<Vec2>;
  /** Coffee/cooler tiles — picked 1-in-4 as wander targets. */
  readonly breakTiles: ReadonlyArray<Vec2>;
  /** The coffee tile specifically (drives the ☕ icon while dwelling there). */
  readonly coffeeTile: Vec2;
}

export class AgentBrain {
  private nameValue: string;
  private phaseValue: AgentPhase = 'entering';
  private prevPhase: AgentPhase = 'idle';
  private readonly mover: Mover;
  private readonly bubbles = new BubbleChannel();
  private readonly entrance: Vec2;
  private readonly deps: AgentBrainDeps;
  private seat: Seat | null = null;
  private monitorOfficeIndex: number | null = null;
  private monitorOn = false;
  private turnRunning = false;
  private dwellMs = 0;
  private atCoffee = false;
  private lastActivityMs = 0;
  private now = 0;
  private effects: SceneEffect[] = [];
  private onGoneCb: (() => void) | null = null;

  constructor(
    readonly id: string,
    name: string,
    readonly lookIdx: number,
    entranceTile: Vec2,
    deps: AgentBrainDeps,
  ) {
    this.nameValue = name;
    this.entrance = { x: entranceTile.x, y: entranceTile.y };
    this.deps = deps;
    this.mover = new Mover(entranceTile);
    this.wanderTo('entering'); // walk in from the doors
  }

  get name(): string {
    return this.nameValue;
  }

  setName(name: string): void {
    this.nameValue = name;
  }

  get phase(): AgentPhase {
    return this.phaseValue;
  }

  /** The actor's current (visual) tile — seat tile while seated. */
  get tile(): Vec2 {
    if (this.seatedVisual() && this.seat) return this.seat.tile;
    return this.mover.tile;
  }

  // ---------- director intents ----------------------------------------------

  assignSeat(seat: Seat, monitorOfficeIndex: number | null): void {
    this.seat = seat;
    this.monitorOfficeIndex = monitorOfficeIndex;
  }

  /** A turn started: head to the desk, sit, type. */
  beginThinking(): void {
    this.noteActivity();
    this.turnRunning = true;
    if (this.phaseValue === 'frozen' || this.phaseValue === 'leaving' || this.phaseValue === 'gone') {
      return; // frozen resumes via unfreeze(); leavers don't come back
    }
    if (this.phaseValue === 'seated') {
      this.ensureMonitorOn();
      return;
    }
    this.walkToSeat();
  }

  /** The turn finished: stand up, switch the monitor off, wander back out. */
  endThinking(): void {
    this.noteActivity();
    this.turnRunning = false;
    if (this.monitorOn) {
      this.effects.push({ kind: 'monitor', officeIndex: this.monitorOfficeIndex ?? 0, on: false });
      this.monitorOn = false;
    }
    if (this.phaseValue === 'seated' || this.phaseValue === 'walking-to-seat') {
      this.wanderTo('walking-back');
    }
    // frozen: unfreeze() routes to idle since turnRunning is now false
  }

  /** A permission ask is pending: stop dead, show the alert icon. */
  freeze(): void {
    this.noteActivity();
    if (this.phaseValue === 'frozen' || this.phaseValue === 'gone') return;
    this.prevPhase = this.phaseValue;
    this.phaseValue = 'frozen';
    this.mover.stop();
  }

  /** Ask resolved: resume what it was doing. */
  unfreeze(): void {
    this.noteActivity();
    if (this.phaseValue !== 'frozen') return;
    if (this.prevPhase === 'leaving') {
      this.walkOut();
      return;
    }
    if (this.turnRunning) {
      if (this.seat && this.prevPhase === 'seated') this.phaseValue = 'seated';
      else this.walkToSeat();
      return;
    }
    this.startDwell();
  }

  /** Session removed: walk to the entrance and disappear. */
  leave(onGone: () => void): void {
    if (this.phaseValue === 'gone') {
      onGone();
      return;
    }
    this.onGoneCb = onGone;
    this.turnRunning = false;
    if (this.monitorOn) {
      this.effects.push({ kind: 'monitor', officeIndex: this.monitorOfficeIndex ?? 0, on: false });
      this.monitorOn = false;
    }
    this.walkOut();
  }

  // ---------- bubble passthroughs --------------------------------------------

  pushDelta(delta: string): void {
    this.noteActivity();
    this.bubbles.push(delta, this.now);
  }

  sayTool(name: string): void {
    this.noteActivity();
    this.bubbles.say(`[${name}]`, 'tool', this.now);
  }

  sayFinal(text: string): void {
    this.noteActivity();
    this.bubbles.say(firstSentence(text), 'speech', this.now, FINAL_BUBBLE_TTL_MS);
  }

  sayError(text: string): void {
    this.noteActivity();
    this.bubbles.say(text, 'error', this.now);
  }

  /** Any input for this agent counts as activity (clears the 💤 icon). */
  noteActivity(): void {
    this.lastActivityMs = this.now;
  }

  // ---------- stepping --------------------------------------------------------

  update(dtMs: number, nowMs: number): void {
    this.now = nowMs;
    if (this.phaseValue === 'gone') return;
    this.mover.update(dtMs);
    if (this.phaseValue === 'idle') {
      this.dwellMs -= dtMs;
      if (this.dwellMs <= 0) this.wanderTo('wandering');
    }
  }

  drainEffects(): SceneEffect[] {
    if (this.effects.length === 0) return [];
    const out = this.effects;
    this.effects = [];
    return out;
  }

  snapshot(nowMs: number): ActorSnapshot {
    const seated = this.seatedVisual();
    let x: number;
    let y: number;
    let facing: Facing;
    let moving: boolean;
    if (seated && this.seat) {
      const p = tileCenterPx(this.seat.tile);
      x = p.x;
      y = p.y;
      facing = this.seat.facing;
      moving = false;
    } else {
      const s = this.mover.state;
      x = s.x;
      y = s.y;
      facing = s.facing;
      moving = s.moving;
    }
    return {
      id: this.id,
      name: this.nameValue,
      role: 'agent',
      lookIdx: this.lookIdx,
      x,
      y,
      facing,
      moving,
      seated,
      typing: this.phaseValue === 'seated' && this.turnRunning,
      bubble: this.bubbles.current(nowMs),
      icon: this.currentIcon(nowMs),
    };
  }

  // ---------- internals -------------------------------------------------------

  private seatedVisual(): boolean {
    return (
      this.phaseValue === 'seated' || (this.phaseValue === 'frozen' && this.prevPhase === 'seated')
    );
  }

  private currentIcon(nowMs: number): StatusIcon {
    if (this.phaseValue === 'frozen') return 'alert';
    if (this.phaseValue === 'idle' && this.atCoffee) return 'coffee';
    if (
      (this.phaseValue === 'idle' || this.phaseValue === 'wandering') &&
      nowMs - this.lastActivityMs >= ZZZ_AFTER_MS
    ) {
      return 'zzz';
    }
    return null;
  }

  private ensureMonitorOn(): void {
    if (this.monitorOfficeIndex !== null && !this.monitorOn) {
      this.effects.push({ kind: 'monitor', officeIndex: this.monitorOfficeIndex, on: true });
      this.monitorOn = true;
    }
  }

  private sit(): void {
    this.phaseValue = 'seated';
    this.ensureMonitorOn();
  }

  private walkToSeat(): void {
    if (!this.seat) return;
    this.atCoffee = false;
    const path = findPath(this.deps.walkable, this.mover.tile, this.seat.tile);
    if (!path) {
      this.mover.teleport(this.seat.tile); // pathological map — never strand a worker
      this.sit();
      return;
    }
    this.phaseValue = 'walking-to-seat';
    this.mover.setPath(path, () => this.sit());
  }

  private walkOut(): void {
    const path = findPath(this.deps.walkable, this.mover.tile, this.entrance);
    if (!path) {
      this.mover.teleport(this.entrance);
      this.becomeGone();
      return;
    }
    this.phaseValue = 'leaving';
    this.mover.setPath(path, () => this.becomeGone());
  }

  private becomeGone(): void {
    this.phaseValue = 'gone';
    const cb = this.onGoneCb;
    this.onGoneCb = null;
    cb?.();
  }

  private startDwell(): void {
    this.phaseValue = 'idle';
    this.dwellMs = DWELL_MIN_MS + this.deps.rng.next() * DWELL_SPAN_MS;
    this.atCoffee = sameTile(this.mover.tile, this.deps.coffeeTile);
  }

  private wanderTo(phase: 'entering' | 'wandering' | 'walking-back'): void {
    const { rng, wanderTiles, breakTiles } = this.deps;
    const useBreak = phase === 'wandering' && breakTiles.length > 0 && rng.int(4) === 0;
    const pool = useBreak ? breakTiles : wanderTiles;
    if (pool.length === 0) {
      this.startDwell();
      return;
    }
    const target = rng.pick(pool);
    const path = findPath(this.deps.walkable, this.mover.tile, target);
    if (!path) {
      // Unreachable target: just dwell a moment and try again later.
      this.phaseValue = 'idle';
      this.dwellMs = 1000;
      return;
    }
    this.atCoffee = false;
    this.phaseValue = phase;
    this.mover.setPath(path, () => this.startDwell());
  }
}

// ---------- subagents ---------------------------------------------------------

export interface SubagentBrainDeps {
  readonly walkable: Walkability;
  /** Where to stand when no war-room seat is free, and the exit waypoint. */
  readonly warRoomDoor: Vec2;
}

export class SubagentBrain {
  private phaseValue: SubagentPhase = 'walking-to-warroom';
  private readonly mover: Mover;
  private readonly bubbles = new BubbleChannel();
  private now = 0;
  private finishAtMs: number | null = null;
  private onGoneCb: ((at: Vec2) => void) | null = null;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly lookIdx: number,
    startTile: Vec2,
    private readonly seat: Seat | null,
    private readonly deps: SubagentBrainDeps,
  ) {
    this.mover = new Mover(startTile);
    const target = seat ? seat.tile : deps.warRoomDoor;
    const path = findPath(deps.walkable, startTile, target);
    if (path) {
      this.mover.setPath(path, () => {
        this.phaseValue = 'seated';
      });
    } else {
      this.mover.teleport(target);
      this.phaseValue = 'seated';
    }
  }

  get phase(): SubagentPhase {
    return this.phaseValue;
  }

  pushDelta(delta: string): void {
    this.bubbles.push(delta, this.now);
  }

  sayTool(name: string): void {
    this.bubbles.say(`[${name}]`, 'tool', this.now);
  }

  /**
   * Done: show the final bubble for 3s (skipped when no text), then walk to
   * the war-room door and go 'gone'; onGone receives the last tile (for the
   * director's poof effect).
   */
  finish(text: string | undefined, failed: boolean, onGone: (at: Vec2) => void): void {
    if (this.finishAtMs !== null || this.phaseValue === 'leaving' || this.phaseValue === 'gone') {
      return;
    }
    this.onGoneCb = onGone;
    if (text && text.trim().length > 0) {
      this.bubbles.say(
        firstSentence(text),
        failed ? 'error' : 'speech',
        this.now,
        SUBAGENT_FINAL_TTL_MS,
      );
      this.finishAtMs = this.now + SUBAGENT_FINAL_TTL_MS;
    } else {
      this.finishAtMs = this.now;
    }
  }

  update(dtMs: number, nowMs: number): void {
    this.now = nowMs;
    if (this.phaseValue === 'gone') return;
    this.mover.update(dtMs);
    if (this.finishAtMs !== null && nowMs >= this.finishAtMs && this.phaseValue !== 'leaving') {
      this.walkOut();
    }
  }

  snapshot(nowMs: number): ActorSnapshot {
    const seated = this.phaseValue === 'seated' && this.seat !== null;
    let x: number;
    let y: number;
    let facing: Facing;
    let moving: boolean;
    if (seated && this.seat) {
      const p = tileCenterPx(this.seat.tile);
      x = p.x;
      y = p.y;
      facing = this.seat.facing;
      moving = false;
    } else {
      const s = this.mover.state;
      x = s.x;
      y = s.y;
      facing = s.facing;
      moving = s.moving;
    }
    return {
      id: this.id,
      name: this.label,
      role: 'subagent',
      lookIdx: this.lookIdx,
      x,
      y,
      facing,
      moving,
      seated,
      typing: seated && this.finishAtMs === null,
      bubble: this.bubbles.current(nowMs),
      icon: null,
    };
  }

  private walkOut(): void {
    const path = findPath(this.deps.walkable, this.mover.tile, this.deps.warRoomDoor);
    if (!path) {
      this.becomeGone();
      return;
    }
    this.phaseValue = 'leaving';
    this.mover.setPath(path, () => this.becomeGone());
  }

  private becomeGone(): void {
    this.phaseValue = 'gone';
    const cb = this.onGoneCb;
    this.onGoneCb = null;
    cb?.(this.mover.tile);
  }
}
