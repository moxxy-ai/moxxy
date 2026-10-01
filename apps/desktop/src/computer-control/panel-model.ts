import type { ComputerControlSnapshot, ComputerControlState } from '@moxxy/sdk';
import type { IconName } from '@moxxy/desktop-ui';

export interface ComputerScope { workspaceId:string; sessionId:string; turnId:string }
export interface ComputerPanelView {
  label:string; icon:IconName;
  /** The app (and window) under control; `null` until the agent has looked at one. */
  target:string|null;
  canTakeOver:boolean; canResume:boolean; canStop:boolean;
}
export interface ComputerSnapshots {workspaceId:string;turns:ReadonlyArray<ComputerControlSnapshot>}
export type ComputerPanelCommand='takeover'|'resume'|'stop';
const states:Record<ComputerControlState,{label:string;icon:IconName}>={
  idle:{label:'Computer Use ready',icon:'check'},
  background:{label:'Working in the background',icon:'play'},
  foreground:{label:'Controlling the target window',icon:'play'},
  waiting_for_focus:{label:'Waiting for the target window',icon:'focus'},
  paused_by_user:{label:'Paused by you',icon:'pause'},
  recovering:{label:'Checking the target',icon:'rotate'},
  stopped:{label:'Computer Use stopped',icon:'stop'},
  failed:{label:'Computer Use unavailable',icon:'x'},
};

/** Every Computer Use tool, on every platform, carries this prefix. */
export function usesComputer(tools:ReadonlyArray<{name:string}>):boolean {
  return tools.some(tool=>tool.name.startsWith('computer_'));
}

export function computerPanel(scope:ComputerScope, response:ComputerSnapshots):ComputerPanelView|null {
  if (response.workspaceId!==scope.workspaceId) return null;
  const turn=response.turns.find(item=>item.sessionId===scope.sessionId && item.turnId===scope.turnId);
  if (!turn) return null;
  const terminal=turn.state==='stopped' || turn.state==='failed';
  return {
    ...states[turn.state],
    target:turn.target ? [turn.target.app,turn.target.window].filter(Boolean).join(' — ') : null,
    canStop:!terminal,
    canTakeOver:!terminal && turn.state!=='paused_by_user',
    canResume:turn.state==='paused_by_user' || turn.state==='waiting_for_focus',
  };
}
