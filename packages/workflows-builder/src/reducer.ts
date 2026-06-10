/**
 * A typed reducer over {@link BuilderState} that dispatches to the pure
 * operations. Both platforms drive the canvas through `useReducer(builderReducer)`
 * (or an equivalent store), so all state transitions are centralized and
 * replayable. Validation results arrive as their own action so the async
 * bridge stays outside the reducer.
 */

import type { BuilderState } from './types.js';
import {
  addStep,
  connectNeeds,
  disconnectNeeds,
  moveNode,
  removeStep,
  removeSwitchCase,
  renameNode,
  selectNode,
  setBranchTargets,
  setLoopBody,
  setLoopConfig,
  setLoopExit,
  setSwitchCase,
  setViewport,
  updateMeta,
  updateNode,
  type AddStepInput,
  type BranchSlot,
  type NodeFieldPatch,
} from './operations.js';

export type BuilderAction =
  | { type: 'load'; state: BuilderState }
  | { type: 'add-step'; input: AddStepInput }
  | { type: 'remove-step'; id: string }
  | { type: 'move-node'; id: string; x: number; y: number }
  | { type: 'set-viewport'; viewport: BuilderState['viewport'] }
  | { type: 'select'; id: string | null }
  | { type: 'connect-needs'; from: string; to: string }
  | { type: 'disconnect-needs'; from: string; to: string }
  | { type: 'set-branch'; nodeId: string; slot: BranchSlot; targets: ReadonlyArray<string> }
  | { type: 'set-case'; nodeId: string; caseId: string; targets: ReadonlyArray<string> }
  | { type: 'remove-case'; nodeId: string; caseId: string }
  | { type: 'set-loop-body'; loopId: string; body: ReadonlyArray<string> }
  | { type: 'set-loop-exit'; loopId: string; targetId: string | null }
  | { type: 'set-loop-config'; loopId: string; patch: Parameters<typeof setLoopConfig>[2] }
  | { type: 'update-node'; id: string; patch: NodeFieldPatch }
  | { type: 'rename-node'; from: string; to: string }
  | { type: 'update-meta'; patch: Partial<BuilderState['meta']> }
  | { type: 'apply-validation'; errors: Record<string, ReadonlyArray<string>> }
  | { type: 'mark-saved' };

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'load':
      return action.state;
    case 'add-step':
      return addStep(state, action.input);
    case 'remove-step':
      return removeStep(state, action.id);
    case 'move-node':
      return moveNode(state, action.id, action.x, action.y);
    case 'set-viewport':
      return setViewport(state, action.viewport);
    case 'select':
      return selectNode(state, action.id);
    case 'connect-needs':
      return connectNeeds(state, action.from, action.to);
    case 'disconnect-needs':
      return disconnectNeeds(state, action.from, action.to);
    case 'set-branch':
      return setBranchTargets(state, action.nodeId, action.slot, action.targets);
    case 'set-case':
      return setSwitchCase(state, action.nodeId, action.caseId, action.targets);
    case 'remove-case':
      return removeSwitchCase(state, action.nodeId, action.caseId);
    case 'set-loop-body':
      return setLoopBody(state, action.loopId, action.body);
    case 'set-loop-exit':
      return setLoopExit(state, action.loopId, action.targetId);
    case 'set-loop-config':
      return setLoopConfig(state, action.loopId, action.patch);
    case 'update-node':
      return updateNode(state, action.id, action.patch);
    case 'rename-node':
      return renameNode(state, action.from, action.to);
    case 'update-meta':
      return updateMeta(state, action.patch);
    case 'apply-validation':
      return { ...state, errors: action.errors };
    case 'mark-saved':
      return { ...state, dirty: false };
    default:
      return state;
  }
}
