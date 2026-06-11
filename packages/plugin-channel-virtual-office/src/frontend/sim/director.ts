/**
 * The office director: translates {@link DirectorInput}s (derived from live
 * moxxy traffic) into agent/subagent brain intents, owns seat occupancy, and
 * exposes the render contract — actors() snapshots + drainEffects().
 *
 * Pure and deterministic: time is an internal clock advanced only by
 * update(dtMs), starting at 0.
 */

import { lookIndexFor } from '../art/palette.js';
import { AgentBrain, SubagentBrain } from './brain.js';
import type { Rng } from './rng.js';
import type {
  ActorSnapshot,
  DirectorInput,
  SceneEffect,
  Seat,
  Vec2,
  Walkability,
  Zones,
} from './types.js';

export interface DirectorDeps {
  walkable: Walkability;
  zones: Zones;
  rng: Rng;
  now?: () => number;
}

type SeatRef =
  | { readonly kind: 'office'; readonly index: number }
  | { readonly kind: 'hot'; readonly index: number }
  | { readonly kind: 'fallback' };

interface AgentEntry {
  readonly brain: AgentBrain;
  readonly seatRef: SeatRef;
}

interface SubEntry {
  readonly brain: SubagentBrain;
  readonly parentId: string;
  readonly warSeatIndex: number | null;
}

export class OfficeDirector {
  private clock = 0;
  private readonly agents = new Map<string, AgentEntry>();
  private readonly subs = new Map<string, SubEntry>();
  private readonly officeUsed: boolean[];
  private readonly hotUsed: boolean[];
  private readonly warUsed: boolean[];
  private effects: SceneEffect[] = [];

  constructor(private readonly deps: DirectorDeps) {
    this.officeUsed = deps.zones.offices.map(() => false);
    this.hotUsed = deps.zones.hotDesks.map(() => false);
    this.warUsed = deps.zones.warRoom.seats.map(() => false);
  }

  input(e: DirectorInput): void {
    switch (e.kind) {
      case 'roster': {
        const seen = new Set<string>();
        for (const s of e.sessions) {
          seen.add(s.id);
          const existing = this.agents.get(s.id);
          if (existing) {
            existing.brain.setName(s.name);
          } else {
            this.spawnAgent(s.id, s.name);
          }
        }
        for (const [id, entry] of [...this.agents]) {
          const phase = entry.brain.phase;
          if (!seen.has(id) && phase !== 'leaving' && phase !== 'gone') this.removeAgent(id);
        }
        break;
      }
      case 'turn-started':
        this.agents.get(e.workspaceId)?.brain.beginThinking();
        break;
      case 'turn-complete':
        this.agents.get(e.workspaceId)?.brain.endThinking();
        this.sweepChildren(e.workspaceId); // safety net for lingering subagents
        break;
      case 'assistant-delta':
        this.agents.get(e.workspaceId)?.brain.pushDelta(e.delta);
        break;
      case 'assistant-final':
        this.agents.get(e.workspaceId)?.brain.sayFinal(e.text);
        break;
      case 'tool-call':
        this.agents.get(e.workspaceId)?.brain.sayTool(e.tool);
        break;
      case 'tool-denied':
        this.agents.get(e.workspaceId)?.brain.sayError('✗ denied');
        break;
      case 'tool-failed':
        this.agents.get(e.workspaceId)?.brain.sayError('! failed');
        break;
      case 'ask-opened':
        this.agents.get(e.workspaceId)?.brain.freeze();
        break;
      case 'ask-cleared':
        this.agents.get(e.workspaceId)?.brain.unfreeze();
        break;
      case 'subagent-started':
        this.spawnSubagent(e.workspaceId, e.childId, e.label);
        break;
      case 'subagent-delta':
        this.subs.get(e.childId)?.brain.pushDelta(e.delta);
        break;
      case 'subagent-tool':
        this.subs.get(e.childId)?.brain.sayTool(e.tool);
        break;
      case 'subagent-done':
        this.subs.get(e.childId)?.brain.finish(e.text, e.failed === true, this.subGone(e.childId));
        break;
      case 'session-removed':
        this.removeAgent(e.workspaceId);
        this.sweepChildren(e.workspaceId);
        break;
    }
  }

  /** Advances the authoritative internal clock by dtMs (starts at 0). */
  update(dtMs: number): void {
    this.clock += dtMs;
    for (const entry of this.agents.values()) entry.brain.update(dtMs, this.clock);
    for (const entry of this.subs.values()) entry.brain.update(dtMs, this.clock);
  }

  /** Agents then subagents, stable insertion order, 'gone' actors omitted. */
  actors(): ReadonlyArray<ActorSnapshot> {
    const out: ActorSnapshot[] = [];
    for (const entry of this.agents.values()) {
      if (entry.brain.phase !== 'gone') out.push(entry.brain.snapshot(this.clock));
    }
    for (const entry of this.subs.values()) {
      if (entry.brain.phase !== 'gone') out.push(entry.brain.snapshot(this.clock));
    }
    return out;
  }

  drainEffects(): SceneEffect[] {
    const out: SceneEffect[] = [];
    for (const entry of this.agents.values()) out.push(...entry.brain.drainEffects());
    out.push(...this.effects);
    this.effects = [];
    return out;
  }

  // ---------- internals -------------------------------------------------------

  private spawnAgent(id: string, name: string): void {
    const { zones, walkable, rng } = this.deps;
    const seatRef = this.allocSeat();
    const brain = new AgentBrain(id, name, lookIndexFor(id), zones.entrance, {
      walkable,
      rng,
      wanderTiles: zones.wanderTiles,
      breakTiles: [zones.coffee.tile, zones.cooler.tile],
      coffeeTile: zones.coffee.tile,
    });
    brain.assignSeat(this.seatFor(seatRef), seatRef.kind === 'office' ? seatRef.index : null);
    this.agents.set(id, { brain, seatRef });
  }

  private removeAgent(id: string): void {
    const entry = this.agents.get(id);
    if (!entry) return;
    this.freeSeat(entry.seatRef); // freed immediately so the next spawn can take it
    entry.brain.leave(() => {
      this.agents.delete(id);
    });
  }

  private allocSeat(): SeatRef {
    for (let i = 0; i < this.officeUsed.length; i++) {
      if (!this.officeUsed[i]) {
        this.officeUsed[i] = true;
        return { kind: 'office', index: i };
      }
    }
    for (let i = 0; i < this.hotUsed.length; i++) {
      if (!this.hotUsed[i]) {
        this.hotUsed[i] = true;
        return { kind: 'hot', index: i };
      }
    }
    return { kind: 'fallback' }; // "standing desk" at the cooler — unlimited
  }

  private seatFor(ref: SeatRef): Seat {
    const { zones } = this.deps;
    if (ref.kind === 'office') return zones.offices[ref.index].seat;
    if (ref.kind === 'hot') return zones.hotDesks[ref.index];
    return zones.cooler;
  }

  private freeSeat(ref: SeatRef): void {
    if (ref.kind === 'office') this.officeUsed[ref.index] = false;
    else if (ref.kind === 'hot') this.hotUsed[ref.index] = false;
  }

  private spawnSubagent(workspaceId: string, childId: string, label: string): void {
    if (this.subs.has(childId)) return;
    const { zones, walkable } = this.deps;
    const parent = this.agents.get(workspaceId);
    let start: Vec2 = zones.entrance;
    if (parent && parent.brain.phase !== 'gone') {
      const t = parent.brain.tile;
      if (walkable[t.y]?.[t.x]) {
        start = t;
      } else if (parent.seatRef.kind === 'office') {
        start = zones.offices[parent.seatRef.index].door;
      }
    }
    let warSeatIndex: number | null = null;
    for (let i = 0; i < this.warUsed.length; i++) {
      if (!this.warUsed[i]) {
        this.warUsed[i] = true;
        warSeatIndex = i;
        break;
      }
    }
    const seat = warSeatIndex !== null ? zones.warRoom.seats[warSeatIndex] : null;
    const brain = new SubagentBrain(childId, label, lookIndexFor(childId), start, seat, {
      walkable,
      warRoomDoor: zones.warRoom.door,
    });
    this.subs.set(childId, { brain, parentId: workspaceId, warSeatIndex });
  }

  private subGone(childId: string): (at: Vec2) => void {
    return (at) => {
      this.effects.push({ kind: 'poof', at });
      const entry = this.subs.get(childId);
      if (entry && entry.warSeatIndex !== null) this.warUsed[entry.warSeatIndex] = false;
      this.subs.delete(childId);
    };
  }

  private sweepChildren(parentId: string): void {
    for (const [childId, entry] of this.subs) {
      if (entry.parentId === parentId) {
        entry.brain.finish(undefined, false, this.subGone(childId));
      }
    }
  }
}
