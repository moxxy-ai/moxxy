import type { ComputerControlSnapshot, ComputerControlState } from '@moxxy/sdk';

export interface ComputerScope { workspaceId:string; sessionId:string; turnId:string }
export interface ComputerPanelView { label:string; canPause:boolean; canResume:boolean; canStop:boolean }
export interface ComputerSnapshots {workspaceId:string;turns:ReadonlyArray<ComputerControlSnapshot>}
const labels:Record<ComputerControlState,string>={
  idle:'Computer Use ready',background:'Working in the background',foreground:'Controlling the target window',
  waiting_for_focus:'Waiting for the target window',paused_by_user:'Paused by you',
  recovering:'Checking the target',stopped:'Computer Use stopped',failed:'Computer Use unavailable',
};

export function computerPanel(scope:ComputerScope, response:ComputerSnapshots):ComputerPanelView|null {
  if (response.workspaceId!==scope.workspaceId) return null;
  const target=response.turns.find(item=>item.sessionId===scope.sessionId && item.turnId===scope.turnId);
  if (!target) return null;
  const terminal=target.state==='stopped' || target.state==='failed';
  return {
    label:labels[target.state],canStop:!terminal,
    canPause:!terminal && target.state!=='paused_by_user',
    canResume:target.state==='paused_by_user' || target.state==='waiting_for_focus',
  };
}
